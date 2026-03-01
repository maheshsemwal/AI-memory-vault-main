import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '../prisma/client.js';
import { supabase, downloadFileWithRetry } from '../config/supabase.js';
import { extractWithDocling } from './extractors/doclingClient.js';
import { splitText } from './splitters/textSplitter.js';
import { embedTexts } from './embedders/hfEmbedder.js';
import { upsertVectors, isPineconeEnabled } from './vectorstores/pineconeClient.js';
import { isGraphEnabled, initNeo4jDriver, createIndexesAndConstraints, closeDriver as closeNeo4jDriver } from './graph/neo4jClient.js';
import { extractEntities } from './graph/entityExtractor.js';
import { buildGraph } from './graph/graphBuilder.js';

interface ProcessFileJob {
  fileId: string;
}

/**
 * Create Redis connection for BullMQ
 */
const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

/**
 * Process a single file: extract, chunk, embed, and store
 */
async function processFile(job: Job<ProcessFileJob>): Promise<void> {
  const { fileId } = job.data;
  
  console.log(`\n========== Processing File: ${fileId} ==========`);
  console.log(`[Worker] Job ID: ${job.id}`);

  let file = null;

  try {
    // Step 1: Update file status to "processing"
    console.log(`[Worker] Step 1: Updating file status to 'processing'`);
    file = await prisma.file.update({
      where: { id: fileId },
      data: { status: 'processing', error: null },
    });

    console.log(`[Worker] File: ${file.filename} (${file.mimeType}, ${file.size} bytes)`);

    // Step 2: Download file from Supabase
    console.log(`[Worker] Step 2: Downloading file from Supabase`);
    console.log(`[Worker] Bucket: ${process.env.S3_BUCKET}, Key: ${file.key}`);
    
    let fileData: Blob;
    try {
      fileData = await downloadFileWithRetry(process.env.S3_BUCKET!, file.key, 3);
    } catch (downloadError: any) {
      console.error(`[Worker] Download error details:`, {
        bucket: process.env.S3_BUCKET,
        key: file.key,
        supabaseUrl: process.env.SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        error: downloadError.message,
      });
      throw new Error(`Failed to download file from Supabase: ${downloadError.message}`);
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    console.log(`[Worker] Downloaded ${buffer.length} bytes`);

    // Step 3: Extract text with Docling
    console.log(`[Worker] Step 3: Extracting text with Docling`);
    const markdown = await extractWithDocling(buffer, file.filename);
    
    if (!markdown || markdown.trim().length === 0) {
      throw new Error('Docling returned empty text');
    }

    // Step 4: Split into chunks
    console.log(`[Worker] Step 4: Splitting text into chunks`);
    const chunks = await splitText(markdown);

    if (chunks.length === 0) {
      throw new Error('Text splitting produced no chunks');
    }

    console.log(`[Worker] Created ${chunks.length} chunks`);

    // Step 5: Generate embeddings
    console.log(`[Worker] Step 5: Generating embeddings`);
    const embeddings = await embedTexts(chunks);

    if (embeddings.length !== chunks.length) {
      throw new Error(
        `Embedding count (${embeddings.length}) does not match chunk count (${chunks.length})`
      );
    }

    console.log(`[Worker] Generated ${embeddings.length} embeddings`);

    // Step 6: Store in Pinecone (if configured)
    let pineconeIds: string[] = [];
    
    if (isPineconeEnabled()) {
      console.log(`[Worker] Step 6: Upserting vectors to Pinecone`);
      pineconeIds = await upsertVectors(fileId, embeddings, chunks);
      console.log(`[Worker] Upserted ${pineconeIds.length} vectors to Pinecone`);
    } else {
      console.log(`[Worker] Step 6: Skipping Pinecone (not configured)`);
    }

    // Step 7: Create Document records in database
    console.log(`[Worker] Step 7: Creating Document records in database`);
    
    const documents = chunks.map((chunk, index) => ({
      fileId: fileId,
      chunk: index,
      text: chunk,
      pineconeId: pineconeIds[index] || null,
    }));

    // Use transaction to ensure all documents are created atomically
    await prisma.$transaction(async (tx) => {
      // Delete any existing documents for this file (in case of reprocessing)
      await tx.document.deleteMany({
        where: { fileId: fileId },
      });

      // Create new documents
      await tx.document.createMany({
        data: documents,
      });
    });

    console.log(`[Worker] Created ${documents.length} Document records`);

    // Step 8: Build Knowledge Graph (if enabled)
    if (isGraphEnabled()) {
      console.log(`[Worker] Step 8: Building Knowledge Graph`);
      
      try {
        let graphSuccessCount = 0;
        let graphFailCount = 0;

        // Process each chunk for graph extraction
        for (let i = 0; i < chunks.length; i++) {
          try {
            const chunk = chunks[i];
            if (!chunk) {
              console.warn(`[Worker] Chunk ${i} is undefined, skipping`);
              continue;
            }

            console.log(`[Worker] Extracting entities from chunk ${i + 1}/${chunks.length}`);
            
            // Extract entities and relationships from chunk text
            const extraction = await extractEntities(chunk);
            
            if (extraction.entities.length === 0) {
              console.log(`[Worker] No entities found in chunk ${i}`);
              continue;
            }

            // Build graph for this chunk
            const chunkId = `${fileId}-${i}`;
            const success = await buildGraph({
              userId: file.userId,
              fileId: fileId,
              fileName: file.filename,
              chunkId: chunkId,
              chunkIndex: i,
              chunkText: chunk,
              entities: extraction.entities,
              relations: extraction.relations,
            });

            if (success) {
              graphSuccessCount++;
            } else {
              graphFailCount++;
            }
          } catch (graphError: any) {
            console.error(`[Worker] Graph processing failed for chunk ${i}: ${graphError.message}`);
            graphFailCount++;
            // Continue to next chunk - don't fail the entire job
          }
        }

        console.log(
          `[Worker] Graph processing complete: ${graphSuccessCount} succeeded, ${graphFailCount} failed`
        );
      } catch (graphError: any) {
        // Graph layer is additive - log error but don't fail the job
        console.error(`[Worker] Graph layer error (non-fatal): ${graphError.message}`);
      }
    } else {
      console.log(`[Worker] Step 8: Skipping Knowledge Graph (not enabled)`);
    }

    // Step 9: Update file status to "done"
    console.log(`[Worker] Step 9: Updating file status to 'done'`);
    await prisma.file.update({
      where: { id: fileId },
      data: { 
        status: 'done',
        error: null,
      },
    });

    console.log(`[Worker] ✅ Successfully processed file: ${file.filename}`);
    console.log(`========== Completed: ${fileId} ==========\n`);

  } catch (error: any) {
    console.error(`[Worker] ❌ Error processing file: ${error.message}`);
    console.error(error.stack);

    // Update file status to "failed" and store error message
    try {
      await prisma.file.update({
        where: { id: fileId },
        data: {
          status: 'failed',
          error: error.message || 'Unknown error occurred',
        },
      });
      console.log(`[Worker] Updated file status to 'failed'`);
    } catch (updateError: any) {
      console.error(`[Worker] Failed to update file status:`, updateError.message);
    }

    // Re-throw to let BullMQ handle retries
    throw error;
  }
}

/**
 * Create and start the BullMQ worker
 */
console.log('🚀 Starting BullMQ Worker for file processing...');
console.log(`📦 Queue: process-file`);
console.log(`🔗 Redis: ${process.env.REDIS_URL}`);
console.log(`🗄️  Bucket: ${process.env.S3_BUCKET}`);
console.log(`🐍 Docling: ${process.env.DOCLING_URL}`);
console.log(`🤗 HF Model: ${process.env.HF_EMBEDDING_MODEL}`);
console.log(`📌 Pinecone: ${isPineconeEnabled() ? 'Enabled' : 'Disabled'}`);
console.log(`🕸️  Graph: ${isGraphEnabled() ? 'Enabled' : 'Disabled'}`);

// Initialize Neo4j if enabled
if (isGraphEnabled()) {
  initNeo4jDriver();
  // Create indexes and constraints on startup
  createIndexesAndConstraints().catch((err) => {
    console.error('[Worker] Failed to create Neo4j indexes:', err.message);
  });
}

console.log('');

const worker = new Worker<ProcessFileJob>(
  'process-file',
  processFile,
  {
    connection,
    concurrency: 1, // Process one file at a time to avoid overwhelming services
    limiter: {
      max: 10, // Max 10 jobs
      duration: 60000, // per minute
    },
    settings: {
      backoffStrategy: (attemptsMade: number) => {
        // Exponential backoff: 10s, 30s, 90s, 270s...
        return Math.min(10000 * Math.pow(3, attemptsMade), 300000);
      },
    },
  }
);

/**
 * Worker event handlers
 */
worker.on('completed', (job: Job) => {
  console.log(`✅ Job ${job.id} completed successfully`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
  console.error(`❌ Job ${job?.id} failed:`, error.message);
  
  if (job && job.attemptsMade < (job.opts.attempts || 3)) {
    console.log(`🔄 Job will be retried (attempt ${job.attemptsMade + 1})`);
  }
});

worker.on('error', (error: Error) => {
  console.error('❌ Worker error:', error.message);
});

worker.on('stalled', (jobId: string) => {
  console.warn(`⚠️  Job ${jobId} stalled`);
});

/**
 * Graceful shutdown
 */
async function gracefulShutdown() {
  console.log('\n🛑 Shutting down worker...');
  
  try {
    await worker.close();
    await connection.quit();
    await prisma.$disconnect();
    
    // Close Neo4j driver if enabled
    if (isGraphEnabled()) {
      await closeNeo4jDriver();
    }
    
    console.log('✅ Worker shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

console.log('✅ Worker is ready and waiting for jobs...\n');

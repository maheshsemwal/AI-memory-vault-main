import { Pinecone } from '@pinecone-database/pinecone';

interface VectorRecord {
  id: string;
  values: number[];
  metadata?: Record<string, any>;
}

let pineconeClient: Pinecone | null = null;
let pineconeIndex: any = null;

/**
 * Initialize Pinecone client (singleton)
 * Only initializes if PINECONE_API_KEY is configured
 */
function initPinecone() {
  if (pineconeClient) {
    return pineconeClient;
  }

  const apiKey = process.env.PINECONE_API_KEY;

  // If Pinecone is not configured, return null
  if (!apiKey) {
    console.log('[Pinecone] PINECONE_API_KEY not set - vector storage disabled');
    return null;
  }

  const indexName = process.env.PINECONE_INDEX;

  if (!indexName) {
    console.warn('[Pinecone] PINECONE_INDEX not set - vector storage disabled');
    return null;
  }

  try {
    console.log(`[Pinecone] Initializing client for index: ${indexName}`);
    
    pineconeClient = new Pinecone({
      apiKey: apiKey,
    });

    pineconeIndex = pineconeClient.index(indexName);

    console.log('[Pinecone] Client initialized successfully');
    return pineconeClient;
  } catch (error: any) {
    console.error('[Pinecone] Failed to initialize:', error.message);
    return null;
  }
}

/**
 * Check if Pinecone is configured and available
 */
export function isPineconeEnabled(): boolean {
  const client = initPinecone();
  return client !== null;
}

/**
 * Upsert vectors to Pinecone index
 * @param fileId - File ID for creating vector IDs
 * @param embeddings - Array of embedding vectors
 * @param chunks - Corresponding text chunks
 * @returns Array of Pinecone IDs (format: fileId-chunkIndex)
 */
export async function upsertVectors(
  fileId: string,
  embeddings: number[][],
  chunks: string[]
): Promise<string[]> {
  const client = initPinecone();

  if (!client || !pineconeIndex) {
    console.log('[Pinecone] Skipping vector upsert - not configured');
    return [];
  }

  if (embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count (${embeddings.length}) does not match chunk count (${chunks.length})`
    );
  }

  console.log(`[Pinecone] Upserting ${embeddings.length} vectors for file: ${fileId}`);

  // Prepare vectors in Pinecone format
  const vectors: VectorRecord[] = embeddings.map((embedding, index) => ({
    id: `${fileId}-${index}`,
    values: embedding,
    metadata: {
      fileId: fileId,
      chunkIndex: index,
      text: (chunks[index] || '').substring(0, 1000), // Store first 1000 chars in metadata
      createdAt: new Date().toISOString(),
    },
  }));

  try {
    // Upsert in batches of 100 (Pinecone limit)
    const batchSize = 100;
    const pineconeIds: string[] = [];

    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, Math.min(i + batchSize, vectors.length));
      
      console.log(
        `[Pinecone] Upserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)} (${batch.length} vectors)`
      );

      await pineconeIndex.upsert(batch);
      
      pineconeIds.push(...batch.map(v => v.id));
    }

    console.log(`[Pinecone] Successfully upserted ${pineconeIds.length} vectors`);
    return pineconeIds;
  } catch (error: any) {
    console.error('[Pinecone] Upsert failed:', error.message);
    throw new Error(`Pinecone upsert failed: ${error.message}`);
  }
}

/**
 * Delete vectors for a file from Pinecone
 * @param fileId - File ID
 */
export async function deleteVectors(fileId: string): Promise<void> {
  const client = initPinecone();

  if (!client || !pineconeIndex) {
    console.log('[Pinecone] Skipping vector deletion - not configured');
    return;
  }

  try {
    console.log(`[Pinecone] Deleting vectors for file: ${fileId}`);

    // Delete by metadata filter
    await pineconeIndex.deleteMany({
      filter: {
        fileId: { $eq: fileId },
      },
    });

    console.log(`[Pinecone] Successfully deleted vectors for file: ${fileId}`);
  } catch (error: any) {
    console.error('[Pinecone] Delete failed:', error.message);
    throw new Error(`Pinecone delete failed: ${error.message}`);
  }
}

/**
 * Query similar vectors from Pinecone
 * @param embedding - Query embedding vector
 * @param topK - Number of results to return
 * @param filter - Optional metadata filter
 * @returns Array of matching results with scores
 */
export async function querySimilar(
  embedding: number[],
  topK: number = 10,
  filter?: Record<string, any>
): Promise<Array<{ id: string; score: number; metadata?: any }>> {
  const client = initPinecone();

  if (!client || !pineconeIndex) {
    console.warn('[Pinecone] Query called but Pinecone not configured');
    return [];
  }

  try {
    const queryRequest: any = {
      vector: embedding,
      topK: topK,
      includeMetadata: true,
    };

    if (filter) {
      queryRequest.filter = filter;
    }

    const results = await pineconeIndex.query(queryRequest);

    console.log(`[Pinecone] Query returned ${results.matches?.length || 0} results`);

    return (results.matches || []).map((match: any) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata,
    }));
  } catch (error: any) {
    console.error('[Pinecone] Query failed:', error.message);
    throw new Error(`Pinecone query failed: ${error.message}`);
  }
}

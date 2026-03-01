# Worker Integration - Quick Start Guide

## ✅ Setup Complete

All worker components have been successfully implemented:

- ✅ **doclingClient.ts** - Document extraction with retry logic
- ✅ **textSplitter.ts** - Text chunking with LangChain
- ✅ **hfEmbedder.ts** - Embedding generation with HuggingFace
- ✅ **pineconeClient.ts** - Optional vector storage
- ✅ **ingest.worker.ts** - Main orchestration worker
- ✅ **queue.ts** - Queue management utilities

---

## 🚀 Running the System

### 1. Set Up Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# Required
DATABASE_URL="postgresql://..."
REDIS_URL="redis://127.0.0.1:6379"
S3_BUCKET="your-bucket-name"
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="..."
DOCLING_URL="http://localhost:8000"
HF_API_KEY="hf_..."
HF_EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2"

# Optional (for vector search)
PINECONE_API_KEY="..."
PINECONE_INDEX="your-index-name"
```

### 2. Start Redis

```bash
# Using Docker
docker run -d -p 6379:6379 redis:latest

# Or using local Redis
redis-server
```

### 3. Start Python Docling Service

```bash
cd doclingSVC
python main.py
# Should run on http://localhost:8000
```

### 4. Start the Backend API

```bash
cd backend
bun run dev:api
# Runs on http://localhost:5000
```

### 5. Start the Worker

```bash
cd backend
bun run dev:worker
```

You should see:
```
🚀 Starting BullMQ Worker for file processing...
📦 Queue: process-file
🔗 Redis: redis://127.0.0.1:6379
🗄️  Bucket: your-bucket
🐍 Docling: http://localhost:8000
🤗 HF Model: sentence-transformers/all-MiniLM-L6-v2
📌 Pinecone: Enabled (or Disabled)
✅ Worker is ready and waiting for jobs...
```

---

## 📝 How It Works

### Upload Flow

1. **Frontend** requests presigned URL
   ```typescript
   POST /upload/presign
   { filename: "document.pdf", mimeType: "application/pdf" }
   ```

2. **Backend** returns signed URL
   ```typescript
   { signedUploadUrl: "https://...", path: "uploads/userId/..." }
   ```

3. **Frontend** uploads directly to Supabase
   ```typescript
   PUT signedUploadUrl (binary file data)
   ```

4. **Frontend** confirms upload
   ```typescript
   POST /upload/complete
   { path, filename, mimeType, size }
   ```

5. **Backend** creates File record + enqueues job
   ```typescript
   await fileQueue.add('process-file', { fileId: file.id });
   ```

6. **Worker** processes the job:
   ```
   uploaded → processing → [extract → chunk → embed → store] → done
   ```

### Worker Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Update status to "processing"                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ 2. Download file from Supabase (using file.key)            │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ 3. Extract markdown via Docling service                     │
│    POST /extract with multipart/form-data                   │
│    Returns: { text: "...", metadata: {...} }                │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ 4. Split text into chunks                                   │
│    LangChain RecursiveCharacterTextSplitter                 │
│    chunkSize: 1000, overlap: 200                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ 5. Generate embeddings                                      │
│    HuggingFace API in batches of 32                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ 6. Upsert to Pinecone (if enabled)                          │
│    Vector ID: ${fileId}-${chunkIndex}                       │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ 7. Create Document records in database                      │
│    Transaction: delete old + create new                     │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ 8. Update status to "done"                                  │
└─────────────────────────────────────────────────────────────┘

If error occurs at any step:
  → Update status to "failed"
  → Store error in file.error
  → BullMQ retries with exponential backoff (10s, 30s, 90s)
```

---

## 🧪 Testing the Pipeline

### Upload a Test File

```bash
# 1. Login and get token
curl -X POST http://localhost:5000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password"}'

# 2. Get presigned URL
curl -X POST http://localhost:5000/upload/presign \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.pdf", "mimeType": "application/pdf"}'

# 3. Upload file to Supabase (use signedUploadUrl from response)
curl -X PUT "SIGNED_URL" \
  --data-binary @test.pdf

# 4. Complete upload
curl -X POST http://localhost:5000/upload/complete \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "uploads/userId/...",
    "filename": "test.pdf",
    "mimeType": "application/pdf",
    "size": 12345
  }'
```

### Monitor Processing

Watch the worker logs:
```
========== Processing File: clxxxxx ==========
[Worker] Job ID: 1
[Worker] Step 1: Updating file status to 'processing'
[Worker] File: test.pdf (application/pdf, 12345 bytes)
[Worker] Step 2: Downloading file from Supabase
[Worker] Downloaded 12345 bytes
[Worker] Step 3: Extracting text with Docling
[Docling] Attempt 1/3 for file: test.pdf
[Docling] Successfully extracted 5432 characters
[Worker] Step 4: Splitting text into chunks
[TextSplitter] Created 6 chunks
[Worker] Step 5: Generating embeddings
[HF Embedder] Processing batch 1/1 (6 items)
[Worker] Step 6: Upserting vectors to Pinecone
[Pinecone] Upserting batch 1/1 (6 vectors)
[Worker] Step 7: Creating Document records
[Worker] Created 6 Document records
[Worker] Step 8: Updating file status to 'done'
✅ Successfully processed file: test.pdf
========== Completed: clxxxxx ==========
```

### Check Database

```sql
-- Check file status
SELECT id, filename, status, error, "createdAt" 
FROM "File" 
ORDER BY "createdAt" DESC 
LIMIT 5;

-- Check generated documents
SELECT id, "fileId", chunk, LEFT(text, 100) as preview 
FROM "Document" 
WHERE "fileId" = 'YOUR_FILE_ID'
ORDER BY chunk;

-- Count documents per file
SELECT f.filename, COUNT(d.id) as chunks
FROM "File" f
LEFT JOIN "Document" d ON d."fileId" = f.id
GROUP BY f.id, f.filename;
```

---

## 🛠️ Queue Management

Use the queue utilities for monitoring and management:

```typescript
import {
  enqueueFile,
  getQueueStats,
  getJob,
  getJobs,
  retryJob,
  removeJob,
} from './workers/queue';

// Get queue statistics
const stats = await getQueueStats();
console.log(stats);
// { waiting: 5, active: 1, completed: 42, failed: 2, delayed: 0, total: 50 }

// Get failed jobs
const failed = await getJobs('failed', 0, 10);
console.log(failed);

// Retry a failed job
await retryJob('job-id-123');

// Check specific job status
const job = await getJob('job-id-123');
console.log(job.state); // 'completed' | 'failed' | 'active' | 'waiting'
```

---

## 🔧 Troubleshooting

### Worker not processing jobs

1. **Check Redis connection**
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

2. **Check queue has jobs**
   ```bash
   redis-cli
   > KEYS bull:process-file:*
   ```

3. **Check worker logs for errors**

### Docling timeout

1. **Check Python service is running**
   ```bash
   curl http://localhost:8000/health
   ```

2. **Increase timeout** in `doclingClient.ts`
   ```typescript
   const timeout = 120000; // 2 minutes
   ```

### Embedding fails

1. **Verify HuggingFace API key**
   ```bash
   curl -H "Authorization: Bearer $HF_API_KEY" \
     https://huggingface.co/api/whoami
   ```

2. **Check model name**
   ```bash
   # Valid models:
   # - sentence-transformers/all-MiniLM-L6-v2 (384 dims)
   # - sentence-transformers/all-mpnet-base-v2 (768 dims)
   # - BAAI/bge-small-en-v1.5 (384 dims)
   ```

3. **Check rate limits** - Free tier has limits

### Pinecone errors

1. **Verify index dimension matches model**
   ```typescript
   // Model: all-MiniLM-L6-v2 → dimension: 384
   // Model: all-mpnet-base-v2 → dimension: 768
   ```

2. **Check index exists**
   - Go to Pinecone dashboard
   - Verify index name matches `PINECONE_INDEX`

3. **Verify API key** - Check in Pinecone console

---

## 📊 Monitoring

### Redis Queue Inspector

Install BullMQ Board for visual monitoring:

```bash
bun add @bull-board/api @bull-board/express
```

Add to your Express app:
```typescript
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullMQAdapter(fileQueue)],
  serverAdapter: serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());
```

Access at: `http://localhost:5000/admin/queues`

---

## 🎯 Next Steps

1. **Add query endpoint** for semantic search
2. **Implement chat** with RAG using stored embeddings
3. **Add file deletion** with vector cleanup
4. **Add reprocessing** endpoint for failed files
5. **Add batch upload** support
6. **Implement usage tracking** (tokens, storage)

---

## 📚 API Reference

See [workers/README.md](./README.md) for detailed component documentation.

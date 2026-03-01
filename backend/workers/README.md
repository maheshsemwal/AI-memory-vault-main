# Workers Directory

This directory contains the BullMQ worker implementation for processing uploaded files in the AI Memory Vault system.

## Architecture

### 📁 Structure

```
workers/
├── extractors/
│   └── doclingClient.ts      # Python Docling service integration
├── splitters/
│   └── textSplitter.ts        # LangChain text chunking
├── embedders/
│   └── hfEmbedder.ts          # HuggingFace embedding API
├── vectorstores/
│   └── pineconeClient.ts      # Pinecone vector database (optional)
├── graph/                     # Knowledge Graph (Neo4j) - NEW! 🧠
│   ├── neo4jClient.ts         # Neo4j driver & session management
│   ├── entityExtractor.ts     # AI-powered entity extraction
│   ├── graphBuilder.ts        # Graph construction logic
│   ├── README.md              # Full graph documentation
│   └── QUICKSTART.md          # 5-minute setup guide
├── ingest.worker.ts           # Main worker orchestration
└── queue.ts                   # Queue management utilities
```

### 🔄 Processing Pipeline

When a file is uploaded and enqueued, the worker executes these steps:

1. **Status Update** → Set file status to `processing`
2. **Download** → Fetch file from Supabase storage
3. **Extract** → Send to Docling service, receive markdown
4. **Chunk** → Split markdown into 1000-char chunks (200 overlap)
5. **Embed** → Generate embeddings via HuggingFace API (batches of 32)
6. **Store Vectors** → Upsert to Pinecone (if configured)
7. **Save DB** → Create Document records in Prisma
8. **Build Graph** → Extract entities & build knowledge graph (if enabled) 🧠 NEW!
9. **Complete** → Set file status to `done`

On error: Set status to `failed` + store error message.

---

## 🧩 Components

### 1. **doclingClient.ts**

Extracts text from documents using the Python Docling service.

**Features:**
- Multipart/form-data upload
- 60-second timeout
- 3 retry attempts with exponential backoff
- Clear error messages

**Usage:**
```typescript
import { extractWithDocling } from './extractors/doclingClient';

const markdown = await extractWithDocling(buffer, filename);
```

**Environment:**
- `DOCLING_URL` - Python service endpoint (e.g., `http://localhost:8000`)

---

### 2. **textSplitter.ts**

Splits markdown text into chunks using LangChain's RecursiveCharacterTextSplitter.

**Configuration:**
- `chunkSize: 1000`
- `chunkOverlap: 200`

**Usage:**
```typescript
import { splitText } from './splitters/textSplitter';

const chunks = await splitText(markdown);
```

---

### 3. **hfEmbedder.ts**

Generates embeddings using HuggingFace Inference API.

**Features:**
- Batch processing (max 32 texts per batch)
- Automatic retry with exponential backoff
- Response normalization (handles different model output formats)
- Rate limit handling

**Usage:**
```typescript
import { embedTexts, embedText } from './embedders/hfEmbedder';

// Batch
const embeddings = await embedTexts(chunks);

// Single
const embedding = await embedText(text);
```

**Environment:**
- `HF_API_KEY` - HuggingFace API key
- `HF_EMBEDDING_MODEL` - Model name (e.g., `sentence-transformers/all-MiniLM-L6-v2`)

---

### 4. **pineconeClient.ts**

Manages vector storage in Pinecone (optional).

**Features:**
- Singleton client initialization
- Graceful fallback if not configured
- Batch upserts (100 vectors per batch)
- Vector ID format: `${fileId}-${chunkIndex}`
- Metadata storage (fileId, chunkIndex, text preview)

**Usage:**
```typescript
import { 
  isPineconeEnabled, 
  upsertVectors, 
  deleteVectors,
  querySimilar 
} from './vectorstores/pineconeClient';

if (isPineconeEnabled()) {
  const ids = await upsertVectors(fileId, embeddings, chunks);
}
```

**Environment:**
- `PINECONE_API_KEY` - API key (optional)
- `PINECONE_INDEX` - Index name (optional)

---

### 5. **ingest.worker.ts**

Main worker that orchestrates the entire pipeline.

**Features:**
- Single concurrency (processes one file at a time)
- Rate limiting (10 jobs per minute)
- Exponential backoff retry strategy
- Transaction safety for DB operations
- Graceful shutdown handling
- Comprehensive logging

**Status Flow:**
```
uploaded → processing → done
                     ↘ failed (on error)
```

---

### 6. **Knowledge Graph Layer** (graph/) 🧠 NEW!

AI-powered entity extraction and relationship mapping using Neo4j.

**Components:**

**neo4jClient.ts** - Singleton Neo4j driver
- Connection pooling
- Session management
- Batch operations
- Index/constraint creation

**entityExtractor.ts** - AI entity extraction
- Uses HuggingFace LLMs
- Extracts entities (Person, Tech, Concept, etc.)
- Identifies relationships
- Robust JSON validation

**graphBuilder.ts** - Graph construction
- MERGE-based operations (no duplicates)
- Batch writes
- Query utilities

**Graph Schema:**
```
(User)-[:UPLOADED]->(Document)-[:CONTAINS]->(Chunk)-[:MENTIONS]->(Entity)
(Entity)-[:RELATED_TO|USES|PART_OF]->(Entity)
```

**Quick Setup:**
```bash
# Install Neo4j
docker run -d -p 7687:7687 -e NEO4J_AUTH=neo4j/password neo4j

# Enable in .env
ENABLE_GRAPH="true"
NEO4J_URI="bolt://localhost:7687"
NEO4J_USERNAME="neo4j"
NEO4J_PASSWORD="password"
```

**See:** [graph/QUICKSTART.md](graph/QUICKSTART.md) for 5-minute setup  
**See:** [graph/README.md](graph/README.md) for full documentation

---

## 🚀 Running the Worker

### Start the worker:
```bash
bun run dev:worker
```

### Environment Variables Required:

**Core:**
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `S3_BUCKET` - Supabase storage bucket
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key

**Services:**
- `DOCLING_URL` - Python Docling endpoint
- `HF_API_KEY` - HuggingFace API key
- `HF_EMBEDDING_MODEL` - Embedding model name

**Optional (Pinecone):**
- `PINECONE_API_KEY` - Pinecone API key
- `PINECONE_INDEX` - Index name

**Optional (Knowledge Graph - Neo4j):** 🧠
- `ENABLE_GRAPH` - Set to "true" to enable (default: false)
- `NEO4J_URI` - Bolt connection string (e.g., bolt://localhost:7687)
- `NEO4J_USERNAME` - Database username
- `NEO4J_PASSWORD` - Database password
- `HF_EXTRACTION_MODEL` - LLM for entity extraction (optional, default: mistralai/Mistral-7B-Instruct-v0.2)

---

## 🛡️ Error Handling

### Automatic Retries

The worker uses BullMQ's retry mechanism:
- **Backoff:** 10s → 30s → 90s → 270s (exponential)
- **Max Attempts:** 3 (default, configurable in job options)

### Error Storage

All errors are stored in the `File.error` field:
```typescript
{
  status: 'failed',
  error: 'Docling extraction failed: timeout after 60000ms'
}
```

### Graceful Degradation

- If Pinecone is not configured → Skip vector storage, continue processing
- If Docling fails → Mark file as failed, allow BullMQ retry
- If embedding fails → Mark file as failed, store error message

---

## 📊 Monitoring

### Worker Events

```typescript
worker.on('completed', (job) => { ... });
worker.on('failed', (job, error) => { ... });
worker.on('error', (error) => { ... });
worker.on('stalled', (jobId) => { ... });
```

### Logs

The worker provides detailed logging:
```
🚀 Starting BullMQ Worker for file processing...
📦 Queue: process-file
🔗 Redis: redis://127.0.0.1:6379
🗄️  Bucket: my-bucket
🐍 Docling: http://localhost:8000
🤗 HF Model: sentence-transformers/all-MiniLM-L6-v2
📌 Pinecone: Enabled
```

---

## 🔧 Future Extensions

The modular structure allows easy addition of:
- Image extractors (Tesseract.js, GPT-4 Vision)
- Video processors (frame extraction, transcription)
- Additional vector stores (Qdrant, Weaviate)
- Custom text splitters (semantic chunking)
- Alternative embedding providers (OpenAI, Cohere)

To add a new extractor:
1. Create `extractors/newExtractor.ts`
2. Implement extraction logic
3. Update `ingest.worker.ts` to handle new file types
4. Add mimeType detection logic

---

## 📝 Database Schema

### File Table
```prisma
model File {
  id        String   @id @default(cuid())
  userId    String
  key       String   @unique
  filename  String
  mimeType  String
  size      Int
  status    String   @default("uploaded")
  error     String?
  documents Document[]
}
```

### Document Table
```prisma
model Document {
  id         String   @id @default(cuid())
  fileId     String
  chunk      Int
  text       String   @db.Text
  pineconeId String?
}
```

---

## 🧪 Testing

To test the worker:

1. **Upload a file** via the API
2. **Check Redis** for queued jobs
3. **Monitor logs** for processing steps
4. **Verify database** for Document records
5. **Query Pinecone** (if enabled) for vectors

Example test flow:
```bash
# Upload file
curl -X POST http://localhost:5000/upload/complete \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"fileId": "file123"}'

# Check file status
psql $DATABASE_URL -c "SELECT status, error FROM File WHERE id='file123';"

# Check documents
psql $DATABASE_URL -c "SELECT COUNT(*) FROM Document WHERE fileId='file123';"
```

---

## 🚨 Troubleshooting

### Worker not processing jobs
- Check Redis connection
- Verify queue name matches (`process-file`)
- Check worker logs for errors

### Docling timeout
- Increase timeout in `doclingClient.ts`
- Check Python service is running
- Verify network connectivity

### Embedding fails
- Verify HF_API_KEY is valid
- Check model name is correct
- Review API quota/rate limits

### Pinecone errors
- Verify API key and index name
- Check index dimension matches embedding model
- Review Pinecone dashboard for quota

---

## 📚 Dependencies

- **bullmq** - Queue system
- **ioredis** - Redis client
- **@prisma/client** - Database ORM
- **@supabase/supabase-js** - Storage client
- **langchain** - Text splitting
- **node-fetch** - HTTP requests
- **@pinecone-database/pinecone** - Vector storage (optional)

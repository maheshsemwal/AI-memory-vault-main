# Knowledge Graph Quick Setup

Get your Neo4j Knowledge Graph running in 5 minutes! 🚀

## 1️⃣ Install Neo4j

### Option A: Docker (Recommended)

```bash
docker run -d \
  --name ai-memory-vault-neo4j \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your_password_here \
  -v neo4j_data:/data \
  neo4j:latest
```

### Option B: Neo4j Desktop

1. Download from https://neo4j.com/download/
2. Install and create a new database
3. Set password
4. Start the database

## 2️⃣ Configure Environment

Edit your `.env` file:

```bash
# Enable Knowledge Graph
ENABLE_GRAPH="true"

# Neo4j Connection
NEO4J_URI="bolt://localhost:7687"
NEO4J_USERNAME="neo4j"
NEO4J_PASSWORD="your_password_here"

# Optional: Specify LLM for entity extraction
# Default: mistralai/Mistral-7B-Instruct-v0.2
HF_EXTRACTION_MODEL="mistralai/Mistral-7B-Instruct-v0.2"
```

## 3️⃣ Test Connection

```bash
# Access Neo4j Browser
open http://localhost:7474

# Login with:
# - Username: neo4j
# - Password: your_password_here

# Run test query:
MATCH (n) RETURN count(n)
```

## 4️⃣ Start Worker

```bash
cd backend
bun run dev:worker
```

You should see:
```
🚀 Starting BullMQ Worker for file processing...
📦 Queue: process-file
🔗 Redis: redis://127.0.0.1:6379
🗄️  Bucket: aimemoryvault
🐍 Docling: http://localhost:8000
🤗 HF Model: sentence-transformers/all-MiniLM-L6-v2
📌 Pinecone: Enabled
🕸️  Graph: Enabled  ← You should see this!

[Neo4j] Initializing driver: bolt://localhost:7687
[Neo4j] Driver initialized successfully
[Neo4j] Creating indexes and constraints...
✅ Worker is ready and waiting for jobs...
```

## 5️⃣ Upload a Test File

Use your frontend or API to upload a document. The worker will:

1. Extract text
2. Create chunks
3. Generate embeddings
4. **Extract entities** ✨
5. **Build knowledge graph** 🕸️
6. Store everything

## 6️⃣ Query the Graph

Open Neo4j Browser (http://localhost:7474) and run:

### See all entities
```cypher
MATCH (e:Entity)
RETURN e.name, e.type
LIMIT 25
```

### Visualize relationships
```cypher
MATCH (e1:Entity)-[r]->(e2:Entity)
RETURN e1, r, e2
LIMIT 50
```

### Find documents by user
```cypher
MATCH (u:User)-[:UPLOADED]->(d:Document)-[:CONTAINS]->(c:Chunk)
RETURN u.id, d.fileName, count(c) as chunks
```

### Technology graph
```cypher
MATCH (e:Entity {type: 'Technology'})-[r]-(e2:Entity {type: 'Technology'})
RETURN e, r, e2
LIMIT 100
```

## 🎯 Verify It's Working

After uploading a file, check the worker logs:

```
[Worker] Step 8: Building Knowledge Graph
[Worker] Extracting entities from chunk 1/15
[EntityExtractor] Found 5 entities, 3 relations
[GraphBuilder] Building graph for chunk 0 (5 entities, 3 relations)
[GraphBuilder] ✓ Graph built successfully for chunk 0
...
[Worker] Graph processing complete: 15 succeeded, 0 failed
```

## 🔍 Example Queries

### Get statistics
```typescript
import { getGraphStats } from './workers/graph/graphBuilder';

const stats = await getGraphStats();
console.log(stats);
// { users: 1, documents: 5, chunks: 75, entities: 142, relationships: 89 }
```

### Find related entities
```typescript
import { findRelatedEntities } from './workers/graph/graphBuilder';

const related = await findRelatedEntities('AWS', 10);
console.log(related);
// [
//   { name: 'Lambda', type: 'Technology', relation: 'USES', distance: 1 },
//   { name: 'S3', type: 'Technology', relation: 'USES', distance: 1 },
//   ...
// ]
```

## 🛑 Disable Graph (Optional)

If you want to disable the graph layer:

```bash
# .env
ENABLE_GRAPH="false"
```

The system will continue working with just vector storage.

## 🚨 Troubleshooting

### "Connection refused to localhost:7687"
- Neo4j is not running
- Run: `docker start ai-memory-vault-neo4j`

### "Authentication failed"
- Wrong password in .env
- Reset in Neo4j Browser or recreate container

### "Graph not building"
- Check ENABLE_GRAPH="true"
- Verify HF_API_KEY is set
- Check worker logs for errors

### "Empty entities"
- Text might not contain extractable entities
- LLM might be loading (wait and retry)
- Try different text/documents

## 📚 Next Steps

1. ✅ Graph is running
2. 📤 Upload some documents
3. 🔍 Query relationships
4. 🚀 Build hybrid retrieval (vector + graph)

See [README.md](./README.md) for full documentation!

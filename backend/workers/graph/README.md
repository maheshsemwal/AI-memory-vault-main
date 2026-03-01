# Knowledge Graph Layer - Neo4j Integration

This directory contains the Knowledge Graph implementation for the AI Memory Vault, providing structured relationship memory alongside vector similarity.

## 🧠 Overview

The graph layer extracts entities and relationships from document chunks using AI, then stores them in a Neo4j graph database. This enables:

- **Relationship-based queries** - Find connected concepts
- **Multi-hop reasoning** - Traverse relationships between entities
- **Hybrid retrieval** - Combine vector similarity + graph traversal
- **Structured memory** - Organize knowledge in a semantic network

## 📁 Structure

```
workers/graph/
├── neo4jClient.ts       # Singleton driver & session management
├── entityExtractor.ts   # AI-powered entity/relation extraction
└── graphBuilder.ts      # Graph construction with MERGE operations
```

---

## 🏗️ Graph Schema

### Nodes

**User**
- Properties: `id`, `createdAt`, `lastActive`

**Document**
- Properties: `id`, `fileName`, `createdAt`

**Chunk**
- Properties: `id`, `index`, `text`, `fileId`, `createdAt`

**Entity**
- Properties: `name`, `type`, `createdAt`
- Types: Person, Organization, Technology, Concept, Location, Product, Event

### Relationships

```
(User)-[:UPLOADED]->(Document)
(Document)-[:CONTAINS]->(Chunk)
(Chunk)-[:MENTIONS]->(Entity)
(Entity)-[:RELATED_TO]->(Entity)
(Entity)-[:PART_OF]->(Entity)
(Entity)-[:USES]->(Entity)
(Entity)-[:WORKS_FOR]->(Entity)
(Entity)-[:LOCATED_IN]->(Entity)
(Entity)-[:CREATES]->(Entity)
(Entity)-[:MANAGES]->(Entity)
```

---

## 🧩 Components

### 1. **neo4jClient.ts**

Singleton Neo4j driver with connection pooling and session management.

**Features:**
- Environment-based feature flag (`ENABLE_GRAPH`)
- Connection pooling (max 50 connections)
- Automatic session cleanup
- Read/write transaction wrappers
- Batch write support
- Constraints and indexes creation

**Usage:**
```typescript
import { executeWrite, executeRead, isGraphEnabled } from './neo4jClient';

if (isGraphEnabled()) {
  const result = await executeWrite(
    'MERGE (u:User {id: $id}) RETURN u',
    { id: 'user123' }
  );
}
```

**Environment Variables:**
- `ENABLE_GRAPH` - Set to "true" to enable (default: false)
- `NEO4J_URI` - Bolt connection string
- `NEO4J_USERNAME` - Database username
- `NEO4J_PASSWORD` - Database password

---

### 2. **entityExtractor.ts**

AI-powered entity and relationship extraction using HuggingFace LLMs.

**Features:**
- Structured JSON extraction from text
- Robust error handling & validation
- Graceful degradation on failures
- Batch processing support
- Entity deduplication

**Entity Types Extracted:**
- Person
- Organization
- Technology
- Concept
- Location
- Product
- Event

**Relationship Types:**
- RELATED_TO
- PART_OF
- USES
- WORKS_FOR
- LOCATED_IN
- CREATES
- MANAGES

**Usage:**
```typescript
import { extractEntities } from './entityExtractor';

const result = await extractEntities(chunkText);
// Returns: { entities: Entity[], relations: Relation[] }
```

**LLM Configuration:**
- Uses `HF_EXTRACTION_MODEL` env var (default: `mistralai/Mistral-7B-Instruct-v0.2`)
- Requires `HF_API_KEY`
- Temperature: 0.1 (for consistent structured output)
- Max tokens: 500

**Output Format:**
```json
{
  "entities": [
    { "name": "AWS", "type": "Technology" },
    { "name": "Kubernetes", "type": "Technology" }
  ],
  "relations": [
    { "from": "AWS", "to": "Kubernetes", "type": "USES" }
  ]
}
```

---

### 3. **graphBuilder.ts**

Constructs knowledge graph in Neo4j using MERGE operations to avoid duplicates.

**Features:**
- Atomic transactions
- MERGE-based node/relationship creation
- Batch write optimization
- Query utilities (stats, search, traversal)

**Core Functions:**

**buildGraph(context)**
```typescript
await buildGraph({
  userId: 'user123',
  fileId: 'file456',
  fileName: 'document.pdf',
  chunkId: 'chunk789',
  chunkIndex: 0,
  chunkText: '...',
  entities: [...],
  relations: [...]
});
```

**buildGraphForFile(userId, fileId, fileName, chunks)**
- Process multiple chunks for a file
- Returns success status

**deleteFileGraph(fileId)**
- Remove all graph data for a file
- Cascades to chunks and orphaned documents

**getGraphStats()**
```typescript
const stats = await getGraphStats();
// { users: 10, documents: 50, chunks: 500, entities: 1000, relationships: 2000 }
```

**findRelatedEntities(entityName, limit)**
- Find entities connected within 2 hops
- Returns: name, type, relation, distance

**findChunksByEntities(entityNames, limit)**
- Query chunks mentioning specific entities
- Ranked by match count

---

## 🔄 Integration Flow

When a file is processed by the worker:

```
1. Extract text (Docling)
2. Split into chunks
3. Generate embeddings
4. Store in Prisma + Pinecone
5. FOR EACH CHUNK:
   a. Extract entities using LLM
   b. Build graph nodes/relationships
   c. Store in Neo4j
6. Mark file as done
```

**Error Handling:**
- Graph failures are **non-fatal**
- Worker continues if extraction fails
- Errors logged but not thrown
- Graceful degradation ensures vector pipeline completes

---

## 🚀 Setup & Usage

### Install Neo4j

**Option 1: Docker**
```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:latest
```

**Option 2: Neo4j Desktop**
- Download from https://neo4j.com/download/
- Create local database
- Set password

### Configure Environment

```bash
# .env
ENABLE_GRAPH="true"
NEO4J_URI="bolt://localhost:7687"
NEO4J_USERNAME="neo4j"
NEO4J_PASSWORD="password"

# Optional: Specify extraction model
HF_EXTRACTION_MODEL="mistralai/Mistral-7B-Instruct-v0.2"
```

### Start Worker

```bash
bun run dev:worker
```

The worker will:
1. Initialize Neo4j driver
2. Create indexes and constraints
3. Begin processing files with graph extraction

---

## 📊 Querying the Graph

### Cypher Examples

**Find all entities mentioned in a user's documents:**
```cypher
MATCH (u:User {id: 'user123'})-[:UPLOADED]->(:Document)-[:CONTAINS]->(:Chunk)-[:MENTIONS]->(e:Entity)
RETURN DISTINCT e.name, e.type
ORDER BY e.name
```

**Find related technologies:**
```cypher
MATCH (e1:Entity {type: 'Technology'})-[r]-(e2:Entity {type: 'Technology'})
RETURN e1.name, type(r), e2.name, COUNT(*) as strength
ORDER BY strength DESC
LIMIT 20
```

**Find chunks mentioning specific concepts:**
```cypher
MATCH (c:Chunk)-[:MENTIONS]->(e:Entity)
WHERE e.name IN ['AWS', 'Kubernetes', 'Docker']
WITH c, COUNT(DISTINCT e) as matchCount
RETURN c.text, matchCount
ORDER BY matchCount DESC
LIMIT 10
```

**Get relationship paths between entities:**
```cypher
MATCH path = (e1:Entity {name: 'AWS'})-[*1..3]-(e2:Entity {name: 'Terraform'})
RETURN path
LIMIT 5
```

---

## 🛠️ API Functions

### From TypeScript

```typescript
import { 
  getGraphStats, 
  findRelatedEntities, 
  findChunksByEntities 
} from './workers/graph/graphBuilder';

// Get statistics
const stats = await getGraphStats();
console.log(`Entities: ${stats.entities}, Relations: ${stats.relationships}`);

// Find related entities
const related = await findRelatedEntities('AWS', 10);
// [{ name: 'S3', type: 'Technology', relation: 'USES', distance: 1 }, ...]

// Find chunks by entities
const chunks = await findChunksByEntities(['AWS', 'Lambda'], 5);
// [{ chunkId: '...', chunkText: '...', matchCount: 2 }, ...]
```

---

## 🔍 Hybrid Retrieval (Future)

Combine vector similarity + graph traversal for enhanced retrieval:

```typescript
// 1. Vector search for initial chunks
const similarChunks = await pinecone.query(queryEmbedding, 20);

// 2. Extract entities from results
const entities = await findEntitiesInChunks(similarChunks);

// 3. Expand via graph traversal
const relatedEntities = await findRelatedEntities(entities);

// 4. Find additional chunks via expanded entities
const expandedChunks = await findChunksByEntities(relatedEntities);

// 5. Merge and rank results
const finalResults = mergeAndRank(similarChunks, expandedChunks);
```

---

## ⚡ Performance Considerations

### Indexes & Constraints

Automatically created on startup:
```cypher
CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT entity_name_type IF NOT EXISTS FOR (e:Entity) REQUIRE (e.name, e.type) IS UNIQUE;

CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name);
CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type);
CREATE INDEX chunk_file IF NOT EXISTS FOR (c:Chunk) ON (c.fileId);
```

### Batch Operations

Use `executeBatchWrite()` for multiple operations:
```typescript
await executeBatchWrite([
  { query: 'MERGE (u:User {id: $id})', params: { id: 'user1' } },
  { query: 'MERGE (d:Document {id: $id})', params: { id: 'doc1' } },
  // ...
]);
```

### Connection Pooling

- Max connections: 50
- Acquisition timeout: 60s
- Retry timeout: 30s

---

## 🧪 Testing

### Verify Connectivity
```typescript
import { verifyConnectivity } from './workers/graph/neo4jClient';

const connected = await verifyConnectivity();
console.log(`Neo4j connected: ${connected}`);
```

### Test Entity Extraction
```typescript
import { extractEntities } from './workers/graph/entityExtractor';

const text = 'AWS Lambda integrates with DynamoDB for serverless applications.';
const result = await extractEntities(text);
console.log(result);
// { 
//   entities: [
//     { name: 'AWS Lambda', type: 'Technology' },
//     { name: 'DynamoDB', type: 'Technology' }
//   ],
//   relations: [
//     { from: 'AWS Lambda', to: 'DynamoDB', type: 'USES' }
//   ]
// }
```

---

## 🚨 Troubleshooting

### Graph not building
- Check `ENABLE_GRAPH="true"` in .env
- Verify Neo4j is running: `docker ps` or Neo4j Desktop
- Check logs for connection errors

### Entity extraction failing
- Verify `HF_API_KEY` is valid
- Check HuggingFace API quotas
- Model may be loading (503 status) - retry automatically handled

### Slow performance
- Check Neo4j memory settings
- Verify indexes are created: `SHOW INDEXES`
- Monitor connection pool usage

### Duplicate entities
- Constraints ensure uniqueness by (name, type)
- Use MERGE instead of CREATE in custom queries

---

## 🔮 Future Enhancements

### Planned Features

1. **Temporal Relationships**
   - Add timestamps to relationships
   - Track entity evolution over time

2. **Confidence Scores**
   - LLM confidence in extracted entities
   - Relationship strength metrics

3. **Entity Embeddings**
   - Store entity vector representations
   - Enable semantic entity search

4. **Graph Traversal Queries**
   - Pre-built query templates
   - Path finding algorithms

5. **Memory Consolidation**
   - Merge duplicate entities across files
   - Entity resolution and linking

6. **Advanced Entity Types**
   - Custom entity schemas per domain
   - Hierarchical entity types

---

## 📚 Dependencies

- **neo4j-driver** (^6.0.1) - Official Neo4j driver
- **HuggingFace Inference API** - Entity extraction
- Integrated with existing worker pipeline

---

## 🎯 Architecture Benefits

### Why Knowledge Graph?

**Vector DB (Pinecone):** "Find similar content"
- Semantic similarity
- Fast approximate search
- Great for: "Documents like this one"

**Knowledge Graph (Neo4j):** "Understand relationships"
- Explicit connections
- Multi-hop reasoning
- Great for: "How are these concepts connected?"

**Together:** True AI Memory
- Similarity + Structure
- Context + Connections
- Comprehensive retrieval

---

## 📖 Resources

- [Neo4j Cypher Manual](https://neo4j.com/docs/cypher-manual/)
- [Neo4j Driver Documentation](https://neo4j.com/docs/javascript-manual/)
- [HuggingFace Inference API](https://huggingface.co/docs/api-inference/)

---

## ⚠️ Important Notes

1. **Graph is Optional** - System works without it
2. **Non-Blocking** - Graph failures don't crash worker
3. **Additive Layer** - Enhances but doesn't replace vector search
4. **Production-Ready** - Built for scale and reliability
5. **Future-Proof** - Designed for advanced features

This is the **core memory layer** of your AI Memory Vault. 🧠✨

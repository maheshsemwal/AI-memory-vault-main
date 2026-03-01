import { executeWrite, executeBatchWrite, isGraphEnabled } from './neo4jClient.js';
import type { Entity, Relation } from './entityExtractor.js';

/**
 * Graph Builder - Constructs knowledge graph in Neo4j
 * Uses MERGE operations to avoid duplicates
 */

export interface GraphContext {
  userId: string;
  fileId: string;
  fileName: string;
  chunkId: string;
  chunkIndex: number;
  chunkText: string;
  entities: Entity[];
  relations: Relation[];
}

/**
 * Build complete graph for a document chunk
 * Creates nodes and relationships using MERGE to avoid duplicates
 */
export async function buildGraph(context: GraphContext): Promise<boolean> {
  if (!isGraphEnabled()) {
    console.log('[GraphBuilder] Graph disabled - skipping');
    return false;
  }

  console.log(
    `[GraphBuilder] Building graph for chunk ${context.chunkIndex} ` +
    `(${context.entities.length} entities, ${context.relations.length} relations)`
  );

  try {
    const queries: Array<{ query: string; params: Record<string, any> }> = [];

    // 1. MERGE User node
    queries.push({
      query: `
        MERGE (u:User {id: $userId})
        ON CREATE SET u.createdAt = datetime()
        ON MATCH SET u.lastActive = datetime()
        RETURN u
      `,
      params: { userId: context.userId },
    });

    // 2. MERGE Document node and create User->Document relationship
    queries.push({
      query: `
        MATCH (u:User {id: $userId})
        MERGE (d:Document {id: $fileId})
        ON CREATE SET 
          d.fileName = $fileName,
          d.createdAt = datetime()
        MERGE (u)-[:UPLOADED]->(d)
        RETURN d
      `,
      params: {
        userId: context.userId,
        fileId: context.fileId,
        fileName: context.fileName,
      },
    });

    // 3. MERGE Chunk node and create Document->Chunk relationship
    queries.push({
      query: `
        MATCH (d:Document {id: $fileId})
        MERGE (c:Chunk {id: $chunkId})
        ON CREATE SET 
          c.index = $chunkIndex,
          c.text = $chunkText,
          c.fileId = $fileId,
          c.createdAt = datetime()
        ON MATCH SET
          c.text = $chunkText,
          c.updatedAt = datetime()
        MERGE (d)-[:CONTAINS]->(c)
        RETURN c
      `,
      params: {
        fileId: context.fileId,
        chunkId: context.chunkId,
        chunkIndex: context.chunkIndex,
        chunkText: context.chunkText.substring(0, 5000), // Limit text size
      },
    });

    // 4. MERGE Entity nodes and create Chunk->Entity relationships
    for (const entity of context.entities) {
      queries.push({
        query: `
          MATCH (c:Chunk {id: $chunkId})
          MERGE (e:Entity {name: $name, type: $type})
          ON CREATE SET e.createdAt = datetime()
          MERGE (c)-[m:MENTIONS]->(e)
          ON CREATE SET m.createdAt = datetime()
          RETURN e
        `,
        params: {
          chunkId: context.chunkId,
          name: entity.name,
          type: entity.type,
        },
      });
    }

    // 5. Create Entity->Entity relationships
    for (const relation of context.relations) {
      // Find entities that match the relation endpoints
      queries.push({
        query: `
          MATCH (e1:Entity {name: $fromName})
          MATCH (e2:Entity {name: $toName})
          MERGE (e1)-[r:${sanitizeRelationType(relation.type)}]->(e2)
          ON CREATE SET r.createdAt = datetime(), r.count = 1
          ON MATCH SET r.count = r.count + 1, r.lastSeen = datetime()
          RETURN r
        `,
        params: {
          fromName: relation.from,
          toName: relation.to,
        },
      });
    }

    // Execute all queries in a single transaction
    await executeBatchWrite(queries);

    console.log(`[GraphBuilder] ✓ Graph built successfully for chunk ${context.chunkIndex}`);
    return true;
  } catch (error: any) {
    console.error(`[GraphBuilder] Failed to build graph: ${error.message}`);
    
    // Don't throw - allow worker to continue
    return false;
  }
}

/**
 * Create graph for multiple chunks from the same file
 * @param userId - User ID
 * @param fileId - File ID
 * @param fileName - File name
 * @param chunks - Array of chunks with their data
 */
export async function buildGraphForFile(
  userId: string,
  fileId: string,
  fileName: string,
  chunks: Array<{
    chunkId: string;
    chunkIndex: number;
    chunkText: string;
    entities: Entity[];
    relations: Relation[];
  }>
): Promise<boolean> {
  if (!isGraphEnabled()) {
    console.log('[GraphBuilder] Graph disabled - skipping');
    return false;
  }

  console.log(`[GraphBuilder] Building graph for file ${fileName} (${chunks.length} chunks)`);

  let successCount = 0;
  let failCount = 0;

  for (const chunk of chunks) {
    const context: GraphContext = {
      userId,
      fileId,
      fileName,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      chunkText: chunk.chunkText,
      entities: chunk.entities,
      relations: chunk.relations,
    };

    const success = await buildGraph(context);
    
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log(
    `[GraphBuilder] File graph complete: ${successCount} succeeded, ${failCount} failed`
  );

  return failCount === 0;
}

/**
 * Delete graph data for a file
 * @param fileId - File ID to delete
 */
export async function deleteFileGraph(fileId: string): Promise<boolean> {
  if (!isGraphEnabled()) {
    return false;
  }

  console.log(`[GraphBuilder] Deleting graph for file: ${fileId}`);

  try {
    // Delete chunks and their relationships
    await executeWrite(
      `
      MATCH (d:Document {id: $fileId})-[:CONTAINS]->(c:Chunk)
      DETACH DELETE c
      `,
      { fileId }
    );

    // Delete document if it has no more chunks
    await executeWrite(
      `
      MATCH (d:Document {id: $fileId})
      WHERE NOT (d)-[:CONTAINS]->()
      DETACH DELETE d
      `,
      { fileId }
    );

    console.log(`[GraphBuilder] ✓ Graph deleted for file: ${fileId}`);
    return true;
  } catch (error: any) {
    console.error(`[GraphBuilder] Failed to delete graph: ${error.message}`);
    return false;
  }
}

/**
 * Get graph statistics
 */
export async function getGraphStats(): Promise<{
  users: number;
  documents: number;
  chunks: number;
  entities: number;
  relationships: number;
} | null> {
  if (!isGraphEnabled()) {
    return null;
  }

  try {
    const result = await executeWrite<any>(
      `
      MATCH (u:User)
      WITH count(u) as users
      MATCH (d:Document)
      WITH users, count(d) as documents
      MATCH (c:Chunk)
      WITH users, documents, count(c) as chunks
      MATCH (e:Entity)
      WITH users, documents, chunks, count(e) as entities
      MATCH ()-[r]->()
      RETURN users, documents, chunks, entities, count(r) as relationships
      `
    );

    if (!result || result.length === 0) {
      return {
        users: 0,
        documents: 0,
        chunks: 0,
        entities: 0,
        relationships: 0,
      };
    }

    return result[0];
  } catch (error: any) {
    console.error(`[GraphBuilder] Failed to get stats: ${error.message}`);
    return null;
  }
}

/**
 * Find related entities for a given entity
 * @param entityName - Entity name to search for
 * @param limit - Maximum number of results
 */
export async function findRelatedEntities(
  entityName: string,
  limit: number = 10
): Promise<Array<{ name: string; type: string; relation: string; distance: number }>> {
  if (!isGraphEnabled()) {
    return [];
  }

  try {
    const result = await executeWrite<any>(
      `
      MATCH (e1:Entity {name: $entityName})-[r*1..2]-(e2:Entity)
      WHERE e1 <> e2
      RETURN DISTINCT 
        e2.name as name, 
        e2.type as type,
        type(r[0]) as relation,
        length(r) as distance
      ORDER BY distance, e2.name
      LIMIT $limit
      `,
      { entityName, limit }
    );

    return result || [];
  } catch (error: any) {
    console.error(`[GraphBuilder] Failed to find related entities: ${error.message}`);
    return [];
  }
}

/**
 * Query chunks that mention specific entities
 * @param entityNames - Array of entity names
 * @param limit - Maximum number of results
 */
export async function findChunksByEntities(
  entityNames: string[],
  limit: number = 10
): Promise<Array<{ chunkId: string; chunkText: string; matchCount: number }>> {
  if (!isGraphEnabled()) {
    return [];
  }

  try {
    const result = await executeWrite<any>(
      `
      MATCH (c:Chunk)-[:MENTIONS]->(e:Entity)
      WHERE e.name IN $entityNames
      WITH c, count(e) as matchCount
      RETURN 
        c.id as chunkId,
        c.text as chunkText,
        matchCount
      ORDER BY matchCount DESC, c.index
      LIMIT $limit
      `,
      { entityNames, limit }
    );

    return result || [];
  } catch (error: any) {
    console.error(`[GraphBuilder] Failed to find chunks: ${error.message}`);
    return [];
  }
}

/**
 * Sanitize relation type for Cypher query
 * Neo4j relationship types must be valid identifiers
 */
function sanitizeRelationType(type: string): string {
  // Replace spaces and special chars with underscore
  return type
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_') // Remove duplicate underscores
    .substring(0, 50); // Limit length
}

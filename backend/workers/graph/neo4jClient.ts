import neo4j, { Driver, Session } from 'neo4j-driver';

/**
 * Neo4j Client - Singleton pattern for connection management
 * Provides reusable driver and session management for graph operations
 */

let driver: Driver | null = null;

/**
 * Check if Neo4j is enabled via environment variable
 */
export function isGraphEnabled(): boolean {
  return process.env.ENABLE_GRAPH === 'true';
}

/**
 * Initialize Neo4j driver (singleton)
 * Only initializes if ENABLE_GRAPH is true
 */
export function initNeo4jDriver(): Driver | null {
  if (driver) {
    return driver;
  }

  if (!isGraphEnabled()) {
    console.log('[Neo4j] ENABLE_GRAPH is not set to true - graph storage disabled');
    return null;
  }

  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !username || !password) {
    console.warn('[Neo4j] Missing configuration (NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD) - graph storage disabled');
    return null;
  }

  try {
    console.log(`[Neo4j] Initializing driver: ${uri}`);
    
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 60000, // 60 seconds
      maxTransactionRetryTime: 30000, // 30 seconds
    });

    console.log('[Neo4j] Driver initialized successfully');
    return driver;
  } catch (error: any) {
    console.error('[Neo4j] Failed to initialize driver:', error.message);
    driver = null;
    return null;
  }
}

/**
 * Get Neo4j driver instance
 */
export function getDriver(): Driver | null {
  return initNeo4jDriver();
}

/**
 * Create a new Neo4j session
 * @param database - Optional database name (default: neo4j)
 * @returns Session instance or null if driver not initialized
 */
export function createSession(database: string = 'neo4j'): Session | null {
  const neo4jDriver = getDriver();
  
  if (!neo4jDriver) {
    return null;
  }

  return neo4jDriver.session({ database });
}

/**
 * Execute a read query with automatic session management
 * @param query - Cypher query string
 * @param params - Query parameters
 * @returns Query results or null
 */
export async function executeRead<T = any>(
  query: string,
  params: Record<string, any> = {}
): Promise<T[] | null> {
  const session = createSession();
  
  if (!session) {
    console.log('[Neo4j] Session creation failed - graph disabled');
    return null;
  }

  try {
    const result = await session.executeRead(async (tx) => {
      const res = await tx.run(query, params);
      return res.records.map(record => record.toObject() as T);
    });

    return result;
  } catch (error: any) {
    console.error('[Neo4j] Read query failed:', error.message);
    console.error('[Neo4j] Query:', query);
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * Execute a write query with automatic session management
 * @param query - Cypher query string
 * @param params - Query parameters
 * @returns Query results or null
 */
export async function executeWrite<T = any>(
  query: string,
  params: Record<string, any> = {}
): Promise<T[] | null> {
  const session = createSession();
  
  if (!session) {
    console.log('[Neo4j] Session creation failed - graph disabled');
    return null;
  }

  try {
    const result = await session.executeWrite(async (tx) => {
      const res = await tx.run(query, params);
      return res.records.map(record => record.toObject() as T);
    });

    return result;
  } catch (error: any) {
    console.error('[Neo4j] Write query failed:', error.message);
    console.error('[Neo4j] Query:', query);
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * Execute multiple write queries in a single transaction
 * @param queries - Array of {query, params} objects
 * @returns Success status
 */
export async function executeBatchWrite(
  queries: Array<{ query: string; params: Record<string, any> }>
): Promise<boolean> {
  const session = createSession();
  
  if (!session) {
    console.log('[Neo4j] Session creation failed - graph disabled');
    return false;
  }

  try {
    await session.executeWrite(async (tx) => {
      for (const { query, params } of queries) {
        await tx.run(query, params);
      }
    });

    console.log(`[Neo4j] Batch write completed (${queries.length} queries)`);
    return true;
  } catch (error: any) {
    console.error('[Neo4j] Batch write failed:', error.message);
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * Verify Neo4j connectivity
 * @returns true if connected, false otherwise
 */
export async function verifyConnectivity(): Promise<boolean> {
  const neo4jDriver = getDriver();
  
  if (!neo4jDriver) {
    return false;
  }

  try {
    await neo4jDriver.verifyConnectivity();
    console.log('[Neo4j] Connectivity verified');
    return true;
  } catch (error: any) {
    console.error('[Neo4j] Connectivity check failed:', error.message);
    return false;
  }
}

/**
 * Create indexes and constraints for optimal performance
 * Should be called once during setup
 */
export async function createIndexesAndConstraints(): Promise<void> {
  if (!isGraphEnabled()) {
    return;
  }

  console.log('[Neo4j] Creating indexes and constraints...');

  const queries = [
    // User constraints
    'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
    
    // Document constraints
    'CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE',
    
    // Chunk constraints
    'CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE',
    
    // Entity constraints
    'CREATE CONSTRAINT entity_name_type IF NOT EXISTS FOR (e:Entity) REQUIRE (e.name, e.type) IS UNIQUE',
    
    // Indexes for performance
    'CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name)',
    'CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)',
    'CREATE INDEX chunk_file IF NOT EXISTS FOR (c:Chunk) ON (c.fileId)',
  ];

  for (const query of queries) {
    try {
      await executeWrite(query);
      console.log(`[Neo4j] ✓ ${query.split(' ')[1]} created`);
    } catch (error: any) {
      // Ignore errors for already existing constraints
      if (!error.message.includes('already exists')) {
        console.warn(`[Neo4j] Failed to create constraint/index: ${error.message}`);
      }
    }
  }

  console.log('[Neo4j] Indexes and constraints setup complete');
}

/**
 * Close Neo4j driver connection
 * Should be called during graceful shutdown
 */
export async function closeDriver(): Promise<void> {
  if (driver) {
    console.log('[Neo4j] Closing driver...');
    await driver.close();
    driver = null;
    console.log('[Neo4j] Driver closed');
  }
}

/**
 * Graceful shutdown handler
 */
export async function shutdown(): Promise<void> {
  await closeDriver();
}

import { Pinecone } from '@pinecone-database/pinecone';

let pineconeClient: Pinecone | null = null;
let pineconeIndex: any = null;

/**
 * Initialize Pinecone client (singleton)
 * Only initializes if PINECONE_API_KEY is configured
 */
export function getPineconeClient() {
  if (pineconeClient) {
    return pineconeClient;
  }

  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    console.log('[Pinecone] PINECONE_API_KEY not set - Pinecone disabled');
    return null;
  }

  const indexName = process.env.PINECONE_INDEX;

  if (!indexName) {
    console.warn('[Pinecone] PINECONE_INDEX not set - Pinecone disabled');
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

export function getPineconeIndex() {
  getPineconeClient(); // Ensure client is initialized
  return pineconeIndex;
}

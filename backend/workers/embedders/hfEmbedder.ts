import fetch from 'node-fetch';

/**
 * Generates embeddings for text chunks using HuggingFace Inference API
 * @param texts - Array of text chunks to embed
 * @returns Array of embedding vectors (number[][])
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.HF_API_KEY;
  const model = process.env.HF_EMBEDDING_MODEL;

  if (!apiKey) {
    throw new Error('HF_API_KEY environment variable is not set');
  }

  if (!model) {
    throw new Error('HF_EMBEDDING_MODEL environment variable is not set');
  }

  if (!texts || texts.length === 0) {
    return [];
  }

  console.log(`[HF Embedder] Embedding ${texts.length} chunks using model: ${model}`);

  // Process in batches of 32 to avoid API limits
  const batchSize = 32;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, Math.min(i + batchSize, texts.length));
    console.log(
      `[HF Embedder] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (${batch.length} items)`
    );

    const embeddings = await embedBatch(batch, apiKey, model);
    allEmbeddings.push(...embeddings);
  }

  console.log(`[HF Embedder] Successfully generated ${allEmbeddings.length} embeddings`);
  return allEmbeddings;
}

/**
 * Embeds a single batch of texts
 * @param texts - Batch of texts to embed
 * @param apiKey - HuggingFace API key
 * @param model - Model name
 * @returns Array of embedding vectors
 */
async function embedBatch(
  texts: string[],
  apiKey: string,
  model: string
): Promise<number[][]> {
  const url = `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`;

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: texts,
          options: {
            wait_for_model: true,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        // Handle rate limiting
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        
        // Handle model loading
        if (response.status === 503) {
          throw new Error('Model is loading, please retry');
        }

        throw new Error(
          `HuggingFace API returned ${response.status}: ${errorText}`
        );
      }

      const result = await response.json();

      // Normalize response - HF returns different shapes depending on model
      const embeddings = normalizeEmbeddings(result);

      if (embeddings.length !== texts.length) {
        throw new Error(
          `Expected ${texts.length} embeddings but got ${embeddings.length}`
        );
      }

      return embeddings;
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;

      if (isLastAttempt) {
        throw new Error(`HuggingFace embedding failed: ${error.message}`);
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(
        `[HF Embedder] Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('HuggingFace embedding failed: unexpected error');
}

/**
 * Normalizes HuggingFace API response to consistent format
 * Different models return different shapes:
 * - Single text: [embedding]
 * - Multiple texts: [[embedding1], [embedding2], ...]
 * - Some models add extra dimensions
 */
function normalizeEmbeddings(result: any): number[][] {
  if (!Array.isArray(result)) {
    throw new Error('Invalid embedding response format');
  }

  // If result is empty
  if (result.length === 0) {
    return [];
  }

  // Check if first element is a number (single embedding)
  if (typeof result[0] === 'number') {
    return [result];
  }

  // Check if first element is an array
  if (Array.isArray(result[0])) {
    // Check if it's a batch of embeddings
    if (typeof result[0][0] === 'number') {
      return result;
    }
    
    // Some models return extra dimensions, flatten them
    if (Array.isArray(result[0][0])) {
      return result.map((item: any) => item[0]);
    }
  }

  throw new Error('Unable to normalize embedding response format');
}

/**
 * Embeds a single text (convenience function)
 * @param text - Text to embed
 * @returns Embedding vector
 */
export async function embedText(text: string): Promise<number[]> {
  const embeddings = await embedTexts([text]);
  if (!embeddings[0]) {
    throw new Error('Failed to generate embedding');
  }
  return embeddings[0];
}

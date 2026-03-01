import fetch from 'node-fetch';

/**
 * Entity and Relationship extraction using HuggingFace LLM
 * Extracts structured knowledge from text chunks
 */

export interface Entity {
  name: string;
  type: string;
}

export interface Relation {
  from: string;
  to: string;
  type: string;
}

export interface ExtractionResult {
  entities: Entity[];
  relations: Relation[];
}

/**
 * Extract entities and relationships from text using HuggingFace LLM
 * @param text - Text chunk to analyze
 * @returns Structured extraction result
 */
export async function extractEntities(text: string): Promise<ExtractionResult> {
  const apiKey = process.env.HF_API_KEY;
  
  if (!apiKey) {
    throw new Error('HF_API_KEY not configured for entity extraction');
  }

  // Use a smaller, faster model for extraction
  // You can use: meta-llama/Meta-Llama-3-8B-Instruct or mistralai/Mistral-7B-Instruct-v0.2
  const model = process.env.HF_EXTRACTION_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2';

  console.log(`[EntityExtractor] Extracting from ${text.length} characters using ${model}`);

  const prompt = buildExtractionPrompt(text);

  try {
    const result = await callHuggingFaceLLM(prompt, model, apiKey);
    const extraction = parseExtractionResult(result);
    
    console.log(
      `[EntityExtractor] Found ${extraction.entities.length} entities, ${extraction.relations.length} relations`
    );

    return extraction;
  } catch (error: any) {
    console.error(`[EntityExtractor] Extraction failed: ${error.message}`);
    
    // Return empty result on failure (graceful degradation)
    return { entities: [], relations: [] };
  }
}

/**
 * Build extraction prompt for LLM
 */
function buildExtractionPrompt(text: string): string {
  // Truncate text if too long (max 2000 chars for faster processing)
  const truncatedText = text.length > 2000 ? text.substring(0, 2000) + '...' : text;

  return `Extract entities and relationships from the following text. Return ONLY valid JSON with no additional text.

Entity types to extract: Person, Organization, Technology, Concept, Location, Product, Event

Format:
{
  "entities": [
    {"name": "Entity Name", "type": "EntityType"}
  ],
  "relations": [
    {"from": "Entity1", "to": "Entity2", "type": "RELATED_TO"}
  ]
}

Relationship types: RELATED_TO, PART_OF, USES, WORKS_FOR, LOCATED_IN, CREATES, MANAGES

Text to analyze:
"""
${truncatedText}
"""

JSON output:`;
}

/**
 * Call HuggingFace Inference API with LLM
 */
async function callHuggingFaceLLM(
  prompt: string,
  model: string,
  apiKey: string
): Promise<string> {
  const url = `https://api-inference.huggingface.co/models/${model}`;

  const maxRetries = 2;
  const baseDelay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 500,
            temperature: 0.1, // Low temperature for structured output
            top_p: 0.9,
            return_full_text: false,
          },
          options: {
            wait_for_model: true,
            use_cache: false,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        if (response.status === 503) {
          throw new Error('Model is loading');
        }
        
        throw new Error(`HuggingFace API error ${response.status}: ${errorText}`);
      }

      const result: any = await response.json();

      // Handle different response formats
      let generatedText = '';
      
      if (Array.isArray(result)) {
        generatedText = result[0]?.generated_text || result[0]?.text || '';
      } else if (result && typeof result === 'object') {
        generatedText = (result as any).generated_text || (result as any).text || (result as any)[0]?.generated_text || '';
      } else if (typeof result === 'string') {
        generatedText = result;
      }

      if (!generatedText) {
        throw new Error('Empty response from LLM');
      }

      return generatedText;
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;

      if (isLastAttempt) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(
        `[EntityExtractor] Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Entity extraction failed after retries');
}

/**
 * Parse and validate extraction result from LLM
 */
function parseExtractionResult(llmOutput: string): ExtractionResult {
  try {
    // Extract JSON from response (LLM might include extra text)
    const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      console.warn('[EntityExtractor] No JSON found in LLM output');
      return { entities: [], relations: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!parsed.entities || !Array.isArray(parsed.entities)) {
      console.warn('[EntityExtractor] Invalid entities array');
      parsed.entities = [];
    }

    if (!parsed.relations || !Array.isArray(parsed.relations)) {
      console.warn('[EntityExtractor] Invalid relations array');
      parsed.relations = [];
    }

    // Validate and clean entities
    const validEntities: Entity[] = parsed.entities
      .filter((e: any) => e.name && e.type && typeof e.name === 'string' && typeof e.type === 'string')
      .map((e: any) => ({
        name: e.name.trim().substring(0, 200), // Limit length
        type: e.type.trim().substring(0, 50),
      }))
      .filter((e: Entity) => e.name.length > 0 && e.type.length > 0);

    // Validate and clean relations
    const validRelations: Relation[] = parsed.relations
      .filter((r: any) => 
        r.from && r.to && r.type && 
        typeof r.from === 'string' && 
        typeof r.to === 'string' && 
        typeof r.type === 'string'
      )
      .map((r: any) => ({
        from: r.from.trim().substring(0, 200),
        to: r.to.trim().substring(0, 200),
        type: r.type.trim().toUpperCase().substring(0, 50),
      }))
      .filter((r: Relation) => 
        r.from.length > 0 && 
        r.to.length > 0 && 
        r.type.length > 0
      );

    return {
      entities: validEntities,
      relations: validRelations,
    };
  } catch (error: any) {
    console.error('[EntityExtractor] Failed to parse LLM output:', error.message);
    console.error('[EntityExtractor] Raw output:', llmOutput.substring(0, 500));
    
    // Return empty result on parse failure
    return { entities: [], relations: [] };
  }
}

/**
 * Batch extract entities from multiple chunks
 * @param chunks - Array of text chunks
 * @returns Array of extraction results
 */
export async function extractEntitiesBatch(
  chunks: string[]
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];

  // Process sequentially to avoid overwhelming the API
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[EntityExtractor] Processing chunk ${i + 1}/${chunks.length}`);
    
    try {
      const chunk = chunks[i];
      if (!chunk) {
        console.warn(`[EntityExtractor] Chunk ${i} is undefined, skipping`);
        results.push({ entities: [], relations: [] });
        continue;
      }

      const result = await extractEntities(chunk);
      results.push(result);
      
      // Small delay to avoid rate limits
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      console.error(`[EntityExtractor] Failed to extract from chunk ${i}:`, error.message);
      results.push({ entities: [], relations: [] });
    }
  }

  return results;
}

/**
 * Deduplicate entities across extraction results
 * @param results - Array of extraction results
 * @returns Deduplicated extraction result
 */
export function deduplicateEntities(results: ExtractionResult[]): ExtractionResult {
  const entityMap = new Map<string, Entity>();
  const relationSet = new Set<string>();
  const relations: Relation[] = [];

  for (const result of results) {
    // Deduplicate entities by (name, type)
    for (const entity of result.entities) {
      const key = `${entity.name.toLowerCase()}:${entity.type.toLowerCase()}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, entity);
      }
    }

    // Deduplicate relations by (from, to, type)
    for (const relation of result.relations) {
      const key = `${relation.from.toLowerCase()}:${relation.to.toLowerCase()}:${relation.type}`;
      if (!relationSet.has(key)) {
        relationSet.add(key);
        relations.push(relation);
      }
    }
  }

  return {
    entities: Array.from(entityMap.values()),
    relations,
  };
}

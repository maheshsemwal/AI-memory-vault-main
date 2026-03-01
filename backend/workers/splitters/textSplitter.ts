import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

/**
 * Text splitter singleton instance
 */
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

/**
 * Splits markdown text into chunks for embedding
 * @param text - Markdown text to split
 * @returns Array of text chunks
 */
export async function splitText(text: string): Promise<string[]> {
  if (!text || text.trim().length === 0) {
    console.warn('[TextSplitter] Empty text provided');
    return [];
  }

  console.log(`[TextSplitter] Splitting text of ${text.length} characters`);
  
  const chunks = await splitter.splitText(text);
  
  console.log(`[TextSplitter] Created ${chunks.length} chunks`);
  
  // Filter out empty chunks
  const validChunks = chunks.filter((chunk: string) => chunk.trim().length > 0);
  
  if (validChunks.length !== chunks.length) {
    console.warn(
      `[TextSplitter] Filtered out ${chunks.length - validChunks.length} empty chunks`
    );
  }

  return validChunks;
}

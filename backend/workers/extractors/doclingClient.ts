import fetch from 'node-fetch';

interface DoclingResponse {
  text: string;
  metadata: {
    filename: string;
    pages?: number;
    tables?: number;
    sections?: number;
  };
}

/**
 * Extracts text from a document file using the Docling service
 * @param buffer - File buffer to process
 * @param filename - Original filename
 * @returns Extracted markdown text
 * @throws Error if extraction fails after retries
 */
export async function extractWithDocling(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const doclingUrl = process.env.DOCLING_URL;
  
  if (!doclingUrl) {
    throw new Error('DOCLING_URL environment variable is not set');
  }

  const maxRetries = 3;
  const timeout = 60000; // 60 seconds
  const baseDelay = 1000; // 1 second

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Docling] Attempt ${attempt}/${maxRetries} for file: ${filename}`);
      
      // Create FormData
      const FormData = (await import('node-fetch')).FormData;
      const formData = new FormData();
      const blob = new Blob([buffer]);
      formData.append('file', blob, filename);

      // Make request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${doclingUrl}/extract`, {
          method: 'POST',
          body: formData as any,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Docling service returned ${response.status}: ${errorText}`
          );
        }

        const result = (await response.json()) as DoclingResponse;

        if (!result.text) {
          throw new Error('Docling service returned empty text');
        }

        console.log(`[Docling] Successfully extracted ${result.text.length} characters from ${filename}`);
        console.log(`[Docling] Metadata:`, result.metadata);

        return result.text;
      } catch (error: any) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
          throw new Error(`Docling request timeout after ${timeout}ms`);
        }
        throw error;
      }
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      
      if (isLastAttempt) {
        console.error(`[Docling] All ${maxRetries} attempts failed for ${filename}`);
        throw new Error(`Docling extraction failed: ${error.message}`);
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(
        `[Docling] Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Should never reach here
  throw new Error('Docling extraction failed: unexpected error');
}

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        persistSession: false
    },
    global: {
        headers: {
            'x-client-info': 'ai-memory-vault'
        },
    },
    db: {
        schema: 'public',
    },
});

/**
 * Helper function to download file with retry logic
 */
export async function downloadFileWithRetry(
  bucket: string,
  path: string,
  maxRetries: number = 3
): Promise<Blob> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Supabase] Download attempt ${attempt}/${maxRetries}: ${path}`);
      
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(path);

      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }

      if (!data) {
        throw new Error('No data returned from Supabase');
      }

      console.log(`[Supabase] Successfully downloaded ${data.size} bytes`);
      return data;
    } catch (error: any) {
      lastError = error;
      console.error(`[Supabase] Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`[Supabase] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to download file after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
  );
}
/**
 * Test Supabase connection and storage access
 * Run with: bun run test-supabase.ts
 */

import { supabase, downloadFileWithRetry } from './config/supabase.js';
import { config } from 'dotenv';

config();

async function testSupabaseConnection() {
  console.log('🧪 Testing Supabase Connection...\n');

  // 1. Check environment variables
  console.log('1️⃣ Environment Variables:');
  console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL || '❌ MISSING'}`);
  console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set (' + process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 15) + '...)' : '❌ MISSING'}`);
  console.log(`   S3_BUCKET: ${process.env.S3_BUCKET || '❌ MISSING'}\n`);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.S3_BUCKET) {
    console.error('❌ Missing required environment variables!');
    process.exit(1);
  }

  // 2. Test storage bucket access
  console.log('2️⃣ Testing Storage Bucket Access:');
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      console.error(`   ❌ Error listing buckets: ${error.message}`);
      return;
    }

    console.log(`   ✅ Found ${buckets?.length || 0} buckets:`);
    buckets?.forEach(bucket => {
      console.log(`      - ${bucket.name} (${bucket.public ? 'public' : 'private'})`);
    });

    const targetBucket = buckets?.find(b => b.name === process.env.S3_BUCKET);
    if (!targetBucket) {
      console.error(`   ⚠️  Warning: Bucket '${process.env.S3_BUCKET}' not found!`);
    }
    console.log('');
  } catch (error: any) {
    console.error(`   ❌ Exception: ${error.message}\n`);
    return;
  }

  // 3. Test file listing
  console.log('3️⃣ Testing File Listing:');
  try {
    const { data: files, error } = await supabase.storage
      .from(process.env.S3_BUCKET!)
      .list('uploads', {
        limit: 5,
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (error) {
      console.error(`   ❌ Error listing files: ${error.message}`);
    } else {
      console.log(`   ✅ Found ${files?.length || 0} files in 'uploads/' folder`);
      if (files && files.length > 0) {
        console.log(`   Recent files:`);
        files.slice(0, 3).forEach(file => {
          console.log(`      - ${file.name} (${file.metadata?.size || 'unknown'} bytes)`);
        });
      }
    }
    console.log('');
  } catch (error: any) {
    console.error(`   ❌ Exception: ${error.message}\n`);
  }

  // 4. Test download with retry (if we have files)
  console.log('4️⃣ Testing Download with Retry:');
  try {
    const { data: files } = await supabase.storage
      .from(process.env.S3_BUCKET!)
      .list('uploads', { limit: 1 });

    if (files && files.length > 0 && files[0].name) {
      const testPath = `uploads/${files[0].name}`;
      console.log(`   Testing download of: ${testPath}`);
      
      const blob = await downloadFileWithRetry(process.env.S3_BUCKET!, testPath, 2);
      console.log(`   ✅ Successfully downloaded ${blob.size} bytes`);
    } else {
      console.log(`   ⚠️  No files found to test download`);
    }
    console.log('');
  } catch (error: any) {
    console.error(`   ❌ Download failed: ${error.message}\n`);
  }

  // 5. Network connectivity test
  console.log('5️⃣ Testing Network Connectivity:');
  try {
    const response = await fetch(process.env.SUPABASE_URL!);
    console.log(`   ✅ Can reach Supabase URL (status: ${response.status})`);
  } catch (error: any) {
    console.error(`   ❌ Cannot reach Supabase URL: ${error.message}`);
    console.error(`   This might be a network/firewall issue`);
  }

  console.log('\n✅ Supabase connection test complete!');
}

testSupabaseConnection().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});

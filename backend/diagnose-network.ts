/**
 * Network diagnostic tool for Supabase connectivity
 */

import { config } from 'dotenv';

config();

async function diagnoseNetwork() {
  console.log('🔍 Network Diagnostics for Supabase\n');

  const supabaseUrl = process.env.SUPABASE_URL!;
  const host = new URL(supabaseUrl).hostname;

  // Test 1: Basic HTTP connectivity
  console.log('1️⃣ Testing basic HTTP connectivity...');
  try {
    const response = await fetch(supabaseUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    console.log(`   ✅ HTTP Status: ${response.status}`);
    console.log(`   ✅ Can reach: ${supabaseUrl}\n`);
  } catch (error: any) {
    console.error(`   ❌ Failed: ${error.message}`);
    console.error(`   📌 This suggests a network/firewall block\n`);
  }

  // Test 2: DNS Resolution
  console.log('2️⃣ Testing DNS resolution...');
  try {
    // Use node-fetch or built-in DNS
    const start = Date.now();
    await fetch(`https://${host}`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
    const duration = Date.now() - start;
    console.log(`   ✅ DNS resolves (took ${duration}ms)\n`);
  } catch (error: any) {
    console.error(`   ❌ DNS issue: ${error.message}\n`);
  }

  // Test 3: Supabase REST API endpoint
  console.log('3️⃣ Testing Supabase REST API...');
  try {
    const apiUrl = `${supabaseUrl}/rest/v1/`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`   ✅ REST API Status: ${response.status}`);
    
    if (response.status === 200 || response.status === 401) {
      console.log(`   ✅ REST API is reachable\n`);
    }
  } catch (error: any) {
    console.error(`   ❌ REST API failed: ${error.message}\n`);
  }

  // Test 4: Storage API endpoint
  console.log('4️⃣ Testing Supabase Storage API...');
  try {
    const storageUrl = `${supabaseUrl}/storage/v1/bucket`;
    const response = await fetch(storageUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`   ✅ Storage API Status: ${response.status}`);
    
    if (response.ok) {
      const buckets = await response.json();
      console.log(`   ✅ Storage API is reachable`);
      console.log(`   📦 Buckets found: ${buckets.length}`);
      buckets.forEach((b: any) => console.log(`      - ${b.name}`));
    } else {
      const text = await response.text();
      console.log(`   ⚠️  Response: ${text.substring(0, 100)}`);
    }
    console.log('');
  } catch (error: any) {
    console.error(`   ❌ Storage API failed: ${error.message}\n`);
  }

  // Test 5: Check proxy settings
  console.log('5️⃣ Checking proxy settings...');
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  
  if (httpProxy || httpsProxy) {
    console.log(`   ⚠️  Proxy detected:`);
    if (httpProxy) console.log(`      HTTP_PROXY: ${httpProxy}`);
    if (httpsProxy) console.log(`      HTTPS_PROXY: ${httpsProxy}`);
    if (noProxy) console.log(`      NO_PROXY: ${noProxy}`);
  } else {
    console.log(`   ✅ No proxy configured`);
  }
  console.log('');

  // Test 6: Alternative fetch with node-fetch
  console.log('6️⃣ Testing with alternative fetch implementation...');
  try {
    const nodeFetch = await import('node-fetch');
    const response = await nodeFetch.default(supabaseUrl, {
      signal: AbortSignal.timeout(5000),
    } as any);
    console.log(`   ✅ node-fetch works: Status ${response.status}\n`);
  } catch (error: any) {
    console.error(`   ❌ node-fetch also fails: ${error.message}\n`);
  }

  // Recommendations
  console.log('📋 Recommendations:\n');
  console.log('If tests are failing, try:');
  console.log('  1. Check Windows Firewall settings');
  console.log('  2. Check antivirus (temporarily disable to test)');
  console.log('  3. Try from a different network (mobile hotspot?)');
  console.log('  4. Check if VPN is required/interfering');
  console.log('  5. Check corporate proxy settings');
  console.log('  6. Verify internet connection is stable');
  console.log('  7. Try in browser: ' + supabaseUrl);
  console.log('  8. Check if Supabase is down: https://status.supabase.com');
}

diagnoseNetwork().catch(console.error);

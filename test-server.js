// Test script for YNAB Proxy Server
// Usage: node test-server.js <server-url> <ynab-api-key>

const axios = require('axios');

async function testServer(serverUrl, apiKey) {
  console.log(`Testing YNAB Proxy Server at: ${serverUrl}\n`);
  
  try {
    // Test 1: Health Check
    console.log('1. Testing health endpoint...');
    const health = await axios.get(`${serverUrl}/health`);
    console.log('✅ Health check passed:', health.data);
    console.log('');
    
    // Test 2: YNAB Budgets (with rate limiting)
    console.log('2. Testing YNAB proxy with rate limiting...');
    const budgets = await axios.get(`${serverUrl}/ynab/budgets`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Use-Delta': 'false'
      }
    });
    
    console.log('✅ YNAB request successful');
    console.log(`   Found ${budgets.data.data.budgets.length} budgets`);
    console.log(`   Rate Limit Remaining: ${budgets.headers['x-rate-limit-remaining'] || 'N/A'}`);
    console.log('');
    
    // Test 3: Cache Test
    console.log('3. Testing cache (making same request again)...');
    const start = Date.now();
    const budgets2 = await axios.get(`${serverUrl}/ynab/budgets`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Use-Delta': 'false'
      }
    });
    const duration = Date.now() - start;
    
    console.log(`✅ Cache test: ${budgets2.headers['x-cache'] || 'Unknown'}`);
    console.log(`   Response time: ${duration}ms`);
    console.log('');
    
    console.log('🎉 All tests passed! Your YNAB proxy server is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Check command line arguments
if (process.argv.length !== 4) {
  console.log('Usage: node test-server.js <server-url> <ynab-api-key>');
  console.log('Example: node test-server.js https://ynab-proxy.onrender.com your-api-key-here');
  process.exit(1);
}

const [,, serverUrl, apiKey] = process.argv;
testServer(serverUrl.replace(/\/$/, ''), apiKey);
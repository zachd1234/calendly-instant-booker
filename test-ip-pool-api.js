/**
 * Test script for the IP Pool Manager API
 * This script verifies that the IP pool manager API can provide multiple IPs
 * and that DNS resolution and TLS handshakes are already completed (pre-warmed)
 * 
 * This script is designed to work with the IP Pool API Server (ipPoolServer.js)
 */

require('dotenv').config();
const ipPoolClient = require('./utils/ipPoolClient');
const { chromium } = require('playwright');
const fetch = require('node-fetch');

// Test settings
const TEST_RUNS = 3; // Number of test runs to perform
const CHECK_REAL_IP = true; // Whether to verify the actual IP being used

// Load and log environment variables to debug proxy setup
console.log('Environment variables:');
console.log(`PROXY_URL: ${process.env.PROXY_URL}`);
// Mask sensitive info for logging
console.log(`PROXY_USERNAME: ${process.env.PROXY_USERNAME ? '***' : 'not set'}`);
console.log(`PROXY_PASSWORD: ${process.env.PROXY_PASSWORD ? '***' : 'not set'}`);

// Utility to get actual IP address
async function checkPublicIP(proxy) {
  try {
    console.log(`Checking IP with proxy: ${proxy.server}`);
    // Format the proxy URL properly for the fetch library
    const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.server.replace('http://', '')}`;
    console.log(`Formatted proxy URL: ${proxyUrl.replace(proxy.password, '****')}`);
    
    // Get the current IP by making a request through the proxy
    const response = await fetch('https://api.ipify.org?format=json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/90.0.4430.212'
      },
      // Use proxy URL format: http://username:password@host:port
      proxy: proxyUrl
    });

    if (!response.ok) {
      throw new Error(`IP check failed with status: ${response.status}`);
    }

    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.error('Error checking public IP:', error.message);
    return 'unknown';
  }
}

// Main test function
async function testIPPool() {
  console.log('=== IP Pool Manager API Test ===');
  
  // First, check if the server is running
  const isServerRunning = await ipPoolClient.isServerRunning();
  if (!isServerRunning) {
    console.error('IP Pool API Server is not running!');
    console.log('Please start the server with: node ipPoolServer.js');
    return;
  }
  
  console.log('✅ Successfully connected to IP Pool API Server');
  
  // Get current pool stats
  try {
    const stats = await ipPoolClient.getStats();
    console.log('\nCurrent Pool Stats:');
    console.log(`Total sessions: ${stats.total}`);
    console.log(`Available: ${stats.available}`);
    console.log(`In use: ${stats.inUse}`);
    console.log(`Total created: ${stats.created}`);
    console.log(`Total used: ${stats.used}`);
  } catch (error) {
    console.error('Failed to get pool stats:', error.message);
  }
  
  console.log(`\nRunning ${TEST_RUNS} test iterations to verify IP rotation and pre-warming`);
  
  const results = [];
  const sessionIds = new Set();
  const ips = new Set();
  
  // Test direct connection without pool to verify proxy works
  console.log('\n--- Testing direct proxy connection ---');
  try {
    const directProxySettings = {
      server: process.env.PROXY_URL,
      username: process.env.PROXY_USERNAME,
      password: process.env.PROXY_PASSWORD
    };
    
    console.log('Launching browser with direct proxy settings');
    console.log(`Server: ${directProxySettings.server}`);
    console.log(`Username: ${directProxySettings.username}`);
    
    const browser = await chromium.launch({
      headless: true,
      proxy: directProxySettings
    });
    
    console.log('Browser launched with direct settings');
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('Testing direct navigation to google.com...');
    await page.goto('https://www.google.com', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log('Direct navigation successful');
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Check the public IP
    await page.goto('https://api.ipify.org', { waitUntil: 'domcontentloaded' });
    const publicIP = await page.content();
    console.log(`Direct public IP: ${publicIP.trim()}`);
    
    await context.close();
    await browser.close();
    console.log('Direct test completed successfully');
  } catch (error) {
    console.error('Direct proxy test failed:', error.message);
    console.log('This suggests there may be an issue with the proxy configuration');
    console.log('Please verify your .env file has the correct proxy settings');
  }
  
  // Now run the actual pool tests
  for (let i = 0; i < TEST_RUNS; i++) {
    console.log(`\n--- Test Run ${i+1}/${TEST_RUNS} ---`);
    
    // Get a session from the pool
    console.log('Getting IP session from pool...');
    const startGetSession = Date.now();
    let session;
    
    try {
      session = await ipPoolClient.getIpSession();
      const getSessionTime = Date.now() - startGetSession;
      
      console.log(`Got session ${session.sessionId} in ${getSessionTime}ms`);
      console.log(`Proxy settings: ${session.server}`);
      console.log(`Username: ${session.username}`);
      console.log(`Password: ${'*'.repeat(session.password ? session.password.length : 0)}`);
      
      // Track unique session IDs
      sessionIds.add(session.sessionId);
      
      // Try to check the IP directly first
      if (CHECK_REAL_IP) {
        console.log('Checking IP directly via HTTP request...');
        const ip = await checkPublicIP(session);
        if (ip !== 'unknown') {
          console.log(`IP from direct check: ${ip}`);
          ips.add(ip);
        }
      }
      
      // Option 1: Use Playwright to test the connection with this IP
      console.log('\nTesting connection with Playwright...');
      
      const startBrowser = Date.now();
      let browser;
      try {
        // Launch browser with this proxy
        browser = await chromium.launch({
          headless: true,
          proxy: {
            server: session.server,
            username: session.username,
            password: session.password
          }
        });
        
        const browserLaunchTime = Date.now() - startBrowser;
        console.log(`Browser launched in ${browserLaunchTime}ms`);
        
        // Create a new context
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Test navigation to a simple page
        console.log('Testing navigation to google.com...');
        const startNavigation = Date.now();
        await page.goto('https://www.google.com', { 
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        const navigationTime = Date.now() - startNavigation;
        
        console.log(`Navigation completed in ${navigationTime}ms`);
        const title = await page.title();
        console.log(`Page title: ${title}`);
        
        // Check the actual IP if enabled
        let publicIP = 'check disabled';
        if (CHECK_REAL_IP) {
          console.log('\nChecking actual public IP...');
          // Navigate to an IP checking service
          await page.goto('https://api.ipify.org', { waitUntil: 'domcontentloaded' });
          publicIP = await page.content();
          publicIP = publicIP.trim();
          console.log(`Current public IP: ${publicIP}`);
          ips.add(publicIP);
        }
        
        // Store result
        results.push({
          sessionId: session.sessionId,
          browserLaunchTime,
          navigationTime,
          publicIP,
          success: true
        });
        
        // Close browser
        await context.close();
        await browser.close();
        
      } catch (error) {
        console.error('Error during Playwright test:', error.message);
        results.push({
          sessionId: session.sessionId,
          error: error.message,
          success: false
        });
        
        if (browser) {
          await browser.close().catch(() => {});
        }
      }
      
      // Release the session back to the pool
      console.log('\nReleasing session back to pool...');
      await session.release();
      console.log('Session released successfully');
      
      // Pause between tests
      if (i < TEST_RUNS - 1) {
        console.log('Waiting 2 seconds before next test...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`Failed to get or use session: ${error.message}`);
      results.push({
        error: error.message,
        success: false
      });
      
      // Try to release the session if it exists
      if (session && session.release) {
        try {
          await session.release();
        } catch (releaseError) {
          console.error(`Failed to release session: ${releaseError.message}`);
        }
      }
    }
  }
  
  // Print summary
  console.log('\n=== Test Summary ===');
  console.log(`Test runs: ${TEST_RUNS}`);
  console.log(`Successful tests: ${results.filter(r => r.success).length}`);
  console.log(`Failed tests: ${results.filter(r => !r.success).length}`);
  console.log(`Unique session IDs: ${sessionIds.size}`);
  
  if (CHECK_REAL_IP) {
    console.log(`Unique IPs observed: ${ips.size}`);
    
    // Clean up the IPs (remove HTML content)
    const cleanIps = Array.from(ips).filter(ip => 
      !ip.includes('<html') && 
      !ip.includes('</html>') &&
      ip.match(/^[0-9.]+$/)
    );
    
    console.log(`IPs: ${cleanIps.join(', ')}`);
  }
  
  // Calculate average timings
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length > 0) {
    const avgBrowserLaunchTime = successfulResults.reduce((sum, r) => sum + r.browserLaunchTime, 0) / successfulResults.length;
    const avgNavigationTime = successfulResults.reduce((sum, r) => sum + r.navigationTime, 0) / successfulResults.length;
    
    console.log('\n=== Performance Metrics ===');
    console.log(`Average browser launch time: ${avgBrowserLaunchTime.toFixed(2)}ms`);
    console.log(`Average navigation time: ${avgNavigationTime.toFixed(2)}ms`);
  }
  
  // Final check of pool stats
  try {
    const stats = await ipPoolClient.getStats();
    console.log('\nFinal Pool Stats:');
    console.log(`Total sessions: ${stats.total}`);
    console.log(`Available: ${stats.available}`);
    console.log(`In use: ${stats.inUse}`);
    console.log(`Total created: ${stats.created}`);
    console.log(`Total used: ${stats.used}`);
  } catch (error) {
    console.error('Failed to get final pool stats:', error.message);
  }
  
  // Clean up
  console.log('\nCleaning up client resources...');
  await ipPoolClient.cleanup();
}

// Run the test
testIPPool()
  .then(() => {
    console.log('\nIP Pool API test completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nTest failed:', error);
    process.exit(1);
  }); 
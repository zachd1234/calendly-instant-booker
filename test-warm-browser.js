/**
 * Test Warm Browser Performance
 * 
 * This script tests the warm browser functionality by:
 * 1. Getting a session from the IP Pool
 * 2. Testing the warm browser performance 
 * 3. Comparing it with cold browser performance
 */

const { getIpSession, releaseSession, getWarmBrowser, isServerRunning, getPoolStats, getWarmBrowserStats } = require('./utils/ipPoolClient');
const config = require('./config');

/**
 * Run a test with warm browser
 */
async function testWarmBrowser() {
  console.log('Starting warm browser test...');
  
  try {
    // First check if the IP Pool Server is running
    const serverRunning = await isServerRunning();
    if (!serverRunning) {
      throw new Error('IP Pool Server is not running! Start it with "node ipPoolServer.js" in a separate terminal.');
    }
    
    // Get pool stats
    const poolStats = await getPoolStats();
    console.log(`IP Pool API Server is running with ${poolStats.total} IP sessions available`);
    
    // Get warm browser stats
    const browserStats = await getWarmBrowserStats();
    console.log(`Warm browsers: ${browserStats.ready} ready, ${browserStats.creating} creating`);
    
    // === First test: Warm Browser ===
    console.log('\n=== WARM BROWSER TEST ===');
    
    // Get a session with a warm browser
    console.log('Getting IP session...');
    const session = await getIpSession();
    console.log(`Got IP session: ${session.sessionId}`);
    
    let totalWarmTime = 0;
    let warmBrowser;
    
    try {
      // Check if a warm browser is available for this session
      if (session.warmBrowserAvailable) {
        console.log('✅ Warm browser is available for this session');
      } else {
        console.log('⚠️ No warm browser ready for this session');
      }
      
      // Get warm browser timing
      console.log('Getting browser...');
      const warmStartTime = Date.now();
      
      // Try to get a warm browser for this session
      warmBrowser = await getWarmBrowser(session);
      
      const warmBrowserTime = (Date.now() - warmStartTime) / 1000;
      console.log(`Got browser ready in ${warmBrowserTime.toFixed(2)}s for session ${session.sessionId}`);
      
      // Track total time
      totalWarmTime = warmBrowserTime;
      
      // Perform test actions
      console.log('Filling out form...');
      const fillStartTime = Date.now();
      
      // Navigate to Calendly
      const calendlyUrl = 'https://calendly.com/zachderhake/30min';  // Use a general URL without specific timeslot
      await warmBrowser.page.goto(calendlyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Wait for and fill form fields
      await warmBrowser.page.waitForSelector('input[name="full_name"]', { timeout: 15000 });
      await warmBrowser.page.waitForSelector('input[name="email"]', { timeout: 15000 });
      
      // Fill out the form
      await warmBrowser.page.type('input[name="full_name"]', 'Warm Browser Test');
      await warmBrowser.page.type('input[name="email"]', 'warm-test@example.com');
      
      // Take a screenshot to verify
      await warmBrowser.page.screenshot({ path: 'warm-browser-test.png' });
      
      const fillTime = (Date.now() - fillStartTime) / 1000;
      console.log(`Filled out form in ${fillTime.toFixed(2)}s`);
      
      // Calculate total time
      totalWarmTime += fillTime;
      console.log(`Total warm browser test time: ${totalWarmTime.toFixed(2)}s`);
      
    } finally {
      // Clean up browser
      if (warmBrowser && warmBrowser.browser) {
        await warmBrowser.browser.close().catch(e => console.error('Error closing warm browser:', e.message));
      }
      
      // Release session
      await releaseSession(session.sessionId).catch(e => console.error('Error releasing session:', e.message));
      console.log(`Released IP session ${session.sessionId} back to pool`);
    }
    
    // === Second test: Cold Browser ===
    console.log('\n=== COLD BROWSER TEST ===');
    
    // Get a new session for cold browser test
    console.log('Getting new IP session for cold test...');
    const coldSession = await getIpSession();
    console.log(`Got IP session: ${coldSession.sessionId}`);
    
    let totalColdTime = 0;
    let coldBrowser;
    
    try {
      // Get cold browser by forcing a new browser instance
      console.log('Creating cold browser...');
      const coldStartTime = Date.now();
      
      // Create a cold browser
      coldBrowser = await getWarmBrowser(coldSession, { skipWarmup: false });
      
      const coldBrowserTime = (Date.now() - coldStartTime) / 1000;
      console.log(`Created cold browser in ${coldBrowserTime.toFixed(2)}s`);
      
      // Track total time
      totalColdTime = coldBrowserTime;
      
      // Perform the same test actions
      console.log('Filling out form...');
      const coldFillStartTime = Date.now();
      
      // Navigate to Calendly
      const calendlyUrl = 'https://calendly.com/zachderhake/30min/2025-04-25T12:30:00-07:00';  // Use a general URL without specific timeslot
      await coldBrowser.page.goto(calendlyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Wait for and fill form fields
      await coldBrowser.page.waitForSelector('input[name="full_name"]', { timeout: 15000 });
      await coldBrowser.page.waitForSelector('input[name="email"]', { timeout: 15000 });
      
      // Fill out the form
      await coldBrowser.page.type('input[name="full_name"]', 'Cold Browser Test');
      await coldBrowser.page.type('input[name="email"]', 'cold-test@example.com');
      
      // Take a screenshot to verify
      await coldBrowser.page.screenshot({ path: 'cold-browser-test.png' });
      
      const coldFillTime = (Date.now() - coldFillStartTime) / 1000;
      console.log(`Filled out form in ${coldFillTime.toFixed(2)}s`);
      
      // Calculate total time
      totalColdTime += coldFillTime;
      console.log(`Total cold browser test time: ${totalColdTime.toFixed(2)}s`);
      
    } finally {
      // Clean up browser
      if (coldBrowser && coldBrowser.browser) {
        await coldBrowser.browser.close().catch(e => console.error('Error closing cold browser:', e.message));
      }
      
      // Release session
      await releaseSession(coldSession.sessionId).catch(e => console.error('Error releasing session:', e.message));
      console.log(`Released IP session ${coldSession.sessionId} back to pool`);
    }
    
    // Compare results
    console.log('\n=== PERFORMANCE COMPARISON ===');
    console.log(`Warm browser total time: ${totalWarmTime.toFixed(2)}s`);
    console.log(`Cold browser total time: ${totalColdTime.toFixed(2)}s`);
    
    const difference = totalColdTime - totalWarmTime;
    const percentImprovement = (difference / totalColdTime) * 100;
    
    if (difference > 0) {
      console.log(`✅ Warm browser was ${difference.toFixed(2)}s faster (${percentImprovement.toFixed(2)}% improvement)`);
    } else if (difference < 0) {
      console.log(`❌ Cold browser was ${Math.abs(difference).toFixed(2)}s faster (${Math.abs(percentImprovement).toFixed(2)}% faster)`);
    } else {
      console.log('⚠️ No significant difference in performance');
    }
    
  } catch (error) {
    console.error('Error during warm browser test:', error);
  }
}

// Run the test
testWarmBrowser().catch(console.error); 
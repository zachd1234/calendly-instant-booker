/**
 * Test Playwright Integration with IP Pool
 * 
 * This script verifies that the converted IP Pool system works with Playwright
 */

const { getIpSession, releaseSession, getWarmBrowser, isServerRunning } = require('./utils/ipPoolClient');

async function testPlaywrightIntegration() {
  console.log('Testing Playwright integration with IP Pool...');
  
  try {
    // Check if server is running
    const serverRunning = await isServerRunning();
    if (!serverRunning) {
      throw new Error('IP Pool Server is not running! Start it with "node ipPoolServer.js" in a separate terminal.');
    }
    console.log('✅ IP Pool Server is running');
    
    // Get a session
    console.log('Requesting IP session...');
    const session = await getIpSession();
    console.log(`✅ Got IP session ${session.sessionId}`);
    console.log(`Warm browser available: ${session.warmBrowserAvailable}`);
    
    // Get a browser
    console.log('Getting browser...');
    const startTime = Date.now();
    const { browser, page, creationTime } = await getWarmBrowser(session);
    const totalTime = (Date.now() - startTime) / 1000;
    
    console.log(`✅ Got browser in ${totalTime.toFixed(2)}s (creation time reported: ${creationTime.toFixed(2)}s)`);
    
    // Test basic navigation
    console.log('Testing navigation to Calendly...');
    await page.goto('https://calendly.com', { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    console.log(`✅ Page loaded with title: ${title}`);
    
    // Take a screenshot
    console.log('Taking screenshot...');
    await page.screenshot({ path: 'playwright-test.png' });
    console.log('✅ Screenshot saved as playwright-test.png');
    
    // Clean up
    console.log('Cleaning up...');
    await browser.close();
    await releaseSession(session.sessionId);
    console.log('✅ Resources cleaned up');
    
    console.log('\n🎉 Playwright integration test completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPlaywrightIntegration().catch(console.error); 
const { chromium } = require('playwright');
const axios = require('axios'); // Import axios
require('dotenv').config();
const { bookMeeting } = require('./services/bookingService');

// --- Configuration ---
// URL of your running IP Pool API Server
const IP_POOL_SERVER_URL = process.env.IP_POOL_SERVER || 'http://localhost:3057';

// Define the base URL we expect the server to warm
const EXPECTED_WARM_URL = process.env.TARGET_WARM_URL || "https://calendly.com/zachderhake/30min";
// Define the SPECIFIC time slot URL for this test run
const TEST_SPECIFIC_TIME_URL = "https://calendly.com/zachderhake/30min/YYYY-MM-DDTHH:MM:SS"; // Replace with a known valid time slot URL

// Read booking details from .env (provide fallbacks just in case)
const TEST_NAME = process.env.NAME || "Test Env Booker";
const TEST_EMAIL = process.env.EMAIL || "test.env@example.com";
const TEST_PHONE = "+13109122212"; // Read from .env or use fallback

async function runTestBooking() {
  console.log('[TestingScript] Starting test using IP Pool API Server...');
  console.log(`[TestingScript] IP Pool Server URL: ${IP_POOL_SERVER_URL}`);
  console.log(`[TestingScript] Expected warm URL on server: ${EXPECTED_WARM_URL}`);
  console.log(`[TestingScript] URL for booking interaction: ${TEST_SPECIFIC_TIME_URL}`);
  console.log(`[TestingScript] Booking with Name: ${TEST_NAME}, Email: ${TEST_EMAIL}, Phone: ${TEST_PHONE}`);

  let browser = null;
  let page = null;
  let session = null;

  try {
    // 1. Get Session from API Server
    console.log('[TestingScript] Requesting IP session from API...');
    const sessionStartTime = Date.now();
    const sessionResponse = await axios.get(`${IP_POOL_SERVER_URL}/api/get-session`);
    session = sessionResponse.data;
    const sessionDuration = (Date.now() - sessionStartTime) / 1000;

    if (!session || !session.sessionId) {
      throw new Error("Failed to get valid session from API server.");
    }
    console.log(`[TestingScript] Got session ${session.sessionId} in ${sessionDuration.toFixed(2)}s.`);

    // 2. Verify Warm Browser State VIA API
    if (session.warmBrowserAvailable) {
      console.log('✅ [TestingScript] Server initially reported WARM BROWSER AVAILABLE.');
      console.log(`[TestingScript] Querying API for warm browser details for session ${session.sessionId}...`);
      try {
        const warmBrowserDetailsResponse = await axios.get(`${IP_POOL_SERVER_URL}/api/get-warm-browser?sessionId=${session.sessionId}`);
        const details = warmBrowserDetailsResponse.data;
        if (details && details.warmBrowserAvailable && details.status === 'ready') { // Check status is ready
           console.log(`\t✔️ Status: ${details.status}`);
           console.log(`\t✔️ URL Reported by Server: ${details.url}`);
           console.log(`\t✔️ Warmup Time (Server-side): ${details.warmupTime?.toFixed(2) || 'N/A'}s`);
           if (details.url === EXPECTED_WARM_URL) {
               console.log(`\t👍 Server confirmation: Warm browser is on the expected base page!`);
           } else {
               console.warn(`\t⚠️ Server confirmation: Warm browser is on UNEXPECTED page: ${details.url}`);
           }
        } else {
            console.warn(`\t⚠️ Server reported warm browser details unavailable or status not ready. Details:`, details);
            session.warmBrowserAvailable = false; // Update local understanding
        }
      } catch (detailsError) {
           console.error(`\t❌ Error fetching warm browser details: ${detailsError.message}`);
            if (detailsError.response) console.error('\t   API Error Data:', detailsError.response.data);
            session.warmBrowserAvailable = false; // Assume unavailable if details fetch fails
      }
    } else {
      console.log('⚠️ [TestingScript] Server reported WARM BROWSER *NOT* AVAILABLE for this session.');
    }

    // 3. Launch Local Playwright Browser with Proxy
    console.log('[TestingScript] Launching local Playwright browser with received proxy...');
    const browserStartTime = Date.now();
    const proxyConfig = {
      server: session.server,
      username: session.username,
      password: session.password
    };
    browser = await chromium.launch({
      headless: false, // Set to false to show the browser window
      slowMo: 150,    // Slow down Playwright operations by 150 milliseconds to make it easier to watch
      proxy: proxyConfig
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await context.newPage();
    const browserDuration = (Date.now() - browserStartTime) / 1000;
    console.log(`[TestingScript] Local browser launched in ${browserDuration.toFixed(2)}s.`);

    // 4. Navigate Local Browser to the SPECIFIC Time Slot URL
    console.log(`[TestingScript] Navigating local browser to SPECIFIC time slot: ${TEST_SPECIFIC_TIME_URL}...`);
    const navStartTime = Date.now();
    await page.goto(TEST_SPECIFIC_TIME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const navDuration = (Date.now() - navStartTime) / 1000;
    const pageTitle = await page.title().catch(() => "Error getting title"); // Catch errors getting title
    console.log(`[TestingScript] Navigation complete in ${navDuration.toFixed(2)}s. Page title: ${pageTitle}`);

    // 5. Perform Booking using details from .env
    console.log('[TestingScript] Calling bookMeeting service directly...');
    const bookStartTime = Date.now();
    // Pass the details read from .env (or fallbacks)
    const success = await bookMeeting(page, TEST_NAME, TEST_EMAIL, TEST_PHONE);
    const bookDuration = (Date.now() - bookStartTime) / 1000;

    if (success) {
      console.log(`✅ [TestingScript] bookMeeting reported SUCCESS in ${bookDuration.toFixed(2)}s.`);
    } else {
      console.log(`❌ [TestingScript] bookMeeting reported FAILURE in ${bookDuration.toFixed(2)}s.`);
      await page.screenshot({ path: 'testing-failure-final-state.png' }).catch(e => console.log('Failed to take failure screenshot:', e));
    }

  } catch (error) {
    console.error('❌ [TestingScript] Unhandled error during test execution:', error.message);
     if (error.response) {
        console.error('[TestingScript] API Error Data:', error.response.data);
        console.error('[TestingScript] API Error Status:', error.response.status);
     }
     // Use optional chaining and check isClosed() for safer screenshotting
     if (page && !page.isClosed?.()) {
       try {
         await page.screenshot({ path: 'testing-error-state.png' });
         console.log('[TestingScript] Error screenshot saved to testing-error-state.png')
       } catch (screenshotError) {
          console.log('[TestingScript] Failed to take error screenshot:', screenshotError.message);
       }
     } else {
          console.log('[TestingScript] Page object unavailable or closed, cannot take error screenshot.');
     }
  } finally {
    // Ensure browser is closed and session is released via API
    if (browser) {
        // Add a small pause before closing in non-headless mode so you can see the final state
        if (browser.browserType().name() === 'chromium' && !(await browser.contexts()[0]?.pages()[0]?.isClosed())) { // Basic check if window might be open
             console.log('[TestingScript] Pausing for 5 seconds before closing browser...');
             await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        }
        console.log('[TestingScript] Closing local browser...');
        await browser.close().catch(e => console.error('[TestingScript] Error closing browser:', e.message));
    }
    if (session && session.sessionId) {
        console.log(`[TestingScript] Releasing session ${session.sessionId} via API...`);
        try {
            await axios.post(`${IP_POOL_SERVER_URL}/api/release-session`, { sessionId: session.sessionId });
            console.log(`[TestingScript] Session ${session.sessionId} released.`);
        } catch (releaseError) {
             console.error(`[TestingScript] Error releasing session ${session.sessionId} via API:`, releaseError.message);
              if (releaseError.response) {
                 console.error('[TestingScript] API Release Error Data:', releaseError.response.data);
              }
        }
    }
    console.log('[TestingScript] Test finished.');
  }
}

// Run the test
runTestBooking();

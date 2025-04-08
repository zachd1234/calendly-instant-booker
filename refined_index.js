const { chromium } = require('playwright');
require('dotenv').config();
const { getIpSession, releaseSession, getWarmBrowser, isServerRunning } = require('./utils/ipPoolClient');
const { bookMeeting } = require('./services/bookingService');

// Configuration - Moving Calendly URL to code instead of .env
// List of Calendly time slots to cycle through
const CALENDLY_SLOTS = [
  "https://calendly.com/zachderhake/30min/2025-05-01T10:00:00-07:00", // May 1, 2025 at 10:00 AM PDT
  "https://calendly.com/zachderhake/30min/2025-05-01T14:30:00-07:00", // May 1, 2025 at 2:30 PM PDT
  "https://calendly.com/zachderhake/30min/2025-05-02T09:00:00-07:00", // May 2, 2025 at 9:00 AM PDT
  "https://calendly.com/zachderhake/30min/2025-05-02T13:30:00-07:00", // May 2, 2025 at 1:30 PM PDT
  "https://calendly.com/zachderhake/30min/2025-05-03T11:00:00-07:00", // May 3, 2025 at 11:00 AM PDT
  "https://calendly.com/zachderhake/30min/2025-05-03T15:00:00-07:00", // May 3, 2025 at 3:00 PM PDT
  "https://calendly.com/zachderhake/30min/2025-05-06T09:30:00-07:00", // May 6, 2025 at 9:30 AM PDT
  "https://calendly.com/zachderhake/30min/2025-05-06T14:00:00-07:00", // May 6, 2025 at 2:00 PM PDT
  "https://calendly.com/zachderhake/30min/2025-05-07T08:30:00-07:00", // May 7, 2025 at 8:30 AM PDT
  "https://calendly.com/zachderhake/30min/2025-05-07T10:30:00-07:00"  // May 7, 2025 at 10:30 AM PDT
];

// You can change this index to cycle through different time slots (0-9)
const SLOT_INDEX = 7; // Change this to try different slots


// Get current Calendly URL
const CALENDLY_URL = CALENDLY_SLOTS[SLOT_INDEX];

// Other configuration from .env
const NAME = process.env.NAME;
const EMAIL = process.env.EMAIL;

// Phone number without hyphens
const PHONE_NUMBER = "+1 3109122380";

const PROXY_URL = process.env.PROXY_URL;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

// OPTIMIZATION #5: Add debug mode flag to control screenshots and verbose logging
const DEBUG_MODE = false; // Set to false for maximum performance, true for debugging

// List of realistic user agents to rotate through
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
];

// Get a random user agent
const getRandomUserAgent = () => {
  const randomIndex = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[randomIndex];
};

// Get a random viewport size that looks realistic
const getRandomViewport = () => {
  const commonWidths = [1280, 1366, 1440, 1536, 1920];
  const commonHeights = [720, 768, 800, 864, 900, 1080];
  
  const randomWidth = commonWidths[Math.floor(Math.random() * commonWidths.length)];
  const randomHeight = commonHeights[Math.floor(Math.random() * commonHeights.length)];
  
  return { width: randomWidth, height: randomHeight };
};

// --- Main Booking Function ---
async function runBooking() {
  const overallStartTime = Date.now();
  console.log(`[Main] Starting booking attempt for slot index ${SLOT_INDEX}: ${CALENDLY_URL}`);
  console.log(`[Main] Using Name: ${NAME}, Email: ${EMAIL}, Phone: ${PHONE_NUMBER}`);

  let session = null;
  let browser = null; // The browser instance from getWarmBrowser
  let page = null;    // The page instance from getWarmBrowser

  try {
    // 1. Check IP Pool Server
    console.log('[Main] Checking IP Pool Server status...');
    const serverUp = await isServerRunning();
    if (!serverUp) {
      throw new Error("IP Pool Server is not running or accessible. Please start it first.");
    }
    console.log('[Main] IP Pool Server is running.');

    // 2. Get IP Session from Pool Client
    console.log('[Main] Requesting IP session...');
    const sessionStartTime = Date.now();
    session = await getIpSession(); // { sessionId, server, username, password, warmBrowserAvailable }
    const sessionDuration = (Date.now() - sessionStartTime) / 1000;
    console.log(`[Main] Got session ${session.sessionId} in ${sessionDuration.toFixed(2)}s. Warm browser reported as available: ${session.warmBrowserAvailable}`);

    // 3. Get Warm Browser Setup from Pool Client
    console.log('[Main] Requesting browser setup from getWarmBrowser...');
    const browserSetupStartTime = Date.now();
    // getWarmBrowser should handle launching/connecting, applying proxy, setting user-agent/viewport, resource blocking etc.
    const warmData = await getWarmBrowser(session); // Expected: { browser, context, page, wasWarm, creationTime }
    browser = warmData.browser;
    page = warmData.page; // Use the page provided by getWarmBrowser
    const setupDuration = (Date.now() - browserSetupStartTime) / 1000;
    console.log(`[Main] Browser setup completed in ${setupDuration.toFixed(2)}s (Total time reported by getWarmBrowser: ${warmData.creationTime?.toFixed(2)}s). Was warm: ${warmData.wasWarm}`);

    // 4. Navigate to Specific Calendly Slot URL
    console.log(`[Main] Navigating to specific slot URL: ${CALENDLY_URL}...`);
    const navStartTime = Date.now();
    // Use 'domcontentloaded' for speed, assuming bookingService waits for specific elements later if needed.
    await page.goto(CALENDLY_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const navDuration = (Date.now() - navStartTime) / 1000;
    const pageTitle = await page.title().catch(() => "Error getting title");
    console.log(`[Main] Navigation complete in ${navDuration.toFixed(2)}s. Page title: ${pageTitle}`);

    // --- Pre-Booking Check (Removed based on simplifying request, rely on bookingService) ---
    // console.log('[Main] Checking page content before booking...');
    // const pageContent = await page.content()... // Removed this check

    // 5. Call Booking Service
    console.log('[Main] Calling bookMeeting service...');
    const bookingStartTime = Date.now();
    const success = await bookMeeting(page, NAME, EMAIL, PHONE_NUMBER);
    const bookingDuration = (Date.now() - bookingStartTime) / 1000;

    // 6. Log Result
    if (success) {
      console.log(`✅ [Main] bookMeeting reported SUCCESS in ${bookingDuration.toFixed(2)}s.`);
    } else {
      console.log(`❌ [Main] bookMeeting reported FAILURE in ${bookingDuration.toFixed(2)}s.`);
      // Attempt screenshot on failure if page exists
      if (page && !page.isClosed?.()) {
          try {
              await page.screenshot({ path: `failure-slot-${SLOT_INDEX}.png` });
              console.log(`[Main] Failure screenshot saved to failure-slot-${SLOT_INDEX}.png`);
          } catch(e) { console.error('[Main] Failed to take failure screenshot:', e.message); }
      }
    }

  } catch (error) {
    console.error('❌ [Main] Unhandled error during booking execution:', error);
     // Attempt screenshot on error if page exists
     if (page && !page.isClosed?.()) {
         try {
             await page.screenshot({ path: `error-slot-${SLOT_INDEX}.png` });
             console.log(`[Main] Error screenshot saved to error-slot-${SLOT_INDEX}.png`);
         } catch(e) { console.error('[Main] Failed to take error screenshot:', e.message); }
     }
  } finally {
    const overallDuration = (Date.now() - overallStartTime) / 1000;
    console.log(`[Main] Attempt finished in ${overallDuration.toFixed(2)}s. Cleaning up...`);

    // 7. Release Session (Crucial)
    if (session && session.sessionId) {
        console.log(`[Main] Releasing session ${session.sessionId}...`);
        // Use the releaseSession function from ipPoolClient
        await releaseSession(session.sessionId).catch(e => console.error('[Main] Error releasing session:', e.message));
    } else {
        console.log('[Main] No session ID found to release.');
    }

    // 8. Close Browser (Crucial)
    // The browser instance comes from getWarmBrowser, ensure it's closed
    if (browser) {
      console.log('[Main] Closing browser...');
      await browser.close().catch(e => console.error('[Main] Error closing browser:', e.message));
    } else {
        console.log('[Main] No browser instance found to close.');
    }

    console.log('[Main] Cleanup finished.');
  }
}

// --- Run the Booking ---
runBooking();

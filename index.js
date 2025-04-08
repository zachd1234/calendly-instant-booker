//control panel 


const { chromium } = require('playwright');
require('dotenv').config();
const { bookMeeting } = require('./services/bookingService'); // Import the booking service

// Configuration - Moving Calendly URL to code instead of .env
// List of Calendly time slots to cycle through (kept for potential future use or reference, but not used by default)
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
  
  
// Removed hardcoded SLOT_INDEX, CALENDLY_URL, NAME, EMAIL, PHONE_NUMBER as they will be passed as arguments

// Configuration from .env remains
const PROXY_URL = process.env.PROXY_URL;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

// Debug mode flag - bookingService might have its own internal debug logging
const DEBUG_MODE = process.env.DEBUG === 'true'; // Read from env or default to false

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

// Helper function for more efficient form filling - OPTIMIZATION #3
async function fastFill(page, selector, text) {
  // Special handling for phone fields - clear first then fill
  if (selector.includes('tel')) {
    await page.focus(selector);
    await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
    await page.keyboard.press('Backspace'); // Clear any existing text including country code
    await page.fill(selector, text);
    console.log(`Phone field cleared and filled directly: ${text}`);
    return;
  }

  // For non-phone fields, use regular approach
  try {
    await page.fill(selector, text);
    console.log(`Fast-filled "${text}" into field`);
    
    // Verify what was typed
    const value = await page.$eval(selector, el => el.value);
    
    if (value !== text) {
      // If direct fill doesn't work correctly, fall back to typing with minimal delay
      console.log(`Fast-fill resulted in "${value}", falling back to typing`);
      await humanType(page, selector, text);
    }
  } catch (e) {
    console.log(`Fast-fill failed: ${e.message}, falling back to typing`);
    await humanType(page, selector, text);
  }
}

// Helper function for fast human-like typing with minimal delay
async function humanType(page, selector, text) {
  // Special handling for phone fields - clear first then fill
  if (selector.includes('tel')) {
    await page.focus(selector);
    await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
    await page.keyboard.press('Backspace'); // Clear any existing text including country code
    await page.fill(selector, text);
    console.log(`Phone field cleared and filled directly: ${text}`);
    return;
  }

  await page.focus(selector);
  await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
  await page.keyboard.press('Backspace'); // Clear any existing text
  
  // OPTIMIZATION #3: Reduced typing delay from 30-130ms to 5-15ms
  // Type the text with minimal random delays between keystrokes
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 10) + 5 });
  }
  
  // Verify what was typed
  const value = await page.$eval(selector, el => el.value);
  console.log(`Typed "${text}" into field, current value: "${value}"`);
  
  if (value !== text) {
    console.log(`⚠️ Warning: Field value "${value}" doesn't match expected "${text}". Retrying...`);
    await page.fill(selector, text);
  }
}

// --- Main Booking Function ---
// Now accepts parameters and an optional logCapture function
async function runBooking(calendlyUrl, name, email, phone, logCapture = console.log) { // Removed useProxy param
  logCapture('Starting Calendly booking process...');
  logCapture(`Using time slot URL: ${calendlyUrl}`);
  logCapture(`Booking for: Name=${name}, Email=${email}, Phone=${phone}`);
  const overallStartTime = Date.now();
  let browserStartTime, navigationStartTime, bookingStartTime;
  let browserTime = 0, navigationTime = 0, bookingDuration = 0, overallDuration = 0;

  // --- Browser Setup ---
  browserStartTime = Date.now(); // Start timer
  logCapture(`Using proxy: ${PROXY_URL || 'None'}`);
  // Removed logging for useProxy setting

  let browser;
  let success = false;
  
  // Removed conditional proxy logic based on useProxy
  // Always determine proxy settings based on env vars
  const proxySettings = PROXY_URL && PROXY_USERNAME && PROXY_PASSWORD
      ? {
          server: PROXY_URL,
          username: PROXY_USERNAME,
          password: PROXY_PASSWORD
        }
      : undefined;

  if (proxySettings) {
      logCapture('Proxy configuration will be used (based on environment variables).');
  } else {
      logCapture('Proxy configuration will not be used (environment variables not set).');
  }

  try {
      browser = await chromium.launch({
        headless: true,
        proxy: proxySettings // Use the determined settings based only on env vars
      });

      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        locale: 'en-US'
      });

      const page = await context.newPage();
      browserTime = (Date.now() - browserStartTime) / 1000; // Calculate time
      logCapture(`Browser created in ${browserTime.toFixed(2)}s`);

      await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,otf,eot}', route => route.abort().catch(()=>{}));
      await page.route(/google|facebook|analytics|hotjar|doubleclick/, route => route.abort().catch(()=>{}));
      logCapture('Resource blocking applied (images, fonts, tracking).');

      try {
        // --- Navigation ---
        navigationStartTime = Date.now(); // Start timer
        logCapture(`Navigating to ${calendlyUrl}`);
        await page.goto(calendlyUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });
        navigationTime = (Date.now() - navigationStartTime) / 1000; // Calculate time
        logCapture(`Navigated to booking page in ${navigationTime.toFixed(2)}s`);
        logCapture(`Page title: ${await page.title().catch(() => 'Error getting title')}`);

        // --- Optional: Handle Cookie Consent ---
        logCapture('Handling cookie consent (quick check)...');
        try {
          const cookieSelector = '#onetrust-accept-btn-handler';
          const cookieButton = await page.waitForSelector(cookieSelector, { timeout: 1500 }).catch(() => null);
          if (cookieButton) {
            logCapture('Found cookie button, clicking...');
            await cookieButton.click({ force: true, timeout: 2000 }).catch(e => logCapture(`WARN: Cookie click failed: ${e.message}`));
            await page.waitForTimeout(300);
          } else {
              logCapture('No cookie button found quickly.');
          }
        } catch (e) {
          logCapture(`Cookie consent check skipped or failed: ${e.message}`);
        }

        // --- Hand off to Booking Service ---
        logCapture(`Handing off to bookingService for Name: ${name}, Email: ${email}, Phone: ${phone}...`);
        bookingStartTime = Date.now(); // Start timer

        // Call the imported function with parameters
        const bookingServiceSuccess = await bookMeeting(page, name, email, phone, logCapture); // Pass logCapture here too

        bookingDuration = (Date.now() - bookingStartTime) / 1000; // Calculate time

        // --- Log Result from bookingService ---
        if (bookingServiceSuccess) {
          logCapture(`✅ bookingService reported SUCCESS in ${bookingDuration.toFixed(2)}s.`);
          success = true;
        } else {
          logCapture(`❌ bookingService reported FAILURE in ${bookingDuration.toFixed(2)}s.`);
          if (!page.isClosed()) {
            await page.screenshot({ path: 'final-state-index-failure.png' }).catch(e => logCapture(`ERROR: Index screenshot failed: ${e.message}`));
          }
          success = false;
        }

        overallDuration = (Date.now() - overallStartTime) / 1000;
        logCapture(`Process completed (inner block) in ${overallDuration.toFixed(2)} seconds.`);

      } catch (error) {
        logCapture(`❌ Error during page navigation/booking in runBooking: ${error}`);
        if (page && !page.isClosed()) {
            await page.screenshot({ path: 'error-state-index.png' }).catch(e => logCapture(`ERROR: Index error screenshot failed: ${e.message}`));
        }
        success = false;
        overallDuration = (Date.now() - overallStartTime) / 1000;
        logCapture(`Process failed (inner block) after ${overallDuration.toFixed(2)} seconds.`);
      }

  } catch (browserError) {
      logCapture(`❌ Error during browser setup in runBooking: ${browserError}`);
      success = false;
      overallDuration = (Date.now() - overallStartTime) / 1000;
      logCapture(`Process failed (outer block) after ${overallDuration.toFixed(2)} seconds.`);

  } finally {
    // --- Cleanup ---
    logCapture('Closing browser...');
    if (browser) {
       await browser.close().catch(e => logCapture(`ERROR: Error closing browser: ${e.message}`));
    } else {
        logCapture("Browser variable was not assigned, nothing to close.");
    }
     logCapture('Script finished.');
     // Ensure overall duration is calculated even if errors occurred early
     if (overallDuration === 0) overallDuration = (Date.now() - overallStartTime) / 1000;
  }

  // Return detailed result object
  return {
      success: success,
      duration: parseFloat(overallDuration.toFixed(2)),
      browserTime: parseFloat(browserTime.toFixed(2)),
      navigationTime: parseFloat(navigationTime.toFixed(2)),
      bookingDuration: parseFloat(bookingDuration.toFixed(2)) // Time spent in bookingService
  };
}

// Export the function
module.exports = { runBooking };
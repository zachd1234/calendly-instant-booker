// Handles creation and storage of browser sessions

const { chromium } = require('playwright');
const crypto = require('crypto');
require('dotenv').config(); // Needs .env vars for proxy settings

// --- Configuration ---

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;    // 5 minutes in milliseconds

// Global session store (simple map)
// Key: sessionId, Value: { browser, page, logCapture, startTime }
const activeSessions = {};

// Helper function to determine proxy settings - NOW ALWAYS ZD PROXY
// Removed proxyChoice parameter
function determineProxySettings(logCapture) {
    let proxySettings;
    logCapture(`Determining proxy settings (Forced ZD configuration)...`);

    // Use process.env directly here as this file loads dotenv
    const ZD_PROXY_URL = process.env.ZD_PROXY_URL;
    const ZD_PROXY_USERNAME = process.env.ZD_PROXY_USERNAME;
    const ZD_PROXY_PASSWORD = process.env.ZD_PROXY_PASSWORD;

    logCapture(`Attempting to use ZD proxy configuration.`);
    if (ZD_PROXY_URL && ZD_PROXY_USERNAME && ZD_PROXY_PASSWORD) {
         try {
             const url = new URL(ZD_PROXY_URL);
             const server = `${url.protocol}//${url.hostname}:${url.port}`;
             proxySettings = {
                 server: server,
                 username: ZD_PROXY_USERNAME,
                 password: ZD_PROXY_PASSWORD
             };
             logCapture(`ZD Proxy settings configured: Server=${server}, Username=${ZD_PROXY_USERNAME}`);
         } catch (e) {
             logCapture(`❌ ERROR: Failed to parse ZD_PROXY_URL (${ZD_PROXY_URL}): ${e.message}. Cannot proceed without valid ZD proxy.`);
             // Decide how to handle this - throw error or return undefined? Returning undefined for now.
             proxySettings = undefined;
         }
    } else {
        logCapture('❌ CRITICAL WARN: ZD proxy environment variables (ZD_PROXY_URL, ZD_PROXY_USERNAME, ZD_PROXY_PASSWORD) not fully set. Cannot proceed without ZD proxy.');
        // Returning undefined - this will likely cause browser launch to fail or run without proxy, depending on Playwright version.
        // Consider throwing an error here if ZD proxy is absolutely mandatory.
        proxySettings = undefined;
    }

    // Removed checks for 'original' or invalid choices

    if (!proxySettings) {
        logCapture('ZD proxy configuration failed or variables not set.');
    }
    return proxySettings;
}

// --- Step 1: Start Session Function ---
// Removed proxyChoice parameter
async function startSession(baseUrl, logCapture = console.log) {
    const sessionId = crypto.randomUUID(); // Generate unique session ID
    const sessionStartTime = Date.now(); // Record start time
    // Updated log message
    logCapture(`[${sessionId}] Attempting to start session with ZD proxy... BaseURL: ${baseUrl}`);

    let browser;
    // Call determineProxySettings without proxyChoice
    let proxySettings = determineProxySettings(logCapture);

    // Add a check here: If ZD proxy is mandatory and settings failed, we should probably exit early.
    if (!proxySettings) {
        const errorMsg = "Failed to configure mandatory ZD proxy settings. Check .env variables and logs.";
        logCapture(`[${sessionId}] ❌ ERROR starting session: ${errorMsg}`);
         const totalTime = (Date.now() - sessionStartTime) / 1000;
        return { success: false, error: errorMsg, duration: parseFloat(totalTime.toFixed(2)) };
    }

    try {
        logCapture(`[${sessionId}] Launching browser with ZD proxy...`);
        browser = await chromium.launch({
            headless: true,
            proxy: proxySettings
        });

        const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            locale: 'en-US'
            // Consider adding user agent/viewport randomization here if needed
        });
        const page = await context.newPage();
        const browserTime = (Date.now() - sessionStartTime) / 1000;
        logCapture(`[${sessionId}] Browser launched in ${browserTime.toFixed(2)}s.`);

        // Apply resource blocking
        await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,otf,eot}', route => route.abort().catch(()=>{}));
        await page.route(/google|facebook|analytics|hotjar|doubleclick/, route => route.abort().catch(()=>{}));
        logCapture(`[${sessionId}] Resource blocking applied.`);

        // Navigate to the BASE URL
        logCapture(`[${sessionId}] Navigating to base URL: ${baseUrl}`);
        const navStartTime = Date.now();
        await page.goto(baseUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        const navTime = (Date.now() - navStartTime) / 1000;
        logCapture(`[${sessionId}] Navigated to base URL in ${navTime.toFixed(2)}s. Page title: ${await page.title().catch(() => 'Error getting title')}`);


        // Optional: Quick cookie consent check
        try {
            const cookieSelector = '#onetrust-accept-btn-handler';
            const cookieButton = await page.waitForSelector(cookieSelector, { timeout: 1500 }).catch(() => null);
            if (cookieButton) {
                logCapture(`[${sessionId}] Found cookie button on base page, clicking...`);
                await cookieButton.click({ force: true, timeout: 2000 }).catch(e => logCapture(`[${sessionId}] WARN: Base page cookie click failed: ${e.message}`));
                await page.waitForTimeout(300);
            }
        } catch (e) {
             logCapture(`[${sessionId}] Base page cookie consent check skipped or failed: ${e.message}`);
        }

        // Store the active session components AND startTime
        activeSessions[sessionId] = { browser, page, logCapture, startTime: sessionStartTime };
        logCapture(`[${sessionId}] Session active and stored. Timeout set to ${SESSION_TIMEOUT_MS / 1000 / 60} minutes.`);

        const totalTime = (Date.now() - sessionStartTime) / 1000;
        return { success: true, sessionId: sessionId, duration: parseFloat(totalTime.toFixed(2)) };

    } catch (error) {
        logCapture(`[${sessionId}] ❌ ERROR during session start (after proxy config): ${error}`);
        if (browser) {
            logCapture(`[${sessionId}] Attempting to close browser due to session start error...`);
            await browser.close().catch(e => logCapture(`[${sessionId}] Error closing browser during session start failure: ${e.message}`));
        }
        delete activeSessions[sessionId];
        const totalTime = (Date.now() - sessionStartTime) / 1000;
        return { success: false, error: error.message, duration: parseFloat(totalTime.toFixed(2)) };
    }
}

// --- Session Cleanup Logic ---
async function cleanupIdleSessions() {
    const now = Date.now();
    console.log(`[SessionManager] Running cleanup check for idle sessions at ${new Date().toISOString()}...`);
    let cleanedCount = 0;

    // Iterate over a copy of keys to allow safe deletion during iteration
    const sessionIds = Object.keys(activeSessions);

    for (const sessionId of sessionIds) {
        const session = activeSessions[sessionId];
        // Double-check if session still exists (might be removed by another process/request)
        if (!session) continue;

        const elapsedTime = now - session.startTime;

        if (elapsedTime > SESSION_TIMEOUT_MS) {
            cleanedCount++;
            session.logCapture(`[${sessionId}] Session timed out after ${Math.round(elapsedTime / 1000 / 60)} minutes. Closing browser...`);
            try {
                await session.browser.close();
                session.logCapture(`[${sessionId}] Browser closed successfully.`);
            } catch (closeError) {
                session.logCapture(`[${sessionId}] ❌ ERROR closing timed-out browser: ${closeError.message}`);
            } finally {
                // Always remove from active sessions after attempting close
                delete activeSessions[sessionId];
            }
        }
    }
    if (cleanedCount > 0) {
       console.log(`[SessionManager] Cleanup finished. Closed ${cleanedCount} idle session(s).`);
    } else {
       console.log(`[SessionManager] Cleanup finished. No idle sessions found exceeding timeout.`);
    }
}

// --- Start Periodic Cleanup ---
// Run the cleanup function immediately once, then set the interval
console.log(`[SessionManager] Initializing idle session cleanup. Timeout: ${SESSION_TIMEOUT_MS / 1000 / 60} mins, Check Interval: ${CLEANUP_INTERVAL_MS / 1000 / 60} mins.`);
cleanupIdleSessions(); // Run once on startup
const cleanupIntervalId = setInterval(cleanupIdleSessions, CLEANUP_INTERVAL_MS);

// Optional: Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('[SessionManager] Received SIGINT. Shutting down...');
  clearInterval(cleanupIntervalId); // Stop the cleanup loop
  console.log('[SessionManager] Closing all remaining active sessions...');
  const closePromises = Object.entries(activeSessions).map(async ([sessionId, session]) => {
      session.logCapture(`[${sessionId}] Closing session due to server shutdown...`);
      try {
          await session.browser.close();
      } catch (e) {
          session.logCapture(`[${sessionId}] Error closing browser during shutdown: ${e.message}`);
      }
  });
  await Promise.allSettled(closePromises); // Wait for all closes to attempt
  console.log('[SessionManager] All sessions closed. Exiting.');
  process.exit(0);
});

// Export functions and potentially the session store if needed elsewhere (e.g., for cleanup)
module.exports = {
    startSession,
    activeSessions // Exporting this so bookSession can access it later
}; 
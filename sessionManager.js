// Handles creation and management of browser sessions (using rotating proxy)

const { chromium } = require('playwright');
const crypto = require('crypto');
require('dotenv').config(); // Still needs .env vars for proxy credentials
const { standardizeBrowserProfile, standardizeBrowserSession, removeAllRoutes } = require('./utils/browserUtils');

// --- Configuration ---
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;    // 5 minutes
// PROXY_LIST_PATH is no longer needed

// --- State ---
// REMOVED browserPool array
// Active user sessions
// Structure: { page: PlaywrightPage, browser: PlaywrightBrowser, context: PlaywrightContext, logCapture: function, startTime: number }
const activeSessions = {};

// REMOVED initializeBrowserPool function
// REMOVED getProxySettingsForPoolEntry function

// --- Step 1: Start Session (Launches browser with Rotating Proxy) ---
async function startSession(baseUrl, logCapture = console.log) {
    const sessionId = crypto.randomUUID();
    const sessionStartTime = Date.now();
    logCapture(`[${sessionId}] Attempting to start session with rotating ISP proxy... BaseURL: ${baseUrl}`);

    // --- Configure Rotating Proxy ---
    const ZD_USERNAME = process.env.ZD_PROXY_USERNAME;
    const ZD_PASSWORD = process.env.ZD_PROXY_PASSWORD;

    if (!ZD_USERNAME || !ZD_PASSWORD) {
        const errorMsg = "ZD_PROXY_USERNAME or ZD_PROXY_PASSWORD missing in .env for rotating proxy.";
        logCapture(`[${sessionId}] ❌ ERROR starting session: ${errorMsg}`);
        return { success: false, error: errorMsg, duration: 0 };
    }

    const proxySettings = {
        server: 'http://isp.oxylabs.io:8000', // Rotating endpoint, assuming http
        username: ZD_USERNAME,
        password: ZD_PASSWORD
    };
    logCapture(`[${sessionId}] Using rotating proxy endpoint: ${proxySettings.server}`);
    // --- End Proxy Config ---

    let browser;
    let context;
    let page;

    try {
        // 1. Launch Browser with improved settings to reduce fingerprinting
        logCapture(`[${sessionId}] Launching new browser with rotating proxy and improved anti-fingerprinting...`);
        browser = await chromium.launch({
            headless: true, // Set to true for production environments
            proxy: proxySettings,
            args: [
                // Enhanced stealth arguments
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process,SitePerProcess',
                '--disable-site-isolation-trials',
                '--disable-web-security',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--mute-audio'
            ]
        });

        // 2. Create Context with advanced settings
        logCapture(`[${sessionId}] Creating new context with standardized LA location settings...`);
        context = await browser.newContext({
            ignoreHTTPSErrors: true,
            locale: 'en-US',
            timezoneId: 'America/Los_Angeles', // Set to LA timezone
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
            hasTouch: false,
            isMobile: false,
            javaScriptEnabled: true,
            acceptDownloads: false,
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'X-Forwarded-For': '128.97.27.37' // UCLA IP address (Los Angeles)
            },
            geolocation: {
                latitude: 34.052235, // LA coordinates
                longitude: -118.243683,
                accuracy: 100
            },
            permissions: ['geolocation'] // Pre-grant geolocation permission
        });
        
        // Add script to mask automation and set LA location
        await context.addInitScript(() => {
            // Override properties that reveal automation
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            
            // Override chrome object
            if (window.chrome) {
                window.chrome = {};
            }
            
            // Override Permissions API
            if (navigator.permissions) {
                navigator.permissions.query = (parameters) => 
                    Promise.resolve({ state: 'granted', onchange: null });
            }
            
            // Override geolocation API to return LA coordinates
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition = function(success) {
                    success({ 
                        coords: {
                            latitude: 34.052235, // LA coordinates
                            longitude: -118.243683,
                            accuracy: 100,
                            altitude: null,
                            altitudeAccuracy: null,
                            heading: null,
                            speed: null
                        },
                        timestamp: Date.now()
                    });
                };
            }
            
            // Set timezone to LA
            Object.defineProperty(Intl, 'DateTimeFormat', {
                writable: true,
                configurable: true
            });
            const originalDateTimeFormat = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function(...args) {
                if (args.length > 0 && args[1] && args[1].timeZone) {
                    args[1].timeZone = 'America/Los_Angeles';
                }
                return new originalDateTimeFormat(...args);
            };
            Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;
        });
        
        page = await context.newPage();
        const setupTime = (Date.now() - sessionStartTime) / 1000;
        logCapture(`[${sessionId}] Browser, context, page created in ${setupTime.toFixed(2)}s with standardized profile.`);

        // Resource blocking & Cookie check (remains the same)
        await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,otf,eot}', route => route.abort().catch(()=>{}));
        await page.route(/google|facebook|analytics|hotjar|doubleclick/, route => route.abort().catch(()=>{}));
        logCapture(`[${sessionId}] Resource blocking applied.`);
        try {
            logCapture(`[${sessionId}] Checking for cookie consent banner before navigation...`);
            const cookieSelector = '#onetrust-accept-btn-handler';
            const cookieButton = await page.waitForSelector(cookieSelector, { timeout: 3000, state: 'visible' }).catch(() => null);
            if (cookieButton) {
                logCapture(`[${sessionId}] Found cookie button, clicking...`);
                await cookieButton.click({ force: true, timeout: 2000 }).catch(e => logCapture(`[${sessionId}] WARN: Cookie click failed: ${e.message}`));
                await page.waitForTimeout(500);
                logCapture(`[${sessionId}] Cookie button clicked.`);
            } else { logCapture(`[${sessionId}] No cookie button found within 3 seconds.`); }
        } catch (e) { logCapture(`[${sessionId}] WARN: Cookie consent check failed: ${e.message}`); }

        // Apply the comprehensive one-time standardization
        await standardizeBrowserSession(browser, page, sessionId, logCapture);
        
        // Now navigate with the standardized profile
        logCapture(`[${sessionId}] Navigating to Calendly URL with standardized profile: ${baseUrl}`);
        const navStartTime = Date.now();
        
        // Try with three strategies in sequence if needed
        let navigationSuccess = false;
        const strategies = ['domcontentloaded', 'load', 'networkidle'];
        const timeouts = [20000, 30000, 45000]; // Increasing timeouts
        
        for (let i = 0; i < strategies.length && !navigationSuccess; i++) {
            try {
                logCapture(`[${sessionId}] Navigation attempt ${i+1} with strategy '${strategies[i]}' and timeout ${timeouts[i]}ms...`);
                await page.goto(baseUrl, {
                    waitUntil: strategies[i],
                    timeout: timeouts[i]
                });
                navigationSuccess = true;
                logCapture(`[${sessionId}] Navigation succeeded with '${strategies[i]}' strategy.`);
            } catch (navError) {
                logCapture(`[${sessionId}] Navigation failed with '${strategies[i]}' strategy: ${navError.message}`);
                if (i === strategies.length - 1) {
                    throw navError; // Re-throw on final attempt
                }
                // Small wait between attempts
                await page.waitForTimeout(1000);
            }
        }
        
        const navTime = (Date.now() - navStartTime) / 1000;
        logCapture(`[${sessionId}] Navigated to base URL in ${navTime.toFixed(2)}s. Page title: ${await page.title().catch(() => 'Error getting title')}`);

        // 4. Store Active Session
        activeSessions[sessionId] = { page, browser, context, logCapture, startTime: sessionStartTime };
        logCapture(`[${sessionId}] Session active and stored with standardized browser profile. Timeout: ${SESSION_TIMEOUT_MS / 1000 / 60} mins.`);

        const totalTime = (Date.now() - sessionStartTime) / 1000;
        return { success: true, sessionId: sessionId, duration: parseFloat(totalTime.toFixed(2)) };

    } catch (error) {
        logCapture(`[${sessionId}] ❌ ERROR during session start: ${error}`);
        // Cleanup on error: Close browser if launched
        if (browser) {
             await browser.close().catch(e => logCapture(`[${sessionId}] Error closing browser during session start failure: ${e.message}`));
        }
        delete activeSessions[sessionId]; // Ensure session is removed

        const totalTime = (Date.now() - sessionStartTime) / 1000;
        return { success: false, error: error.message, duration: parseFloat(totalTime.toFixed(2)) };
    }
}

// --- Session Cleanup Logic (Simplified: Just close the session's browser) ---
async function closeSession(sessionId) {
    const session = activeSessions[sessionId];
    if (!session) return false;
    
    try {
        const { page, browser, logCapture = console.log } = session;
        
        // First remove route handlers
        if (page && !page.isClosed()) {
            await removeAllRoutes(page, sessionId, logCapture);
        }
        
        // Then close browser
        if (browser) {
            await browser.close().catch(e => {
                logCapture(`[${sessionId}] Error closing browser: ${e.message}`);
            });
        }
        
        delete activeSessions[sessionId];
        logCapture(`[${sessionId}] Session closed and removed from active sessions.`);
        return true;
    } catch (e) {
        console.error(`Error closing session ${sessionId}:`, e);
        delete activeSessions[sessionId]; // Still remove from active sessions
        return false;
    }
}

// --- Start Periodic Cleanup --- (No change)
console.log(`[SessionManager] Initializing idle session cleanup. Timeout: ${SESSION_TIMEOUT_MS / 1000 / 60} mins, Check Interval: ${CLEANUP_INTERVAL_MS / 1000 / 60} mins.`);
startIdleSessionCleanup();
const cleanupIntervalId = setInterval(startIdleSessionCleanup, CLEANUP_INTERVAL_MS);

// --- Graceful Shutdown (Simplified: Close browsers in activeSessions) ---
process.on('SIGINT', async () => {
  console.log('\n[SessionManager] Received SIGINT. Shutting down...');
  clearInterval(cleanupIntervalId);
  console.log('[SessionManager] Closing browsers for all remaining active sessions...');
  const closePromises = Object.values(activeSessions).map(async (session) => {
      // Log which session's browser is being closed
      const sessionId = Object.keys(activeSessions).find(key => activeSessions[key] === session); // Find ID for logging
      console.log(`[SessionManager] Closing browser for active session ${sessionId}...`);
      try {
          if (session.browser) {
             await session.browser.close();
          }
      } catch (e) {
          console.error(`[SessionManager] Error closing browser for session ${sessionId}: ${e.message}`);
      }
  });
  await Promise.allSettled(closePromises);
  console.log('[SessionManager] All active session browsers closed. Exiting.');
  process.exit(0);
});

// --- Exports --- (Removed pool related)
module.exports = {
    startSession,
    activeSessions
};

/**
 * Performs a cleanup of idle sessions
 */
function startIdleSessionCleanup() {
    const now = Date.now();
    const activeSessionCount = Object.keys(activeSessions).length;
    console.log(`[SessionManager] Running cleanup check... Active: ${activeSessionCount}`);
    
    for (const [sessionId, session] of Object.entries(activeSessions)) {
        const lastActiveTime = session.lastActiveTime || session.startTime || now;
        const idleTimeMs = now - lastActiveTime;
        
        if (idleTimeMs >= SESSION_TIMEOUT_MS) {
            console.log(`[SessionManager] Session ${sessionId} idle for ${Math.floor(idleTimeMs / 1000 / 60)} minutes, cleaning up...`);
            
            try {
                // Close and cleanup this session
                if (session.browser) {
                    // First remove route handlers if exists
                    if (session.page && !session.page.isClosed()) {
                        try {
                            session.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
                        } catch (e) {
                            // Ignore errors during unroute
                        }
                    }
                    
                    // Then close browser
                    session.browser.close().catch(e => {
                        console.error(`[SessionManager] Error closing browser for idle session ${sessionId}:`, e.message);
                    });
                }
                
                // Remove from active sessions
                delete activeSessions[sessionId];
                console.log(`[SessionManager] Idle session ${sessionId} cleaned up.`);
            } catch (error) {
                console.error(`[SessionManager] Error during cleanup of session ${sessionId}:`, error.message);
                // Still remove from active sessions if cleanup failed
                delete activeSessions[sessionId];
            }
        }
    }
}
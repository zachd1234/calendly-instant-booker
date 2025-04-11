// Handles creation and management of browser sessions (using rotating proxy)

const { chromium } = require('playwright');
const crypto = require('crypto');
require('dotenv').config(); // Still needs .env vars for proxy credentials
const { standardizeBrowserProfile, standardizeBrowserSession, removeAllRoutes } = require('./utils/browserUtils');

// --- Configuration ---
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;    // 5 minutes
const MAX_IP_RETRIES = 3; // Max retries if specific problematic IP is detected
// PROXY_LIST_PATH is no longer needed

// --- State ---
// REMOVED browserPool array
// Active user sessions
// Structure: { page: PlaywrightPage, browser: PlaywrightBrowser, context: PlaywrightContext, logCapture: function, startTime: number }
const activeSessions = {};

// REMOVED initializeBrowserPool function
// REMOVED getProxySettingsForPoolEntry function

// --- Step 1: Start Session (Launches browser with Rotating Proxy) ---

/**
 * Creates realistic human-like delays
 * @param {Page} page - Playwright page
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {Promise<number>} The actual delay used
 */
async function humanDelay(page, min = 500, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min)) + min;
    await page.waitForTimeout(delay);
    return delay;
}

/**
 * Performs human-like mouse movements on the page
 * @param {Page} page - Playwright page
 * @param {string} sessionId - Session identifier for logging
 * @param {Function} logCapture - Logging function
 */
async function simulateHumanMouseMovement(page, sessionId, logCapture) {
    // Start position
    let lastX = 100 + Math.floor(Math.random() * 500);
    let lastY = 100 + Math.floor(Math.random() * 300);
    
    // Number of movements (fewer for better performance)
    const movements = 3 + Math.floor(Math.random() * 5);
    
    for (let i = 0; i < movements; i++) {
        // Generate next position with natural movement
        const nextX = Math.max(0, Math.min(1200, lastX + (Math.random() - 0.5) * 300));
        const nextY = Math.max(0, Math.min(700, lastY + (Math.random() - 0.5) * 200));
        
        // Fewer steps for better performance
        const steps = 5 + Math.floor(Math.random() * 10);
        
        // Perform movement with intermediate points
        for (let step = 1; step <= steps; step++) {
            // Ease-in-out curve for natural movement
            const t = step / steps;
            const tSmoothstep = t * t * (3 - 2 * t);
            
            const x = lastX + (nextX - lastX) * tSmoothstep;
            const y = lastY + (nextY - lastY) * tSmoothstep;
            
            await page.mouse.move(x, y);
            await page.waitForTimeout(5 + Math.random() * 10); // Small delay
        }
        
        // Update last position
        lastX = nextX;
        lastY = nextY;
        
        // Add a short pause between movements
        await humanDelay(page, 50, 200);
    }
    
    // Add some scrolling
    const scrollAmount = Math.floor(Math.random() * 300) + 100;
    await page.mouse.wheel(0, scrollAmount);
    
    logCapture(`[${sessionId}] Completed ${movements} human-like mouse movements`);
}

/**
 * Enhanced start session function with advanced anti-bot measures
 * @param {string} baseUrl The target URL to navigate to initially.
 * @param {Function} [logCapture=console.log] Function to capture logs.
 * @param {number} [retryCount=0] Internal counter for IP-based retries.
 * @returns {Promise<object>} Object indicating success/failure, sessionId, and duration.
 */
async function startSession(baseUrl, logCapture = console.log, retryCount = 0) {
    const sessionId = crypto.randomUUID();
    const sessionStartTime = Date.now();
    logCapture(`[${sessionId}] Starting enhanced session (Attempt ${retryCount + 1})...`);

    // --- Configure Rotating Proxy ---
    const ZD_USERNAME = process.env.ZD_PROXY_USERNAME;
    const ZD_PASSWORD = process.env.ZD_PROXY_PASSWORD;

    if (!ZD_USERNAME || !ZD_PASSWORD) {
        const errorMsg = "ZD_PROXY_USERNAME or ZD_PROXY_PASSWORD missing in .env for rotating proxy.";
        logCapture(`[${sessionId}] ❌ ERROR starting session: ${errorMsg}`);
        return { success: false, error: errorMsg, duration: 0 };
    }

    const proxySettings = {
        server: 'http://isp.oxylabs.io:8000',
        username: ZD_USERNAME,
        password: ZD_PASSWORD
    };
    logCapture(`[${sessionId}] Using rotating proxy endpoint: ${proxySettings.server}`);

    let browser;
    let context;
    let page;

    try {
        // 1. Launch Browser with enhanced stealth settings
        logCapture(`[${sessionId}] Launching browser with advanced anti-fingerprinting...`);
        
        // Use a random set of args to vary the browser fingerprint
        const baseArgs = [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ];
        
        const optionalArgs = [
            '--disable-accelerated-2d-canvas',
            '--disable-canvas-aa',
            '--disable-2d-canvas-clip-aa',
            '--disable-gpu-driver-bug-workarounds',
            '--disable-gpu-vsync',
            '--disable-ipc-flooding-protection',
            '--disable-notifications',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-extensions',
            '--disable-features=TranslateUI',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-renderer-backgrounding',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--force-color-profile=srgb',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-first-run',
            '--password-store=basic',
        ];
        
        // Add 3-8 random optional arguments to create variation
        const selectedOptionalArgs = [];
        for (const arg of optionalArgs) {
            if (Math.random() > 0.6) { // 40% chance to include each arg
                selectedOptionalArgs.push(arg);
                // Don't add too many, cap at 8
                if (selectedOptionalArgs.length >= 8) break;
            }
        }
        
        // Launch with combined arguments
        browser = await chromium.launch({
            headless: true,
            proxy: proxySettings,
            args: [...baseArgs, ...selectedOptionalArgs]
        });
        
        // Small randomization in viewport size
        const widthVariation = Math.floor(Math.random() * 80); // +/- 40px
        const heightVariation = Math.floor(Math.random() * 60); // +/- 30px
        const viewportWidth = 1280 + (widthVariation - 40);
        const viewportHeight = 800 + (heightVariation - 30);
        
        // 2. Create context with slightly randomized settings
        logCapture(`[${sessionId}] Creating browser context with subtle randomizations...`);
        context = await browser.newContext({
            ignoreHTTPSErrors: true,
            locale: 'en-US',
            timezoneId: 'America/Los_Angeles',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { 
                width: viewportWidth, 
                height: viewportHeight 
            },
            deviceScaleFactor: Math.random() > 0.5 ? 1 : 1.25, // Sometimes use Retina
            hasTouch: false,
            isMobile: false,
            javaScriptEnabled: true,
            acceptDownloads: false,
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'X-Forwarded-For': '128.97.27.37', // UCLA IP
                'Sec-Ch-Ua': '"Google Chrome";v="124", " Not;A Brand";v="99"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"macOS"',
            },
            geolocation: {
                latitude: 34.052235 + (Math.random() - 0.5) * 0.01, // Slight variation
                longitude: -118.243683 + (Math.random() - 0.5) * 0.01,
                accuracy: 100
            },
            permissions: ['geolocation']
        });
        
        // Add enhanced stealth script with more realistic browser behavior
        await context.addInitScript(() => {
            // Override properties that reveal automation
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            
            // Add realistic browser features
            if (!window.chrome) {
                window.chrome = {
                    runtime: {},
                    loadTimes: function() {},
                    csi: function() {},
                    app: {}
                };
            }
            
            // Add more realistic plugins
            const originalPlugins = Navigator.prototype.plugins;
            Object.defineProperty(Navigator.prototype, 'plugins', {
                get: () => {
                    const plugins = [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
                        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                    ];
                    
                    // Add plugin methods and properties
                    plugins.forEach(plugin => {
                        plugin.item = () => plugin;
                        plugin.namedItem = () => plugin;
                        plugin.length = 1;
                    });
                    
                    return plugins;
                }
            });
            
            // Override permissions API
            if (navigator.permissions) {
                navigator.permissions.query = (parameters) => 
                    Promise.resolve({ state: 'granted', onchange: null });
            }
            
            // Override geolocation API
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition = function(success) {
                    // Add slight random variation to coordinates
                    const latVariation = (Math.random() - 0.5) * 0.01;
                    const longVariation = (Math.random() - 0.5) * 0.01;
                    
                    success({ 
                        coords: {
                            latitude: 34.052235 + latVariation,
                            longitude: -118.243683 + longVariation,
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
            
            // Set timezone with more natural implementation
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
            
            // Add hardware concurrency and device memory with slight variation
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => Math.floor(Math.random() * 4) + 4 // 4-8 cores
            });
            
            if (!navigator.deviceMemory) {
                Object.defineProperty(navigator, 'deviceMemory', {
                    get: () => Math.pow(2, Math.floor(Math.random() * 3) + 2) // 4, 8, or 16 GB
                });
            }
            
            // Add realistic battery API
            if (!navigator.getBattery) {
                navigator.getBattery = () => Promise.resolve({
                    charging: Math.random() > 0.3, // 70% chance to be charging
                    chargingTime: Math.random() > 0.5 ? Infinity : Math.floor(Math.random() * 3600),
                    dischargingTime: Math.floor(Math.random() * 7200) + 1800,
                    level: 0.25 + Math.random() * 0.75 // Random battery level between 25% and 100%
                });
            }
            
            // Add common browser storage items
            try {
                localStorage.setItem('_ga', `GA1.2.${Math.floor(Math.random() * 1000000000)}.${Math.floor(Date.now()/1000)}`);
                localStorage.setItem('CookieConsent', 'true');
                localStorage.setItem('timezone', 'America/Los_Angeles');
                localStorage.setItem('returning_visitor', 'true');
            } catch (e) {
                // Ignore localStorage errors
            }
        });
        
        // Create page with small delay to make it more natural
        page = await context.newPage();
        await humanDelay(page, 500, 1500);
        
        const setupTime = (Date.now() - sessionStartTime) / 1000;
        logCapture(`[${sessionId}] Browser context created in ${setupTime.toFixed(2)}s with humanized settings.`);

        // Selective resource blocking - allow some resources through for more natural behavior
        await page.route('**/*.{woff,woff2,ttf,png,jpg,jpeg}', route => {
            // Let some resources through randomly (20% chance)
            if (Math.random() > 0.8) {
                route.continue();
            } else {
                route.abort().catch(() => {});
            }
        });
        
        // Block analytics more selectively
        await page.route(/google-analytics|facebook|hotjar|doubleclick/, route => route.abort().catch(() => {}));
        logCapture(`[${sessionId}] Selective resource blocking applied.`);
        
        // Handle cookies with natural timing
        try {
            await humanDelay(page, 300, 1200);
            logCapture(`[${sessionId}] Checking for cookie consent banner...`);
            const cookieSelector = '#onetrust-accept-btn-handler';
            const cookieButton = await page.waitForSelector(cookieSelector, { timeout: 3000, state: 'visible' }).catch(() => null);
            if (cookieButton) {
                // Add natural delay before clicking cookie button
                await humanDelay(page, 800, 2000);
                logCapture(`[${sessionId}] Found cookie button, clicking naturally...`);
                await cookieButton.click({ force: true, timeout: 2000 }).catch(e => logCapture(`[${sessionId}] WARN: Cookie click failed: ${e.message}`));
                await humanDelay(page, 500, 1500);
                logCapture(`[${sessionId}] Cookie consent handled.`);
            } else { 
                logCapture(`[${sessionId}] No cookie banner found.`); 
            }
        } catch (e) { 
            logCapture(`[${sessionId}] WARN: Cookie consent check failed: ${e.message}`); 
        }

        // Apply one-time standardization but with natural behavior
        // --- IP Detection and Conditional Retry --- 
        let ipInfo = null;
        try {
            logCapture(`[${sessionId}] Detecting IP information...`);
            const response = await page.goto('https://ipinfo.io/json', { timeout: 10000 });
            ipInfo = await response.json();
            logCapture(`[${sessionId}] IP Information: ${JSON.stringify(ipInfo, null, 2)}`);

            const problematicIP = '45.196.58.213';
            if (ipInfo && ipInfo.ip === problematicIP) {
                logCapture(`[${sessionId}] Detected problematic IP: ${problematicIP}`);
                if (retryCount < MAX_IP_RETRIES) {
                    logCapture(`[${sessionId}] Attempting retry (${retryCount + 1}/${MAX_IP_RETRIES})...`);
                    // Clean up current attempt before retrying
                    if (browser) await browser.close().catch(() => {});
                    // Recursive call with incremented retry count
                    return startSession(baseUrl, logCapture, retryCount + 1); 
                } else {
                    logCapture(`[${sessionId}] ❌ ERROR: Reached max retries (${MAX_IP_RETRIES}) for problematic IP ${problematicIP}. Failing session start.`);
                    throw new Error(`Failed to get a non-problematic IP after ${MAX_IP_RETRIES} retries.`);
                }
            }
        } catch (ipError) {
            // Log non-critical IP detection errors, but check if it was the problematic IP error
            if (ipError.message.includes('Failed to get a non-problematic IP')) {
                throw ipError; // Re-throw the specific error to fail the session
            }
            logCapture(`[${sessionId}] WARN: IP detection failed or skipped (non-critical): ${ipError.message}`);
            // Optionally, save state even without IP info if needed elsewhere
            // await context.storageState({ path: `session_state_${sessionId}.json` }).catch(e => logCapture(`[${sessionId}] WARN: Saving state failed: ${e.message}`));
        }
        // --- End IP Detection --- 

        await standardizeBrowserSession(browser, page, sessionId, logCapture);
        await humanDelay(page, 500, 1500);
        
        // Simulate human navigation with pre-warming
        logCapture(`[${sessionId}] Preparing human-like navigation to ${baseUrl}...`);
        
        // 1. Pre-warm connections with a HEAD request (optional)
        try {
            await page.evaluate(async (url) => {
                try {
                    await fetch(url, { 
                        method: 'HEAD', 
                        mode: 'no-cors', 
                        cache: 'no-store',
                        credentials: 'omit'
                    });
                } catch (e) {
                    // Ignore errors, this is just for connection warming
                }
            }, baseUrl);
            await humanDelay(page, 300, 800);
        } catch (e) {
            // Ignore errors, continue with navigation
        }
        
        // Set referer to make it look like we came from a search engine
        const referers = [
            'https://www.google.com/search?q=calendly+scheduling',
            'https://www.google.com/search?q=book+appointment+online',
            'https://www.bing.com/search?q=calendly',
            'https://duckduckgo.com/?q=online+scheduling+tool',
            '',  // No referer sometimes
        ];
        
        const selectedReferer = referers[Math.floor(Math.random() * referers.length)];
        if (selectedReferer) {
            await page.setExtraHTTPHeaders({
                'Referer': selectedReferer
            });
            logCapture(`[${sessionId}] Set referer: ${selectedReferer}`);
        }
        
        // Try navigation with progressive strategies
        logCapture(`[${sessionId}] Starting human-like navigation...`);
        const navStartTime = Date.now();
        
        // Dynamic strategies with progressive timeouts
        const strategies = [
            { name: 'domcontentloaded', timeout: 20000 },
            { name: 'load', timeout: 30000 },
            { name: 'networkidle', timeout: 45000 }
        ];
        
        let navigationSuccess = false;
        
        for (let i = 0; i < strategies.length && !navigationSuccess; i++) {
            try {
                logCapture(`[${sessionId}] Navigation attempt ${i+1}/${strategies.length} with strategy '${strategies[i].name}'...`);
                
                if (i > 0) {
                    // Add longer delay between attempts
                    await humanDelay(page, 2000, 4000);
                    
                    // Log retry attitude
                    logCapture(`[${sessionId}] Retrying with more patience (${strategies[i].name})...`);
                }
                
                // Navigate with current strategy
                const response = await page.goto(baseUrl, {
                    waitUntil: strategies[i].name,
                    timeout: strategies[i].timeout
                });
                
                // Check if navigation was successful
                if (response && response.status() >= 200 && response.status() < 400) {
                    navigationSuccess = true;
                    logCapture(`[${sessionId}] Navigation succeeded with '${strategies[i].name}' strategy, status: ${response.status()}`);
                    
                    // Add human delay after successful navigation
                    await humanDelay(page, 800, 2000);
                } else {
                    throw new Error(`Received status code ${response ? response.status() : 'unknown'}`);
                }
            } catch (navError) {
                logCapture(`[${sessionId}] Navigation attempt ${i+1} failed: ${navError.message}`);
                
                if (i === strategies.length - 1) {
                    throw navError; // Re-throw on final attempt
                }
                
                // Add longer wait between attempts
                await humanDelay(page, 2000, 5000);
            }
        }
        
        // After successful navigation, perform human-like interaction
        logCapture(`[${sessionId}] Page loaded, simulating human browsing behavior...`);
        
        // Simulate human mouse movements and scrolling
        await simulateHumanMouseMovement(page, sessionId, logCapture);
        
        // Add some keyboard interactions (tab navigation)
        const tabCount = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < tabCount; i++) {
            await humanDelay(page, 300, 800);
            await page.keyboard.press('Tab');
        }
        
        // Simulate human scrolling
        await page.evaluate(() => {
            return new Promise(resolve => {
                let scrolledPixels = 0;
                const targetScroll = Math.random() * 500 + 100;
                
                const scrollStep = () => {
                    const step = Math.min(20 + Math.random() * 30, targetScroll - scrolledPixels);
                    window.scrollBy(0, step);
                    scrolledPixels += step;
                    
                    if (scrolledPixels < targetScroll) {
                        setTimeout(scrollStep, 50 + Math.random() * 100);
                    } else {
                        resolve();
                    }
                };
                
                setTimeout(scrollStep, 500);
            });
        });
        
        // Get page title with error handling
        const pageTitle = await page.title().catch(() => 'Unknown Page Title');
        const navTime = (Date.now() - navStartTime) / 1000;
        logCapture(`[${sessionId}] Completed human-like navigation in ${navTime.toFixed(2)}s. Page title: ${pageTitle}`);

        // Store session in active sessions
        activeSessions[sessionId] = { 
            page, 
            browser, 
            context, 
            logCapture, 
            startTime: sessionStartTime,
            lastActiveTime: Date.now() // Track for session timeouts
        };
        
        logCapture(`[${sessionId}] Session active with humanized browser profile. Timeout: ${SESSION_TIMEOUT_MS / 1000 / 60} mins.`);

        const totalTime = (Date.now() - sessionStartTime) / 1000;
        return { success: true, sessionId: sessionId, duration: parseFloat(totalTime.toFixed(2)) };

    } catch (error) {
        logCapture(`[${sessionId}] ❌ ERROR during session start: ${error}`);
        
        // Cleanup on error: Close browser if launched
        if (browser) {
            try {
                // First remove route handlers if page exists
                if (page && !page.isClosed()) {
                    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
                }
                
                // Then close browser
                await browser.close().catch(e => logCapture(`[${sessionId}] Error closing browser during session start failure: ${e.message}`));
            } catch (cleanupError) {
                logCapture(`[${sessionId}] Error during cleanup: ${cleanupError.message}`);
            }
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
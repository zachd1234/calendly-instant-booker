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
 * Performs more sophisticated human-like mouse movements with idle periods
 * @param {Page} page - Playwright page
 * @param {string} sessionId - Session identifier for logging
 * @param {Function} logCapture - Logging function
 */
async function simulateHumanMouseMovement(page, sessionId, logCapture) {
    // Start position
    let lastX = 100 + Math.floor(Math.random() * 500);
    let lastY = 100 + Math.floor(Math.random() * 300);
    
    // More complex movement patterns
    const patterns = [
        'casual-browsing',     // Slow movements with pauses
        'reading-content',     // Small movements + scrolling
        'searching-for-info',  // Faster movements, clicks
        'idle-thinking'        // Almost no movement + long pause
    ];
    
    const selectedPattern = patterns[Math.floor(Math.random() * patterns.length)];
    logCapture(`[${sessionId}] Using human behavior pattern: ${selectedPattern}`);
    
    // Number of movements based on pattern
    let movements = 3;
    let idleProbability = 0.1;
    let scrollProbability = 0.3;
    let maxIdleTime = 2000;
    
    // Adjust parameters based on selected pattern
    switch(selectedPattern) {
        case 'casual-browsing':
            movements = 3 + Math.floor(Math.random() * 4);
            scrollProbability = 0.4;
            idleProbability = 0.2;
            maxIdleTime = 3000;
            break;
        case 'reading-content':
            movements = 2 + Math.floor(Math.random() * 3);
            scrollProbability = 0.7;
            idleProbability = 0.3;
            maxIdleTime = 5000;
            break;
        case 'searching-for-info':
            movements = 5 + Math.floor(Math.random() * 4);
            scrollProbability = 0.5;
            idleProbability = 0.1;
            maxIdleTime = 1500;
            break;
        case 'idle-thinking':
            movements = 1 + Math.floor(Math.random() * 2);
            scrollProbability = 0.2;
            idleProbability = 0.8;
            maxIdleTime = 8000;
            break;
    }
    
    // Perform movements with idle periods
    for (let i = 0; i < movements; i++) {
        // Simulate idle period
        if (Math.random() < idleProbability) {
            const idleTime = Math.floor(Math.random() * maxIdleTime) + 500;
            logCapture(`[${sessionId}] Idle period: ${idleTime}ms`);
            await page.waitForTimeout(idleTime);
        }
        
        // Generate next position with more natural movement
        // Using bezier curves for more realistic movement
        const targetX = Math.max(0, Math.min(1200, lastX + (Math.random() - 0.5) * 400));
        const targetY = Math.max(0, Math.min(700, lastY + (Math.random() - 0.5) * 250));
        
        const controlPointX1 = lastX + (targetX - lastX) * (0.2 + Math.random() * 0.3);
        const controlPointY1 = lastY + (targetY - lastY) * (0.2 + Math.random() * 0.3);
        const controlPointX2 = lastX + (targetX - lastX) * (0.6 + Math.random() * 0.3);
        const controlPointY2 = lastY + (targetY - lastY) * (0.6 + Math.random() * 0.3);
        
        // Fewer steps for better performance but still realistic
        const steps = 5 + Math.floor(Math.random() * 15);
        
        // Perform movement with bezier curve
        for (let step = 0; step <= steps; step++) {
            const t = step / steps;
            
            // Cubic bezier curve calculation
            const tPow2 = t * t;
            const tPow3 = tPow2 * t;
            const mt = 1 - t;
            const mtPow2 = mt * mt;
            const mtPow3 = mtPow2 * mt;
            
            const x = mtPow3 * lastX + 
                     3 * mtPow2 * t * controlPointX1 + 
                     3 * mt * tPow2 * controlPointX2 + 
                     tPow3 * targetX;
                     
            const y = mtPow3 * lastY + 
                     3 * mtPow2 * t * controlPointY1 + 
                     3 * mt * tPow2 * controlPointY2 + 
                     tPow3 * targetY;
            
            await page.mouse.move(x, y);
            
            // Variable delay between movements
            const stepDelay = 5 + Math.random() * (t < 0.3 || t > 0.7 ? 15 : 8);
            await page.waitForTimeout(stepDelay);
        }
        
        // Update last position
        lastX = targetX;
        lastY = targetY;
        
        // Random chance to click after movement
        if (Math.random() < 0.3) {
            await page.mouse.click(lastX, lastY);
            await humanDelay(page, 300, 800);
        }
        
        // Random chance to scroll after movement
        if (Math.random() < scrollProbability) {
            const scrollAmount = Math.floor(Math.random() * 300) + 50;
            const scrollDirection = Math.random() > 0.2 ? 1 : -1; // 80% down, 20% up
            await page.mouse.wheel(0, scrollAmount * scrollDirection);
            await humanDelay(page, 300, 1000);
        }
    }
    
    logCapture(`[${sessionId}] Completed ${movements} human-like mouse movements with pattern: ${selectedPattern}`);
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
            headless: false,
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
            extraHTTPers: {
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

            // Define an array of problematic IPs
            const problematicIPs = ['45.196.58.213', '50.117.28.79', '69.46.65.27'];
            
            // Check if the detected IP is in the problematic list
            if (ipInfo && problematicIPs.includes(ipInfo.ip)) {
                logCapture(`[${sessionId}] Detected problematic IP: ${ipInfo.ip}`);
                if (retryCount < MAX_IP_RETRIES) {
                    logCapture(`[${sessionId}] Attempting retry (${retryCount + 1}/${MAX_IP_RETRIES})...`);
                    // Clean up current attempt before retrying
                    if (browser) await browser.close().catch(() => {});
                    // Recursive call with incremented retry count
                    return startSession(baseUrl, logCapture, retryCount + 1); 
                } else {
                    logCapture(`[${sessionId}] ❌ ERROR: Reached max retries (${MAX_IP_RETRIES}) for problematic IP ${ipInfo.ip}. Failing session start.`);
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
        const { page, browser, logCapture = console.log, rateLimitCheckInterval } = session;
        
        // Clear any intervals
        if (rateLimitCheckInterval) {
            clearInterval(rateLimitCheckInterval);
        }
        
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

/**
 * Starts a predictive session with two separate browser instances for two potential meeting times
 * @param {string} baseUrl - The base Calendly URL (not used in this implementation)
 * @param {string} bookingUrl1 - First specific booking URL with date/time
 * @param {string} bookingUrl2 - Second specific booking URL with date/time
 * @param {Object} clientInfo - Client information for booking
 * @param {string} clientInfo.name - Client name
 * @param {string} clientInfo.email - Client email
 * @param {string} clientInfo.phone - Client phone in format "+1 1234567890"
 * @param {Function} logCapture - Function to capture logs
 * @returns {Promise<Object>} Success/failure status and session IDs
 */
async function startPredictiveSession(baseUrl, bookingUrl1, bookingUrl2, clientInfo, logCapture = console.log) {
    const masterSessionId = crypto.randomUUID();
    const startTime = Date.now();
    logCapture(`[${masterSessionId}] Starting predictive session with two options...`);
    
    try {
        // Import the new predictive booking service
        const { prepareBooking } = require('./services/predictiveBookingService');
        
        // Start two separate browser sessions going directly to the specific booking URLs
        logCapture(`[${masterSessionId}] Launching first browser directly to booking URL 1...`);
        const session1Promise = startSession(bookingUrl1, 
            (msg) => logCapture(`[Option1] ${msg}`));
            
        logCapture(`[${masterSessionId}] Launching second browser directly to booking URL 2...`);
        const session2Promise = startSession(bookingUrl2, 
            (msg) => logCapture(`[Option2] ${msg}`));
        
        // Wait for both sessions to initialize
        const [session1Result, session2Result] = await Promise.all([session1Promise, session2Promise]);
        
        // Check if both sessions started successfully
        if (!session1Result.success || !session2Result.success) {
            const errorMessage = !session1Result.success 
                ? `First session failed: ${session1Result.error}` 
                : `Second session failed: ${session2Result.error}`;
                
            throw new Error(errorMessage);
        }
        
        const sessionId1 = session1Result.sessionId;
        const sessionId2 = session2Result.sessionId;
        
        // Store client information in both sessions
        if (activeSessions[sessionId1]) {
            activeSessions[sessionId1].clientInfo = { ...clientInfo };
            activeSessions[sessionId1].bookingUrl = bookingUrl1;
        }
        
        if (activeSessions[sessionId2]) {
            activeSessions[sessionId2].clientInfo = { ...clientInfo };
            activeSessions[sessionId2].bookingUrl = bookingUrl2;
        }
        
        // Link the two sessions together under the master session
        activeSessions[sessionId1].masterSessionId = masterSessionId;
        activeSessions[sessionId2].masterSessionId = masterSessionId;
        
        // Now prepare both booking forms using the new service
        logCapture(`[${masterSessionId}] Preparing booking form for option 1...`);
        const prepareOption1 = prepareBooking(
            activeSessions[sessionId1].page,
            bookingUrl1,
            clientInfo.name,
            clientInfo.email,
            clientInfo.phone,
            (msg) => logCapture(`[Option1] ${msg}`)
        );
        
        logCapture(`[${masterSessionId}] Preparing booking form for option 2...`);
        const prepareOption2 = prepareBooking(
            activeSessions[sessionId2].page,
            bookingUrl2,
            clientInfo.name,
            clientInfo.email,
            clientInfo.phone,
            (msg) => logCapture(`[Option2] ${msg}`)
        );
        
        // Wait for both preparations to complete
        const [prepResult1, prepResult2] = await Promise.all([prepareOption1, prepareOption2]);
        
        // Check preparation results
        if (!prepResult1.success || !prepResult2.success) {
            const errorMessage = !prepResult1.success 
                ? `Preparation of form 1 failed: ${prepResult1.error}` 
                : `Preparation of form 2 failed: ${prepResult2.error}`;
                
            logCapture(`[${masterSessionId}] ⚠️ Warning: ${errorMessage}`);
            // We won't throw here, as we still have the sessions even if form filling failed
        }
        
        // Update session data with preparation results
        if (activeSessions[sessionId1]) {
            activeSessions[sessionId1].prepResult = prepResult1;
            activeSessions[sessionId1].formReady = prepResult1.success;
        }
        
        if (activeSessions[sessionId2]) {
            activeSessions[sessionId2].prepResult = prepResult2;
            activeSessions[sessionId2].formReady = prepResult2.success;
        }
        
        const totalTime = (Date.now() - startTime) / 1000;
        logCapture(`[${masterSessionId}] Predictive session initialized successfully in ${totalTime.toFixed(2)}s`);
        logCapture(`[${masterSessionId}] Session 1 ID: ${sessionId1}, Form Ready: ${prepResult1.success}`);
        logCapture(`[${masterSessionId}] Session 2 ID: ${sessionId2}, Form Ready: ${prepResult2.success}`);
        
        return {
            success: true,
            sessionId1,
            sessionId2,
            masterSessionId,
            option1Ready: prepResult1.success,
            option2Ready: prepResult2.success,
            duration: parseFloat(totalTime.toFixed(2))
        };
        
    } catch (error) {
        logCapture(`[${masterSessionId}] ❌ ERROR during predictive session start: ${error.message || error}`);
        
        const totalTime = (Date.now() - startTime) / 1000;
        return {
            success: false,
            error: error.message || 'Unknown error',
            duration: parseFloat(totalTime.toFixed(2))
        };
    }
}

// Make sure to export this new function
module.exports = {
    startSession,
    startPredictiveSession,
    activeSessions
};

/**
 * Sets realistic geo-aware HTTP headers
 * @param {Page} page - Playwright page
 * @param {Object} ipInfo - IP information object
 * @param {string} sessionId - Session identifier for logging
 * @param {Function} logCapture - Logging function
 */
async function setGeoConsistentHeaders(page, ipInfo, sessionId, logCapture) {
    // Base user agents for different platforms
    const userAgents = {
        windows: [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
        ],
        mac: [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0'
        ],
        linux: [
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0'
        ]
    };
    
    // Language mapping by country
    const languageByCountry = {
        'US': 'en-US',
        'GB': 'en-GB',
        'CA': 'en-CA,fr-CA',
        'AU': 'en-AU',
        'DE': 'de-DE',
        'FR': 'fr-FR',
        'IT': 'it-IT',
        'ES': 'es-ES',
        'JP': 'ja-JP',
        'default': 'en-US'
    };
    
    // Time zone mapping by region (simplified)
    const timezoneByRegion = {
        'US': [
            'America/New_York',
            'America/Chicago',
            'America/Denver',
            'America/Los_Angeles'
        ],
        'GB': ['Europe/London'],
        'CA': ['America/Toronto', 'America/Vancouver'],
        'AU': ['Australia/Sydney', 'Australia/Perth'],
        'DE': ['Europe/Berlin'],
        'FR': ['Europe/Paris'],
        'IT': ['Europe/Rome'],
        'ES': ['Europe/Madrid'],
        'JP': ['Asia/Tokyo'],
        'default': ['America/New_York']
    };
    
    // Define platform distribution by region
    const platformDistribution = {
        'US': { windows: 0.65, mac: 0.3, linux: 0.05 },
        'GB': { windows: 0.7, mac: 0.25, linux: 0.05 },
        'CA': { windows: 0.65, mac: 0.3, linux: 0.05 },
        'default': { windows: 0.75, mac: 0.2, linux: 0.05 }
    };
    
    // Determine geo settings from IP info
    const country = ipInfo?.country || 'US';
    
    // Select platform based on country distribution
    const distribution = platformDistribution[country] || platformDistribution.default;
    const random = Math.random();
    let platform;
    
    if (random < distribution.windows) {
        platform = 'windows';
    } else if (random < distribution.windows + distribution.mac) {
        platform = 'mac';
    } else {
        platform = 'linux';
    }
    
    // Select consistent user-agent, language, and timezone
    const userAgent = userAgents[platform][Math.floor(Math.random() * userAgents[platform].length)];
    const language = languageByCountry[country] || languageByCountry.default;
    const timezones = timezoneByRegion[country] || timezoneByRegion.default;
    const timezone = timezones[Math.floor(Math.random() * timezones.length)];
    
    // Common accept headers
    const acceptHeaders = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': language + ',en;q=0.9',
        'cache-control': 'max-age=0',
        'sec-ch-ua': '"Google Chrome";v="124", " Not;A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': platform === 'windows' ? '"Windows"' : platform === 'mac' ? '"macOS"' : '"Linux"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate', 
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1'
    };
    
    // Set viewport consistent with platform
    let viewportWidth, viewportHeight;
    if (platform === 'windows') {
        viewportWidth = 1280 + Math.floor(Math.random() * 200) - 100;
        viewportHeight = 800 + Math.floor(Math.random() * 100) - 50;
    } else if (platform === 'mac') {
        viewportWidth = 1440 + Math.floor(Math.random() * 150) - 75;
        viewportHeight = 900 + Math.floor(Math.random() * 100) - 50;
    } else {
        viewportWidth = 1366 + Math.floor(Math.random() * 100) - 50;
        viewportHeight = 768 + Math.floor(Math.random() * 100) - 50;
    }
    
    // Set the headers
    await page.setExtraHTTPHeaders(acceptHeaders);
    
    // Set viewport and timezone
    await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
    
    // Log the settings
    logCapture(`[${sessionId}] Set geo-consistent headers for ${country}`);
    logCapture(`[${sessionId}] - Platform: ${platform}`);
    logCapture(`[${sessionId}] - User-Agent: ${userAgent}`);
    logCapture(`[${sessionId}] - Language: ${language}`);
    logCapture(`[${sessionId}] - Timezone: ${timezone}`);
    logCapture(`[${sessionId}] - Viewport: ${viewportWidth}x${viewportHeight}`);
    
    // Apply timezone and feature settings via script
    await page.addInitScript(({ timezone, userAgent, platform }) => {
        // Override timezone
        const timezoneOverride = timezone;
        if (Intl.DateTimeFormat) {
            const originalDateTimeFormat = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function(...args) {
                if (args.length > 0 && args[1] && args[1].timeZone) {
                    args[1].timeZone = timezoneOverride;
                }
                return new originalDateTimeFormat(...args);
            };
            Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;
        }
        
        // Override user agent
        if (navigator) {
            try {
                Object.defineProperty(navigator, 'userAgent', { get: () => userAgent });
                
                // Platform-specific overrides
                if (platform === 'windows') {
                    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
                    Object.defineProperty(navigator, 'appVersion', { get: () => userAgent.substring(8) });
                } else if (platform === 'mac') {
                    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
                    Object.defineProperty(navigator, 'appVersion', { get: () => userAgent.substring(8) });
                } else {
                    Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64' });
                    Object.defineProperty(navigator, 'appVersion', { get: () => userAgent.substring(8) });
                }
            } catch (e) {
                console.error('Failed to override navigator properties:', e);
            }
        }
    }, { timezone, userAgent, platform });
    
    return { 
        userAgent, 
        language, 
        timezone, 
        platform, 
        viewport: { width: viewportWidth, height: viewportHeight } 
    };
}

/**
 * Checks if page is being rate limited and rotates proxy if needed
 * @param {Page} page - Playwright page
 * @param {string} sessionId - Session identifier
 * @param {Function} logCapture - Logging function
 * @returns {Promise<boolean>} True if rate limiting was detected and handled
 */
async function detectAndHandleRateLimiting(page, sessionId, logCapture) {
    try {
        // Check for common rate limiting signals
        const rateLimitIndicators = [
            // Text content indicators
            'rate limit',
            'too many requests',
            'try again later',
            'temporarily blocked',
            'unusual activity',
            'captcha',
            
            // HTTP status indicators
            '429',
            '403'
        ];
        
        // Check page content
        const content = await page.content();
        const lowerContent = content.toLowerCase();
        
        // Check for indicators in content
        const hasRateLimitIndicator = rateLimitIndicators.some(indicator => 
            lowerContent.includes(indicator.toLowerCase()));
            
        // Check for status code
        const status = await page.evaluate(() => {
            try {
                // Try to get last response status from performance entries
                const entries = performance.getEntriesByType('resource');
                const lastEntry = entries[entries.length - 1];
                if (lastEntry && lastEntry.responseStatus) {
                    return lastEntry.responseStatus;
                }
                return null;
            } catch (e) {
                return null;
            }
        });
        
        if (hasRateLimitIndicator || status === 429 || status === 403) {
            logCapture(`[${sessionId}] ⚠️ Rate limiting detected! Status: ${status || 'unknown'}`);
            
            // Update session with rate limit info
            if (activeSessions[sessionId]) {
                activeSessions[sessionId].rateLimitDetected = true;
                activeSessions[sessionId].rateLimitTime = Date.now();
            }
            
            // Now we need to rotate the proxy by restarting the session
            logCapture(`[${sessionId}] Attempting to rotate proxy and restart session...`);
            
            // Keep track of current URL and client info
            const currentUrl = page.url();
            const sessionInfo = activeSessions[sessionId] || {};
            
            // Close current session
            await closeSession(sessionId);
            
            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 5000));
            
            // Start a new session with the same URL
            logCapture(`[${sessionId}] Creating fresh session with new proxy...`);
            const result = await startSession(currentUrl, logCapture);
            
            if (result.success) {
                logCapture(`[${sessionId}] Successfully rotated proxy! New session ID: ${result.sessionId}`);
                
                // Transfer any client information to new session if needed
                if (sessionInfo.clientInfo && activeSessions[result.sessionId]) {
                    activeSessions[result.sessionId].clientInfo = sessionInfo.clientInfo;
                    activeSessions[result.sessionId].previousSessionId = sessionId;
                }
                
                return true;
            } else {
                logCapture(`[${sessionId}] ❌ Failed to rotate proxy: ${result.error}`);
                return false;
            }
        }
        
        return false;
    } catch (error) {
        logCapture(`[${sessionId}] Error checking for rate limiting: ${error.message}`);
        return false;
    }
}

// Start a rate limiting detection interval
const rateLimitCheckInterval = setInterval(async () => {
    // Check if session is still valid
    if (!activeSessions[sessionId] || !activeSessions[sessionId].page) {
        clearInterval(rateLimitCheckInterval);
        return;
    }
    
    try {
        const wasRateLimited = await detectAndHandleRateLimiting(page, sessionId, logCapture);
        if (wasRateLimited) {
            // If proxy was rotated, clear this interval
            clearInterval(rateLimitCheckInterval);
        }
    } catch (e) {
        // Ignore errors, will retry on next interval
    }
}, 15000); // Check every 15 seconds

// Store the interval in the session for cleanup
if (activeSessions[sessionId]) {
    activeSessions[sessionId].rateLimitCheckInterval = rateLimitCheckInterval;
}
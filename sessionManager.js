// Handles creation and management of browser sessions (using rotating proxy)

const { chromium } = require('playwright');
const crypto = require('crypto');
require('dotenv').config(); // Still needs .env vars for proxy credentials
const { standardizeBrowserProfile, standardizeBrowserSession, removeAllRoutes } = require('./utils/browserUtils');

// Define your activeSessions object before using it
const activeSessions = {};

// --- Configuration ---
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;    // 5 minutes
const MAX_IP_RETRIES = 8; // Increased max retries for problematic IPs to improve success rate
const CONCURRENT_STARTUP_ATTEMPTS = 5; // Number of concurrent attempts
// PROXY_LIST_PATH is no longer needed

// --- State ---
// REMOVED browserPool array
// Active user sessions
// Structure: { page: PlaywrightPage, browser: PlaywrightBrowser, context: PlaywrightContext, logCapture: function, startTime: number }

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
 * Helper function to launch and navigate a single browser instance.
 * Contains the core logic previously in startSession.
 * @param {string} baseUrl The target URL to navigate to initially.
 * @param {Function} logCapture Function to capture logs.
 * @param {number} attemptNumber Identifier for logging purposes.
 * @returns {Promise<object>} Resolves with session details on success, rejects on failure.
 */
async function _launchAndNavigateInstance(baseUrl, logCapture, attemptNumber) {
    const instanceSessionId = crypto.randomUUID(); // Temporary ID for this instance
    const instanceStartTime = Date.now();
    logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Starting instance...`);

    // --- Configure Rotating Proxy ---
    const ZD_USERNAME = process.env.ZD_PROXY_USERNAME;
    const ZD_PASSWORD = process.env.ZD_PROXY_PASSWORD;

    if (!ZD_USERNAME || !ZD_PASSWORD) {
        const errorMsg = "ZD_PROXY_USERNAME or ZD_PROXY_PASSWORD missing in .env";
        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] ❌ ERROR: ${errorMsg}`);
        // Note: No browser to return here yet
        return Promise.reject({ success: false, error: errorMsg, duration: 0, browser: null, instanceSessionId });
    }

    const proxySettings = {
        server: 'http://isp.oxylabs.io:8000',
        username: ZD_USERNAME,
        password: ZD_PASSWORD
    };
    logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Using proxy: ${proxySettings.server}`);

    let browser = null; // Initialize browser to null
    let context;
    let page;

    try {
        // 1. Launch Browser with enhanced stealth settings
        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Launching browser...`);

        // Use a random set of args (same logic as before)
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
        const selectedOptionalArgs = [];
        for (const arg of optionalArgs) {
            if (Math.random() > 0.6) {
                selectedOptionalArgs.push(arg);
                if (selectedOptionalArgs.length >= 8) break;
            }
        }
        
        browser = await chromium.launch({
            headless: true,
            proxy: proxySettings,
            args: [...baseArgs, ...selectedOptionalArgs]
        });

        // Randomize viewport (same logic as before)
        const widthVariation = Math.floor(Math.random() * 80);
        const heightVariation = Math.floor(Math.random() * 60);
        const viewportWidth = 1280 + (widthVariation - 40);
        const viewportHeight = 800 + (heightVariation - 30);

        // 2. Create context (same logic as before)
        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Creating context...`);
        context = await browser.newContext({
            ignoreHTTPSErrors: true,
            locale: 'en-US',
            timezoneId: 'America/Los_Angeles',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { width: viewportWidth, height: viewportHeight },
            deviceScaleFactor: Math.random() > 0.5 ? 1 : 1.25,
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
                latitude: 34.052235 + (Math.random() - 0.5) * 0.01,
                longitude: -118.243683 + (Math.random() - 0.5) * 0.01,
                accuracy: 100
            },
            permissions: ['geolocation']
        });

        // Add init script (same logic as before)
        await context.addInitScript(() => {
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

        // Create page
        page = await context.newPage();
        await humanDelay(page, 500, 1500);
        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Context created.`);

        // Resource blocking (same logic as before)
        await page.route('**/*.{woff,woff2,ttf,png,jpg,jpeg}', route => {
            if (Math.random() > 0.8) route.continue(); else route.abort().catch(() => {});
        });
        await page.route(/google-analytics|facebook|hotjar|doubleclick/, route => route.abort().catch(() => {}));
        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Resource blocking applied.`);

        // Cookie handling (same logic as before)
        try {
            await humanDelay(page, 300, 1200);
            const cookieSelector = '#onetrust-accept-btn-handler';
            const cookieButton = await page.waitForSelector(cookieSelector, { timeout: 3000, state: 'visible' }).catch(() => null);
            if (cookieButton) {
                await humanDelay(page, 800, 2000);
                await cookieButton.click({ force: true, timeout: 2000 }).catch(e => logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] WARN: Cookie click failed: ${e.message}`));
                await humanDelay(page, 500, 1500);
                logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Cookie consent handled.`);
            }
        } catch (e) {
            logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] WARN: Cookie consent check failed: ${e.message}`);
        }

        // --- IP Detection (No Retry Here) ---
        let ipInfo = null;
        try {
            logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Detecting IP...`);
            const response = await page.goto('https://ipinfo.io/json', { timeout: 10000 });
            ipInfo = await response.json();
            logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] IP Info: ${ipInfo.ip}`);

            const problematicIPs = [ /* ... same list ... */ ];
            if (ipInfo && problematicIPs.includes(ipInfo.ip)) {
                logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] ❌ Problematic IP detected: ${ipInfo.ip}. Failing this attempt.`);
                throw new Error(`Problematic IP detected: ${ipInfo.ip}`); // Fail this attempt
            }
        } catch (ipError) {
            // If the error was specifically the 'Problematic IP' error, re-throw to fail the attempt.
            if (ipError.message.includes('Problematic IP detected')) {
                throw ipError;
            }
            // Otherwise, log as a warning and continue (maybe ipinfo.io was down)
            logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] WARN: IP detection failed/skipped: ${ipError.message}`);
        }
        // --- End IP Detection ---

        // Standardization and Human Behavior (same logic as before)
        await standardizeBrowserSession(browser, page, instanceSessionId, logCapture); // Use temp ID for standardization logs
        await humanDelay(page, 500, 1500);

        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Navigating to ${baseUrl}...`);
        // Pre-warm (same logic as before)
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
        } catch (e) { /* Ignore */ }

        // Referer (same logic as before)
        const referers = [ /* ... same list ... */ ];
        const selectedReferer = referers[Math.floor(Math.random() * referers.length)];
        if (selectedReferer) {
            await page.setExtraHTTPHeaders({ 'Referer': selectedReferer });
        }

        // Navigation Strategies (same logic as before)
        const strategies = [ /* ... same strategies ... */ ];
        let navigationSuccess = false;
        for (let i = 0; i < strategies.length && !navigationSuccess; i++) {
            try {
                logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Nav attempt ${i+1} ('${strategies[i].name}')...`);
                const response = await page.goto(baseUrl, {
                    waitUntil: strategies[i].name,
                    timeout: strategies[i].timeout
                });
                if (response && response.status() >= 200 && response.status() < 400) {
                    navigationSuccess = true;
                    logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Nav SUCCESS ('${strategies[i].name}', ${response.status()})`);
                    await humanDelay(page, 800, 2000);
                } else {
                    throw new Error(`Status code ${response ? response.status() : 'unknown'}`);
                }
            } catch (navError) {
                logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Nav attempt ${i+1} FAILED: ${navError.message}`);
                if (i === strategies.length - 1) throw navError; // Re-throw final failure
                await humanDelay(page, 2000, 5000); // Wait before next strategy
            }
        }

        // Human Interaction Post-Navigation (same logic as before)
        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Simulating human interaction...`);
        await simulateHumanMouseMovement(page, instanceSessionId, logCapture);
        const tabCount = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < tabCount; i++) { /* ... */ }
        await page.evaluate(() => { /* ... scrolling ... */ });

        const pageTitle = await page.title().catch(() => 'Unknown Title');
        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Interaction complete. Title: ${pageTitle}`);

        // If we reached here, the instance is successful
        const instanceDuration = (Date.now() - instanceStartTime) / 1000;
        return {
            success: true,
            browser,
            context,
            page,
            instanceSessionId, // Return the temp ID used
            duration: parseFloat(instanceDuration.toFixed(2))
        };

    } catch (error) {
        logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] ❌ Instance FAILED: ${error.message}`);
        // Ensure browser is closed on failure
        if (browser) {
            // Use unrouteAll before closing if page exists
             if (page && !page.isClosed()) {
                await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
            }
            await browser.close().catch(e => logCapture(`[Attempt-${attemptNumber}/${instanceSessionId}] Error closing browser on failure: ${e.message}`));
        }
        const instanceDuration = (Date.now() - instanceStartTime) / 1000;
        // Reject the promise with necessary info for cleanup
        return Promise.reject({
            success: false,
            error: error.message,
            duration: parseFloat(instanceDuration.toFixed(2)),
            browser: null, // Already closed or never opened
            instanceSessionId
        });
    }
}

/**
 * Starts a session by launching multiple concurrent browser instances
 * and selecting the first one that successfully navigates to the target URL.
 * @param {string} baseUrl The target URL to navigate to initially.
 * @param {Function} [logCapture=console.log] Function to capture logs.
 * @returns {Promise<object>} Object indicating success/failure, sessionId, and duration.
 */
async function startSession(baseUrl, logCapture = console.log) {
    const overallStartTime = Date.now();
    const masterLogPrefix = `[Master-${crypto.randomUUID().substring(0, 8)}]`; // Short unique ID for this startSession call
    logCapture(`${masterLogPrefix} Starting concurrent session initialization (${CONCURRENT_STARTUP_ATTEMPTS} attempts) for: ${baseUrl}`);

    const attempts = [];
    for (let i = 1; i <= CONCURRENT_STARTUP_ATTEMPTS; i++) {
        // Create a specific logger for each attempt
        const attemptLogCapture = (msg) => logCapture(`${masterLogPrefix} ${msg}`);
        attempts.push(_launchAndNavigateInstance(baseUrl, attemptLogCapture, i));
    }

    // Wait for all attempts to settle (either resolve or reject)
    const results = await Promise.allSettled(attempts);

    let winnerResult = null;
    let winnerIndex = -1;

    // Find the first successful attempt
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled' && results[i].value.success) {
            winnerResult = results[i].value;
            winnerIndex = i;
            logCapture(`${masterLogPrefix} Attempt ${winnerIndex + 1} succeeded first.`);
            break; // Found the winner
        }
    }

    // --- Cleanup Losers ---
    const cleanupPromises = [];
    for (let i = 0; i < results.length; i++) {
        if (i === winnerIndex) continue; // Don't clean up the winner

        const result = results[i];
        let browserToClose = null;

        if (result.status === 'fulfilled' && result.value.browser) {
            // Successful attempt, but not the winner
            browserToClose = result.value.browser;
            logCapture(`${masterLogPrefix} Cleaning up successful-but-slower attempt ${i + 1}`);
        } else if (result.status === 'rejected' && result.reason.browser) {
            // Failed attempt, but browser might have been launched before failure
             // NOTE: _launchAndNavigateInstance now closes its own browser on failure,
             // so reason.browser should ideally be null. This is belt-and-suspenders.
            browserToClose = result.reason.browser;
             logCapture(`${masterLogPrefix} Cleaning up failed attempt ${i + 1} (browser should already be closed)`);
        } else if (result.status === 'rejected') {
            // Failed attempt before browser launch or browser already closed
             logCapture(`${masterLogPrefix} Noting failed attempt ${i + 1} (no browser to close)`);
        }


        if (browserToClose) {
             // Add unrouteAll before closing, just in case
             const page = result.value?.page; // Get page if available
             if (page && !page.isClosed()) {
                 cleanupPromises.push(
                     page.unrouteAll({ behavior: 'ignoreErrors' })
                         .catch(() => {}) // Ignore unroute errors
                         .finally(() => browserToClose.close()) // Ensure close is called
                         .catch(e => logCapture(`${masterLogPrefix} Error closing loser browser ${i + 1}: ${e.message}`))
                 );
             } else {
                 cleanupPromises.push(
                     browserToClose.close()
                         .catch(e => logCapture(`${masterLogPrefix} Error closing loser browser ${i + 1}: ${e.message}`))
                 );
            }
        }
    }
    // Wait for cleanup of losers to complete
    await Promise.allSettled(cleanupPromises);
    logCapture(`${masterLogPrefix} Loser cleanup complete.`);


    // --- Handle Outcome ---
    if (winnerResult) {
        // Assign a *new* final sessionId for the winner
        const finalSessionId = crypto.randomUUID();
        const { browser, context, page, duration: instanceDuration } = winnerResult;

        // Store the winning session in activeSessions
        activeSessions[finalSessionId] = {
            page,
            browser,
            context,
            logCapture: (msg) => logCapture(`[${finalSessionId}] ${msg}`), // Use final ID for session logs
            startTime: overallStartTime, // Use the overall start time
            lastActiveTime: Date.now()
        };

        logCapture(`${masterLogPrefix} Session ${finalSessionId} (from attempt ${winnerIndex + 1}) established successfully.`);
        const totalDuration = (Date.now() - overallStartTime) / 1000;
        return {
            success: true,
            sessionId: finalSessionId,
            duration: parseFloat(totalDuration.toFixed(2))
        };

    } else {
        // All attempts failed
        logCapture(`${masterLogPrefix} ❌ All ${CONCURRENT_STARTUP_ATTEMPTS} attempts failed.`);
        // Combine error messages (optional)
        const errors = results
            .filter(r => r.status === 'rejected')
            .map((r, idx) => `Attempt ${idx + 1}: ${r.reason.error || 'Unknown error'}`)
            .join('; ');

        const totalDuration = (Date.now() - overallStartTime) / 1000;
        return {
            success: false,
            error: `All concurrent session attempts failed. Errors: ${errors}`,
            duration: parseFloat(totalDuration.toFixed(2))
        };
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
    startPredictiveSession,
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
 * @param {string} baseUrl - The base Calendly URL
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
        
        // Start two separate browser sessions going first to the base URL
        logCapture(`[${masterSessionId}] Launching first browser starting with base URL: ${baseUrl}`);
        const session1Promise = startSession(baseUrl, 
            (msg) => logCapture(`[Option1] ${msg}`));
            
        logCapture(`[${masterSessionId}] Launching second browser starting with base URL: ${baseUrl}`);
        const session2Promise = startSession(baseUrl, 
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
            
            // Wait a few seconds on base URL with some human-like interaction
            const page1 = activeSessions[sessionId1].page;
            logCapture(`[Option1] Interacting with base URL before proceeding to booking URL...`);
            
            // Perform some scrolling
            await page1.evaluate(() => {
                return new Promise(resolve => {
                    // Scroll down slowly
                    let totalScroll = 0;
                    const maxScroll = 300 + Math.random() * 200;
                    
                    const scrollStep = () => {
                        const step = 10 + Math.random() * 20;
                        window.scrollBy(0, step);
                        totalScroll += step;
                        
                        if (totalScroll < maxScroll) {
                            setTimeout(scrollStep, 100 + Math.random() * 150);
                        } else {
                            // After scrolling down, scroll back up partially
                            setTimeout(() => {
                                window.scrollBy(0, -100 - Math.random() * 100);
                                setTimeout(resolve, 500);
                            }, 1000);
                        }
                    };
                    
                    setTimeout(scrollStep, 500 + Math.random() * 500);
                });
            });
            
            // Move mouse randomly
            const viewportSize = await page1.viewportSize();
            if (viewportSize) {
                await page1.mouse.move(
                    Math.random() * viewportSize.width * 0.8, 
                    Math.random() * viewportSize.height * 0.8
                );
                await page1.waitForTimeout(300 + Math.random() * 500);
            }
            
            // Wait a bit more with natural delay
            await page1.waitForTimeout(1500 + Math.random() * 1000);
            
            // Now navigate to specific booking URL
            logCapture(`[Option1] Navigating from base URL to specific booking URL: ${bookingUrl1}`);
            await page1.goto(bookingUrl1, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        }
        
        if (activeSessions[sessionId2]) {
            activeSessions[sessionId2].clientInfo = { ...clientInfo };
            activeSessions[sessionId2].bookingUrl = bookingUrl2;
            
            // Wait a few seconds on base URL with some human-like interaction
            const page2 = activeSessions[sessionId2].page;
            logCapture(`[Option2] Interacting with base URL before proceeding to booking URL...`);
            
            // Perform some scrolling (slightly different pattern for variation)
            await page2.evaluate(() => {
                return new Promise(resolve => {
                    // Scroll down in steps
                    let scrollPosition = 0;
                    const scrollTargets = [
                        150 + Math.random() * 50, 
                        300 + Math.random() * 100,
                        200 + Math.random() * 100 // Scroll back up a bit
                    ];
                    
                    const performScroll = (index) => {
                        if (index >= scrollTargets.length) {
                            resolve();
                            return;
                        }
                        
                        const target = scrollTargets[index];
                        const scrollDiff = target - scrollPosition;
                        window.scrollBy(0, scrollDiff);
                        scrollPosition = target;
                        
                        setTimeout(() => performScroll(index + 1), 1000 + Math.random() * 500);
                    };
                    
                    setTimeout(() => performScroll(0), 400 + Math.random() * 300);
                });
            });
            
            // Tab through elements a couple times
            const tabCount = 1 + Math.floor(Math.random() * 3);
            for (let i = 0; i < tabCount; i++) {
                await page2.keyboard.press('Tab');
                await page2.waitForTimeout(300 + Math.random() * 400);
            }
            
            // Wait a bit more with natural delay (slightly different from session 1)
            await page2.waitForTimeout(1200 + Math.random() * 1500);
            
            // Now navigate to specific booking URL
            logCapture(`[Option2] Navigating from base URL to specific booking URL: ${bookingUrl2}`);
            await page2.goto(bookingUrl2, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
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
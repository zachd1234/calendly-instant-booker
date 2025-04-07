/**
 * Warm Browser Manager
 * Maintains a pool of pre-warmed browsers with Calendly pages already loaded
 * to significantly reduce booking times
 * 
 * CONVERTED FROM PUPPETEER TO PLAYWRIGHT
 */

const { chromium } = require('playwright');
const config = require('../config');

// Configure debug logging
const DEBUG = process.env.DEBUG_BROWSER || false;

// Storage for warm browsers
const warmBrowsers = new Map();

// Browser config for Playwright
const BROWSER_CONFIG = {
  headless: true
};

// Context options for Playwright
const CONTEXT_OPTIONS = {
  viewport: { width: 1280, height: 800 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  bypassCSP: true,
  ignoreHTTPSErrors: true
};

// Track creation attempts to prevent spamming for the same session
const browserCreationAttempts = new Map();
const MAX_CREATION_ATTEMPTS = 3;

// Track statistics
let stats = {
  created: 0,
  errors: 0,
  reused: 0,
  closed: 0,
  lastCreatedAt: null
};

/**
 * Initialize the URL for a session
 * @param {string} sessionId The session ID
 * @returns {string} The warm-up URL  
 */
function getWarmupUrl(sessionId) {
  return 'https://calendly.com';
}

/**
 * Log debug message if debug is enabled
 * @param {string} message The debug message
 */
function debugLog(message) {
  if (DEBUG) {
    console.log(`[WarmBrowser] ${message}`);
  }
}

/**
 * Create a warm browser instance with a page already navigated to Calendly
 * 
 * @param {Object} session The IP session to use
 * @returns {Promise<Object>} The warmed browser info
 */
async function createWarmBrowser(session) {
  const sessionId = session.sessionId;
  
  // Prevent too many creation attempts for the same session
  const attempts = browserCreationAttempts.get(sessionId) || 0;
  if (attempts >= MAX_CREATION_ATTEMPTS) {
    debugLog(`Too many creation attempts (${attempts}) for session ${sessionId}, skipping`);
    return false;
  }
  
  // Check if one already exists
  if (warmBrowsers.has(sessionId)) {
    const existing = warmBrowsers.get(sessionId);
    if (existing.status === 'ready' || existing.status === 'creating') {
      debugLog(`Browser for session ${sessionId} already exists with status ${existing.status}`);
      return existing;
    }
  }
  
  debugLog(`Creating warm browser for session ${sessionId}`);
  
  // Update creation attempts
  browserCreationAttempts.set(sessionId, attempts + 1);
  
  // Add to tracking with 'creating' status
  const browserInfo = {
    sessionId,
    status: 'creating',
    createdAt: Date.now(),
    browser: null,
    context: null,
    page: null,
    proxyConfig: {
      server: session.server,
      username: session.username,
      password: session.password
    }
  };
  
  warmBrowsers.set(sessionId, browserInfo);
  
  try {
    // Configure proxy if needed
    const proxySettings = session.server ? {
      server: session.server,
      username: session.username,
      password: session.password
    } : undefined;
    
    // Launch browser
    const browser = await chromium.launch(BROWSER_CONFIG);
    
    // Create context with proxy and other settings
    const context = await browser.newContext({
      ...CONTEXT_OPTIONS,
      proxy: proxySettings
    });
    
    // Create and set up the page
    const page = await context.newPage();
    
    // Set up route handlers to block unnecessary resources
    await context.route('**/*.{png,jpg,jpeg,gif,svg,webp}', route => route.abort());
    await context.route('**/*.{woff,woff2,ttf,otf,eot}', route => route.abort());
    await context.route('**/*ga*.js', route => route.abort());
    await context.route('**/*facebook*.js', route => route.abort());
    await context.route('**/*analytics*.js', route => route.abort());
    await context.route('**/*tracking*.js', route => route.abort());
    await context.route('**/*doubleclick*.js', route => route.abort());
    await context.route('**/*hotjar*.js', route => route.abort());
    
    // Measure navigation time
    const startTime = Date.now();
    
    // Navigate to the warm-up URL
    const warmupUrl = getWarmupUrl(sessionId);
    await page.goto(warmupUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 // 30 second timeout
    });
    
    const navTime = (Date.now() - startTime) / 1000;
    debugLog(`Pre-warmed browser for session ${sessionId} loaded Calendly in ${navTime.toFixed(2)}s`);
    
    // Add final browser and page to tracking
    browserInfo.browser = browser;
    browserInfo.context = context;
    browserInfo.page = page;
    browserInfo.status = 'ready';
    browserInfo.url = warmupUrl;
    browserInfo.warmupTime = navTime;
    
    // Update stats
    stats.created++;
    stats.lastCreatedAt = new Date();
    
    debugLog(`Warm browser for session ${sessionId} is now ready`);
    
    return browserInfo;
  } catch (error) {
    // If error, mark as failed and log
    browserInfo.status = 'failed';
    browserInfo.error = error.message;
    warmBrowsers.set(sessionId, browserInfo);
    
    stats.errors++;
    
    console.error(`Error creating warm browser for session ${sessionId}:`, error.message);
    throw error; // Rethrow to be handled by caller
  }
}

/**
 * Check if a warm browser is available for a specific session ID
 * 
 * @param {string} sessionId The session ID to check
 * @returns {Promise<boolean>} True if a warm browser is available
 */
async function isWarmBrowserAvailable(sessionId) {
  if (!sessionId) {
    console.error('Cannot check warm browser without sessionId');
    return false;
  }
  
  // Check if a warm browser exists for this session
  if (warmBrowsers.has(sessionId)) {
    const browserInfo = warmBrowsers.get(sessionId);
    
    // Only return true if status is 'ready' and has actual browser object
    if (browserInfo.status === 'ready' && browserInfo.browser) {
      debugLog(`Found warm browser for session ${sessionId}`);
      return true;
    }
    
    // If failed or invalid, clean it up
    if (browserInfo.status === 'failed' || !browserInfo.browser) {
      debugLog(`Found invalid browser for session ${sessionId}, cleaning up`);
      await cleanupBrowser(sessionId);
      return false;
    }
    
    // If still creating, return false but don't clean up
    if (browserInfo.status === 'creating') {
      debugLog(`Warm browser for session ${sessionId} is still creating`);
      return false;
    }
  }
  
  debugLog(`No warm browser found for session ${sessionId}`);
  return false;
}

/**
 * Get a warm browser by session ID
 * 
 * @param {string} sessionId The session ID to get
 * @returns {Promise<Object>} The browser info or null if not found
 */
async function getWarmBrowserBySessionId(sessionId) {
  if (!sessionId) {
    debugLog('No sessionId provided');
    return null;
  }
  
  // Check if this session has a warm browser
  if (warmBrowsers.has(sessionId)) {
    const browserInfo = warmBrowsers.get(sessionId);
    
    if (browserInfo.status === 'ready' && browserInfo.browser) {
      debugLog(`Found warm browser for session ${sessionId}`);
      // Mark as used
      stats.reused++;
      browserInfo.lastUsed = new Date();
      warmBrowsers.set(sessionId, browserInfo);
      return browserInfo;
    }
  }
  
  debugLog(`No warm browser found for session ${sessionId}`);
  return null;
}

/**
 * Clean up a browser instance
 * 
 * @param {string} sessionId The session ID to clean up
 */
async function cleanupBrowser(sessionId) {
  if (!sessionId || !warmBrowsers.has(sessionId)) {
    return;
  }
  
  const browserInfo = warmBrowsers.get(sessionId);
  
  try {
    if (browserInfo.browser) {
      debugLog(`Closing browser for session ${sessionId}`);
      await browserInfo.browser.close();
      stats.closed++;
    }
  } catch (e) {
    debugLog(`Error closing browser for session ${sessionId}: ${e.message}`);
  }
  
  // Remove from tracking
  warmBrowsers.delete(sessionId);
}

/**
 * Initialize warm browsers for a list of sessions
 * 
 * @param {Array<Object>} sessions List of sessions to warm up
 * @returns {Promise<number>} Number of successful warm ups
 */
async function initializeWarmBrowsersForSessions(sessions) {
  if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
    debugLog('No sessions provided for warm browser initialization');
    return 0;
  }
  
  debugLog(`Initializing warm browsers for ${sessions.length} sessions`);
  
  let success = 0;
  
  // Process in sequence to avoid overwhelming the system
  for (const session of sessions) {
    try {
      debugLog(`Creating warm browser for session ${session.sessionId}`);
      await createWarmBrowser(session);
      success++;
    } catch (error) {
      debugLog(`Failed to create warm browser for session ${session.sessionId}: ${error.message}`);
    }
    
    // Small delay between initializations
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  debugLog(`Warm browser initialization completed: ${success}/${sessions.length} successful`);
  return success;
}

/**
 * Get statistics about warm browsers
 * 
 * @returns {Object} Statistics
 */
function getWarmBrowserStats() {
  const ready = Array.from(warmBrowsers.values())
    .filter(info => info.status === 'ready').length;
  
  const failed = Array.from(warmBrowsers.values())
    .filter(info => info.status === 'failed').length;
  
  const creating = Array.from(warmBrowsers.values())
    .filter(info => info.status === 'creating').length;
  
  return {
    ...stats,
    ready,
    failed,
    creating,
    total: warmBrowsers.size
  };
}

module.exports = {
  createWarmBrowser,
  isWarmBrowserAvailable,
  getWarmBrowserBySessionId,
  cleanupBrowser,
  initializeWarmBrowsersForSessions,
  getWarmBrowserStats
}; 
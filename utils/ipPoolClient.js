/**
 * IP Pool Client
 * 
 * Client for interacting with the IP Pool API Server
 * Handles both IP session management and warm browser retrieval
 * 
 * CONVERTED FROM PUPPETEER TO PLAYWRIGHT
 */

const http = require('http');
const https = require('https');
const { chromium } = require('playwright');
// Remove Puppeteer imports
// const puppeteer = require('puppeteer-extra');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');

// Configure the IP Pool API server URL
const IP_POOL_SERVER = process.env.IP_POOL_SERVER || 'http://localhost:3057';

// Track statistics locally
let stats = {
  sessionsRequested: 0,
  warmBrowsersUsed: 0,
  coldBrowsersCreated: 0,
  lastSessionTime: null
};

/**
 * Helper to make HTTP requests to the IP Pool API
 * @param {string} endpoint - API endpoint to call
 * @param {string} method - HTTP method
 * @param {Object} data - Optional data for POST requests 
 * @returns {Promise<Object>} - Response data
 */
async function callApi(endpoint, method = 'GET', data = null) {
  const url = `${IP_POOL_SERVER}${endpoint}`;
  
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {}
    };
    
    let req;
    
    if (url.startsWith('https:')) {
      req = https.request(url, options);
    } else {
      req = http.request(url, options);
    }
    
    req.on('error', (err) => {
      reject(new Error(`API request failed: ${err.message}`));
    });
    
    req.on('response', (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(responseData);
            resolve(data);
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${e.message}`));
          }
        } else {
          reject(new Error(`API request failed with status ${res.statusCode}: ${responseData}`));
        }
      });
    });
    
    if (data) {
      req.setHeader('Content-Type', 'application/json');
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

/**
 * Check if the IP Pool Server is running and accessible
 * @returns {Promise<boolean>} True if server is accessible
 */
async function isServerRunning() {
  try {
    const response = await callApi('/api/health');
    return response && response.status === 'ok';
  } catch (error) {
    console.error('IP Pool Server not accessible:', error.message);
    return false;
  }
}

/**
 * Get an IP session from the pool
 * @returns {Promise<Object>} Session data with proxy details
 */
async function getIpSession() {
  try {
    const response = await callApi('/api/get-session');
    stats.sessionsRequested++;
    stats.lastSessionTime = new Date();
    
    // Log message about server-side warm status (informational only now)
    console.log(`📊 Session ${response.sessionId} obtained. Server reported warm status: ${response.warmBrowserAvailable}`);
    
    return response;
  } catch (error) {
    throw new Error(`Failed to get IP session: ${error.message}`);
  }
}

/**
 * Get a specific IP session by ID
 * @param {string} sessionId - The session ID to get
 * @returns {Promise<Object>} Session data with proxy details
 */
async function getSpecificSession(sessionId) {
  if (!sessionId) {
    throw new Error('No sessionId provided');
  }
  
  try {
    const response = await callApi(`/api/get-specific-session?sessionId=${sessionId}`);
    stats.sessionsRequested++;
    stats.lastSessionTime = new Date();
    
    return response;
  } catch (error) {
    throw new Error(`Failed to get specific IP session: ${error.message}`);
  }
}

/**
 * Release a session back to the pool
 * @param {string} sessionId - The session ID to release
 * @returns {Promise<Object>} Response data
 */
async function releaseSession(sessionId) {
  try {
    return await callApi('/api/release-session', 'POST', { sessionId });
  } catch (error) {
    console.error(`Error releasing session ${sessionId}:`, error.message);
    // Don't throw, as this is typically called in cleanup paths
  }
}

/**
 * Creates a NEW local browser instance configured with the proxy from the provided session.
 * Applies standard context settings (viewport, userAgent) and resource blocking.
 * NOTE: This function *always* launches a new browser locally.
 *
 * @param {Object} session - The session object obtained from getIpSession, containing proxy details.
 *                           Expected structure: { sessionId, server, username, password, ... }
 * @param {Object} options - Optional: Currently unused, but kept for potential future flags.
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page, creationTime: number }>}
 *          An object containing the launched browser, context, page, and setup time.
 * @throws {Error} If session details are invalid or browser launch/setup fails.
 */
async function getWarmBrowser(session, options = {}) {
  const startTime = Date.now();
  
  // Validate session object structure for proxy details
  if (!session || !session.sessionId || !session.server || !session.username || !session.password) {
    // Added more specific check for necessary proxy fields from session
    console.error("Invalid session object passed to getWarmBrowser. Session:", session);
    throw new Error('Invalid session object provided to getWarmBrowser. Must include sessionId, server, username, password.');
  }
  
  let browser = null;
  let context = null;
  let page = null;
  
  try {
    // --- Always Launch Locally (Simplified Path) ---
    console.log(`[ipPoolClient] 🧊 Creating NEW local browser configured for session ${session.sessionId}...`);
    stats.coldBrowsersCreated++;
    
    // Configure proxy using details directly from the session object
    const proxyConfig = {
      server: session.server,
      username: session.username,
      password: session.password
    };
    console.log(`[ipPoolClient] Using proxy server: ${proxyConfig.server}`);
    
    // Launch browser with Playwright
    browser = await chromium.launch({
      headless: true,
      proxy: proxyConfig
    });
    
    // Create a context with standard settings
    context = await browser.newContext({
      proxy: proxyConfig,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      bypassCSP: true,
      ignoreHTTPSErrors: true,
    });
    
    // Create a page
    page = await context.newPage();
    
    // Set up resource blocking (Essential for speed)
    await context.route(
        (url) => /\.(png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|otf|eot)$/i.test(url.pathname) ||
                 /(google|ga|facebook|analytics|tracking|doubleclick|hotjar)\.com/i.test(url.hostname) ||
                 /(google|ga|facebook|analytics|tracking|doubleclick|hotjar)/i.test(url.pathname),
        (route) => route.abort().catch(err => console.error(`[ipPoolClient] Failed to abort route ${route.request().url()}: ${err.message}`))
    );
    console.log('[ipPoolClient] Resource blocking rules applied (images, fonts, tracking).');
    
    const creationTime = (Date.now() - startTime) / 1000;
    console.log(`[ipPoolClient] Local browser setup complete for session ${session.sessionId} in ${creationTime.toFixed(2)}s`);
    
    return {
      browser,
      context,
      page,
      creationTime: creationTime,
    };
  } catch (error) {
    console.error(`[ipPoolClient] Error during local browser setup for session ${session.sessionId}: ${error.message}`);
    // Clean up partially created resources
    if (page && !page.isClosed()) await page.close().catch(()=>{});
    if (context) await context.close().catch(()=>{});
    if (browser) await browser.close().catch(()=>{});
    throw error;
  }
}

/**
 * Get pool statistics
 * @returns {Promise<Object>} Pool statistics
 */
async function getPoolStats() {
  try {
    return await callApi('/api/stats');
  } catch (error) {
    console.error('Error getting pool stats:', error.message);
    return { error: error.message };
  }
}

/**
 * Get warm browser statistics
 * @returns {Promise<Object>} Warm browser statistics
 */
async function getWarmBrowserStats() {
  try {
    return await callApi('/api/browser-stats');
  } catch (error) {
    console.error('Error getting browser stats:', error.message);
    return { error: error.message };
  }
}

/**
 * Get client-side statistics
 * @returns {Object} Client statistics
 */
function getClientStats() {
  return {
    ...stats,
    lastSessionTime: stats.lastSessionTime ? stats.lastSessionTime.toISOString() : null
  };
}

// Export the functions
module.exports = {
  isServerRunning,
  getIpSession,
  getSpecificSession,
  releaseSession,
  getWarmBrowser,
  getPoolStats,
  getWarmBrowserStats,
  getClientStats
}; 
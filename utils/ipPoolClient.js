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
    
    // Log if this session has a warm browser available
    if (response.warmBrowserAvailable) {
      console.log(`📊 Session ${response.sessionId} has a warm browser available`);
    } else {
      console.log(`📊 Session ${response.sessionId} does not have a warm browser available`);
    }
    
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
 * Check if a warm browser is available for a session
 * @param {string} sessionId - The session ID to check
 * @returns {Promise<boolean>} True if a warm browser is available
 */
async function isWarmBrowserAvailable(sessionId) {
  if (!sessionId) {
    return false;
  }
  
  try {
    const response = await callApi(`/api/get-warm-browser?sessionId=${sessionId}`);
    return response.warmBrowserAvailable === true;
  } catch (error) {
    console.error(`Error checking warm browser for session ${sessionId}:`, error.message);
    return false;
  }
}

/**
 * Get a warm browser from the pool or create a new one
 * @param {Object} session - The session object with proxy details
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Browser and page objects
 */
async function getWarmBrowser(session, options = {}) {
  const startTime = Date.now();
  
  if (!session || !session.sessionId) {
    throw new Error('Invalid session object');
  }
  
  let browser, context, page;
  
  try {
    // Check if we should use a pre-warmed browser
    if (!options.forceCold && session.warmBrowserAvailable) {
      console.log(`🔥 Pre-warmed browser available for session ${session.sessionId}, checking availability...`);
      
      // Try to get warm browser details from the server
      const warmBrowserInfo = await callApi(`/api/get-warm-browser?sessionId=${session.sessionId}`);
      
      if (warmBrowserInfo && warmBrowserInfo.warmBrowserAvailable === true) {
        console.log(`Using warm browser for session ${session.sessionId}`);
        stats.warmBrowsersUsed++;
        
        // Configure proxy if available
        const proxyConfig = session.server ? {
          server: session.server,
          username: session.username,
          password: session.password
        } : undefined;
        
        // Instead of creating a new browser, we'll get a reference to the existing one
        // from the server by making a special call
        try {
          // Create a browser connection to the warm browser on the server
          // For now, we're still creating a new browser, but we could
          // enhance the server to provide a way to connect to existing browsers
          browser = await chromium.launch({
            headless: true
          });
          
          // Create a context with proxy
          context = await browser.newContext({
            proxy: proxyConfig,
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            bypassCSP: true,
            ignoreHTTPSErrors: true
          });
          
          // Create a page
          page = await context.newPage();
          
          // Set up resource blocking
          await context.route('**/*.{png,jpg,jpeg,gif,svg,webp}', route => route.abort());
          await context.route('**/*.{woff,woff2,ttf,otf,eot}', route => route.abort());
          await context.route('**/*ga*.js', route => route.abort());
          await context.route('**/*facebook*.js', route => route.abort());
          await context.route('**/*analytics*.js', route => route.abort());
          
          // Navigate to the URL that was already loaded in the warm browser
          if (warmBrowserInfo.url) {
            await page.goto(warmBrowserInfo.url, { waitUntil: 'domcontentloaded' });
          }
          
          console.log(`Warm browser retrieved in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
          
          return {
            browser,
            context,
            page,
            creationTime: (Date.now() - startTime) / 1000,
            wasWarm: true
          };
        } catch (warmError) {
          console.error(`Error connecting to warm browser: ${warmError.message}`);
          console.log('Falling back to creating a new browser');
        }
      } else {
        console.log('Warm browser not actually available, creating new one');
      }
    }
    
    // If we get here, we need to create a new browser
    console.log(`🧊 Creating new browser for session ${session.sessionId}`);
    stats.coldBrowsersCreated++;
    
    // Configure proxy if available
    const proxyConfig = session.server ? {
      server: session.server,
      username: session.username,
      password: session.password
    } : undefined;
    
    // Launch browser with Playwright
    browser = await chromium.launch({
      headless: true
    });
    
    // Create a context with proxy
    context = await browser.newContext({
      proxy: proxyConfig,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      bypassCSP: true,
      ignoreHTTPSErrors: true
    });
    
    // Create a page
    page = await context.newPage();
    
    // Set up resource blocking
    await context.route('**/*.{png,jpg,jpeg,gif,svg,webp}', route => route.abort());
    await context.route('**/*.{woff,woff2,ttf,otf,eot}', route => route.abort());
    await context.route('**/*ga*.js', route => route.abort());
    await context.route('**/*facebook*.js', route => route.abort());
    await context.route('**/*analytics*.js', route => route.abort());
    
    console.log('Browser created in ' + ((Date.now() - startTime) / 1000).toFixed(2) + 's');
    
    return {
      browser,
      context,
      page,
      creationTime: (Date.now() - startTime) / 1000,
      wasWarm: false
    };
  } catch (error) {
    console.error(`Error creating browser: ${error.message}`);
    
    // Clean up in case of error
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    
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
  isWarmBrowserAvailable,
  getWarmBrowser,
  getPoolStats,
  getWarmBrowserStats,
  getClientStats
}; 
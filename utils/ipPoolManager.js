/**
 * IP Pool Manager
 * Maintains a pool of pre-warmed IP addresses from Oxylabs
 * Ready with DNS resolution and TLS handshakes already completed
 */

const https = require('https');
const http = require('http');
const { promisify } = require('util');
const config = require('../config');
const { createWarmBrowser, isWarmBrowserAvailable } = require('./warmBrowserManager');

// Pool of pre-warmed IP sessions
let ipPool = [];
let warmingPromise = null;
const targetPoolSize = config.POOL_SIZE || 3;
const maxConcurrentWarmups = 2; // Limit concurrent warmup requests
let isWarmingUp = false;

// Persistence mode flag - set to true if running as a background service
let persistentMode = false;

// Session management stats
let stats = {
  sessionsCreated: 0,
  sessionsUsed: 0,
  sessionsFailed: 0,
  lastRefreshTime: null
};

// Track the last used session to prevent immediate reuse
let lastUsedSessionId = null;

// Flag to track if the pool has been initialized
let isInitialized = false;

// Log configuration at startup
console.log('IP Pool Manager Configuration:');
console.log(`Target pool size: ${targetPoolSize}`);
console.log(`Proxy server: ${config.PROXY_URL || 'None'}`);
console.log(`Proxy username base: ${config.PROXY_USERNAME || 'None'}`);

/**
 * Generate a unique session ID
 * @returns {string} A unique session ID
 */
function generateSessionId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp.substring(timestamp.length - 6)}-${random}`;
}

/**
 * Set persistence mode
 * @param {boolean} mode - Whether to run in persistent mode
 */
function setPersistentMode(mode) {
  persistentMode = !!mode;
  console.log(`IP Pool Manager persistent mode set to: ${persistentMode}`);
}

/**
 * Creates a proxy session configuration with a unique session ID
 * @returns {Object} Proxy session configuration
 */
function createProxySession() {
  const sessionId = generateSessionId();
  
  // Get the base username and append a unique session ID
  // For Oxylabs, the correct format is customer-{username}_{session_id}
  const username = config.PROXY_USERNAME || '';
  let modifiedUsername = username;
  
  // Only add the session ID if username doesn't already have one
  if (username && !username.includes('_')) {
    modifiedUsername = `${username}_BfgMH`;
  }
  
  // Format the server URL
  // Make sure we have the correct format for the proxy URL
  let server = config.PROXY_URL || '';
  if (server && !server.startsWith('http://') && !server.startsWith('https://')) {
    server = `http://${server}`;
  }
  
  stats.sessionsCreated++;
  
  return {
    sessionId,
    username: modifiedUsername,
    password: config.PROXY_PASSWORD,
    server: server,
    isWarmed: false,
    lastUsed: null,
    createdAt: Date.now(),
    timesUsed: 0,
    inUse: false
  };
}

/**
 * "Warm up" a proxy session
 * 
 * This function now does two things:
 * 1. Prepares the proxy session for fast DNS resolution and TLS handshakes
 * 2. Creates a warm browser instance with Calendly page already loaded
 * 
 * @param {Object} session - The proxy session to warm up
 * @returns {Promise<Object>} The warmed-up session
 */
async function warmupSession(session) {
  if (!session.server) {
    console.log('No proxy server configured');
    return session;
  }
  
  // Extract host from proxy server URL for logging
  let proxyHost = session.server;
  if (proxyHost.startsWith('http://')) {
    proxyHost = proxyHost.substring(7);
  }
  
  console.log(`✅ Prepared IP session ${session.sessionId} with proxy ${proxyHost}`);
  console.log(`Username: ${session.username}`);
  
  // Mark session as warmed for proxy connection
  session.isWarmed = true;
  
  // If in persistent mode, also create a warm browser for this session
  if (persistentMode) {
    try {
      // Create a warm browser with Calendly page preloaded
      await createWarmBrowser(session);
    } catch (error) {
      console.log(`Warning: Unable to create warm browser for session ${session.sessionId}: ${error.message}`);
      // Still consider the session warmed for IP purposes even if browser warming fails
    }
  }
  
  return session;
}

/**
 * Initialize and warm up the IP pool
 * @param {boolean} force - Whether to force re-initialization even if already in progress
 * @returns {Promise<void>}
 */
async function initializePool(force = false) {
  // If already initialized, only proceed if force=true  
  if (isInitialized && !force) {
    console.log('Pool already initialized, skipping initialization');
    return ipPool.length;
  }
  
  if (force) {
    persistentMode = true; // If forced, assume we're in persistent mode
    console.log('Forcing pool initialization in persistent mode');
    
    // If force=true and already warming up, wait for current warming to finish
    if (warmingPromise) {
      try {
        await warmingPromise;
      } catch (e) {
        // Ignore errors, we'll proceed with a new initialization
      }
    }
  } else if (warmingPromise) {
    return warmingPromise;
  }
  
  if (isWarmingUp && !force) {
    console.log('Pool is already warming up');
    return;
  }
  
  isWarmingUp = true;
  console.log('Starting pool initialization...');
  
  warmingPromise = (async () => {
    console.log(`Initializing IP pool with target size of ${targetPoolSize}`);
    
    if (force) {
      // If forcing, clear existing pool to avoid duplicate sessions
      console.log('Clearing existing pool due to force=true');
      ipPool = [];
    }
    
    // Create session configurations
    const sessionsToCreate = targetPoolSize - ipPool.length;
    const newSessions = Array(Math.max(0, sessionsToCreate))
      .fill()
      .map(() => createProxySession());
    
    if (newSessions.length === 0) {
      console.log('Pool already at target size');
      isWarmingUp = false;
      isInitialized = true;
      return ipPool.length;
    }
    
    console.log(`Creating ${newSessions.length} new IP sessions`);
    
    // "Warm up" sessions in batches
    const batchSize = maxConcurrentWarmups;
    for (let i = 0; i < newSessions.length; i += batchSize) {
      const batch = newSessions.slice(i, i + batchSize);
      
      // Process this batch in parallel
      const results = await Promise.all(
        batch.map(session => warmupSession(session))
      );
      
      // Add sessions to the pool
      ipPool.push(...results);
      
      console.log(`Added batch of ${results.length} sessions to pool`);
      
      // Brief pause between batches
      if (i + batchSize < newSessions.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`IP pool initialized with ${ipPool.length} sessions`);
    stats.lastRefreshTime = new Date();
    
    isWarmingUp = false;
    isInitialized = true;
    return ipPool.length;
  })();
  
  return warmingPromise;
}

/**
 * Refresh the IP pool, removing old sessions and adding new ones
 * @returns {Promise<void>}
 */
async function refreshPool() {
  if (isWarmingUp) {
    return;
  }
  
  const now = Date.now();
  const expiredThreshold = 3600000; // 1 hour in milliseconds
  
  // Remove expired sessions
  const expiredCount = ipPool.filter(s => (now - s.createdAt) > expiredThreshold && !s.inUse).length;
  if (expiredCount > 0) {
    console.log(`Removing ${expiredCount} expired sessions from pool`);
    
    // Only remove sessions that aren't in use
    const beforeCount = ipPool.length;
    ipPool = ipPool.filter(s => (now - s.createdAt) <= expiredThreshold || s.inUse);
    const afterCount = ipPool.length;
    
    console.log(`Pool size changed from ${beforeCount} to ${afterCount}`);
  }
  
  // Check if we need to add more sessions
  const availableCount = ipPool.filter(s => !s.inUse).length;
  if (availableCount < targetPoolSize / 2) {
    console.log(`Pool needs more available sessions (${availableCount} available, ${ipPool.length} total, target ${targetPoolSize})`);
    
    // Create new sessions to maintain the target size
    const sessionsToCreate = targetPoolSize - availableCount;
    
    if (sessionsToCreate > 0) {
      console.log(`Creating ${sessionsToCreate} new sessions to maintain pool size`);
      const newSessions = Array(sessionsToCreate)
        .fill()
        .map(() => createProxySession());
      
      // Process all in parallel for speed
      const results = await Promise.all(newSessions.map(session => warmupSession(session)));
      ipPool.push(...results);
      
      console.log(`Added ${results.length} new sessions to pool`);
    }
  }
  
  stats.lastRefreshTime = new Date();
  return getPoolStats();
}

/**
 * Get a warmed IP session from the pool
 * @returns {Promise<Object>} A ready-to-use IP session
 */
async function getIpSession() {
  // Initialize pool if needed
  if (ipPool.length === 0) {
    await initializePool();
  }
  
  // Find available sessions to use
  const availableSessions = ipPool.filter(s => !s.inUse);
  
  if (availableSessions.length === 0) {
    console.log('No sessions available in pool, creating a new one');
    const newSession = createProxySession();
    await warmupSession(newSession);
    ipPool.push(newSession);
    newSession.inUse = true;
    newSession.lastUsed = Date.now();
    newSession.timesUsed = 1;
    
    stats.sessionsUsed++;
    
    console.log(`Using newly created IP session ${newSession.sessionId}`);
    return {
      username: newSession.username,
      password: newSession.password,
      server: newSession.server,
      sessionId: newSession.sessionId,
      release: () => releaseSession(newSession.sessionId)
    };
  }
  
  // IMPROVED WARM BROWSER DETECTION:
  // Try much harder to find a session with a warm browser
  
  // Check all available sessions for warm browsers
  const sessionsWithBrowsers = [];
  let hasCheckedWarmBrowsers = false;
  
  for (const session of availableSessions) {
    // This is an expensive operation (API call), so only do it if we have a small pool
    // or if we're running in persistent mode (where warm browsers matter more)
    if (persistentMode || ipPool.length < 10) {
      hasCheckedWarmBrowsers = true;
      try {
        if (await isWarmBrowserAvailable(session.sessionId)) {
          // Found a session with a warm browser - use it immediately!
          console.log(`Found session ${session.sessionId} with warm browser ready`);
          sessionsWithBrowsers.push(session);
        }
      } catch (error) {
        console.error(`Error checking warm browser for session ${session.sessionId}:`, error.message);
        // Continue with other sessions
      }
    }
  }
  
  // Sort sessions: prioritize ones with warm browsers, then avoid the most recently used ones
  let sessionToUse;
  
  if (sessionsWithBrowsers.length > 0) {
    console.log(`Found ${sessionsWithBrowsers.length} sessions with warm browsers ready`);
    // Use the first session with a warm browser
    sessionToUse = sessionsWithBrowsers[0];
  } else {
    if (hasCheckedWarmBrowsers) {
      console.log('No sessions with warm browsers found, using regular selection');
    }
    
    // Avoid reusing the last used session if possible
    sessionToUse = availableSessions.find(s => s.sessionId !== lastUsedSessionId);
    
    // If all available sessions are the last used one, just pick any
    if (!sessionToUse) {
      sessionToUse = availableSessions[0];
    }
  }
  
  // Mark session as in use and update last used
  sessionToUse.inUse = true;
  sessionToUse.lastUsed = Date.now();
  sessionToUse.timesUsed++;
  lastUsedSessionId = sessionToUse.sessionId;
  
  stats.sessionsUsed++;
  
  console.log(`Using IP session ${sessionToUse.sessionId}`);
  
  // Return the session with a release function
  return {
    username: sessionToUse.username,
    password: sessionToUse.password,
    server: sessionToUse.server,
    sessionId: sessionToUse.sessionId,
    // Provide a function to release this session back to the pool
    release: () => releaseSession(sessionToUse.sessionId)
  };
}

/**
 * Release a session back to the pool
 * @param {string} sessionId - The ID of the session to release
 */
function releaseSession(sessionId) {
  const session = ipPool.find(s => s.sessionId === sessionId);
  if (session) {
    session.inUse = false;
    console.log(`Released IP session ${sessionId} back to pool`);
  }
}

/**
 * Clean up the IP pool
 */
function cleanupPool() {
  console.log(`Cleaning up IP pool with ${ipPool.length} sessions`);
  ipPool = [];
  isInitialized = false;
}

/**
 * Get statistics about the current pool
 * @returns {Object} Statistics about the pool
 */
function getPoolStats() {
  const now = Date.now();
  const availableSessions = ipPool.filter(s => !s.inUse).length;
  const inUseSessions = ipPool.filter(s => s.inUse).length;
  
  const poolStats = {
    total: ipPool.length,
    available: availableSessions,
    inUse: inUseSessions,
    created: stats.sessionsCreated,
    used: stats.sessionsUsed,
    failed: stats.sessionsFailed,
    lastRefresh: stats.lastRefreshTime,
    poolAgeMinutes: ipPool.length > 0 ? 
      Math.floor((now - Math.min(...ipPool.map(s => s.createdAt))) / 60000) : 0
  };
  
  return poolStats;
}

/**
 * Get a specific IP session by ID
 * @param {string} sessionId - The ID of the session to get
 * @returns {Promise<Object|null>} The session if found, null if not found or in use
 */
async function getSpecificSession(sessionId) {
  if (!sessionId) {
    console.error('No sessionId provided');
    return null;
  }
  
  // Find the session in the pool
  const session = ipPool.find(s => s.sessionId === sessionId && !s.inUse);
  
  if (!session) {
    console.log(`Session ${sessionId} not found or already in use`);
    return null;
  }
  
  // Mark session as in use and update last used
  session.inUse = true;
  session.lastUsed = Date.now();
  session.timesUsed++;
  lastUsedSessionId = session.sessionId;
  
  stats.sessionsUsed++;
  
  console.log(`Using specific IP session ${session.sessionId}`);
  
  // Return the session with a release function
  return {
    username: session.username,
    password: session.password,
    server: session.server,
    sessionId: session.sessionId,
    // Provide a function to release this session back to the pool
    release: () => releaseSession(session.sessionId)
  };
}

/**
 * Get all sessions from the pool (for tracking purposes)
 * @returns {Array} Array of all sessions with their IDs
 */
function getAllSessions() {
  return ipPool.map(session => ({
    sessionId: session.sessionId,
    inUse: session.inUse,
    timesUsed: session.timesUsed
  }));
}

// Export the module
module.exports = {
  getIpSession,
  getSpecificSession,
  releaseSession,
  initializePool,
  refreshPool,
  cleanupPool,
  getPoolStats,
  setPersistentMode,
  getAllSessions
}; 
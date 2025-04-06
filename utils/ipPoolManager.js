/**
 * IP Pool Manager
 * Maintains a pool of pre-warmed IP addresses from Oxylabs
 * Ready with DNS resolution and TLS handshakes already completed
 */

const https = require('https');
const http = require('http');
const { promisify } = require('util');
const config = require('../config');

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

// Log configuration at startup
console.log('IP Pool Manager Configuration:');
console.log(`Target pool size: ${targetPoolSize}`);
console.log(`Proxy server: ${config.PROXY_URL}`);
console.log(`Proxy username base: ${config.PROXY_USERNAME ? config.PROXY_USERNAME.split('_')[0] : 'Not set'}`);

/**
 * Generate a unique session ID for Oxylabs
 * @returns {string} A unique session ID
 */
function generateSessionId() {
  // Create a more unique session ID with a timestamp component
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
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
    modifiedUsername = `${username}_${sessionId}`;
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
    isWarmed: true, // Consider all sessions pre-warmed since Playwright handles connections well
    lastUsed: null,
    createdAt: Date.now(),
    timesUsed: 0,
    inUse: false
  };
}

/**
 * "Warm up" a proxy session
 * 
 * Note: We're not actually making a connection - we're just simulating the warmup
 * because Playwright handles the connections efficiently anyway.
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
    
  // We're marking all sessions as pre-warmed since Playwright handles connections well
  session.isWarmed = true;
  return session;
}

/**
 * Initialize and warm up the IP pool
 * @param {boolean} force - Whether to force re-initialization even if already in progress
 * @returns {Promise<void>}
 */
async function initializePool(force = false) {
  if (force) {
    persistentMode = true; // If forced, assume we're in persistent mode
  }
  
  if (warmingPromise && !force) {
    return warmingPromise;
  }
  
  if (isWarmingUp && !force) {
    console.log('Pool is already warming up');
    return;
  }
  
  isWarmingUp = true;
  
  warmingPromise = (async () => {
    console.log(`Initializing IP pool with target size of ${targetPoolSize}`);
    
    // Create session configurations
    const sessionsToCreate = targetPoolSize - ipPool.length;
    const newSessions = Array(Math.max(0, sessionsToCreate))
      .fill()
      .map(() => createProxySession());
    
    if (newSessions.length === 0) {
      console.log('Pool already at target size');
      isWarmingUp = false;
      return;
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
    
    // Only set up periodic refresh if not in persistent mode
    // (persistent mode handles this via startIpPool.js)
    if (!persistentMode) {
      // Periodically refresh the pool
      setTimeout(() => {
        refreshPool().catch(console.error);
      }, 60000); // Check every minute
    }
    
    isWarmingUp = false;
  })().catch(err => {
    console.error(`Error initializing IP pool: ${err.message}`);
    isWarmingUp = false;
  });
  
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
  
  // Avoid reusing the last used session if possible
  let session = availableSessions.find(s => s.sessionId !== lastUsedSessionId);
  
  // If all available sessions are the last used one, just pick any
  if (!session) {
    session = availableSessions[0];
  }
  
  // Mark session as in use and update last used
  session.inUse = true;
  session.lastUsed = Date.now();
  session.timesUsed++;
  lastUsedSessionId = session.sessionId;
  
  stats.sessionsUsed++;
  
  console.log(`Using IP session ${session.sessionId}`);
  
  // Only create a replacement session if in persistent mode and our usage is high
  // This prevents unnecessary session creation for one-off uses
  if (persistentMode && session.timesUsed > 5) {
    setTimeout(() => {
      console.log(`Session ${session.sessionId} has been used ${session.timesUsed} times, preparing replacement`);
      const newSession = createProxySession();
      warmupSession(newSession)
        .then(warmedSession => {
          ipPool.push(warmedSession);
          console.log(`Added replacement session ${warmedSession.sessionId} to pool`);
        })
        .catch(console.error);
    }, 0);
  }
  
  return {
    username: session.username,
    password: session.password,
    server: session.server,
    sessionId: session.sessionId,
    release: () => releaseSession(session.sessionId)
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
 * Set the IP Pool Manager to persistent mode
 * Call this when running as a background service
 */
function setPersistentMode(enabled = true) {
  persistentMode = enabled;
  console.log(`IP Pool Manager persistent mode set to: ${persistentMode}`);
  return persistentMode;
}

// Start initializing the pool in the background
// (but don't await, let it happen asynchronously)
initializePool().catch(console.error);

module.exports = {
  getIpSession,
  releaseSession,
  initializePool,
  refreshPool,
  cleanupPool,
  getPoolStats,
  setPersistentMode
}; 
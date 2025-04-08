/**
 * IP Pool API Server
 * 
 * Provides an HTTP API for accessing the IP Pool Manager
 * and maintaining warm browsers for fast booking
 */

const express = require('express');
const http = require('http');
const ipPoolManager = require('./ipPoolManager');
const {
    createWarmBrowser,
    isWarmBrowserAvailable,
    getWarmBrowserStats,
    cleanupAllBrowsers,
    getWarmBrowserBySessionId,
    initializeWarmBrowsersForSessions
} = require('./warmBrowserManager');
const config = require('../config');

// Track if pool has been initialized
let poolInitialized = false;
let initializationPromise = null;

// Set up Express app
const app = express();
app.use(express.json());

// Configure and initialize the IP Pool Manager
const targetPoolSize = config.POOL_SIZE || 5;
ipPoolManager.setPersistentMode(true);

// Create an array to store and track sessions
const trackedSessions = [];

// Track sessions with warm browsers
let sessionsWithWarmBrowsers = [];

// Interceptor for ipPoolManager to track all created sessions
const originalInitializePool = ipPoolManager.initializePool;
ipPoolManager.initializePool = async function(...args) {
  // Get existing session count
  const existingCount = await ipPoolManager.getPoolStats().total || 0;
  
  // Call original method
  const result = await originalInitializePool.apply(this, args);
  
  // After initialization, get all sessions and track them
  const afterCount = await ipPoolManager.getPoolStats().total || 0;
  
  if (afterCount > existingCount) {
    console.log(`Need to track ${afterCount - existingCount} new sessions from pool initialization`);
    await updateTrackedSessions();
  }
  
  return result;
};

// Helper to update our tracking of all sessions in the pool
async function updateTrackedSessions() {
  // Get all sessions from the pool
  const stats = await ipPoolManager.getPoolStats();
  const allSessions = await ipPoolManager.getAllSessions();
  
  if (!allSessions || allSessions.length === 0) {
    console.log('No sessions available to track');
    return;
  }
  
  console.log(`Tracking ${allSessions.length} sessions from the pool`);
  
  // Clear tracked sessions and add all current ones
  trackedSessions.length = 0;
  trackedSessions.push(...allSessions);
  
  // Update our knowledge of which sessions have warm browsers
  await updateWarmBrowserSessions();
}

// Update our tracking of which sessions have warm browsers
async function updateWarmBrowserSessions() {
  sessionsWithWarmBrowsers = [];
  
  for (const session of trackedSessions) {
    const hasWarm = await isWarmBrowserAvailable(session.sessionId);
    if (hasWarm) {
      sessionsWithWarmBrowsers.push(session.sessionId);
    }
  }
  
  console.log(`Found ${sessionsWithWarmBrowsers.length} sessions with warm browsers: ${sessionsWithWarmBrowsers.join(', ')}`);
}

// Helper to create and track sessions
async function createAndTrackSessions(count) {
  console.log(`Creating ${count} sessions for warm browser initialization`);
  const newSessions = [];
  
  for (let i = 0; i < count; i++) {
    // Get a session from the pool
    const session = await ipPoolManager.getIpSession();
    console.log(`Created session ${session.sessionId} for warm browser initialization`);
    
    // Add to our tracked sessions array
    newSessions.push(session);
    
    // Make sure it's in our tracking array
    if (!trackedSessions.find(s => s.sessionId === session.sessionId)) {
      trackedSessions.push(session);
    }
    
    // Release it back to the pool immediately (but keep track of its details)
    await ipPoolManager.releaseSession(session.sessionId);
  }
  
  return newSessions;
}

// Start initializing the pool asynchronously
initializationPromise = (async () => {
  try {
    const poolSize = await ipPoolManager.initializePool();
    console.log(`✅ Pool initialization complete with ${poolSize} sessions`);
    
    // Get all sessions and update our tracking
    await updateTrackedSessions();
    
    // Get all IP sessions to initialize warm browsers
    const poolStats = ipPoolManager.getPoolStats();
    const sessionCount = Math.min(poolStats.total, 3); // Limit to 3 for faster startup
    console.log(`Starting warm browser initialization for ${sessionCount} sessions`);
    
    // Create and track sessions for warm browser initialization
    const sessionsForBrowsers = await createAndTrackSessions(sessionCount);
    
    // Initialize warm browsers for these sessions
    if (sessionsForBrowsers.length > 0) {
      await initializeWarmBrowsersForSessions(sessionsForBrowsers);
      
      // Update our knowledge of which sessions have warm browsers
      await updateWarmBrowserSessions();
    } else {
      console.log('No sessions available for warm browser initialization');
    }
    
    poolInitialized = true;
    return poolSize;
  } catch (error) {
    console.error('❌ Failed to initialize pool:', error);
    throw error;
  }
})();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    poolInitialized,
    timestamp: new Date().toISOString()
  });
});

// Get an IP session from the pool
app.get('/api/get-session', async (req, res) => {
  try {
    // 1. Wait for pool initialization if it's in progress (optional but good practice)
    if (!poolInitialized) {
      console.log('[Server API /get-session] Pool not initialized yet, waiting...');
      await initializationPromise; // Wait for the initialization attempt to finish
      if(!poolInitialized) { // Check again after waiting
          console.error('[Server API /get-session] Pool failed to initialize.');
          // Use 503 Service Unavailable if the pool isn't ready
          return res.status(503).json({ error: 'Pool initialization failed or not complete.' });
      }
      console.log('[Server API /get-session] Pool initialization confirmed complete.');
    }

    // 2. Get session details from the ipPoolManager
    console.log('[Server API /get-session] Calling ipPoolManager.getIpSession...');
    const session = await ipPoolManager.getIpSession(); // Gets { sessionId, server, username, password, release }

    // Check if the manager returned a valid session
    if (!session || !session.sessionId) {
        console.error('[Server API /get-session] Failed to get valid session from ipPoolManager.');
        return res.status(500).json({ error: 'Failed to get session from pool' });
    }
     console.log(`[Server API /get-session] Got session ${session.sessionId} from manager.`);

    // 3. *** Check warm browser status for THIS specific session ID ***
    let hasWarmBrowser = false; // Default to false
    try {
        console.log(`[Server API /get-session] Checking warm status for session ${session.sessionId} via warmBrowserManager...`);
        // Use the specific function imported from your warmBrowserManager
        hasWarmBrowser = await isWarmBrowserAvailable(session.sessionId);
        console.log(`[Server API /get-session] Warm status for ${session.sessionId}: ${hasWarmBrowser}`);
    } catch (warmCheckError) {
        // Log error but continue, reporting warm as false
        console.error(`[Server API /get-session] Error checking warm status for ${session.sessionId}:`, warmCheckError.message);
        hasWarmBrowser = false;
    }
    // *** END CHECK ***

    // 4. Return session info INCLUDING the correct warm status
    console.log(`[Server API /get-session] Returning session ${session.sessionId} to client with warmAvailable=${hasWarmBrowser}`);
    res.json({
      server: session.server,
      username: session.username,
      password: session.password,
      sessionId: session.sessionId,
      warmBrowserAvailable: hasWarmBrowser // Pass the checked status
    });

  } catch (error) {
    console.error('[Server API /get-session] Unexpected error in route handler:', error);
    // Avoid sending detailed internal errors unless needed for specific debugging
    res.status(500).json({
      error: 'Internal server error while getting session',
      // message: error.message // Optionally include message for debugging
    });
  }
});

// Release an IP session back to the pool
app.post('/api/release-session', (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({
      error: 'Missing sessionId'
    });
  }
  
  try {
    ipPoolManager.releaseSession(sessionId);
    res.json({
      status: 'success',
      message: `Released session ${sessionId}`
    });
  } catch (error) {
    console.error('Error releasing session:', error);
    res.status(500).json({
      error: 'Failed to release session',
      message: error.message
    });
  }
});

// Get pool statistics
app.get('/api/stats', (req, res) => {
  try {
    const stats = ipPoolManager.getPoolStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting pool stats:', error);
    res.status(500).json({
      error: 'Failed to get pool stats',
      message: error.message
    });
  }
});

// Get warm browser statistics
app.get('/api/browser-stats', (req, res) => {
  try {
    const stats = getWarmBrowserStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting browser stats:', error);
    res.status(500).json({
      error: 'Failed to get browser stats',
      message: error.message
    });
  }
});

// Check if a warm browser is available for a session
app.get('/api/get-warm-browser', async (req, res) => {
  const { sessionId } = req.query;
  
  if (!sessionId) {
    return res.status(400).json({
      error: 'Missing sessionId parameter'
    });
  }
  
  try {
    // Wait for pool initialization if not complete
    if (!poolInitialized) {
      console.log('Pool not initialized yet, waiting before checking warm browser...');
      try {
        await initializationPromise;
      } catch (error) {
        console.error('Error waiting for pool initialization:', error);
      }
    }
    
    // Check for warm browser
    const isAvailable = await isWarmBrowserAvailable(sessionId);
    console.log(`Checked warm browser for session ${sessionId}: available=${isAvailable}`);
    
    // Get additional details if available
    let browserInfo = null;
    if (isAvailable) {
      browserInfo = await getWarmBrowserBySessionId(sessionId);
    }
    
    // Return enhanced browser information
    res.json({
      sessionId,
      warmBrowserAvailable: isAvailable,
      status: browserInfo ? browserInfo.status : 'not_available',
      createdAt: browserInfo ? browserInfo.createdAt : null,
      lastUsed: browserInfo ? browserInfo.lastUsed : null,
      url: browserInfo ? browserInfo.url : null,
      warmupTime: browserInfo ? browserInfo.warmupTime : null
    });
  } catch (error) {
    console.error(`Error checking warm browser for session ${sessionId}:`, error);
    res.status(500).json({
      error: 'Failed to check warm browser',
      message: error.message
    });
  }
});

// Get a specific session by ID
app.get('/api/get-specific-session', async (req, res) => {
  const { sessionId } = req.query;
  
  if (!sessionId) {
    return res.status(400).json({
      error: 'Missing sessionId parameter'
    });
  }
  
  try {
    // Wait for pool initialization if not complete
    if (!poolInitialized) {
      console.log('Pool not initialized yet, waiting...');
      try {
        await initializationPromise;
      } catch (error) {
        console.error('Error waiting for pool initialization:', error);
        return res.status(500).json({
          error: 'Pool initialization failed',
          message: error.message
        });
      }
    }
    
    // Get the specific session
    const session = await ipPoolManager.getSpecificSession(sessionId);
    
    if (!session) {
      return res.status(404).json({
        error: 'Session not found or in use',
        message: `No available session found with ID ${sessionId}`
      });
    }
    
    console.log(`Specific IP session ${session.sessionId} returned to client`);
    
    // Check if we have a warm browser for this session
    const hasWarmBrowser = await isWarmBrowserAvailable(session.sessionId);
    console.log(`Session ${session.sessionId} warm browser available: ${hasWarmBrowser}`);
    
    // Return session info with warm browser status
    res.json({
      server: session.server,
      username: session.username,
      password: session.password,
      sessionId: session.sessionId,
      warmBrowserAvailable: hasWarmBrowser
    });
  } catch (error) {
    console.error('Error getting specific IP session:', error);
    res.status(500).json({
      error: 'Failed to get specific session',
      message: error.message
    });
  }
});

// Start the server
const port = process.env.PORT || 3057;
const server = app.listen(port, () => {
  console.log(`IP Pool API Server running on port ${port}`);
});

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('Shutting down IP Pool API Server...');
  
  // Close the server first
  server.close();
  
  // Then clean up resources
  await require('./warmBrowserManager').cleanupAllBrowsers();
  ipPoolManager.cleanupPool();
  
  console.log('Shutdown complete');
  process.exit(0);
});

// Export for testing
module.exports = server;
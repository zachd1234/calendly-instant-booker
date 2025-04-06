/**
 * IP Pool Manager API Server
 * 
 * This script creates a simple HTTP API for the IP Pool Manager,
 * allowing other processes to get and release IP sessions.
 */

const http = require('http');
const url = require('url');
const { 
  getIpSession, 
  releaseSession, 
  initializePool, 
  refreshPool,
  getPoolStats,
  setPersistentMode 
} = require('./utils/ipPoolManager');

// Default port for the API server
const PORT = process.env.IP_POOL_PORT || 3057;

// Set persistent mode
setPersistentMode(true);

// Active sessions tracking (to prevent memory leaks)
const activeSessions = new Map();

// Initialize the pool at startup with force=true
console.log('Initializing IP Pool Manager API Server...');
initializePool(true).then(() => {
  console.log('IP Pool initialized successfully');
}).catch(err => {
  console.error('Error initializing IP pool:', err);
});

// Simple HTTP API server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  
  // Set CORS headers to allow access from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  
  // Basic logging
  console.log(`${new Date().toISOString()} - ${req.method} ${path}`);
  
  if (path === '/api/health') {
    // Health check endpoint
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } 
  else if (path === '/api/stats') {
    // Pool stats endpoint
    res.setHeader('Content-Type', 'application/json');
    const stats = getPoolStats();
    res.end(JSON.stringify(stats));
  }
  else if (path === '/api/get-session') {
    try {
      // Get a session from the pool
      const session = await getIpSession();
      
      // Generate a unique token for this session
      const token = `${session.sessionId}-${Date.now()}`;
      
      // Store the session in our activeSessions map with its token
      activeSessions.set(token, session);
      
      // Return the token and proxy details
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        token,
        proxy: {
          server: session.server,
          username: session.username,
          password: session.password
        },
        sessionId: session.sessionId
      }));
    } catch (error) {
      console.error('Error getting session:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to get IP session' }));
    }
  }
  else if (path === '/api/release-session') {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }
    
    // Handle POST data
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { token } = data;
        
        if (!token) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing token parameter' }));
          return;
        }
        
        // Get session from our activeSessions map
        const session = activeSessions.get(token);
        
        if (!session) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Session not found or already released' }));
          return;
        }
        
        // Release the session back to the pool
        releaseSession(session.sessionId);
        
        // Remove from our activeSessions map
        activeSessions.delete(token);
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, message: 'Session released successfully' }));
      } catch (error) {
        console.error('Error releasing session:', error);
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid request format' }));
      }
    });
  }
  else if (path === '/api/refresh') {
    try {
      // Refresh the pool
      await refreshPool();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, message: 'Pool refreshed successfully' }));
    } catch (error) {
      console.error('Error refreshing pool:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to refresh pool' }));
    }
  }
  else {
    // Not found
    res.statusCode = 404;
    res.end('Not Found');
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`IP Pool Manager API Server running on port ${PORT}`);
  console.log(`API Endpoints:`);
  console.log(`  - GET  /api/health        - Check server health`);
  console.log(`  - GET  /api/stats         - Get pool statistics`);
  console.log(`  - GET  /api/get-session   - Get an IP session`);
  console.log(`  - POST /api/release-session - Release a session`);
  console.log(`  - GET  /api/refresh       - Trigger pool refresh`);
  console.log('\nKeep this terminal window open to maintain the IP pool!');
  console.log('Run your booking scripts in a separate terminal window.');
});

// Set up periodic pool refresh
const refreshInterval = 30000; // 30 seconds
setInterval(async () => {
  try {
    console.log('Performing scheduled pool refresh...');
    await refreshPool();
    console.log('Pool refreshed successfully');
    
    // Log stats every few refreshes
    const stats = getPoolStats();
    console.log(`\nCurrent Pool Stats:`);
    console.log(`Total sessions: ${stats.total}`);
    console.log(`Available: ${stats.available}`);
    console.log(`In use: ${stats.inUse}`);
  } catch (error) {
    console.error('Error during scheduled pool refresh:', error);
  }
}, refreshInterval);

// Cleanup on process exit
process.on('SIGINT', () => {
  console.log('\nShutting down IP Pool Manager API Server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}); 
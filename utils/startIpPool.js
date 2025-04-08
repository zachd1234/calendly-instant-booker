/**
 * IP Pool Background Service with Warm Browsers
 * 
 * This script runs continuously to maintain a pool of pre-warmed IP addresses
 * and browser instances with pre-loaded Calendly pages.
 * 
 * Usage:
 * - Start in a separate terminal window with `node startIpPool.js`
 * - Keep this terminal window open while running your booking scripts in another window
 */

const { initializePool, refreshPool, cleanupPool, getPoolStats, setPersistentMode } = require('./utils/ipPoolManager');
const { getWarmBrowserStats, cleanupAllBrowsers } = require('./utils/warmBrowserManager');

// Configure for persistence mode
setPersistentMode(true);

// Track runtime
const startTime = new Date();
let lastStatsLogTime = Date.now();
const LOG_INTERVAL_MS = 30000; // Log stats every 30 seconds

// Start with a fresh pool
console.log('Starting IP Pool Manager in persistent mode with warm browsers...');
console.log('-----------------------------------------------');
console.log('Keep this terminal window open to maintain the IP pool!');
console.log('Run your booking scripts in a separate terminal window.');
console.log('-----------------------------------------------');

// Initialize the pool with fresh sessions
(async () => {
  try {
    // Force initialization
    await initializePool(true);
    
    // Log initial pool stats
    const stats = getPoolStats();
    const browserStats = getWarmBrowserStats();

    console.log('\nCurrent Pool Stats:');
    console.log(`Total sessions: ${stats.total}`);
    console.log(`Available: ${stats.available}`);
    console.log(`In use: ${stats.inUse}`);
    console.log(`Total created: ${stats.created}`);
    console.log(`Total used: ${stats.used}`);
    
    console.log('\nWarm Browser Stats:');
    console.log(`Total browsers: ${browserStats.total}`);
    console.log(`Ready: ${browserStats.ready}`);
    console.log(`Warming: ${browserStats.warming}`);
    console.log(`Partial: ${browserStats.partial}`);
    console.log(`In use: ${browserStats.inUse}`);
    console.log('-----------------------------------------------');
    
    // Set up periodic refresh of the pool
    const refreshInterval = setInterval(async () => {
      try {
        // Only log stats periodically to avoid console spam
        const now = Date.now();
        const shouldLogStats = now - lastStatsLogTime > LOG_INTERVAL_MS;
        
        console.log('\nRefreshing IP pool and warm browsers...');
        const refreshedStats = await refreshPool();
        const browserStats = getWarmBrowserStats();
        
        if (shouldLogStats) {
          const uptime = Math.floor((now - startTime) / 1000 / 60);
          console.log(`\n📊 Pool Stats (Uptime: ${uptime} minutes):`);
          console.log(`Total sessions: ${refreshedStats.total}`);
          console.log(`Available: ${refreshedStats.available}`);
          console.log(`In use: ${refreshedStats.inUse}`);
          console.log(`Total created: ${refreshedStats.created}`);
          console.log(`Total used: ${refreshedStats.used}`);
          console.log(`Oldest session age: ${refreshedStats.poolAgeMinutes} minutes`);
          
          console.log('\n🔥 Warm Browser Stats:');
          console.log(`Total browsers: ${browserStats.total}`);
          console.log(`Ready: ${browserStats.ready}`);
          console.log(`Warming: ${browserStats.warming}`);
          console.log(`Partial: ${browserStats.partial}`);
          console.log(`In use: ${browserStats.inUse}`);
          console.log('-----------------------------------------------');
          
          lastStatsLogTime = now;
        }
      } catch (error) {
        console.error('Error refreshing pool:', error);
      }
    }, 30000); // Refresh every 30 seconds
    
    // Handle process termination
    process.on('SIGINT', async () => {
      console.log('\nShutting down IP Pool Manager...');
      clearInterval(refreshInterval);
      
      console.log('Cleaning up warm browsers...');
      await cleanupAllBrowsers();
      
      console.log('Cleaning up IP pool...');
      cleanupPool();
      
      console.log('Pool cleaned up. Exiting.');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error initializing pool:', error);
    process.exit(1);
  }
})(); 
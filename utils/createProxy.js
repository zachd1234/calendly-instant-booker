/**
 * Proxy creation utility for different providers
 */

const config = require('../config');

/**
 * Creates a proxy configuration object for Playwright based on the provider
 * @param {string} provider - The proxy provider to use ('oxylabs', 'brightdata', etc.)
 * @returns {Object} - Proxy configuration for Playwright browser launch
 */
async function createProxy(provider) {
  // Return early if no proxy configuration is provided
  if (!config.PROXY_URL) {
    console.log('No proxy configuration found, running without proxy');
    return null;
  }

  // Default configuration for Oxylabs
  if (provider === 'oxylabs') {
    return {
      server: config.PROXY_URL,
      username: config.PROXY_USERNAME,
      password: config.PROXY_PASSWORD
    };
  }

  // Could add support for other proxy providers here
  // Example: Bright Data, Smartproxy, etc.

  // Unknown provider, use the URL directly
  console.log(`Unknown proxy provider: ${provider}, using direct URL`);
  return {
    server: config.PROXY_URL,
    username: config.PROXY_USERNAME,
    password: config.PROXY_PASSWORD
  };
}

module.exports = createProxy; 
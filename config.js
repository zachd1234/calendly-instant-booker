/**
 * Configuration settings for the Calendly booking system
 * Environment variables can override these default values
 */

require('dotenv').config(); // Load environment variables from .env file

module.exports = {
  POOL_SIZE: parseInt(process.env.POOL_SIZE || '3', 10), // Default to 1 browser in the pool
  PROXY_PROVIDER: process.env.PROXY_PROVIDER || 'oxylabs',
  PROXY_URL: process.env.PROXY_URL, // The proxy server URL
  PROXY_USERNAME: process.env.PROXY_USERNAME, // Proxy authentication
  PROXY_PASSWORD: process.env.PROXY_PASSWORD, // Proxy authentication
  SCREENSHOT_MODE: process.env.SCREENSHOT === 'true',
  DEFAULT_NAME: process.env.NAME || 'Julian Bot',
  DEFAULT_EMAIL: process.env.EMAIL || 'julian@example.com',
  DEFAULT_PHONE: process.env.PHONE || '+1 3109122380',
  DEBUG: process.env.DEBUG === 'true',
  // Performance optimization flags
  BLOCK_IMAGES: process.env.BLOCK_IMAGES !== 'false', // Block images by default
  BLOCK_FONTS: process.env.BLOCK_FONTS !== 'false', // Block fonts by default
  BLOCK_ANALYTICS: process.env.BLOCK_ANALYTICS !== 'false', // Block analytics by default
  : process.env.HEADLESS !== 'false', // Run in headless mode by default
}; 
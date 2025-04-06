/**
 * IP Pool Client
 * 
 * Client library for interacting with the IP Pool Manager API Server
 */

const http = require('http');
const https = require('https');

// Default connection settings
const API_HOST = process.env.IP_POOL_HOST || 'localhost';
const API_PORT = process.env.IP_POOL_PORT || 3057;

class IpPoolClient {
  constructor(host = API_HOST, port = API_PORT) {
    this.host = host;
    this.port = port;
    this.baseUrl = `http://${host}:${port}`;
    this.activeTokens = new Set();
  }

  /**
   * Send a request to the IP Pool API Server
   * @param {string} path - API endpoint path
   * @param {string} method - HTTP method
   * @param {object} data - Request body for POST requests
   * @returns {Promise<object>} Response data
   */
  async sendRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.host,
        port: this.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      let requestBody = null;
      if (data) {
        requestBody = JSON.stringify(data);
        options.headers['Content-Length'] = Buffer.byteLength(requestBody);
      }

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsedData = JSON.parse(responseData);
              resolve(parsedData);
            } catch (error) {
              resolve(responseData); // Return raw data if not JSON
            }
          } else {
            reject(new Error(`Request failed with status code ${res.statusCode}: ${responseData}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Failed to connect to IP Pool API Server: ${error.message}`));
      });

      if (requestBody) {
        req.write(requestBody);
      }

      req.end();
    });
  }

  /**
   * Check if the IP Pool API Server is running
   * @returns {Promise<boolean>} True if server is running
   */
  async isServerRunning() {
    try {
      const response = await this.sendRequest('/api/health');
      return response && response.status === 'ok';
    } catch (error) {
      console.error('IP Pool API Server is not running:', error.message);
      return false;
    }
  }

  /**
   * Get pool statistics
   * @returns {Promise<object>} Pool statistics
   */
  async getStats() {
    return this.sendRequest('/api/stats');
  }

  /**
   * Get an IP session from the pool
   * @returns {Promise<object>} Session object with proxy details
   */
  async getIpSession() {
    try {
      const response = await this.sendRequest('/api/get-session');
      
      if (response && response.token) {
        this.activeTokens.add(response.token);
        
        // Create a function to release this specific session
        const release = async () => {
          await this.releaseSession(response.token);
        };
        
        // Return the session with proxy details and release function
        return {
          ...response.proxy,
          sessionId: response.sessionId,
          release
        };
      } else {
        throw new Error('Invalid response from IP Pool API Server');
      }
    } catch (error) {
      console.error('Error getting IP session:', error.message);
      throw error;
    }
  }

  /**
   * Release an IP session back to the pool
   * @param {string} token - Session token
   * @returns {Promise<object>} Response object
   */
  async releaseSession(token) {
    if (!token) {
      throw new Error('Token is required to release session');
    }
    
    try {
      const response = await this.sendRequest('/api/release-session', 'POST', { token });
      this.activeTokens.delete(token);
      return response;
    } catch (error) {
      console.error('Error releasing IP session:', error.message);
      // Remove from active tokens anyway to prevent memory leaks
      this.activeTokens.delete(token);
      throw error;
    }
  }

  /**
   * Trigger a pool refresh
   * @returns {Promise<object>} Response object
   */
  async refreshPool() {
    return this.sendRequest('/api/refresh');
  }

  /**
   * Clean up by releasing all active sessions
   * @returns {Promise<void>}
   */
  async cleanup() {
    const promises = [];
    
    for (const token of this.activeTokens) {
      promises.push(this.releaseSession(token).catch(() => {}));
    }
    
    await Promise.all(promises);
    this.activeTokens.clear();
  }
}

module.exports = new IpPoolClient(); 
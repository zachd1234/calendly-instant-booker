# IP Pool Manager API System

This system provides a persistent IP pool service that can be shared across multiple processes, allowing you to efficiently manage and reuse proxy IP sessions for the Calendly booking bot.

## Components

1. **IP Pool Server (`ipPoolServer.js`)**: A HTTP server that manages the IP pool and provides an API for clients
2. **IP Pool Client (`utils/ipPoolClient.js`)**: A client library that connects to the IP Pool server
3. **Test Script (`test-ip-pool-api.js`)**: A script to test the IP Pool API system
4. **Enhanced Booking Script (`index_with_pool.js`)**: The main booking script that uses the IP Pool API

## How it Works

1. The IP Pool Server runs as a persistent process, maintaining a pool of pre-warmed IP sessions
2. Client processes connect to this server via HTTP to get and release IP sessions
3. This allows multiple booking processes to share the same pool of IPs efficiently

## Usage Instructions

### Step 1: Start the IP Pool Server

Start the IP Pool server in a separate terminal window and keep it running:

```bash
node ipPoolServer.js
```

This will:
- Start a HTTP server on port 3057 (configurable via IP_POOL_PORT environment variable)
- Initialize and maintain a pool of IP sessions
- Periodically refresh the pool 
- Provide an API for clients to get and release sessions

### Step 2: Use the IP Pool in Your Scripts

In your scripts, use the IP Pool Client to get and release sessions:

```javascript
const ipPoolClient = require('./utils/ipPoolClient');

async function myFunction() {
  // Get a session from the pool
  const session = await ipPoolClient.getIpSession();
  
  try {
    // Use the session
    console.log(`Using IP session ${session.sessionId}`);
    console.log(`Proxy settings: ${session.server}`);
    
    // Your code that uses the proxy...
    
  } finally {
    // Release the session back to the pool when done
    await session.release();
  }
}
```

### Step 3: Test the IP Pool API

To verify the system is working correctly, run the test script:

```bash
node test-ip-pool-api.js
```

### Step 4: Run the Booking Script

With the IP Pool Server running, run the booking script:

```bash
node index_with_pool.js
```

## API Endpoints

The IP Pool Server provides the following endpoints:

- `GET /api/health` - Check if the server is running
- `GET /api/stats` - Get current pool statistics
- `GET /api/get-session` - Get an IP session from the pool
- `POST /api/release-session` - Release a session back to the pool
- `GET /api/refresh` - Manually trigger a pool refresh

## Benefits

- **Efficiency**: Reuses IP sessions across multiple booking processes
- **Speed**: Pre-warms connections to reduce booking time
- **Reliability**: Maintains a healthy pool by refreshing expired sessions
- **Scalability**: Can support multiple concurrent booking processes

## Troubleshooting

If you encounter issues:

1. Ensure the IP Pool Server is running (check with `curl http://localhost:3057/api/health`)
2. Verify your proxy configuration in `.env`
3. Check the server logs for any errors
4. If the pool isn't refreshing, try manually hitting the `/api/refresh` endpoint 
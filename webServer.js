const express = require('express');
const path = require('path');
const { runBooking } = require('./index');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Environment detection
const isProduction = process.env.NODE_ENV === 'production';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Booking endpoint
app.post('/api/book', async (req, res) => {
  // Define logs array at the start of the handler
  const logs = [];
  try {
    const { calendlyUrl, name, email, phone, useProxy } = req.body;
    
    if (!calendlyUrl || !name || !email || !phone) {
       // Log the error before returning
       logs.push('ERROR: Missing required fields.');
       console.error('Booking request failed: Missing required fields.');
       return res.status(400).json({ 
         success: false, 
         message: 'Missing required fields. Please provide calendlyUrl, name, email, and phone.',
         logs: logs // Send back logs captured so far
       });
    }
    
    // Define logCapture function to push to local logs array AND console.log
    const logCapture = (message) => {
      console.log(message); // Keep console logging for server visibility
      logs.push(message);
    };
    
    // Pass logCapture to runBooking
    logCapture(`Received booking request: Name=${name}, Email=${email}, URL=${calendlyUrl}`);
    const result = await runBooking(
      calendlyUrl,
      name,
      email,
      phone,
      useProxy,
      logCapture // Pass the function here
    );
    
    // Construct response using the detailed result object from runBooking
    if (result.success) {
        logCapture('runBooking reported success.'); // Log final status
        res.json({
          success: true,
          message: 'Booking process completed successfully.', // More specific success message
          duration: result.duration,
          browserTime: result.browserTime,
          navigationTime: result.navigationTime,
          formTime: result.bookingDuration, // Map bookingDuration to formTime for the frontend
          logs: logs // Send back all captured logs
        });
    } else {
        logCapture('runBooking reported failure.'); // Log final status
        res.status(500).json({ 
          success: false, 
          message: 'Booking process failed. Check logs for details.', // More specific failure message
          duration: result.duration,
          browserTime: result.browserTime,
          navigationTime: result.navigationTime,
          formTime: result.bookingDuration, // Map bookingDuration to formTime
          logs: logs // Send back logs captured, including error details from runBooking
        });
    }
    
  } catch (error) {
    // Catch unexpected errors in the endpoint handler itself
    const errorMessage = `Unexpected server error: ${error.message || error}`;
    console.error('Error in /api/book endpoint:', error);
    logs.push(`FATAL ERROR in /api/book: ${errorMessage}`); // Add fatal error to logs
    res.status(500).json({ 
      success: false, 
      message: 'An unexpected server error occurred.',
      // Include timings if the error happened after runBooking returned (less likely)
      duration: error.duration, 
      browserTime: error.browserTime,
      navigationTime: error.navigationTime,
      formTime: error.bookingDuration,
      logs: logs // Send back logs captured up to the fatal error
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
const express = require('express');
const path = require('path');
const { bookCalendlyWithParams } = require('./refined_index');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for JSON body parsing
app.use(express.json());
// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Booking endpoint
app.post('/api/book', async (req, res) => {
  try {
    // Get parameters from request body
    const { calendlyUrl, name, email, phone } = req.body;
    
    // Validate required fields
    if (!calendlyUrl || !name || !email || !phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields. Please provide calendlyUrl, name, email, and phone.'
      });
    }
    
    console.log('Received booking request:', { calendlyUrl, name, email });
    
    // Create log capture function
    const logs = [];
    const logCapture = (message) => {
      console.log(message);
      logs.push(message);
    };
    
    // Call the booking function with parameters
    const result = await bookCalendlyWithParams({
      calendlyUrl,
      name,
      email,
      phone,
      logCapture
    });
    
    // Return the result
    res.json({
      success: true,
      message: 'Booking completed',
      duration: result.duration,
      browserTime: result.browserTime,
      navigationTime: result.navigationTime,
      formTime: result.formTime,
      logs: logs
    });
    
  } catch (error) {
    console.error('Error processing booking:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'An unknown error occurred',
      logs: error.logs || []
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
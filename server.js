const express = require('express');
const path = require('path');
const { bookCalendlyWithParams } = require('./refined_index');
const { chromium } = require('playwright');

// Function to ensure browsers are installed
async function ensureBrowsersInstalled() {
  try {
    console.log('Checking for Playwright browser installation...');
    // Try launching browser to verify installation
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    console.log('Playwright browser already installed');
  } catch (error) {
    console.log('Installing Playwright browsers...');
    try {
      // If we're on a production server, we need to install browsers
      const { execSync } = require('child_process');
      execSync('npx playwright install chromium --with-deps', { stdio: 'inherit' });
      console.log('Playwright browsers installed successfully');
    } catch (installError) {
      console.error('Failed to install Playwright browsers:', installError);
    }
  }
}

// Initial browser installation check
ensureBrowsersInstalled();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for JSON body parsing
app.use(express.json());
// Serve static files
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
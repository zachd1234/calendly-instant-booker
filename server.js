const express = require('express');
const path = require('path');
// Import startSession from sessionManager (no init needed)
const { startSession, startPredictiveSession, activeSessions } = require('./sessionManager');
// Import bookSession from ISP_index instead of isp_dom_index
const { bookSession } = require('./ISP_index');
// Import bookSession from isp_dom_index AS bookSessionDom
const { bookSession: bookSessionDom } = require('./isp_dom_index');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Environment detection
// const isProduction = process.env.NODE_ENV === 'production'; // Keep if needed

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

// --- Endpoint for Starting a Session ---
app.post('/api/start-session', async (req, res) => {
    const logs = [];
    const logCapture = (message) => {
      console.log(message); // Keep console logging for server visibility
      logs.push(message);
    };

    try {
        const { baseUrl } = req.body;
        if (!baseUrl) {
             logCapture('ERROR: Missing baseUrl for start-session.');
             return res.status(400).json({ success: false, message: 'Missing required field: baseUrl', logs: logs });
        }
        logCapture(`Received startSession request (forced ZD proxy): BaseURL=${baseUrl}`);
        const result = await startSession(baseUrl, logCapture);

        if (result.success) {
            logCapture(`Session ${result.sessionId} started successfully in ${result.duration}s.`);
            res.json({
                success: true,
                sessionId: result.sessionId,
                duration: result.duration,
                message: `Session ${result.sessionId} started successfully.`,
                logs: logs
            });
        } else {
            logCapture(`Failed to start session. Error: ${result.error}. Duration: ${result.duration}s.`);
            res.status(500).json({
                success: false,
                message: `Failed to start session: ${result.error || 'Unknown error'}`,
                duration: result.duration,
                logs: logs
            });
        }
    } catch (error) {
        const errorMessage = `Unexpected server error during session start: ${error.message || error}`;
        logCapture(`FATAL ERROR in /api/start-session: ${errorMessage}`);
        console.error('Error in /api/start-session endpoint:', error);
        res.status(500).json({ success: false, message: 'An unexpected server error occurred during session start.', logs: logs });
    }
});

// --- Endpoint for Booking using a Session ---
app.post('/api/book-session', async (req, res) => {
    console.log(`Received /api/book-session request for Session ID: ${req.body.sessionId}`);
    const logs = []; // Create a log collector for this request
    const logCapture = (message) => {
      console.log(message); // Keep console logging for server visibility
      logs.push(message);
    };

    try {
        const { sessionId, fullBookingUrl, name, email, phone } = req.body;

        // --- ADD SERVER-SIDE VALIDATION ---
        const phoneRegex = /^\+\d{1,4}\s\d{7,}$/; // Same regex as frontend (or stricter)
        if (!sessionId || !fullBookingUrl || !name || !email || !phone || !phoneRegex.test(phone)) {
            let missingFields = [];
            if (!sessionId) missingFields.push('sessionId');
            if (!fullBookingUrl) missingFields.push('fullBookingUrl');
            if (!name) missingFields.push('name');
            if (!email) missingFields.push('email');
            if (!phone) missingFields.push('phone');
            let message = `Missing or invalid required fields: ${missingFields.join(', ')}.`;
            if (phone && !phoneRegex.test(phone)) {
                message += ' Phone format invalid (Expected: +1 123...).';
            }

            logCapture(`ERROR: Missing/Invalid required fields for book-session. Provided: ${JSON.stringify(req.body)}`);
            return res.status(400).json({
                success: false,
                message: message,
                logs: logs
            });
        }
        // --- END VALIDATION ---

        // Pass the validated data to bookSession
        const result = await bookSession(sessionId, fullBookingUrl, name, email, phone, logCapture);

        // We now have the logs collected in the `logs` array.
        // Include these logs in the response.
        if (result.success) {
             logCapture(`[${sessionId}] API reports booking successful in ${result.duration}s.`);
             res.json({ ...result, logs: logs }); // Add logs to successful response
        } else {
             logCapture(`[${sessionId}] API reports booking failed. Error: ${result.error}. Duration: ${result.duration}s.`);
             res.status(500).json({ ...result, logs: logs }); // Add logs to failure response
        }

    } catch (error) {
        // Catch totally unexpected errors in this endpoint handler
        const errorMessage = `Unexpected server error during session booking: ${error.message || error}`;
        logCapture(`FATAL ERROR in /api/book-session for session ${req.body.sessionId}: ${errorMessage}`); // Use logCapture
        console.error(`FATAL ERROR in /api/book-session for session ${req.body.sessionId}:`, error); // Keep console.error for critical issues
        res.status(500).json({
             success: false,
             message: 'An unexpected server error occurred during session booking.',
             sessionId: req.body.sessionId, // Include session ID if possible
             logs: logs // Include logs even in fatal error response
            });
    }
});

// --- Endpoint for Booking using a Session (DOM Version) ---
app.post('/api/book-session-dom', async (req, res) => {
    console.log(`Received /api/book-session-dom request for Session ID: ${req.body.sessionId}`);
    const logs = []; // Create a log collector for this request
    const logCapture = (message) => {
      console.log(message);
      logs.push(message);
    };

    try {
        const { sessionId, fullBookingUrl, name, email, phone } = req.body;

        // --- Re-use SERVER-SIDE VALIDATION ---
        const phoneRegex = /^\+\d{1,4}\s\d{7,}$/;
        if (!sessionId || !fullBookingUrl || !name || !email || !phone || !phoneRegex.test(phone)) {
            let missingFields = [];
            if (!sessionId) missingFields.push('sessionId');
            if (!fullBookingUrl) missingFields.push('fullBookingUrl');
            if (!name) missingFields.push('name');
            if (!email) missingFields.push('email');
            if (!phone) missingFields.push('phone');
            let message = `Missing or invalid required fields: ${missingFields.join(', ')}.`;
            if (phone && !phoneRegex.test(phone)) {
                message += ' Phone format invalid (Expected: +1 123...).';
            }

            logCapture(`ERROR: Missing/Invalid required fields for book-session-dom. Provided: ${JSON.stringify(req.body)}`);
            return res.status(400).json({
                success: false,
                message: message,
                logs: logs
            });
        }
        // --- END VALIDATION ---

        // Pass the validated data to bookSessionDom (from isp_dom_index.js)
        const result = await bookSessionDom(sessionId, fullBookingUrl, name, email, phone, logCapture);

        // Include logs in the response.
        if (result.success) {
             logCapture(`[${sessionId}] API reports booking (DOM) successful in ${result.duration}s.`);
             // Add potential new metrics like domNavigationTime if available
             res.json({ ...result, logs: logs });
        } else {
             logCapture(`[${sessionId}] API reports booking (DOM) failed. Error: ${result.error}. Duration: ${result.duration}s.`);
             res.status(500).json({ ...result, logs: logs });
        }

    } catch (error) {
        // Catch totally unexpected errors in this endpoint handler
        const errorMessage = `Unexpected server error during session booking (DOM): ${error.message || error}`;
        logCapture(`FATAL ERROR in /api/book-session-dom for session ${req.body.sessionId}: ${errorMessage}`);
        console.error(`FATAL ERROR in /api/book-session-dom for session ${req.body.sessionId}:`, error);
        res.status(500).json({
             success: false,
             message: 'An unexpected server error occurred during session booking (DOM).',
             sessionId: req.body.sessionId,
             logs: logs
            });
    }
});

// --- Endpoint for Starting a Predictive Session with Two Options ---
app.post('/api/start-predictive-session', async (req, res) => {
    console.log(`Received /api/start-predictive-session request`);
    const logs = [];
    const logCapture = (message) => {
      console.log(message);
      logs.push(message);
    };

    try {
        const { bookingUrl1, bookingUrl2, name, email, phone } = req.body;

        // --- Validate Inputs ---
        const phoneRegex = /^\+\d{1,4}\s\d{7,}$/;
        if (!bookingUrl1 || !bookingUrl2 || !name || !email || !phone || !phoneRegex.test(phone)) {
            let missingFields = [];
            if (!bookingUrl1) missingFields.push('bookingUrl1');
            if (!bookingUrl2) missingFields.push('bookingUrl2');
            if (!name) missingFields.push('name');
            if (!email) missingFields.push('email');
            if (!phone) missingFields.push('phone');
            let message = `Missing or invalid required fields: ${missingFields.join(', ')}.`;
            if (phone && !phoneRegex.test(phone)) {
                message += ' Phone format invalid (Expected: +1 123...).';
            }

            logCapture(`ERROR: Missing/Invalid required fields for predictive booking. Provided: ${JSON.stringify(req.body)}`);
            return res.status(400).json({
                success: false,
                message: message,
                logs: logs
            });
        }

        // Extract the base URL from the first booking URL
        // This assumes booking URLs are in the format: https://calendly.com/username/30min/YYYY-MM-DDTHH:mm:ss
        const baseUrlMatch = bookingUrl1.match(/(https:\/\/calendly\.com\/[^\/]+\/[^\/]+)\//);
        const baseUrl = baseUrlMatch ? baseUrlMatch[1] : null;
        
        if (!baseUrl) {
            logCapture(`ERROR: Could not extract base URL from booking URL: ${bookingUrl1}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid booking URL format. Could not extract base URL.',
                logs: logs
            });
        }

        // Call the new specialized startPredictiveSession method (to be implemented in sessionManager.js)
        logCapture(`Starting predictive session with two options...`);
        logCapture(`Base URL: ${baseUrl}`);
        logCapture(`Option 1: ${bookingUrl1}`);
        logCapture(`Option 2: ${bookingUrl2}`);
        logCapture(`Client: ${name}, ${email}, ${phone}`);

        // This will be implemented in the sessionManager.js
        const result = await startPredictiveSession(baseUrl, bookingUrl1, bookingUrl2, { name, email, phone }, logCapture);

        if (result.success) {
             logCapture(`Predictive session started successfully. Session IDs: ${result.sessionId1}, ${result.sessionId2}`);
             res.json({
                 success: true,
                 sessionId1: result.sessionId1,
                 sessionId2: result.sessionId2,
                 message: 'Successfully prepared both meeting options.',
                 logs: logs
             });
        } else {
             logCapture(`Failed to start predictive session. Error: ${result.error}`);
             res.status(500).json({
                 success: false,
                 message: `Failed to start predictive session: ${result.error || 'Unknown error'}`,
                 logs: logs
             });
        }
    } catch (error) {
        const errorMessage = `Unexpected server error during predictive session start: ${error.message || error}`;
        logCapture(`FATAL ERROR in /api/start-predictive-session: ${errorMessage}`);
        console.error('Error in /api/start-predictive-session endpoint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'An unexpected server error occurred during predictive session start.', 
            logs: logs 
        });
    }
});

// --- Endpoint for Completing a Predictive Booking by Selecting an Option ---
app.post('/api/complete-predictive-booking', async (req, res) => {
    console.log(`Received /api/complete-predictive-booking request`);
    const logs = [];
    const logCapture = (message) => {
        console.log(message);
        logs.push(message);
    };

    try {
        const { sessionId, selectedOption } = req.body;

        // Validate inputs
        if (!sessionId || (selectedOption !== 1 && selectedOption !== 2)) {
            const errorMsg = `Missing or invalid parameters. Required: sessionId and selectedOption (1 or 2).`;
            logCapture(`ERROR: ${errorMsg}`);
            return res.status(400).json({
                success: false,
                message: errorMsg,
                logs: logs
            });
        }

        // Get the session
        const session = activeSessions[sessionId];
        if (!session) {
            const errorMsg = `Session ${sessionId} not found or has expired.`;
            logCapture(`ERROR: ${errorMsg}`);
            return res.status(404).json({
                success: false,
                message: errorMsg,
                logs: logs
            });
        }

        // Check if this is part of a predictive session
        if (!session.masterSessionId) {
            const errorMsg = `Session ${sessionId} is not part of a predictive booking session.`;
            logCapture(`ERROR: ${errorMsg}`);
            return res.status(400).json({
                success: false,
                message: errorMsg,
                logs: logs
            });
        }

        // Check if the form is ready
        if (!session.formReady) {
            const errorMsg = `Form in session ${sessionId} is not ready for submission.`;
            logCapture(`ERROR: ${errorMsg}`);
            return res.status(400).json({
                success: false,
                message: errorMsg,
                logs: logs
            });
        }

        logCapture(`Completing predictive booking for session ${sessionId} (Option ${selectedOption})...`);
        
        // Import the new function for form submission
        const { completeBooking } = require('./services/completePredictiveBooking');
        
        // Submit the form that's already filled out
        const result = await completeBooking(session.page, logCapture);
        
        if (result.success) {
            logCapture(`Successfully completed booking in ${result.submissionTime.toFixed(2)}s.`);
            
            // Return the successful result
            res.json({
                success: true,
                message: `Successfully booked appointment for option ${selectedOption}.`,
                selectedOption,
                duration: result.submissionTime,
                weakConfirmation: result.weakConfirmation || false,
                logs: logs
            });
        } else {
            logCapture(`Failed to complete booking: ${result.error}`);
            
            // Return the error result
            res.status(500).json({
                success: false,
                message: `Failed to complete booking: ${result.error}`,
                selectedOption,
                duration: result.submissionTime,
                logs: logs
            });
        }

    } catch (error) {
        const errorMessage = `Unexpected server error during predictive booking completion: ${error.message || error}`;
        logCapture(`FATAL ERROR in /api/complete-predictive-booking: ${errorMessage}`);
        console.error('Error in /api/complete-predictive-booking endpoint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'An unexpected server error occurred during predictive booking completion.', 
            logs: logs 
        });
    }
});

// Start the server directly
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // console.log(`Open http://localhost:${PORT} in your browser`); // Optional
});
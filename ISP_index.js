// This file handles Step 2: Booking using an existing session.

require('dotenv').config(); // Still needed if bookingService uses env vars? Review dependencies.
const { bookMeeting } = require('./services/bookingService');
// Import activeSessions map from sessionManager to find and delete sessions
const { activeSessions } = require('./sessionManager');

// --- Step 2: Book Session Function ---
async function bookSession(sessionId, fullBookingUrl, name, email, phone, logCapture) {
    // Retrieve the session object WHICH MIGHT CONTAIN ITS OWN logCapture, but we prioritize the passed one
    const session = activeSessions[sessionId];

    // Now, 'logCapture' refers directly to the function passed in from server.js

    // Add a check log immediately using the passed-in logger
    if (!logCapture) {
        // Fallback if something went wrong and logCapture wasn't passed (shouldn't happen with current server.js)
        console.error(`[${sessionId}] CRITICAL: logCapture function was not provided to bookSession!`);
        logCapture = console.log; // Use console as a last resort
    }

    logCapture(`[${sessionId}] Executing bookSession in ISP_index.js.`);
    logCapture(`[${sessionId}] Received request details: URL=${fullBookingUrl}, Name=${name}, Email=${email}, Phone=${phone}`);

    const overallStartTime = Date.now();

    let navigationTime = 0;
    let bookingServiceDuration = 0;
    let stepSuccess = false;
    let bookingServiceResult = null; // Declared

    // 1. Validate Session
    logCapture(`[${sessionId}] Validating session...`);
    if (!session || !session.page || !session.browser) {
        const errorMsg = `Session ID ${sessionId} not found or session expired/invalid.`;
        logCapture(`[${sessionId}] ❌ ERROR: Session validation failed. ${errorMsg}`);
        if (activeSessions[sessionId]) {
            logCapture(`[${sessionId}] Removing potentially invalid session remnant from active map.`);
            delete activeSessions[sessionId];
        }
        // Ensure return value includes session ID even on early failure
        return { success: false, error: errorMsg, duration: 0, sessionId: sessionId };
    }
    logCapture(`[${sessionId}] Session validated successfully. Page and browser objects exist.`);

    const { page, browser } = session;

    try {
        // 2. Navigation using existing page
        const navigationStartTime = Date.now();
        logCapture(`[${sessionId}] Attempting navigation of existing page to: ${fullBookingUrl}`);
        await page.goto(fullBookingUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });
        navigationTime = (Date.now() - navigationStartTime) / 1000;
        logCapture(`[${sessionId}] Page navigation completed in ${navigationTime.toFixed(2)}s`);
        const pageTitle = await page.title().catch((err) => {
             logCapture(`[${sessionId}] WARN: Failed to get page title after navigation: ${err.message}`);
             return 'Error getting title';
        });
        logCapture(`[${sessionId}] Page title after navigation: ${pageTitle}`);

        // 3. Hand off to Booking Service
        logCapture(`[${sessionId}] Preparing to hand off to bookingService...`);
        const bookingStartTime = Date.now();
        bookingServiceResult = await bookMeeting(sessionId, page, name, email, phone, logCapture); // Add sessionId here
        bookingServiceDuration = (Date.now() - bookingStartTime) / 1000;
        logCapture(`[${sessionId}] bookingService call completed in ${bookingServiceDuration.toFixed(2)}s.`);

        // 4. Log Result from bookingService
        if (bookingServiceResult && bookingServiceResult.success) { // Check if result object exists
          logCapture(`[${sessionId}] ✅ bookingService reported SUCCESS.`);
          stepSuccess = true;
        } else {
          // Log the failure reason more clearly
          const serviceError = bookingServiceResult?.error || "Unknown booking service error";
          logCapture(`[${sessionId}] ❌ bookingService reported FAILURE. Reason: ${serviceError}`);
          // Log the full result object on failure for debugging (optional)
          // logCapture(`[${sessionId}] Full bookingServiceResult on failure: ${JSON.stringify(bookingServiceResult)}`);
          if (page && !page.isClosed()) { // Check page before screenshot
            logCapture(`[${sessionId}] Attempting screenshot on booking failure: session_book_failure_${sessionId}.png`);
            await page.screenshot({ path: `session_book_failure_${sessionId}.png` }).catch(e => logCapture(`[${sessionId}] ERROR: Failure screenshot failed: ${e.message}`));
          }
          stepSuccess = false;
        }

      } catch (error) {
        // Log errors caught within the try block (e.g., navigation failure)
        logCapture(`[${sessionId}] ❌ CAUGHT ERROR during booking execution: ${error.message || error}`);
        logCapture(`[${sessionId}] Error stack trace: ${error.stack}`); // Log stack trace
        stepSuccess = false;
        // Ensure bookingServiceResult has an error representation if the error happened before/during its call
        if (!bookingServiceResult) { bookingServiceResult = { error: `Caught error: ${error.message}` }; }
        if (page && !page.isClosed()) {
            logCapture(`[${sessionId}] Attempting screenshot on caught error: session_book_error_${sessionId}.png`);
            await page.screenshot({ path: `session_book_error_${sessionId}.png` }).catch(e => logCapture(`[${sessionId}] ERROR: Error screenshot failed: ${e.message}`));
        }
  } finally {
        // 5. Session Cleanup
        logCapture(`[${sessionId}] Entering finally block for cleanup...`);
        try {
            if (browser && typeof browser.close === 'function') { // Extra check for browser object and close method
                 logCapture(`[${sessionId}] Closing browser...`);
                 await browser.close();
                 logCapture(`[${sessionId}] Browser closed successfully.`);
            } else {
                 logCapture(`[${sessionId}] WARN: Browser object was missing or invalid during cleanup.`);
            }
        } catch (closeError) {
            logCapture(`[${sessionId}] ❌ ERROR during browser close: ${closeError.message}`);
        } finally {
            // Always remove from active sessions map
            if (activeSessions[sessionId]) {
                 logCapture(`[${sessionId}] Removing session from active map.`);
                 delete activeSessions[sessionId];
                 logCapture(`[${sessionId}] Session removed from active map.`);
            } else {
                logCapture(`[${sessionId}] Session already removed from active map or never added correctly.`);
            }
        }
        logCapture(`[${sessionId}] Finished finally block.`);
    }

    // 6. Final Logging and Return
    const overallDuration = (Date.now() - overallStartTime) / 1000;
    logCapture(`[${sessionId}] bookSession (ISP_index.js) finished. Overall duration: ${overallDuration.toFixed(2)}s. Final Result: ${stepSuccess ? 'Success' : 'Failure'}`);

    // Restructure the return object to match frontend expectations
    return {
        success: stepSuccess,
        sessionId: sessionId,
        duration: parseFloat(overallDuration.toFixed(2)), // Overall total time
        // Add the nested metrics object
        metrics: {
            browserTime: undefined, // This isn't calculated in bookSession, set to undefined or null
            navigationTime: parseFloat(navigationTime.toFixed(2)), // Use the calculated navigation time
            formTime: parseFloat(bookingServiceDuration.toFixed(2)) // Map bookingServiceDuration to formTime
        },
        error: stepSuccess ? undefined : (bookingServiceResult?.error || "Booking step failed in ISP_index"),
        // Keep logs at the top level as server.js expects it there to merge
        // logs: logCapture.getLogs ? logCapture.getLogs() : [] // Only if logCapture had a method to retrieve logs
    };
}

// Export only the booking function for the two-step process
module.exports = { bookSession };
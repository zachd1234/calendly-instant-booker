// This file handles Step 2: Booking using an existing session.

require('dotenv').config(); // Still needed if bookingService uses env vars? Review dependencies.
const { bookMeeting } = require('./services/bookingService');
// Import activeSessions map from sessionManager to find and delete sessions
const { activeSessions } = require('./sessionManager');

// --- Step 2: Book Session Function ---
async function bookSession(sessionId, fullBookingUrl, name, email, phone) {
    // Retrieve the session - including the logCapture function stored during startSession
    const session = activeSessions[sessionId];

    // Use the logCapture associated with this specific session, default to console.log if missing
    const logCapture = session?.logCapture || console.log;

    logCapture(`[${sessionId}] Received request to book session.`);
    logCapture(`[${sessionId}] Booking URL: ${fullBookingUrl}`);
    logCapture(`[${sessionId}] Details: Name=${name}, Email=${email}, Phone=${phone}`);
    const overallStartTime = Date.now(); // Timer for this step

    let navigationTime = 0;
    let bookingServiceDuration = 0;
    let stepSuccess = false; // Track success of this step specifically

    // Check if the session exists
    if (!session || !session.page || !session.browser) {
        const errorMsg = `Session ID ${sessionId} not found or session expired/invalid.`;
        logCapture(`[${sessionId}] ❌ ERROR: ${errorMsg}`);
        // Ensure session is removed if partially invalid
        if (activeSessions[sessionId]) delete activeSessions[sessionId];
        return { success: false, error: errorMsg, duration: 0, sessionId: sessionId };
    }

    const { page, browser } = session; // Extract page and browser from the session

    try {
        // --- Navigation using existing page ---
        const navigationStartTime = Date.now();
        logCapture(`[${sessionId}] Navigating warmed page to specific booking URL: ${fullBookingUrl}`);
        await page.goto(fullBookingUrl, {
          waitUntil: 'domcontentloaded', // Should be faster now
          timeout: 45000 // Keep a reasonable timeout
        });
        navigationTime = (Date.now() - navigationStartTime) / 1000;
        logCapture(`[${sessionId}] Navigated to booking page in ${navigationTime.toFixed(2)}s`);
        logCapture(`[${sessionId}] Page title: ${await page.title().catch(() => 'Error getting title')}`);

        // --- Hand off to Booking Service using existing page ---
        logCapture(`[${sessionId}] Handing off to bookingService...`);
        const bookingStartTime = Date.now();

        // Call the imported bookingService function with the existing page
        const bookingServiceResult = await bookMeeting(page, name, email, phone, logCapture);

        bookingServiceDuration = (Date.now() - bookingStartTime) / 1000;

        // --- Log Result from bookingService ---
        if (bookingServiceResult.success) {
          logCapture(`[${sessionId}] ✅ bookingService reported SUCCESS in ${bookingServiceDuration.toFixed(2)}s.`);
          stepSuccess = true; // Mark this step as successful
        } else {
          logCapture(`[${sessionId}] ❌ bookingService reported FAILURE in ${bookingServiceDuration.toFixed(2)}s. Error: ${bookingServiceResult.error}`);
          // bookingService might take screenshots, or we could take one here
          if (!page.isClosed()) {
            await page.screenshot({ path: `session_book_failure_${sessionId}.png` }).catch(e => logCapture(`[${sessionId}] ERROR: Failure screenshot failed: ${e.message}`));
          }
          stepSuccess = false;
        }

      } catch (error) {
        logCapture(`[${sessionId}] ❌ Error during session booking execution: ${error}`);
        stepSuccess = false;
        if (page && !page.isClosed()) {
            await page.screenshot({ path: `session_book_error_${sessionId}.png` }).catch(e => logCapture(`[${sessionId}] ERROR: Error screenshot failed: ${e.message}`));
        }
        // Need to ensure cleanup happens even if error occurs mid-way
  } finally {
        // --- Session Cleanup ---
        // Always close the browser and remove the session after attempting the booking
        logCapture(`[${sessionId}] Booking attempt finished. Closing browser and removing session...`);
        try {
    if (browser) {
                 await browser.close();
                 logCapture(`[${sessionId}] Browser closed.`);
    } else {
                 logCapture(`[${sessionId}] Browser object was missing, cannot close.`);
            }
        } catch (closeError) {
            logCapture(`[${sessionId}] ❌ ERROR closing browser: ${closeError.message}`);
        } finally {
            // Always remove from active sessions map
            if (activeSessions[sessionId]) {
                 delete activeSessions[sessionId];
                 logCapture(`[${sessionId}] Session removed from active map.`);
            }
        }
    }

    const overallDuration = (Date.now() - overallStartTime) / 1000;
    logCapture(`[${sessionId}] bookSession step completed in ${overallDuration.toFixed(2)} seconds. Result: ${stepSuccess ? 'Success' : 'Failure'}`);

    // Return detailed result object for this step
  return {
        success: stepSuccess,
        sessionId: sessionId, // Include sessionId in response
      duration: parseFloat(overallDuration.toFixed(2)),
      navigationTime: parseFloat(navigationTime.toFixed(2)),
        bookingServiceDuration: parseFloat(bookingServiceDuration.toFixed(2)), // Time spent *only* in bookingService
        // Include specific error message if booking failed
        error: stepSuccess ? undefined : (bookingServiceResult?.error || "Booking step failed")
    };
}

// Export only the booking function for the two-step process
module.exports = { bookSession };
// This file handles Step 2: Booking using an existing session.
//
// LOCATION-BASED ISSUES:
// This implementation addresses timeout issues that occur in certain geographic locations
// by standardizing browser identification through user agent and other browser properties.
//
// Key improvements:
// - Standardized User-Agent for consistent browser identification
// - Browser fingerprint normalization
// - Improved navigation retry logic with multiple strategies
// - Enhanced error diagnostics with location awareness

require('dotenv').config(); // Still needed if bookingService uses env vars? Review dependencies.
const { bookMeeting } = require('./services/bookingService');
// Import activeSessions map from sessionManager to find and delete sessions
const { activeSessions } = require('./sessionManager');
// Import devices for browser emulation
const { devices } = require('playwright');

/**
 * Standardizes the browser profile to ensure consistent Calendly access
 * @param {Page} page - Playwright page object
 * @param {string} sessionId - Session ID for logging
 * @param {Function} logCapture - Logging function
 */
async function standardizeBrowserProfile(page, sessionId, logCapture) {
    logCapture(`[${sessionId}] Standardizing browser profile to bypass geographic restrictions...`);
    
    try {
        // 1. Use a consistent user agent (Chrome on Mac - widely accepted)
        const standardUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        
        // Get the browser context from the page
        const context = page.context();
        
        // Use context.setExtraHTTPHeaders instead of page.setUserAgent
        await context.setExtraHTTPHeaders({
            'User-Agent': standardUserAgent
        });
        
        logCapture(`[${sessionId}] Set User-Agent via HTTP headers: ${standardUserAgent}`);
        
        // 2. Set standard viewport dimensions
        await page.setViewportSize({ width: 1280, height: 800 });
        
        // 3. Set timezone to US/Pacific (LA) regardless of actual location
        await page.evaluate(() => {
            Object.defineProperty(Intl, 'DateTimeFormat', {
                writable: true,
                configurable: true
            });
            const originalDateTimeFormat = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function(...args) {
                if (args.length > 0 && args[1] && args[1].timeZone) {
                    args[1].timeZone = 'America/Los_Angeles';
                }
                return new originalDateTimeFormat(...args);
            };
            Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;
        });
        
        // 4. Set standard language
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'language', {
                get: function() { return 'en-US'; }
            });
            Object.defineProperty(navigator, 'languages', {
                get: function() { return ['en-US', 'en']; }
            });
        });
        
        // 5. Also override navigator.userAgent in the page context
        await page.evaluate((ua) => {
            Object.defineProperty(navigator, 'userAgent', {
                get: function() { return ua; }
            });
        }, standardUserAgent);
        
        // 6. Log the standardized profile
        const currentUserAgent = await page.evaluate(() => navigator.userAgent);
        logCapture(`[${sessionId}] Browser profile standardized to:`);
        logCapture(`[${sessionId}] - User-Agent: ${currentUserAgent}`);
        logCapture(`[${sessionId}] - Viewport: 1280x800`);
        logCapture(`[${sessionId}] - Timezone: America/Los_Angeles (LA)`);
        logCapture(`[${sessionId}] - Language: en-US`);
        
        return true;
    } catch (error) {
        logCapture(`[${sessionId}] ⚠️ Error standardizing browser profile: ${error.message}`);
        return false;
    }
}

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
        // Apply browser profile standardization
        await standardizeBrowserProfile(page, sessionId, logCapture);
        
        // 2. Navigation using existing page with retry logic
        const navigationStartTime = Date.now();
        logCapture(`[${sessionId}] Attempting navigation of existing page to: ${fullBookingUrl}`);
        
        // Define retry parameters
        const maxRetries = 3;
        let navigationSucceeded = false;
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Increase timeout with each retry
                const attemptTimeout = 30000 + ((attempt - 1) * 15000); // 30s, 45s, 60s
                
                // Use different loading strategies for different attempts
                let waitUntilStrategy;
                if (attempt === 1) {
                    waitUntilStrategy = 'domcontentloaded'; // Fastest, try first
                } else if (attempt === 2) {
                    waitUntilStrategy = 'load'; // More complete, try second
                } else {
                    waitUntilStrategy = 'networkidle'; // Most thorough but slowest
                }
                
                logCapture(`[${sessionId}] Navigation attempt ${attempt}/${maxRetries} with ${attemptTimeout}ms timeout and '${waitUntilStrategy}' strategy...`);
                await page.goto(fullBookingUrl, {
                    waitUntil: waitUntilStrategy,
                    timeout: attemptTimeout
                });
                
                // If we get here, navigation succeeded
                navigationSucceeded = true;
                logCapture(`[${sessionId}] ✅ Page navigation succeeded on attempt ${attempt} using '${waitUntilStrategy}' strategy`);
                
                // Since navigation succeeded, double-check the user agent is still set correctly
                // Sometimes navigation can reset browser properties
                const currentUserAgent = await page.evaluate(() => navigator.userAgent);
                if (!currentUserAgent.includes('Mac OS X 10_15')) {
                    logCapture(`[${sessionId}] ⚠️ User-Agent changed after navigation. Re-standardizing browser profile...`);
                    await standardizeBrowserProfile(page, sessionId, logCapture);
                }
                
                break;
            } catch (navError) {
                lastError = navError;
                logCapture(`[${sessionId}] ⚠️ Navigation attempt ${attempt}/${maxRetries} failed: ${navError.message}`);
                
                if (attempt < maxRetries) {
                    // Only wait between retries, not after the last attempt
                    const waitTime = 2000; // 2 second pause between retries
                    logCapture(`[${sessionId}] Waiting ${waitTime}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    
                    // Re-standardize browser profile before next attempt
                    logCapture(`[${sessionId}] Re-standardizing browser profile before next attempt...`);
                    await standardizeBrowserProfile(page, sessionId, logCapture);
                }
            }
        }
        
        // If all navigation attempts failed, perform diagnostics and throw error
        if (!navigationSucceeded) {
            logCapture(`[${sessionId}] All ${maxRetries} navigation attempts failed. Performing diagnostics...`);
            
            // Check location information to provide better error context
            try {
                await page.goto('https://ipinfo.io/json', { waitUntil: 'domcontentloaded', timeout: 10000 });
                const locationData = await page.evaluate(() => {
                    try {
                        return JSON.parse(document.querySelector('pre').textContent);
                    } catch (e) {
                        return { error: e.message };
                    }
                });
                
                if (locationData && locationData.city) {
                    const isSanFrancisco = locationData.city === 'San Francisco' || 
                        (locationData.region === 'California' && locationData.loc?.startsWith('37.7'));
                    
                    logCapture(`[${sessionId}] Location detected: ${locationData.city}, ${locationData.region}`);
                    logCapture(`[${sessionId}] IP: ${locationData.ip}, ISP: ${locationData.org || 'Unknown'}`);
                    
                    if (isSanFrancisco) {
                        throw new Error(`Navigation failed due to San Francisco IP restrictions. Calendly appears to be timing out requests from this region. Try using LA VPN. Last error: ${lastError.message}`);
                    }
                }
            } catch (diagError) {
                if (diagError.message.includes('San Francisco IP restrictions')) {
                    throw diagError; // Re-throw the specific error
                }
                logCapture(`[${sessionId}] Error during location diagnostics: ${diagError.message}`);
            }
            
            // If we get here, throw the generic error
            throw new Error(`All ${maxRetries} navigation attempts failed. Last error: ${lastError.message}`);
        }
        
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
        bookingServiceResult = await bookMeeting(page, name, email, phone);
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
                 // Remove the 5-second delay before closing
                 // logCapture(`[${sessionId}] Waiting 5 seconds before closing browser...`);
                 // await new Promise(resolve => setTimeout(resolve, 5000)); // Remove delay back
                 // Alternatively, if page object is reliably available here, could use: await page.waitForTimeout(5000);

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
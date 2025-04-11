require('dotenv').config(); // Still needed if bookingService uses env vars? Review dependencies.
const { bookMeeting } = require('./services/bookingService');
// Import activeSessions map from sessionManager to find and delete sessions
const { activeSessions } = require('./sessionManager');
// Import devices for browser emulation
const { devices } = require('playwright');
// Import standardizeBrowserProfile from browserUtils
const { standardizeBrowserProfile } = require('./utils/browserUtils');

/**
 * Standardizes the browser profile to ensure consistent Calendly access
 * @param {Page} page - Playwright page object
 * @param {string} sessionId - Session ID for logging
 * @param {Function} logCapture - Logging function
 */
// --- Helper: Parse Date/Time from Calendly URL ---
function parseCalendlyUrl(url) {
    try {
        // Example: https://calendly.com/user/event/YYYY-MM-DDTHH:mm:ss-ZZ:ZZ
        // Extract the date/time part with timezone: YYYY-MM-DDTHH:mm:ss-ZZ:ZZ
        const dateTimeString = url.split('/').pop().split('?')[0]; // Get last part, remove query params
        
        // Extract the timezone offset from the URL
        let timezoneOffset = "";
        const timezoneMatch = dateTimeString.match(/([+-]\d{2}:\d{2})$/);
        if (timezoneMatch) {
            timezoneOffset = timezoneMatch[1];
            console.log(`Detected timezone offset in URL: ${timezoneOffset}`);
        } else {
            console.log(`No timezone offset detected in URL, using local timezone`);
        }
        
        // Create a date object that correctly interprets the timezone in the URL
        const date = new Date(dateTimeString);

        if (isNaN(date)) {
            throw new Error('Invalid date format in URL');
        }

        // Extract date components directly from the date object
        // (Date constructor already handles the timezone correctly)
        const year = date.getFullYear();
        const month = date.getMonth(); // 0-indexed (0 = Jan, 1 = Feb, ...)
        const day = date.getDate();
        let hours = date.getHours(); // 24-hour format
        const minutes = date.getMinutes();

        // Convert to am/pm format used in data-start-time
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        const minutesStr = minutes < 10 ? '0' + minutes : minutes;
        const timeString = `${hours}:${minutesStr}${ampm}`; // e.g., "9:00am", "2:30pm"

        // For logging, display both the original time and the local display time
        const localTimeString = date.toLocaleTimeString();
        
        console.log(`Parsed Calendly URL: ${url}`);
        console.log(`Original datetime: ${dateTimeString} with offset ${timezoneOffset}`);
        console.log(`Time for selection: ${timeString}`);
        
        // Include the timezone offset in the returned object for reference
        return { year, month, day, timeString, timezoneOffset };
    } catch (e) {
        console.error(`Error parsing Calendly URL ${url}: ${e.message}`);
        return null;
    }
}

// --- Step 2: Book Session Function (DOM Navigation - Calculated Month Clicks) ---
async function bookSession(sessionId, fullBookingUrl, name, email, phone, logCapture) {
    const session = activeSessions[sessionId]; // Re-enable this line to get the session object
    // Remove the internal logCapture definition, use the passed-in one.
    // const logCapture = session?.logCapture || console.log;

    logCapture(`[${sessionId}] Received request to book session (DOM Navigation - Calculated).`);
    logCapture(`[${sessionId}] Target URL: ${fullBookingUrl}`);
    logCapture(`[${sessionId}] Details: Name=${name}, Email=${email}, Phone=${phone}`);
    const overallStartTime = Date.now();

    let bookingServiceDuration = 0;
    let stepSuccess = false;
    let error = null; // To store error from catch block
    let bookingServiceResult = null; // To store booking result

    // 1. Validate Session
    if (!session || !session.page || !session.browser) {
        const errorMsg = `Session ID ${sessionId} not found or session expired/invalid.`;
        logCapture(`[${sessionId}] ❌ ERROR: ${errorMsg}`);
        if (activeSessions[sessionId]) delete activeSessions[sessionId];
        return { success: false, error: errorMsg, duration: 0, sessionId: sessionId };
    }
    const { page, browser } = session;

    // Apply browser profile standardization - ONLY if the page is not already navigating to a calendar
    logCapture(`[${sessionId}] Ensuring browser standardization is consistent...`);
    await standardizeBrowserProfile(page, sessionId, logCapture);

    // 2. Parse Target Date/Time
    const targetDate = parseCalendlyUrl(fullBookingUrl);
    if (!targetDate) {
        const errorMsg = `Could not parse date/time from booking URL: ${fullBookingUrl}`;
        logCapture(`[${sessionId}] ❌ ERROR: ${errorMsg}`);
        // Don't close browser here, let finally block handle it
        return { success: false, error: errorMsg, duration: 0, sessionId: sessionId };
    }
    
    logCapture(`[${sessionId}] Target parsed: Month=${targetDate.month}, Day=${targetDate.day}, Year=${targetDate.year}, Time=${targetDate.timeString}`);

    // *** MOVED: Robust Cookie Check happens early ***
    try {
        logCapture(`[${sessionId}] Checking for cookie consent banner before calendar interaction...`);
        const cookieSelector = '#onetrust-accept-btn-handler';
        const cookieButton = await page.waitForSelector(cookieSelector, { timeout: 3000, state: 'visible' }).catch(() => null);
        if (cookieButton) {
            logCapture(`[${sessionId}] Found cookie button, clicking...`);
            await cookieButton.click({ force: true, timeout: 2000 }).catch(e => logCapture(`[${sessionId}] WARN: Cookie click failed: ${e.message}`));
            await page.waitForTimeout(500);
            logCapture(`[${sessionId}] Cookie button clicked.`);
        } else {
            logCapture(`[${sessionId}] No cookie button found within 3 seconds.`);
        }
    } catch (e) {
         logCapture(`[${sessionId}] WARN: Cookie consent check failed: ${e.message}`);
    }
    // *** END OF MOVED COOKIE CHECK ***

    try {
        // Remove the location diagnostics that navigates away from Calendly
        logCapture(`[${sessionId}] Starting booking process on Calendly URL: ${fullBookingUrl}`);

        // --- DOM Navigation Steps ---
        const navigationStartTime = Date.now(); // Timer for DOM nav part

        // 3. Calculate Month Difference and Navigate
        const now = new Date();
        const currentMonth = now.getMonth(); // 0-indexed
        const currentYear = now.getFullYear();

        const monthDifference = (targetDate.year - currentYear) * 12 + (targetDate.month - currentMonth);

        logCapture(`[${sessionId}] Current month/year: ${currentMonth + 1}/${currentYear}. Target month/year: ${targetDate.month + 1}/${targetDate.year}. Difference: ${monthDifference} months.`);

        if (monthDifference < 0) {
            // Target month is in the past relative to the current real month
            logCapture(`[${sessionId}] ❌ ERROR: Target date (${targetDate.month + 1}/${targetDate.year}) is in the past relative to the current date (${currentMonth + 1}/${currentYear}). Cannot navigate backwards.`);
            throw new Error("Target date is in the past.");
        } else if (monthDifference === 0) {
            // Target month is the current month
            logCapture(`[${sessionId}] Target month is the current month. No month navigation needed.`);
        } else {
            // Target month is in the future, click 'Next Month' button 'monthDifference' times
            logCapture(`[${sessionId}] Navigating forward ${monthDifference} months...`);
            const nextMonthButtonSelector = 'button[aria-label="Go to next month"]';
            
            for (let i = 0; i < monthDifference; i++) {
                try {
                    await page.waitForSelector(nextMonthButtonSelector, { timeout: 5000, state: 'visible' });
                    await page.click(nextMonthButtonSelector);
                    logCapture(`[${sessionId}] Clicked next month button (${i + 1}/${monthDifference}).`);
                    await page.waitForTimeout(250);
                } catch (e) {
                    logCapture(`[${sessionId}] ❌ ERROR clicking next month button on click #${i + 1}: ${e.message}`);
                    // On failure, check if browser standardization is still intact
                    const currentUserAgent = await page.evaluate(() => navigator.userAgent).catch(() => 'unknown');
                    if (!currentUserAgent.includes('Mac OS X 10_15')) {
                        logCapture(`[${sessionId}] User agent has changed, re-standardizing before retry...`);
                        await standardizeBrowserProfile(page, sessionId, logCapture);
                        await page.waitForTimeout(1000); // Extra wait for standardization to take effect
                        // Try again after standardization
                        await page.waitForSelector(nextMonthButtonSelector, { timeout: 5000, state: 'visible' });
                        await page.click(nextMonthButtonSelector);
                        logCapture(`[${sessionId}] Retry succeeded after re-standardization.`);
                    } else {
                        throw new Error(`Failed during month navigation on click ${i + 1}.`);
                    }
                }
            }
            logCapture(`[${sessionId}] Finished navigating forward ${monthDifference} months.`);
            await page.waitForTimeout(500);
        }

        // Now we assume the calendar is showing the correct target month and year

        // 4. Select Day
        logCapture(`[${sessionId}] Selecting day: ${targetDate.day}`);
        const targetJsDate = new Date(targetDate.year, targetDate.month, targetDate.day);
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        // Try multiple selector strategies for the day button
        const daySelectors = [
            // Strategy 1: Standard specific day selector
            `button[aria-label*="${monthNames[targetDate.month]} ${targetDate.day}"]`,
            
            // Strategy 2: More general day selector (any button containing the day number)
            `button[aria-label*=" ${targetDate.day} "], button[aria-label*=" ${targetDate.day},"]`,
            
            // Strategy 3: By text content of the button
            `button:has-text("${targetDate.day}")`
        ];
        
        logCapture(`[${sessionId}] Trying multiple day selector strategies...`);
        let dayButton = null;
        let usedSelector = '';
        
        for (let i = 0; i < daySelectors.length; i++) {
            try {
                logCapture(`[${sessionId}] Trying day selector strategy ${i+1}: ${daySelectors[i]}`);
                // First check if selector exists
                const exists = await page.$(daySelectors[i]);
                
                if (exists) {
                    logCapture(`[${sessionId}] ✅ Found day using selector strategy ${i+1}`);
                    dayButton = await page.waitForSelector(daySelectors[i], { 
                        timeout: 5000, 
                        state: 'attached' 
                    });
                    usedSelector = daySelectors[i];
                    break;
                } else {
                    logCapture(`[${sessionId}] ❌ Day not found with selector strategy ${i+1}`);
                }
            } catch (e) {
                logCapture(`[${sessionId}] ❌ Error with day selector strategy ${i+1}: ${e.message}`);
            }
        }
        
        
        // Now check if it's disabled
        try {
            const isDisabled = await dayButton.isDisabled();
            if (isDisabled) {
                logCapture(`[${sessionId}] ❌ ERROR: Day ${targetDate.day} (${monthNames[targetDate.month]}) button found but is disabled (unavailable).`);
                throw new Error(`Day ${targetDate.day} (${monthNames[targetDate.month]}) is unavailable.`);
            }

            // If not disabled, proceed to click
            logCapture(`[${sessionId}] Day ${targetDate.day} button found and is enabled using selector: ${usedSelector}. Clicking...`);
            await dayButton.click(); // Click the located button element
            logCapture(`[${sessionId}] Clicked day ${targetDate.day}.`);
            
            await page.waitForTimeout(1000); // Longer wait after day click
        } catch (e) {
            // Catch errors from isDisabled check/click
            logCapture(`[${sessionId}] ❌ ERROR with day button: ${e.message}`);
            // Keep screenshot on error
            if (page && !page.isClosed()) {
                await page.screenshot({ path: `session_day_click_error_${sessionId}.png` });
            }
            throw new Error(`Error with day button: ${e.message}`);
        }

        // 5. Select Time
        logCapture(`[${sessionId}] Selecting time: ${targetDate.timeString}`);
        
        // Wait for the times to load after clicking day
        try {
            await page.waitForSelector('button[data-container="time-button"]', { timeout: 10000 });
            logCapture(`[${sessionId}] ✅ Time buttons found`);
            
            
            // Log all available times for debugging
            const timeButtons = await page.$$('button[data-container="time-button"]');
            const availableTimes = [];
            
            for (const btn of timeButtons) {
                const startTime = await btn.getAttribute('data-start-time').catch(() => null);
                if (startTime) {
                    availableTimes.push(startTime);
                }
            }
            
            logCapture(`[${sessionId}] Available times: ${availableTimes.join(', ')}`);
            
            // Check if our target time is in the available times
            if (!availableTimes.includes(targetDate.timeString)) {
                logCapture(`[${sessionId}] ⚠️ WARNING: Target time ${targetDate.timeString} not found in available times`);
            }
        } catch (e) {
            logCapture(`[${sessionId}] ❌ ERROR: Failed to find any time buttons: ${e.message}`);
            await page.screenshot({ path: `session_no_time_buttons_${sessionId}.png` });
        }
        
        // Try multiple selectors for the time button
        const timeSelectors = [
            // Primary selector with exact data-start-time
            `button[data-container="time-button"][data-start-time="${targetDate.timeString}"]`,
            
            // Alternative selector using text content
            `button[data-container="time-button"]:has-text("${targetDate.timeString}")`,
            
            // Fallback to any time button if specific time not found
            `button[data-container="time-button"]`
        ];
        
        let timeButton = null;
        let usedTimeSelector = '';
        let usedFallbackTime = false;
        
        for (let i = 0; i < timeSelectors.length; i++) {
            try {
                logCapture(`[${sessionId}] Trying time selector strategy ${i+1}: ${timeSelectors[i]}`);
                timeButton = await page.waitForSelector(timeSelectors[i], { timeout: 5000 });
                
                if (timeButton) {
                    usedTimeSelector = timeSelectors[i];
                    
                    // Check if we're using the fallback (any time) selector
                    if (i === 2) {
                        const fallbackTime = await timeButton.getAttribute('data-start-time');
                        logCapture(`[${sessionId}] ⚠️ Using fallback time: ${fallbackTime} instead of target: ${targetDate.timeString}`);
                        usedFallbackTime = true;
                    }
                    
                    logCapture(`[${sessionId}] ✅ Found time using selector strategy ${i+1}`);
                    break;
                }
            } catch (e) {
                logCapture(`[${sessionId}] Time selector strategy ${i+1} failed: ${e.message}`);
            }
        }
        
        if (!timeButton) {
            await page.screenshot({ path: `session_time_not_found_${sessionId}.png` });
            logCapture(`[${sessionId}] ❌ ERROR: Could not find time ${targetDate.timeString} with any selector strategy`);
            throw new Error(`Time ${targetDate.timeString} not found with any selector strategy`);
        }
        
        // Click the time button
        try {
            await timeButton.click();
            if (usedFallbackTime) {
                logCapture(`[${sessionId}] Clicked fallback time instead of ${targetDate.timeString}.`);
            } else {
                logCapture(`[${sessionId}] Clicked time ${targetDate.timeString}.`);
            }
            
            await page.waitForTimeout(1000); // Longer wait after time click
        } catch (e) {
            logCapture(`[${sessionId}] ❌ ERROR clicking time button: ${e.message}`);
            await page.screenshot({ path: `session_time_click_error_${sessionId}.png` });
            throw new Error(`Failed to click time button: ${e.message}`);
        }

        // 6. Click Next Button
        logCapture(`[${sessionId}] Clicking 'Next' button...`);
        const nextButtonSelector = 'button:has-text("Next")';
        try {
            await page.waitForSelector(nextButtonSelector, { timeout: 5000 });
            await page.click(nextButtonSelector);
            logCapture(`[${sessionId}] Clicked 'Next'. Waiting for form page navigation...`);
            await page.waitForSelector('#email_input', { timeout: 15000 });
            logCapture(`[${sessionId}] Form page loaded.`);
        } catch (e) {
            logCapture(`[${sessionId}] ❌ ERROR clicking 'Next' button or waiting for form page: ${e.message}`);
            await page.screenshot({ path: `session_next_click_error_${sessionId}.png` }).catch(err => logCapture(`[${sessionId}] ERROR: Next click error screenshot failed: ${err.message}`));
            throw new Error("Failed to click 'Next' or load form page.");
        }

        const domNavigationTime = (Date.now() - navigationStartTime) / 1000;
        logCapture(`[${sessionId}] DOM Navigation to form page completed in ${domNavigationTime.toFixed(2)}s`);

        // At the end before the booking service handoff - no need to re-standardize
        // Just log that we're proceeding with the same standardized profile
        logCapture(`[${sessionId}] Continuing with standardized browser profile for form submission...`);

        // --- Hand off to Booking Service ---
        logCapture(`[${sessionId}] Handing off to bookingService...`);
        const bookingStartTime = Date.now();
        bookingServiceResult = await bookMeeting(page, name, email, phone, logCapture);
        bookingServiceDuration = (Date.now() - bookingStartTime) / 1000;

        if (bookingServiceResult.success) {
            logCapture(`[${sessionId}] ✅ bookingService reported SUCCESS in ${bookingServiceDuration.toFixed(2)}s.`);
            stepSuccess = true;
            // Calculate overall duration here rather than just using bookingServiceDuration
            const overallDuration = (Date.now() - overallStartTime) / 1000;
            return { 
                success: true, 
                error: null, 
                duration: parseFloat(overallDuration.toFixed(2)), 
                formDuration: parseFloat(bookingServiceDuration.toFixed(2)),
                domNavigationTime: parseFloat(domNavigationTime.toFixed(2)),
                sessionId: sessionId 
            };
        } else {
            logCapture(`[${sessionId}] ❌ bookingService reported FAILURE in ${bookingServiceDuration.toFixed(2)}s. Error: ${bookingServiceResult.error}`);
            stepSuccess = false;
            // Let finally block handle screenshots if needed on general failure
        }

    } catch (e) { // Catch errors from DOM nav or bookingService call
        error = e; // Store error object
        logCapture(`[${sessionId}] ❌ Error during DOM navigation or booking execution: ${error.message}`);
        stepSuccess = false;
        if (page && !page.isClosed()) {
            // Ensure screenshot call is correct
            await page.screenshot({ path: `session_book_dom_error_${sessionId}.png` }).catch(err => logCapture(`[${sessionId}] ERROR: DOM error screenshot failed: ${err.message}`));
        }
    } finally {
        // --- Session Cleanup (Simplified: Just close browser) ---
        try {
            // First, remove all route handlers to prevent errors during browser closure
            if (page && !page.isClosed()) {
                logCapture(`[${sessionId}] Removing route handlers before closing browser...`);
                await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(e => {
                    logCapture(`[${sessionId}] Non-critical error unrouting: ${e.message}`);
                });
            }
            
            logCapture(`[${sessionId}] Booking attempt finished. Closing browser and removing session...`);
            const sessionForCleanup = activeSessions[sessionId]; // Get session to access browser
            const browserForCleanup = sessionForCleanup?.browser;

            // Close the browser instance used by this session
            try {
                if (browserForCleanup) {
                    await browserForCleanup.close();
                    logCapture(`[${sessionId}] Browser closed.`);
                } else {
                    logCapture(`[${sessionId}] WARN: Browser object missing in session during cleanup.`);
                }
            } catch (closeError) {
                logCapture(`[${sessionId}] ❌ ERROR closing browser: ${closeError.message}`);
            }

            // Always remove session from active map
            if (activeSessions[sessionId]) {
                delete activeSessions[sessionId];
                logCapture(`[${sessionId}] Session removed from active map.`);
            }
        } catch (finallyError) {
            logCapture(`[${sessionId}] Error during cleanup: ${finallyError.message}`);
        }
    }

    const overallDuration = (Date.now() - overallStartTime) / 1000;
    logCapture(`[${sessionId}] bookSession (DOM) step completed in ${overallDuration.toFixed(2)} seconds. Result: ${stepSuccess ? 'Success' : 'Failure'}`);

    const finalError = stepSuccess
        ? undefined
        : (error?.message || bookingServiceResult?.error || "Booking step failed");

    return {
        success: stepSuccess,
        sessionId: sessionId,
        duration: parseFloat(overallDuration.toFixed(2)),
        bookingServiceDuration: parseFloat(bookingServiceDuration.toFixed(2)),
        domNavigationTime: parseFloat(domNavigationTime.toFixed(2)),
        error: finalError
    };
}

// Ensure only bookSession is exported
module.exports = { bookSession };


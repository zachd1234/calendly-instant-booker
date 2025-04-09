require('dotenv').config(); // Still needed if bookingService uses env vars? Review dependencies.
const { bookMeeting } = require('./services/bookingService');
// Import activeSessions map from sessionManager to find and delete sessions
const { activeSessions, browserPool } = require('./sessionManager');

// --- Helper: Parse Date/Time from Calendly URL ---
function parseCalendlyUrl(url) {
    try {
        // Example: https://calendly.com/user/event/YYYY-MM-DDTHH:mm:ss-ZZ:ZZ
        // Extract the date/time part: YYYY-MM-DDTHH:mm:ss
        const dateTimeString = url.split('/').pop().split('?')[0]; // Get last part, remove query params
        const date = new Date(dateTimeString); // Use JS Date object parsing

        if (isNaN(date)) {
            throw new Error('Invalid date format in URL');
        }

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

        return { year, month, day, timeString };
    } catch (e) {
        console.error(`Error parsing Calendly URL ${url}: ${e.message}`);
        return null;
    }
}

// --- Step 2: Book Session Function (DOM Navigation - Calculated Month Clicks) ---
async function bookSession(sessionId, fullBookingUrl, name, email, phone) {
    const session = activeSessions[sessionId];
    const logCapture = session?.logCapture || console.log;

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
// This file handles Step 2: Booking using an existing session via DOM interaction.
            for (let i = 0; i < monthDifference; i++) {
                try {
                    await page.waitForSelector(nextMonthButtonSelector, { timeout: 5000, state: 'visible' });
                    await page.click(nextMonthButtonSelector);
                    logCapture(`[${sessionId}] Clicked next month button (${i + 1}/${monthDifference}).`);
                    await page.waitForTimeout(250);
                } catch (e) {
                    logCapture(`[${sessionId}] ❌ ERROR clicking next month button on click #${i + 1}: ${e.message}`);
                    throw new Error(`Failed during month navigation on click ${i + 1}.`);
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
        // Revert to using aria-label selector
        const daySelector = `button[aria-label*="${monthNames[targetDate.month]} ${targetDate.day}"][aria-label*="Times available"]`;
        try {
            await page.waitForSelector(daySelector, { timeout: 12000, state: 'visible' }); // Keep increased timeout
            await page.click(daySelector);
            logCapture(`[${sessionId}] Clicked day ${targetDate.day}.`);
            await page.waitForTimeout(500);
        } catch (e) {
            logCapture(`[${sessionId}] ❌ ERROR clicking day ${targetDate.day} using selector "${daySelector}": ${e.message}`);
            await page.screenshot({ path: `session_day_click_error_${sessionId}.png` }).catch(err => logCapture(`[${sessionId}] ERROR: Day click error screenshot failed: ${err.message}`));
            throw new Error(`Failed to click day ${targetDate.day}. It might be unavailable or the selector '${daySelector}' is wrong.`);
        }

        // 5. Select Time
        logCapture(`[${sessionId}] Selecting time: ${targetDate.timeString}`);
        const timeSelector = `button[data-container="time-button"][data-start-time="${targetDate.timeString}"]`;
        try {
            await page.waitForSelector(timeSelector, { timeout: 10000 });
            await page.click(timeSelector);
            logCapture(`[${sessionId}] Clicked time ${targetDate.timeString}.`);
            await page.waitForTimeout(500);
        } catch (e) {
            logCapture(`[${sessionId}] ❌ ERROR clicking time ${targetDate.timeString} using selector "${timeSelector}": ${e.message}`);
            await page.screenshot({ path: `session_time_click_error_${sessionId}.png` }).catch(err => logCapture(`[${sessionId}] ERROR: Time click error screenshot failed: ${err.message}`));
            throw new Error(`Failed to click time ${targetDate.timeString}.`);
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

        // --- Hand off to Booking Service ---
        logCapture(`[${sessionId}] Handing off to bookingService...`);
        const bookingStartTime = Date.now();
        bookingServiceResult = await bookMeeting(page, name, email, phone, logCapture);
        bookingServiceDuration = (Date.now() - bookingStartTime) / 1000;

        if (bookingServiceResult.success) {
            logCapture(`[${sessionId}] ✅ bookingService reported SUCCESS in ${bookingServiceDuration.toFixed(2)}s.`);
            return { success: true, error: null, duration: bookingServiceDuration, sessionId: sessionId };
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
        error: finalError
    };
}// Ensure only bookSession is exported
module.exports = { bookSession };


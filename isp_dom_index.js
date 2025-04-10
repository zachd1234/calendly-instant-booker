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

    // Apply browser profile standardization
    logCapture(`[${sessionId}] Applying browser standardization to ensure consistent Calendly access...`);
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
        // Perform location diagnostics to check for potential issues
        try {
            logCapture(`[${sessionId}] Checking location for potential restrictions...`);
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
                
                logCapture(`[${sessionId}] Location detected: ${locationData.city}, ${locationData.region}, ${locationData.country}`);
                logCapture(`[${sessionId}] IP: ${locationData.ip}, ISP: ${locationData.org || 'Unknown'}`);
                
                if (isSanFrancisco) {
                    logCapture(`[${sessionId}] ⚠️ WARNING: Connected from San Francisco area which may experience Calendly timeouts`);
                    logCapture(`[${sessionId}] Proceeding with enhanced browser standardization...`);
                    // Re-apply standardization with extra parameters
                    await standardizeBrowserProfile(page, sessionId, logCapture);
                }
            }
        } catch (locError) {
            logCapture(`[${sessionId}] WARN: Location check failed: ${locError.message}`);
        }

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
        // Simpler selector to find the button *just* by date, not availability yet
        const dayButtonSelector = `button[aria-label*="${monthNames[targetDate.month]} ${targetDate.day}"]`;
        try {
            // Wait for the button corresponding to the date to exist
            const dayButton = await page.waitForSelector(dayButtonSelector, { timeout: 12000, state: 'attached' }); // Find attached, not necessarily visible/enabled

            // Now check if it's disabled
            const isDisabled = await dayButton.isDisabled();
            if (isDisabled) {
                logCapture(`[${sessionId}] ❌ ERROR: Day ${targetDate.day} (${monthNames[targetDate.month]}) button found but is disabled (unavailable). Selector: "${dayButtonSelector}"`);
                throw new Error(`Day ${targetDate.day} (${monthNames[targetDate.month]}) is unavailable.`);
            }

            // If not disabled, proceed to click
            logCapture(`[${sessionId}] Day ${targetDate.day} button found and is enabled. Clicking...`);
            await dayButton.click(); // Click the located button element
            logCapture(`[${sessionId}] Clicked day ${targetDate.day}.`);
            await page.waitForTimeout(500);
        } catch (e) {
            // Catch errors from waitForSelector or the isDisabled check/click
            logCapture(`[${sessionId}] ❌ ERROR selecting day ${targetDate.day}: ${e.message}`);
            // Keep screenshot on error
            if (page && !page.isClosed()) { // Check if page exists and is open before screenshot
                 await page.screenshot({ path: `session_day_click_error_${sessionId}.png` }).catch(err => logCapture(`[${sessionId}] ERROR: Day click error screenshot failed: ${err.message}`));
            }
            // Re-throw a more generic error if the initial find failed, or propagate the specific 'disabled' error
            throw new Error(`Failed to find or click day ${targetDate.day}. Original error: ${e.message}`);
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

        // Apply browser standardization again before form filling
        logCapture(`[${sessionId}] Re-standardizing browser profile before form submission...`);
        await standardizeBrowserProfile(page, sessionId, logCapture);

        // --- Hand off to Booking Service ---
        logCapture(`[${sessionId}] Handing off to bookingService...`);
        const bookingStartTime = Date.now();
        bookingServiceResult = await bookMeeting(page, name, email, phone, logCapture);
        bookingServiceDuration = (Date.now() - bookingStartTime) / 1000;

        if (bookingServiceResult.success) {
            logCapture(`[${sessionId}] ✅ bookingService reported SUCCESS in ${bookingServiceDuration.toFixed(2)}s.`);
            stepSuccess = true;
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
}

// Ensure only bookSession is exported
module.exports = { bookSession };


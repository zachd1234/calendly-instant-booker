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
        try {
            await page.evaluate(() => {
                try {
                    Object.defineProperty(navigator, 'language', {
                        get: function() { return 'en-US'; }
                    });
                } catch (propError) {
                    // If property can't be redefined, log but continue
                    console.log('Warning: Could not override navigator.language');
                }
                
                try {
                    Object.defineProperty(navigator, 'languages', {
                        get: function() { return ['en-US', 'en']; }
                    });
                } catch (propError) {
                    console.log('Warning: Could not override navigator.languages');
                }
            });
        } catch (evalError) {
            logCapture(`[${sessionId}] Warning: Could not set language properties: ${evalError.message}`);
        }
        
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
        // Remove the location diagnostics that navigates away from Calendly
        logCapture(`[${sessionId}] Starting booking process on Calendly URL: ${fullBookingUrl}`);

        // Take a screenshot to see what page we're actually on
        await page.screenshot({ path: `session_before_calendar_${sessionId}.png` });
        logCapture(`[${sessionId}] Screenshot taken before calendar interaction`);

        // --- DOM Navigation Steps ---
        const navigationStartTime = Date.now(); // Timer for DOM nav part

        // Debug: Wait and log what elements are visible on the page
        try {
            logCapture(`[${sessionId}] Waiting for calendar components to load...`);
            
            // Wait for any calendar elements
            const calendarGrid = await page.waitForSelector('table[role="grid"]', { timeout: 20000 }).catch(() => null);
            const monthHeader = await page.waitForSelector('[data-section="month"] h2', { timeout: 5000 }).catch(() => null);
            
            if (calendarGrid) {
                logCapture(`[${sessionId}] ✅ Calendar grid found`);
            } else {
                logCapture(`[${sessionId}] ❌ Calendar grid not found`);
            }
            
            if (monthHeader) {
                const monthText = await monthHeader.textContent();
                logCapture(`[${sessionId}] ✅ Month header found: "${monthText}"`);
            } else {
                logCapture(`[${sessionId}] ❌ Month header not found`);
            }
            
            // Take a screenshot after waiting for calendar
            await page.screenshot({ path: `session_calendar_state_${sessionId}.png` });
            logCapture(`[${sessionId}] Calendar state screenshot captured`);
            
            // Check if there are any date buttons at all
            const dateButtons = await page.$$('button[aria-label*="day"]').catch(() => []);
            logCapture(`[${sessionId}] Found ${dateButtons.length} date buttons on page`);
            
            if (dateButtons.length > 0) {
                // Log the first few date buttons
                const buttonLabels = [];
                for (let i = 0; i < Math.min(5, dateButtons.length); i++) {
                    const label = await dateButtons[i].getAttribute('aria-label').catch(() => 'unknown');
                    buttonLabels.push(label);
                }
                logCapture(`[${sessionId}] Sample date buttons: ${buttonLabels.join(', ')}`);
            }
            
        } catch (debugError) {
            logCapture(`[${sessionId}] WARN: Debug element check failed: ${debugError.message}`);
        }

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
        
        if (!dayButton) {
            // Take a final screenshot before failing
            await page.screenshot({ path: `session_day_not_found_${sessionId}.png` });
            logCapture(`[${sessionId}] ❌ ERROR: Could not find day ${targetDate.day} with any selector strategy`);
            throw new Error(`Day ${targetDate.day} not found with any selector strategy`);
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
            
            // Take a screenshot after clicking day
            await page.screenshot({ path: `session_after_day_click_${sessionId}.png` });
            logCapture(`[${sessionId}] After day click screenshot captured`);
            
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
            
            // Take a screenshot of available times
            await page.screenshot({ path: `session_time_buttons_${sessionId}.png` });
            
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
            
            // Take a screenshot after clicking time
            await page.screenshot({ path: `session_after_time_click_${sessionId}.png` });
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


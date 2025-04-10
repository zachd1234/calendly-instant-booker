// timezoneDetection.js - Utility to detect Calendly timezone during session creation
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Detects the timezone offset that Calendly is using in the browser session
 * by visiting a known URL and checking the displayed time
 * 
 * @param {Object} page - The Playwright page object
 * @param {String} baseUrl - The base Calendly URL 
 * @param {Function} logCapture - Function for logging
 * @param {String} sessionId - Session ID for logging
 * @returns {Object} timezoneInfo - Contains timezone offset and sample mapping
 */
async function detectCalendlyTimezone(page, baseUrl, logCapture, sessionId) {
    logCapture(`[${sessionId}] Starting timezone detection...`);
    
    // Store the current URL to return to it later
    const currentUrl = page.url();
    
    try {
        // 1. Find the last day of the current month for testing
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-indexed
        
        // Get the last day of the current month
        const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
        
        logCapture(`[${sessionId}] Looking for the last day (${lastDay}) of ${monthNames[currentMonth]} ${currentYear}...`);
        
        // 2. Try to click on the last day of the month
        // First, wait for the calendar to be visible
        const calendarSelector = 'table[role="grid"]';
        await page.waitForSelector(calendarSelector, { timeout: 15000 });
        
        // Try to find the button for the last day
        const dayButtonSelector = `button[aria-label*="${monthNames[currentMonth]} ${lastDay}"]`;
        let dayButton;
        
        try {
            // Wait for the button corresponding to the date to exist
            dayButton = await page.waitForSelector(dayButtonSelector, { timeout: 5000, state: 'attached' });
            
            // Check if the button is disabled (unavailable)
            const isDisabled = await dayButton.isDisabled();
            if (isDisabled) {
                logCapture(`[${sessionId}] Last day ${lastDay} is disabled, trying to navigate to next month...`);
                
                // Click next month button
                const nextMonthButtonSelector = 'button[aria-label="Go to next month"]';
                await page.waitForSelector(nextMonthButtonSelector, { timeout: 5000 });
                await page.click(nextMonthButtonSelector);
                await page.waitForTimeout(500);
                
                // Now try with the next month
                const nextMonth = (currentMonth + 1) % 12;
                const nextMonthYear = nextMonth === 0 ? currentYear + 1 : currentYear;
                const nextMonthLastDay = new Date(nextMonthYear, nextMonth + 1, 0).getDate();
                
                logCapture(`[${sessionId}] Looking for the last day (${nextMonthLastDay}) of ${monthNames[nextMonth]} ${nextMonthYear}...`);
                
                const nextMonthDaySelector = `button[aria-label*="${monthNames[nextMonth]} ${nextMonthLastDay}"]`;
                dayButton = await page.waitForSelector(nextMonthDaySelector, { timeout: 5000, state: 'attached' });
                
                const isNextMonthDisabled = await dayButton.isDisabled();
                if (isNextMonthDisabled) {
                    logCapture(`[${sessionId}] Next month's last day is also disabled. Will try the first available day.`);
                    
                    // Try to find any enabled day
                    const anyDaySelector = 'button[aria-label*="Times available"]';
                    dayButton = await page.waitForSelector(anyDaySelector, { timeout: 10000 });
                } else {
                    // Use the next month's last day
                    dayButton = await page.waitForSelector(nextMonthDaySelector, { timeout: 5000 });
                }
            }
            
            // Click the day button
            logCapture(`[${sessionId}] Found an available day, clicking...`);
            await dayButton.click();
            await page.waitForTimeout(500);
            
            // 3. Click the first available time slot
            logCapture(`[${sessionId}] Looking for the first available time slot...`);
            const timeButtonSelector = 'button[data-container="time-button"]';
            await page.waitForSelector(timeButtonSelector, { timeout: 10000 });
            
            // Get all available time buttons
            const timeButtons = await page.$$(timeButtonSelector);
            if (timeButtons.length === 0) {
                throw new Error("No available time slots found");
            }
            
            // Get the actual time text and data attribute
            const firstTimeButton = timeButtons[0];
            const displayedTime = await firstTimeButton.textContent();
            const dataStartTime = await firstTimeButton.getAttribute('data-start-time');
            
            // Click the time button
            await firstTimeButton.click();
            await page.waitForTimeout(500);
            
            // 4. Get the URL after clicking the time slot
            const selectedUrl = page.url();
            
            // Extract the ISO datetime from the URL
            const dateTimeFromUrl = selectedUrl.split('/').pop().split('?')[0];
            
            // 5. Compare the URL time with displayed time to determine timezone offset
            const urlTime = new Date(dateTimeFromUrl);
            if (isNaN(urlTime)) {
                throw new Error(`Invalid datetime in URL: ${dateTimeFromUrl}`);
            }
            
            logCapture(`[${sessionId}] URL contains time: ${dateTimeFromUrl}`);
            logCapture(`[${sessionId}] Page displays time: ${displayedTime}`);
            logCapture(`[${sessionId}] data-start-time attribute: ${dataStartTime}`);
            
            // Calculate the URL's expected AM/PM format to compare with data-start-time
            let urlHours = urlTime.getHours();
            const urlMinutes = urlTime.getMinutes();
            const urlAmPm = urlHours >= 12 ? 'pm' : 'am';
            urlHours = urlHours % 12;
            urlHours = urlHours || 12; // Convert 0 to 12
            const urlTimeString = `${urlHours}:${urlMinutes < 10 ? '0' + urlMinutes : urlMinutes}${urlAmPm}`;
            
            // Determine timezone effect
            const timezoneInfo = {
                urlIsoTime: dateTimeFromUrl,
                urlParsedTime: urlTimeString,
                displayedTime: displayedTime,
                dataStartTime: dataStartTime,
                urlObject: urlTime,
                detectedOffset: urlTime.getTimezoneOffset()
            };
            
            logCapture(`[${sessionId}] Timezone detection complete. URL time: ${urlTimeString}, Display: ${displayedTime}, Data attr: ${dataStartTime}`);
            logCapture(`[${sessionId}] Detected timezone offset: ${timezoneInfo.detectedOffset} minutes from UTC`);
            
            // Return timezone info
            return timezoneInfo;
            
        } catch (e) {
            logCapture(`[${sessionId}] ❌ Error during timezone detection: ${e.message}`);
            
            // Return a default timezone info with error
            return {
                error: e.message,
                detectedOffset: null
            };
        } finally {
            // Always navigate back to the original URL
            logCapture(`[${sessionId}] Returning to original URL: ${currentUrl}`);
            try {
                await page.goto(currentUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });
                logCapture(`[${sessionId}] Successfully returned to original URL`);
            } catch (navError) {
                logCapture(`[${sessionId}] ❌ Error returning to original URL: ${navError.message}`);
            }
        }
    } catch (error) {
        logCapture(`[${sessionId}] ❌ Fatal error in timezone detection: ${error.message}`);
        return {
            error: error.message,
            detectedOffset: null
        };
    }
}

/**
 * Corrects a time string based on detected timezone differences
 * 
 * @param {String} timeString - Time string in format like "9:30am"
 * @param {Object} timezoneInfo - Timezone info from detectCalendlyTimezone
 * @returns {String} - Corrected time string
 */
function adjustTimeForTimezone(timeString, timezoneInfo) {
    // If no timezone info or there's no difference, return original
    if (!timezoneInfo || !timezoneInfo.detectedOffset || timezoneInfo.urlParsedTime === timezoneInfo.dataStartTime) {
        return timeString;
    }
    
    // Extract hours, minutes, and am/pm
    const timeRegex = /(\d+):(\d+)(am|pm)/i;
    const match = timeString.match(timeRegex);
    
    if (!match) {
        console.warn(`Could not parse time string: ${timeString}`);
        return timeString;
    }
    
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3].toLowerCase();
    
    // Convert to 24-hour format
    if (ampm === 'pm' && hours < 12) {
        hours += 12;
    } else if (ampm === 'am' && hours === 12) {
        hours = 0;
    }
    
    // Apply the correction if URL time and displayed time don't match
    if (timezoneInfo.urlParsedTime !== timezoneInfo.dataStartTime) {
        // Parse the data-start-time attribute to get the displayed time
        const displayTimeRegex = /(\d+):(\d+)(am|pm)/i;
        const displayMatch = timezoneInfo.dataStartTime.match(displayTimeRegex);
        
        if (displayMatch) {
            let displayHours = parseInt(displayMatch[1], 10);
            const displayAmPm = displayMatch[3].toLowerCase();
            
            // Convert to 24-hour
            if (displayAmPm === 'pm' && displayHours < 12) {
                displayHours += 12;
            } else if (displayAmPm === 'am' && displayHours === 12) {
                displayHours = 0;
            }
            
            // Calculate the difference between URL time and displayed time
            const urlHours = timezoneInfo.urlObject.getHours();
            const hourDiff = displayHours - urlHours;
            
            // Apply this difference to the input time
            hours = (hours + hourDiff + 24) % 24;
        }
    }
    
    // Convert back to 12-hour format
    const adjustedAmPm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours || 12; // Convert 0 to 12
    
    // Format the adjusted time
    return `${hours}:${minutes < 10 ? '0' + minutes : minutes}${adjustedAmPm}`;
}

module.exports = {
    detectCalendlyTimezone,
    adjustTimeForTimezone
}; 
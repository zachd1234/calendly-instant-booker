// services/bookingService.js

// Re-implement helper functions here for now, or move to a shared utils file later
// Helper function for more efficient form filling
async function fastFill(page, selector, text) {
  // Special handling for phone fields - clear first then fill
  if (selector.includes('tel')) {
    await page.focus(selector);
    await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
    await page.keyboard.press('Backspace'); // Clear any existing text including country code
    await page.fill(selector, text);
    console.log(`[BookingService] Phone field cleared and filled directly: ${text}`);
    return;
  }

  // For non-phone fields, use regular approach
  try {
    await page.fill(selector, text);
    console.log(`[BookingService] Fast-filled "${text}" into field`);

    // Verify what was typed
    const value = await page.$eval(selector, el => el.value);

    if (value !== text) {
      // If direct fill doesn't work correctly, fall back to typing with minimal delay
      console.log(`[BookingService] Fast-fill resulted in "${value}", falling back to typing`);
      await humanType(page, selector, text);
    }
  } catch (e) {
    console.log(`[BookingService] Fast-fill failed: ${e.message}, falling back to typing`);
    await humanType(page, selector, text);
  }
}

// Helper function for fast human-like typing with minimal delay
async function humanType(page, selector, text) {
  // Special handling for phone fields - clear first then fill
  if (selector.includes('tel')) {
    await page.focus(selector);
    await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
    await page.keyboard.press('Backspace'); // Clear any existing text including country code
    await page.fill(selector, text);
    console.log(`[BookingService] Phone field cleared and filled directly: ${text}`);
    return;
  }

  await page.focus(selector);
  await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
  await page.keyboard.press('Backspace'); // Clear any existing text

  // Reduced typing delay
  for (const char of text) {
    // await page.keyboard.type(char, { delay: Math.floor(Math.random() * 10) + 5 });
    await page.keyboard.type(char, { delay: 1 }); // Minimal 1ms delay
  }

  // Verify what was typed
  const value = await page.$eval(selector, el => el.value);
  console.log(`[BookingService] Typed "${text}" into field, current value: "${value}"`);

  if (value !== text) {
    console.log(`[BookingService] ⚠️ Warning: Field value "${value}" doesn't match expected "${text}". Retrying...`);
    await page.fill(selector, text);
  }
}

// *** NEW HELPER FUNCTION for finding fields with retry ***
async function findFieldWithRetry(page, selector, fieldName, maxRetries, retryTimeout) {
    console.log(`[BookingService] Looking for ${fieldName} field ('${selector}') with retry...`);
    let fieldLocator = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[BookingService] ${fieldName} field attempt ${attempt}/${maxRetries}...`);
            fieldLocator = page.locator(selector);
            
            // Check visibility with timeout for this attempt
            await fieldLocator.waitFor({ state: 'visible', timeout: retryTimeout });
            
            console.log(`[BookingService] Found ${fieldName} field.`);
            return fieldLocator; // Success, return the locator
            
        } catch (e) {
            console.log(`[BookingService] ${fieldName} field attempt ${attempt} timed out or failed.`);
            if (attempt === maxRetries) {
                 const errorMessage = `❌ Error finding ${fieldName} field after all ${maxRetries} retries: ${e.message}`;
                 console.error('[BookingService]', errorMessage);
                 // Throw an error that Promise.all can catch
                 throw new Error(errorMessage); 
            }
             // Wait briefly before next retry
             await page.waitForTimeout(500);
        }
    }
    // Should not be reached if maxRetries > 0, but throw just in case
    throw new Error(`Failed to find ${fieldName} field after ${maxRetries} retries.`);
}

// Set to true for debug screenshots, false for performance
// const DEBUG_MODE = false; // We can remove or ignore this now

/**
 * Books a Calendly meeting using an existing Playwright page object.
 * Assumes the page is already navigated to the correct Calendly booking URL.
 *
 * @param {string} sessionId - The unique session identifier.
 * @param {import('playwright').Page} page - The Playwright page object.
 * @param {string} name - The name to fill in the form.
 * @param {string} email - The email to fill in the form.
 * @param {string} phone - The phone number to fill in the form.
 * @param {function} logCapture - Logging function.
 * @returns {Promise<object>} - Object with success status and optional error.
 */
async function bookMeeting(sessionId, page, name, email, phone, logCapture) {
  // Use default console.log if logCapture isn't provided (robustness)
  logCapture = logCapture || console.log;

  logCapture(`[${sessionId}] [BookingService] Starting booking process on existing page...`);
  const formStartTime = Date.now();

  try {
    // Reduced wait time - assume page is mostly ready
    await page.waitForTimeout(300);

    // Debug output of page title
    const pageTitle = await page.title().catch(() => 'Error getting title');
    logCapture(`[${sessionId}] [BookingService] Page title: ${pageTitle}`);

    // --- Cookie Consent Handling (Optional but recommended) ---
    logCapture(`[${sessionId}] [BookingService] Handling cookie consent (quick check)...`);
    const cookieSelector = '#onetrust-accept-btn-handler'; // Define selector once
    try {
        const cookieButton = await page.waitForSelector(cookieSelector, { timeout: 500 }).catch(() => null);
        if (cookieButton) {
            console.log('[BookingService] Found cookie button via selector, clicking...');
            await cookieButton.click();
            // Replace fixed timeout with wait for button/banner to disappear
            console.log('[BookingService] Waiting for cookie banner to hide...');
            await page.locator(cookieSelector).waitFor({ state: 'hidden', timeout: 2000 }); 
            console.log('[BookingService] Cookie banner hidden.');
        } else {
             console.log('[BookingService] No cookie button found quickly.');
        }
    } catch (e) {
      console.log('[BookingService] Cookie consent check skipped or failed:', e.message);
    }

    // --- Form Filling ---
    logCapture(`[${sessionId}] [BookingService] Locating required form fields in parallel...`);
    
    // Wait for the main form container first 
    try {
        logCapture(`[${sessionId}] [BookingService] Waiting for form container...`);
        // Adjust selector if you find a more specific/stable one like 'form[data-testid="booking-form"]'
        await page.waitForSelector('form', { state: 'visible', timeout: 30000 });
        logCapture(`[${sessionId}] [BookingService] Form container found.`);
    } catch (e) {
        logCapture(`[${sessionId}] [BookingService] ❌ Error waiting for form container: ${e.message}`);
        // No need for DEBUG_MODE check for screenshot on critical failure
        await page.screenshot({ path: `error-no-form-container_${sessionId}.png` }).catch(err => logCapture(`[${sessionId}] Error taking screenshot: ${err.message}`));
        return { success: false, error: `Failed to find form container: ${e.message}` };
    }

    // *** PARALLEL FIELD FINDING ***
    const nameSelectorId = '#full_name_input'; // Use specific ID
    const emailSelectorId = '#email_input';   // Use specific ID
    
    const maxRetries = 3;
    const retryTimeout = 7000; 
    let nameFieldLocator, emailFieldLocator;

    try {
        // Run findFieldWithRetry for Name and Email in parallel using specific IDs
        logCapture(`[${sessionId}] [BookingService] Starting parallel search for Name and Email fields using IDs...`);
        [nameFieldLocator, emailFieldLocator] = await Promise.all([
            findFieldWithRetry(page, nameSelectorId, 'Name', maxRetries, retryTimeout),
            findFieldWithRetry(page, emailSelectorId, 'Email', maxRetries, retryTimeout)
        ]);
        logCapture(`[${sessionId}] [BookingService] Found both Name and Email fields.`);

        // *** FILL FIELDS *** (Now that locators are found)
        // Pass the specific ID selectors to fastFill
        logCapture(`[${sessionId}] [BookingService] Filling Name field...`);
        await fastFill(page, nameSelectorId, name); 
        logCapture(`[${sessionId}] [BookingService] Filling Email field...`);
        await fastFill(page, emailSelectorId, email);

    } catch (error) {
        logCapture(`[${sessionId}] [BookingService] Failed to find required fields in parallel: ${error.message}`);
        await page.screenshot({ path: `error-parallel-field-find_${sessionId}.png` }).catch(err => logCapture(`[${sessionId}] Error taking screenshot: ${err.message}`));
        return { success: false, error: `Failed parallel field find: ${error.message}` };
    }
    
    // --- *** REVISED Phone Field Handling (More Patient Wait) *** ---
    logCapture(`[${sessionId}] [BookingService] Checking for phone input field (waiting up to 15s)...`);
    const phoneInputSelector = 'input[type="tel"]'; // Selector for the actual input
    const phoneWaitTimeout = 15000; // Increased wait time (15 seconds)
    let phoneFilled = false;

    try {
        // Wait directly for the input field to be visible
        const phoneElement = await page.waitForSelector(phoneInputSelector, { state: 'visible', timeout: phoneWaitTimeout });
        logCapture(`[${sessionId}] [BookingService] Found phone input field.`);
        
        // Fill the input field
        try {
            logCapture(`[${sessionId}] [BookingService] Filling phone number with provided value: ${phone}`);
            await page.focus(phoneInputSelector);
            await page.click(phoneInputSelector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.fill(phoneInputSelector, phone);
            logCapture(`[${sessionId}] [BookingService] Phone field filled.`);
            phoneFilled = true;
        } catch (fillError) {
            logCapture(`[${sessionId}] [BookingService] ⚠️ Error filling phone field even after finding input: ${fillError.message}`);
        }

    } catch (inputError) {
        // Input field didn't appear within the longer timeout
        logCapture(`[${sessionId}] [BookingService] Phone input field ('${phoneInputSelector}') did not become visible within ${phoneWaitTimeout / 1000}s. Assuming not required or optional.`);
        // No error thrown, just proceed without filling the phone number
    }
    // --- *** END REVISED Phone Field Handling *** ---

    // --- TAKE SCREENSHOT AFTER FILLING ---
    logCapture(`[${sessionId}] [BookingService] Form fields potentially filled. Taking screenshot before submit...`);
    try {
        await page.screenshot({ path: `form-filled-service_${sessionId}.png` }); // Use sessionId in filename
        logCapture(`[${sessionId}] [BookingService] Screenshot 'form-filled-service_${sessionId}.png' saved.`);
    } catch (ssError) {
         logCapture(`[${sessionId}] [BookingService] WARN: Failed to take post-fill screenshot: ${ssError.message}`);
    }
    // --- END SCREENSHOT ---

    // --- Submit Button --- (Optimized with Primary Check)
    logCapture(`[${sessionId}] [BookingService] Looking for submit button...`);
    let submitButtonFound = false;
    const primarySubmitSelector = 'button[type="submit"]';
    const primaryTimeout = 2000; // Short timeout for primary check

    // 1. Try primary selector first
    logCapture(`[${sessionId}] [BookingService] Trying primary selector ('${primarySubmitSelector}') first with ${primaryTimeout}ms timeout...`);
    try {
        const primaryButton = page.locator(primarySubmitSelector).first(); // Take first if multiple
        if (await primaryButton.isVisible({ timeout: primaryTimeout }) && 
            await primaryButton.isEnabled({ timeout: 500 })) { // Quick enable check
            
            logCapture(`[${sessionId}] [BookingService] Found clickable button with primary selector.`);
            await primaryButton.scrollIntoViewIfNeeded();
            await primaryButton.click({ force: true, timeout: 5000 }); 
            submitButtonFound = true;
            logCapture(`[${sessionId}] [BookingService] Submit button clicked (primary check).`);
        } else {
            logCapture(`[${sessionId}] [BookingService] Primary submit button found but not immediately clickable.`);
        }
    } catch (e) {
        logCapture(`[${sessionId}] [BookingService] Primary submit selector ('${primarySubmitSelector}') failed or timed out: ${e.message}`);
    }

    // 2. If primary failed, try fallback logic (existing .or chain)
    if (!submitButtonFound) {
        logCapture(`[${sessionId}] [BookingService] Primary check failed, trying fallback role-based button detection...`);
        try {
            const submitButton = await page.locator('button[type="submit"]') // Keep original chain here as fallback
              .or(page.getByRole('button', { name: /Schedule|Confirm|Book|Submit|Next|Continue|Complete|Finish|Reserve/i }))
              .or(page.locator('form button:not([type="button"])').last());
      
            const buttonCount = await submitButton.count();
            if (buttonCount > 0) {
               const firstVisibleButton = submitButton.first(); 
               // Use slightly longer timeout for fallback check
               if (await firstVisibleButton.isVisible({ timeout: 3000 }) && 
                   await firstVisibleButton.isEnabled({ timeout: 1000 })) {
                   logCapture(`[${sessionId}] [BookingService] Found clickable submit button via fallback locator.`);
                   await firstVisibleButton.scrollIntoViewIfNeeded();
                   await firstVisibleButton.click({ force: true, timeout: 5000 }); 
                   submitButtonFound = true;
                   logCapture(`[${sessionId}] [BookingService] Submit button clicked (fallback check).`);
               } else {
                   logCapture(`[${sessionId}] [BookingService] Fallback locator found button(s), but none seem clickable.`);
                    // Try JS click as fallback if locator found something but couldn't click
                    try {
                        await firstVisibleButton.dispatchEvent('click');
                        submitButtonFound = true;
                        logCapture(`[${sessionId}] [BookingService] Submit button clicked via JS event dispatch (fallback check).`);
                    } catch (jsClickError) {
                        logCapture(`[${sessionId}] [BookingService] JS dispatch click also failed (fallback check): ${jsClickError.message}`);
                    }
               }
            } else {
               logCapture(`[${sessionId}] [BookingService] No button found via fallback locators either.`);
            }
      
          } catch (e) {
            logCapture(`[${sessionId}] [BookingService] Error during fallback button search: ${e.message}`);
          }
    }

    // 3. Fallback JavaScript submission if all else failed
    if (!submitButtonFound) {
      logCapture(`[${sessionId}] [BookingService] Button locators failed or click failed, trying JavaScript form submission...`);
      try {
        const submitted = await page.evaluate(() => {
          const forms = document.querySelectorAll('form');
          if (forms.length > 0) {
            const form = forms[forms.length - 1]; // Assume last form
            const buttons = form.querySelectorAll('button:not([type="button"]), input[type="submit"]');
             if (buttons.length > 0) {
                const submitBtn = buttons[buttons.length - 1]; // Assume last button is submit
                logCapture(`[${sessionId}] [BookingService-Eval] Clicking last button in form: ${submitBtn.outerHTML}`);
                submitBtn.click();
                return true;
             } else {
                 logCapture(`[${sessionId}] [BookingService-Eval] No submit buttons found in form, trying form.submit()`);
                 if (typeof form.submit === 'function') {
                    form.submit();
                    return true;
                 } else {
                    logCapture(`[${sessionId}] [BookingService-Eval] form.submit is not a function`);
                    return false;
                 }
             }
          }
           logCapture(`[${sessionId}] [BookingService-Eval] No forms found.`);
          return false;
        });

        if (submitted) {
            logCapture(`[${sessionId}] [BookingService] JavaScript form submission attempt executed.`);
            submitButtonFound = true; // Assume it worked or is in progress
            // Replace fixed timeout with wait for potential page update
            logCapture(`[${sessionId}] [BookingService] Waiting for page state change after JS submit (max 5s)...`);
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
            logCapture(`[${sessionId}] [BookingService] Page state likely updated or timeout reached after JS submit.`);
        } else {
            logCapture(`[${sessionId}] [BookingService] JavaScript form submission approach failed.`);
        }
      } catch (e) {
        logCapture(`[${sessionId}] [BookingService] Error with JavaScript form submission: ${e.message}`);
      }
    }

    if (!submitButtonFound) {
      logCapture(`[${sessionId}] [BookingService] ⚠️ Warning: Could not reliably find or click any submit button.`);
       // Consider returning false here if submission is critical
       // return false;
    } else {
      logCapture(`[${sessionId}] [BookingService] Submit initiated. Waiting briefly for page transition/network idle before confirmation checks...`);
      // *** Wait for network idle after successful click/submit ***
      try {
          // Replace domcontentloaded with networkidle
          await page.waitForLoadState('networkidle', { timeout: 7000 }); // Wait up to 7s for network idle after submit
          logCapture(`[${sessionId}] [BookingService] Network appears idle after submit.`);
      } catch(loadStateError) {
          logCapture(`[${sessionId}] [BookingService] WARN: Timed out waiting for network idle after submit (${loadStateError.message}). Proceeding with confirmation checks anyway...`);
      }
    }

    // --- Confirmation Check (Revised) ---
     logCapture(`[${sessionId}] [BookingService] Waiting for explicit confirmation or error indicators (max 60s)...`); // Updated log based on previous change

    const successSelectors = [
        'div[data-container="booking-container"]',
        'div.confirmation-page',
        'h1:has-text("Confirmed")',
        'h1:has-text("You are scheduled")',
        'div:has-text("successfully scheduled")',
        'p:has-text("confirmation has been sent")',
        'div[class*="success"i]:visible',
        'div[class*="confirmed"i]:visible',
         // Add more specific selectors if you identify them
    ];

    const errorSelectors = [
        'div[class*="error"i]:visible',
        'p[class*="error"i]:visible',
        'span[class*="error"i]:visible',
        'div:has-text("could not be scheduled"):visible',
        // REMOVED specific selector from here - will check separately if timeout occurs
         // Add more specific selectors for other known errors
    ];

    // Promise for detecting success - Increase timeout to 60s
    const successPromise = page.locator(successSelectors.join(', ')).first().waitFor({ state: 'visible', timeout: 60000 });

    // Promise for detecting error - Increase timeout to 60s
    const errorPromise = page.locator(errorSelectors.join(', ')).first().waitFor({ state: 'visible', timeout: 60000 });

    // Race the promises
    const result = await Promise.race([
        successPromise.then(() => 'success').catch(() => null), // Return 'success' if success element appears
        errorPromise.then(async (errorElement) => {
             const errorText = await errorElement.textContent();
             logCapture(`[${sessionId}] [BookingService] ❌ Explicit error detected: ${errorText?.trim()}`);
             // Capture screenshot specifically on detected error
             if (page && !page.isClosed()) {
                 await page.screenshot({ path: `error-explicit-detected-service_${sessionId}.png` }).catch(e=>logCapture(`[${sessionId}] Error taking screenshot: ${e.message}`));
             }
             return 'error'; // Return 'error' if error element appears
        }).catch(() => null),
        page.waitForTimeout(60000).then(() => 'timeout') // Also update the final race timeout to 60s
    ]);

    const formTime = (Date.now() - formStartTime) / 1000;
    logCapture(`[${sessionId}] [BookingService] Form processing and confirmation wait completed in ${formTime.toFixed(2)}s`);

    if (result === 'success') {
        logCapture(`[${sessionId}] [BookingService] ✅ Explicit confirmation indicator found.`);
        await page.screenshot({ path: `confirmed-service_${sessionId}.png` });
        return { success: true };
    } else if (result === 'error') {
         // Already logged the specific error in the Promise.race handler
         const errorText = await errorElement?.textContent() || 'Unknown explicit error'; // Attempt to get error text again
         return { success: false, error: `Explicit error detected: ${errorText.trim()}` };
    } else { // result === 'timeout'
        logCapture(`[${sessionId}] [BookingService] ⚠️ Timed out waiting for explicit confirmation or general error indicator. Checking for specific popups...`);

        // *** Check for post-submit unavailable popup after timeout ***
        const unavailableText = "Sorry, that time is no longer available.";
        try {
             const unavailableHeading = page.getByRole('heading', { name: unavailableText, exact: false });
             if (await unavailableHeading.isVisible({ timeout: 5000 })) { // 5s check
                  logCapture(`[${sessionId}] [BookingService] ❌ Detected post-submit message after timeout: "${unavailableText}"`);
                  await page.screenshot({ path: `error-slot-unavailable-post-submit_${sessionId}.png` }).catch(e=>logCapture(`[${sessionId}] Error taking screenshot: ${e.message}`));
                  return { success: false, error: `Slot became unavailable post-submit: "${unavailableText}"` };
             } else {
                logCapture(`[${sessionId}] [BookingService] Post-submit unavailable heading not found/visible within extra 5s check.`);
             }
        } catch (e) {
             logCapture(`[${sessionId}] [BookingService] Error or timeout during secondary check for unavailable heading: ${e.message}`);
        }
        // *** END CHECK ***

        // *** ADD CAPTCHA Check after timeout ***
        let captchaDetected = false;
        try {
            logCapture(`[${sessionId}] [BookingService] Performing quick check for CAPTCHA elements...`);
            const captchaSelectors = [
                'iframe[src*="recaptcha"]', 
                'iframe[title*="recaptcha"i]',
                'iframe[src*="hcaptcha"]',
                'iframe[title*="hcaptcha"i]',
                'div[data-captcha-enable="true"]', // Some common patterns
                'div:has-text("Verify you are human")' 
            ];
            const captchaElement = page.locator(captchaSelectors.join(', ')).first();
            if (await captchaElement.isVisible({ timeout: 3000 })) { // Quick 3s check
                 logCapture(`[${sessionId}] [BookingService] ⚠️ Potential CAPTCHA element detected after submit timeout.`);
                 captchaDetected = true;
                 // *** Take screenshot immediately upon CAPTCHA detection ***
                 try {
                    // Remove the 1-second delay before CAPTCHA screenshot
                    // logCapture(`[${sessionId}] [BookingService] Waiting 1 second after CAPTCHA detection before screenshot...`); 
                    // await page.waitForTimeout(1000); // Remove 1s delay back
                    logCapture(`[${sessionId}] [BookingService] Taking CAPTCHA detected screenshot...`);
                    await page.screenshot({ path: `captcha-detected_${sessionId}.png` }).catch(e=>logCapture(`[${sessionId}] Error taking CAPTCHA screenshot: ${e.message}`));
                 } catch (ssError) {
                    logCapture(`[${sessionId}] [BookingService] WARN: Failed to take CAPTCHA detected screenshot: ${ssError.message}`);
                 }
            } else {
                 logCapture(`[${sessionId}] [BookingService] No obvious CAPTCHA elements found quickly.`);
            }
        } catch (e) {
             logCapture(`[${sessionId}] [BookingService] Error during CAPTCHA check: ${e.message}`);
        }
        // *** END CAPTCHA Check ***

         const bodyText = await page.locator('body').textContent({ timeout: 1000 }).catch(() => '');
         const lowerBodyText = bodyText.toLowerCase();
         const confirmationKeywords = ['confirmed', 'success', 'thank you', 'scheduled', 'booked', 'complete'];
         if (!captchaDetected && confirmationKeywords.some(keyword => lowerBodyText.includes(keyword))) { // Also check captchaDetected here
             logCapture(`[${sessionId}] [BookingService] Found weak confirmation text in body after timeout (and no CAPTCHA detected).`);
             await page.screenshot({ path: `final-state-weak-confirm-service_${sessionId}.png` }).catch(e=>logCapture(`[${sessionId}] Error taking screenshot: ${e.message}`));
             return { success: true }; // Consider it success if keywords found after timeout
         }
        // Remove the 1-second delay before the timeout screenshot
        // logCapture(`[${sessionId}] [BookingService] Waiting 1 second before timeout/captcha screenshot...`); 
        // await page.waitForTimeout(1000); // Remove 1s delay back
        await page.screenshot({ path: `timeout-or-captcha-screenshot_${sessionId}.png` }).catch(e=>logCapture(`[${sessionId}] Error taking screenshot: ${e.message}`)); // Renamed screenshot
        // Modify error message based on CAPTCHA detection
        const finalErrorMsg = captchaDetected 
            ? 'Potential CAPTCHA detected after submit (60s timeout)' 
            : 'Timed out waiting for confirmation (60s)';
        return { success: false, error: finalErrorMsg };
    }

 } catch (error) {
    logCapture(`[${sessionId}] [BookingService] ❌ Unhandled error during booking process: ${error.message}`);
    logCapture(`[${sessionId}] [BookingService] Stack Trace: ${error.stack}`); // Log stack for unhandled errors
    // Check if page exists and is open before taking screenshot
    if (page && !page.isClosed()) {
        // Attempt screenshot on uncaught error
        await page.screenshot({ path: `error-uncaught-service_${sessionId}.png` }).catch(err => logCapture(`[${sessionId}] [BookingService] ERROR: Failed screenshot on unhandled error: ${err.message}`));
    } else {
        logCapture(`[${sessionId}] [BookingService] WARN: Page object not available or closed, skipping screenshot on unhandled error.`);
    }
    // Return a standard failure object
    return { success: false, error: `Unhandled error in bookingService: ${error.message}` };
 }
}

module.exports = { bookMeeting };

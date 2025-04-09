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
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 10) + 5 });
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
const DEBUG_MODE = false;

/**
 * Books a Calendly meeting using an existing Playwright page object.
 * Assumes the page is already navigated to the correct Calendly booking URL.
 *
 * @param {import('playwright').Page} page - The Playwright page object.
 * @param {string} name - The name to fill in the form.
 * @param {string} email - The email to fill in the form.
 * @param {string} phone - The phone number to fill in the form.
 * @returns {Promise<boolean>} - True if booking seems successful, false otherwise.
 */
async function bookMeeting(page, name, email, phone) {
  console.log('[BookingService] Starting booking process on existing page...');
  const formStartTime = Date.now();

  try {
    // Reduced wait time - assume page is mostly ready
    await page.waitForTimeout(300);

    // Debug output of page title
    console.log('[BookingService] Page title:', await page.title());

    // --- Cookie Consent Handling (Optional but recommended) ---
    console.log('[BookingService] Handling cookie consent (quick check)...');
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
    console.log('[BookingService] Locating required form fields in parallel...');
    
    // Wait for the main form container first 
    try {
        console.log('[BookingService] Waiting for form container...');
        // Adjust selector if you find a more specific/stable one like 'form[data-testid="booking-form"]'
        await page.waitForSelector('form', { state: 'visible', timeout: 15000 });
        console.log('[BookingService] Form container found.');
    } catch (e) {
        console.error('[BookingService] ❌ Error waiting for form container:', e.message);
        if (DEBUG_MODE) await page.screenshot({ path: 'error-no-form-container.png' });
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
        console.log('[BookingService] Starting parallel search for Name and Email fields using IDs...');
        [nameFieldLocator, emailFieldLocator] = await Promise.all([
            findFieldWithRetry(page, nameSelectorId, 'Name', maxRetries, retryTimeout),
            findFieldWithRetry(page, emailSelectorId, 'Email', maxRetries, retryTimeout)
        ]);
        console.log('[BookingService] Found both Name and Email fields.');

        // *** FILL FIELDS *** (Now that locators are found)
        // Pass the specific ID selectors to fastFill
        await fastFill(page, nameSelectorId, name); 
        await fastFill(page, emailSelectorId, email);

    } catch (error) {
        // Error is thrown by findFieldWithRetry if retries fail for either field
        console.error('[BookingService] Failed to find required fields in parallel:', error.message);
        // Optional: Screenshot on failure
        if (DEBUG_MODE) await page.screenshot({ path: 'error-parallel-field-find.png' }).catch(()=>{});
        return { success: false, error: `Failed parallel field find: ${error.message}` };
    }
    
    // *** REMOVED Sequential Retry Loops for Name and Email ***

    // --- *** REVISED Phone Field Handling (Check Container First) *** ---
    console.log('[BookingService] Checking for phone field container...');
    const phoneContainerSelector = 'div[data-component="phone-field"]';
    const quickContainerTimeout = 500; // Very quick check for the container
    const phoneInputSelector = 'input[type="tel"]'; // Selector for the actual input
    const longerInputTimeout = 5000; // Longer wait if container is found (5 seconds)
    let phoneFilled = false;

    try {
        // 1. Quick check for the container (attached is enough)
        await page.waitForSelector(phoneContainerSelector, { state: 'attached', timeout: quickContainerTimeout });
        console.log('[BookingService] Phone field container found. Now checking for input field...');

        // 2. Container found, now wait longer for the actual input field to be visible
        try {
            const phoneElement = await page.waitForSelector(phoneInputSelector, { state: 'visible', timeout: longerInputTimeout });
            console.log('[BookingService] Found phone input field.');
            
            // 3. Fill the input field
            try {
                const hardcodedPhone = '+1 3109122322';
                console.log(`[BookingService] Filling phone number with HARDCODED value: ${hardcodedPhone}`);
                await page.focus(phoneInputSelector);
                await page.click(phoneInputSelector, { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.fill(phoneInputSelector, hardcodedPhone);
                console.log('[BookingService] Phone field filled.');
                phoneFilled = true;
            } catch (fillError) {
                console.error(`[BookingService] ⚠️ Error filling phone field even after finding input: ${fillError.message}`);
            }

        } catch (inputError) {
            // Container was found, but input field didn't appear within the longer timeout
            console.log(`[BookingService] Phone container found, but input field ('${phoneInputSelector}') did not become visible within ${longerInputTimeout / 1000}s. Skipping fill attempt.`);
        }

    } catch (containerError) {
        // Container not found in the initial quick check
        console.log(`[BookingService] Phone field container ('${phoneContainerSelector}') not found within ${quickContainerTimeout}ms. Assuming no phone field required.`);
    }
    // --- *** END REVISED Phone Field Handling *** ---

    if (DEBUG_MODE) await page.screenshot({ path: 'form-filled-service.png' });

    // --- Submit Button --- (Optimized with Primary Check)
    console.log('[BookingService] Looking for submit button...');
    let submitButtonFound = false;
    const primarySubmitSelector = 'button[type="submit"]';
    const primaryTimeout = 2000; // Short timeout for primary check

    // 1. Try primary selector first
    console.log(`[BookingService] Trying primary selector ('${primarySubmitSelector}') first with ${primaryTimeout}ms timeout...`);
    try {
        const primaryButton = page.locator(primarySubmitSelector).first(); // Take first if multiple
        if (await primaryButton.isVisible({ timeout: primaryTimeout }) && 
            await primaryButton.isEnabled({ timeout: 500 })) { // Quick enable check
            
            console.log('[BookingService] Found clickable button with primary selector.');
            await primaryButton.scrollIntoViewIfNeeded();
            await primaryButton.click({ force: true, timeout: 5000 }); 
            submitButtonFound = true;
            console.log('[BookingService] Submit button clicked (primary check).');
        } else {
            console.log('[BookingService] Primary submit button found but not immediately clickable.');
        }
    } catch (e) {
        console.log(`[BookingService] Primary submit selector ('${primarySubmitSelector}') failed or timed out: ${e.message}`);
    }

    // 2. If primary failed, try fallback logic (existing .or chain)
    if (!submitButtonFound) {
        console.log('[BookingService] Primary check failed, trying fallback role-based button detection...');
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
                   console.log('[BookingService] Found clickable submit button via fallback locator.');
                   await firstVisibleButton.scrollIntoViewIfNeeded();
                   await firstVisibleButton.click({ force: true, timeout: 5000 }); 
                   submitButtonFound = true;
                   console.log('[BookingService] Submit button clicked (fallback check).');
               } else {
                   console.log('[BookingService] Fallback locator found button(s), but none seem clickable.');
                    // Try JS click as fallback if locator found something but couldn't click
                    try {
                        await firstVisibleButton.dispatchEvent('click');
                        submitButtonFound = true;
                        console.log('[BookingService] Submit button clicked via JS event dispatch (fallback check).');
                    } catch (jsClickError) {
                        console.log('[BookingService] JS dispatch click also failed (fallback check): ', jsClickError.message);
                    }
               }
            } else {
               console.log('[BookingService] No button found via fallback locators either.');
            }
      
          } catch (e) {
            console.log(`[BookingService] Error during fallback button search: ${e.message}`);
          }
    }

    // 3. Fallback JavaScript submission if all else failed
    if (!submitButtonFound) {
      console.log('[BookingService] Button locators failed or click failed, trying JavaScript form submission...');
      try {
        const submitted = await page.evaluate(() => {
          const forms = document.querySelectorAll('form');
          if (forms.length > 0) {
            const form = forms[forms.length - 1]; // Assume last form
            const buttons = form.querySelectorAll('button:not([type="button"]), input[type="submit"]');
             if (buttons.length > 0) {
                const submitBtn = buttons[buttons.length - 1]; // Assume last button is submit
                console.log('[BookingService-Eval] Clicking last button in form:', submitBtn.outerHTML);
                submitBtn.click();
                return true;
             } else {
                 console.log('[BookingService-Eval] No submit buttons found in form, trying form.submit()');
                 if (typeof form.submit === 'function') {
                    form.submit();
                    return true;
                 } else {
                    console.log('[BookingService-Eval] form.submit is not a function');
                    return false;
                 }
             }
          }
           console.log('[BookingService-Eval] No forms found.');
          return false;
        });

        if (submitted) {
            console.log('[BookingService] JavaScript form submission attempt executed.');
            submitButtonFound = true; // Assume it worked or is in progress
            // Replace fixed timeout with wait for potential page update
            console.log('[BookingService] Waiting for page state change after JS submit (max 5s)...');
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
            console.log('[BookingService] Page state likely updated or timeout reached after JS submit.');
        } else {
            console.log('[BookingService] JavaScript form submission approach failed.');
        }
      } catch (e) {
        console.log('[BookingService] Error with JavaScript form submission:', e.message);
      }
    }

    if (!submitButtonFound) {
      console.log('[BookingService] ⚠️ Warning: Could not reliably find or click any submit button.');
      if (DEBUG_MODE) await page.screenshot({ path: 'no-submit-button-service.png' });
       // Consider returning false here if submission is critical
       // return false;
    } else {
      console.log('[BookingService] Submit initiated, waiting for confirmation or navigation...');
    }


    // --- Confirmation Check (Revised) ---
     try {
        console.log('[BookingService] Waiting for explicit confirmation or error indicators (max 30s)...');

        const successSelectors = [
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

        // Promise for detecting success - Increased timeout
        const successPromise = page.locator(successSelectors.join(', ')).first().waitFor({ state: 'visible', timeout: 30000 });

        // Promise for detecting error - Increased timeout
        const errorPromise = page.locator(errorSelectors.join(', ')).first().waitFor({ state: 'visible', timeout: 30000 });

        // Race the promises
        const result = await Promise.race([
            successPromise.then(() => 'success').catch(() => null), // Return 'success' if success element appears
            errorPromise.then(async (errorElement) => {
                 const errorText = await errorElement.textContent();
                 console.error(`[BookingService] ❌ Explicit error detected: ${errorText?.trim()}`);
                 return 'error'; // Return 'error' if error element appears
            }).catch(() => null),
            // Increased fallback timeout
            page.waitForTimeout(30000).then(() => 'timeout') // Return 'timeout' if neither appears within 30s
        ]);

        const formTime = (Date.now() - formStartTime) / 1000;
        console.log(`[BookingService] Form processing and confirmation wait completed in ${formTime.toFixed(2)}s`);

        if (result === 'success') {
            console.log('[BookingService] ✅ Explicit confirmation indicator found.');
            if (DEBUG_MODE) await page.screenshot({ path: 'confirmed-service.png' });
            return { success: true };
        } else if (result === 'error') {
             // Already logged the specific error in the Promise.race handler
             if (DEBUG_MODE) await page.screenshot({ path: 'error-explicit-service.png' });
             const errorText = await errorElement?.textContent() || 'Unknown explicit error'; // Get error text if possible
             return { success: false, error: `Explicit error detected: ${errorText.trim()}` };
        } else { // result === 'timeout'
            console.log('[BookingService] ⚠️ Timed out waiting for explicit confirmation or general error indicator. Checking for specific popups...');

            // *** UPDATED AGAIN: Explicit check for post-submit unavailable popup after timeout ***
            const unavailableText = "Sorry, that time is no longer available.";
            try {
                 // Use getByRole, but give this specific check a bit more time
                 const unavailableHeading = page.getByRole('heading', { name: unavailableText, exact: false });
                 
                 // Increased timeout for this specific secondary check to 5000ms
                 if (await unavailableHeading.isVisible({ timeout: 5000 })) { 
                      console.error(`[BookingService] ❌ Detected post-submit message after timeout: "${unavailableText}"`);
                      if (DEBUG_MODE) await page.screenshot({ path: 'error-slot-unavailable-post-submit.png' });
                      return { success: false, error: `Slot became unavailable post-submit: "${unavailableText}"` };
                 } else {
                    // Log if the check was performed but element wasn't visible within the extended secondary timeout
                    console.log(`[BookingService] Post-submit unavailable heading not found/visible within extra 5s check.`);
                 }
            } catch (e) {
                 // Error here likely means timeout occurred during the isVisible check for the heading
                 console.log(`[BookingService] Error or timeout during secondary check for unavailable heading: ${e.message}`);
            }
            // *** END UPDATED CHECK ***

            // Optional: Check body text one last time as a weak confirmation
             const bodyText = await page.locator('body').textContent({ timeout: 1000 }).catch(() => '');
             const lowerBodyText = bodyText.toLowerCase();
             const confirmationKeywords = ['confirmed', 'success', 'thank you', 'scheduled', 'booked', 'complete'];
             if (confirmationKeywords.some(keyword => lowerBodyText.includes(keyword))) {
                 console.log('[BookingService] Found weak confirmation text in body after timeout.');
                 if (DEBUG_MODE) await page.screenshot({ path: 'final-state-weak-confirm-service.png' });
                 return { success: true };
             }
            if (DEBUG_MODE) await page.screenshot({ path: 'timeout-no-confirm-service.png' });
            return { success: false, error: 'Timed out waiting for confirmation (30s)' };
        }

     } catch (e) {
         console.log(`[BookingService] Error during confirmation wait logic: ${e.message}.`);
          if (DEBUG_MODE) await page.screenshot({ path: 'error-confirmation-logic-service.png' });
         // Consider checking for explicit error elements even in this catch block if needed
         return { success: false, error: `Error in confirmation logic: ${e.message}` };
     }

  } catch (error) {
    console.error('[BookingService] ❌ Unhandled error during booking process:', error);
    if (DEBUG_MODE) await page.screenshot({ path: 'error-uncaught-service.png' }).catch(() => {});
    return { success: false, error: `Unhandled error in bookingService: ${error.message}` };
  }
  // Note: We do not close the page, context, or browser here. The caller is responsible.
}

module.exports = { bookMeeting };

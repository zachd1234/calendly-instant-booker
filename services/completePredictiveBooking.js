// services/completePredictiveBooking.js

// Set to true if you want to capture screenshots for debugging
const DEBUG_MODE = false;

/**
 * Completes a predictive booking by pressing the submit button
 * on a form that has already been filled out
 * 
 * @param {import('playwright').Page} page - The Playwright page object
 * @param {Function} logCapture - Function to capture logs
 * @returns {Promise<{success: boolean, error?: string, submissionTime?: number}>} Result object
 */
async function completeBooking(page, logCapture = console.log) {
    const startTime = Date.now();
    const formStartTime = startTime;
    logCapture('[CompletePredictive] Starting submission of previously prepared form...');

    try {
        // --- Submit Button --- (Optimized with Primary Check)
        logCapture('[CompletePredictive] Looking for submit button...');
        let submitButtonFound = false;
        const primarySubmitSelector = 'button[type="submit"]';
        const primaryTimeout = 2000; // Short timeout for primary check

        // 1. Try primary selector first
        logCapture(`[CompletePredictive] Trying primary selector ('${primarySubmitSelector}') first with ${primaryTimeout}ms timeout...`);
        try {
            const primaryButton = page.locator(primarySubmitSelector).first(); // Take first if multiple
            if (await primaryButton.isVisible({ timeout: primaryTimeout }) && 
                await primaryButton.isEnabled({ timeout: 500 })) { // Quick enable check
                
                logCapture('[CompletePredictive] Found clickable button with primary selector.');
                await primaryButton.scrollIntoViewIfNeeded();
                await primaryButton.click({ force: true, timeout: 5000 }); 
                submitButtonFound = true;
                logCapture('[CompletePredictive] Submit button clicked (primary check).');
            } else {
                logCapture('[CompletePredictive] Primary submit button found but not immediately clickable.');
            }
        } catch (e) {
            logCapture(`[CompletePredictive] Primary submit selector ('${primarySubmitSelector}') failed or timed out: ${e.message}`);
        }

        // 2. If primary failed, try fallback logic (existing .or chain)
        if (!submitButtonFound) {
            logCapture('[CompletePredictive] Primary check failed, trying fallback role-based button detection...');
            try {
                const submitButton = page.locator('button[type="submit"]') // Keep original chain here as fallback
                  .or(page.getByRole('button', { name: /Schedule|Confirm|Book|Submit|Next|Continue|Complete|Finish|Reserve/i }))
                  .or(page.locator('form button:not([type="button"])').last());
          
                const buttonCount = await submitButton.count();
                if (buttonCount > 0) {
                   const firstVisibleButton = submitButton.first(); 
                   // Use slightly longer timeout for fallback check
                   if (await firstVisibleButton.isVisible({ timeout: 3000 }) && 
                       await firstVisibleButton.isEnabled({ timeout: 1000 })) {
                       logCapture('[CompletePredictive] Found clickable submit button via fallback locator.');
                       await firstVisibleButton.scrollIntoViewIfNeeded();
                       await firstVisibleButton.click({ force: true, timeout: 5000 }); 
                       submitButtonFound = true;
                       logCapture('[CompletePredictive] Submit button clicked (fallback check).');
                   } else {
                       logCapture('[CompletePredictive] Fallback locator found button(s), but none seem clickable.');
                        // Try JS click as fallback if locator found something but couldn't click
                        try {
                            await firstVisibleButton.dispatchEvent('click');
                            submitButtonFound = true;
                            logCapture('[CompletePredictive] Submit button clicked via JS event dispatch (fallback check).');
                        } catch (jsClickError) {
                            logCapture('[CompletePredictive] JS dispatch click also failed (fallback check): ' + jsClickError.message);
                        }
                   }
                } else {
                   logCapture('[CompletePredictive] No button found via fallback locators either.');
                }
          
              } catch (e) {
                logCapture(`[CompletePredictive] Error during fallback button search: ${e.message}`);
              }
        }

        // 3. Fallback JavaScript submission if all else failed
        if (!submitButtonFound) {
          logCapture('[CompletePredictive] Button locators failed or click failed, trying JavaScript form submission...');
          try {
            const submitted = await page.evaluate(() => {
              const forms = document.querySelectorAll('form');
              if (forms.length > 0) {
                const form = forms[forms.length - 1]; // Assume last form
                const buttons = form.querySelectorAll('button:not([type="button"]), input[type="submit"]');
                 if (buttons.length > 0) {
                    const submitBtn = buttons[buttons.length - 1]; // Assume last button is submit
                    console.log('[CompletePredictive-Eval] Clicking last button in form:', submitBtn.outerHTML);
                    submitBtn.click();
                    return true;
                 } else {
                     console.log('[CompletePredictive-Eval] No submit buttons found in form, trying form.submit()');
                     if (typeof form.submit === 'function') {
                        form.submit();
                        return true;
                     } else {
                        console.log('[CompletePredictive-Eval] form.submit is not a function');
                        return false;
                     }
                 }
              }
               console.log('[CompletePredictive-Eval] No forms found.');
              return false;
            });

            if (submitted) {
                logCapture('[CompletePredictive] JavaScript form submission attempt executed.');
                submitButtonFound = true; // Assume it worked or is in progress
                // Replace fixed timeout with wait for potential page update
                logCapture('[CompletePredictive] Waiting for page state change after JS submit (max 5s)...');
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
                logCapture('[CompletePredictive] Page state likely updated or timeout reached after JS submit.');
            } else {
                logCapture('[CompletePredictive] JavaScript form submission approach failed.');
            }
          } catch (e) {
            logCapture('[CompletePredictive] Error with JavaScript form submission: ' + e.message);
          }
        }

        if (!submitButtonFound) {
          logCapture('[CompletePredictive] ⚠️ Warning: Could not reliably find or click any submit button.');
          if (DEBUG_MODE) await page.screenshot({ path: 'no-submit-button-predictive.png' });
          return { 
              success: false, 
              error: 'Failed to find or click submit button',
              submissionTime: parseFloat(((Date.now() - startTime) / 1000).toFixed(2))
          };
        } else {
          logCapture('[CompletePredictive] Submit initiated, waiting for confirmation or navigation...');
        }

        // --- Confirmation Check (Revised) ---
        try {
            logCapture('[CompletePredictive] Waiting for explicit confirmation or error indicators (max 30s)...');

            const successSelectors = [
                // Focus on key text indicators of the final state
                'h1:has-text("You are scheduled")',                     // Exact H1 text seems reliable
                'div:has-text("A calendar invitation has been sent")',  // Specific confirmation text div

                // Keep original fallbacks as lower priority if needed (though .first() takes precedence)
                'h1:has-text("Confirmed")',
                'div:has-text("successfully scheduled")',
                'div[class*="success"i]:visible',
                'div[class*="confirmed"i]:visible',
            ];

            const errorSelectors = [
                'div[class*="error"i]:visible',
                'p[class*="error"i]:visible',
                'span[class*="error"i]:visible',
                'div:has-text("could not be scheduled"):visible',
                // REMOVED specific selector from here - will check separately if timeout occurs
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
                     logCapture(`[CompletePredictive] ❌ Explicit error detected: ${errorText?.trim()}`);
                     return { status: 'error', element: errorElement }; // Return error with element reference
                }).catch(() => null),
                // Increased fallback timeout
                page.waitForTimeout(30000).then(() => 'timeout') // Return 'timeout' if neither appears within 30s
            ]);

            const formTime = (Date.now() - formStartTime) / 1000;
            logCapture(`[CompletePredictive] Form processing and confirmation wait completed in ${formTime.toFixed(2)}s`);

            if (result === 'success') {
                logCapture('[CompletePredictive] ✅ Explicit confirmation indicator found.');
                if (DEBUG_MODE) await page.screenshot({ path: 'confirmed-predictive.png' });
                return { 
                    success: true,
                    submissionTime: parseFloat(formTime.toFixed(2))
                };
            } else if (result && result.status === 'error') {
                 // Already logged the specific error in the Promise.race handler
                 if (DEBUG_MODE) await page.screenshot({ path: 'error-explicit-predictive.png' });
                 const errorText = await result.element?.textContent() || 'Unknown explicit error'; // Get error text if possible
                 return { 
                     success: false, 
                     error: `Explicit error detected: ${errorText.trim()}`,
                     submissionTime: parseFloat(formTime.toFixed(2))
                 };
            } else { // result === 'timeout'
                logCapture('[CompletePredictive] ⚠️ Timed out waiting for explicit confirmation or general error indicator. Checking for specific popups...');

                // *** UPDATED AGAIN: Explicit check for post-submit unavailable popup after timeout ***
                const unavailableText = "Sorry, that time is no longer available.";
                try {
                     // Use getByRole, but give this specific check a bit more time
                     const unavailableHeading = page.getByRole('heading', { name: unavailableText, exact: false });
                     
                     // Increased timeout for this specific secondary check to 5000ms
                     if (await unavailableHeading.isVisible({ timeout: 5000 })) { 
                          logCapture(`[CompletePredictive] ❌ Detected post-submit message after timeout: "${unavailableText}"`);
                          if (DEBUG_MODE) await page.screenshot({ path: 'error-slot-unavailable-post-submit-predictive.png' });
                          return { 
                              success: false, 
                              error: `Slot became unavailable post-submit: "${unavailableText}"`,
                              submissionTime: parseFloat(formTime.toFixed(2))
                          };
                     } else {
                        // Log if the check was performed but element wasn't visible within the extended secondary timeout
                        logCapture(`[CompletePredictive] Post-submit unavailable heading not found/visible within extra 5s check.`);
                     }
                } catch (e) {
                     // Error here likely means timeout occurred during the isVisible check for the heading
                     logCapture(`[CompletePredictive] Error or timeout during secondary check for unavailable heading: ${e.message}`);
                }
                // *** END UPDATED CHECK ***

                // Optional: Check body text one last time as a weak confirmation
                const bodyText = await page.locator('body').textContent({ timeout: 1000 }).catch(() => '');
                const lowerBodyText = bodyText.toLowerCase();
                const confirmationKeywords = ['confirmed', 'success', 'thank you', 'scheduled', 'booked', 'complete'];
                if (confirmationKeywords.some(keyword => lowerBodyText.includes(keyword))) {
                    logCapture('[CompletePredictive] Found weak confirmation text in body after timeout.');
                    if (DEBUG_MODE) await page.screenshot({ path: 'final-state-weak-confirm-predictive.png' });
                    return { 
                        success: true,
                        weakConfirmation: true,
                        submissionTime: parseFloat(formTime.toFixed(2))
                    };
                }
                if (DEBUG_MODE) await page.screenshot({ path: 'timeout-no-confirm-predictive.png' });
                return { 
                    success: false, 
                    error: 'Timed out waiting for confirmation (30s)',
                    submissionTime: parseFloat(formTime.toFixed(2))
                };
            }

        } catch (e) {
            logCapture(`[CompletePredictive] Error during confirmation wait logic: ${e.message}.`);
            if (DEBUG_MODE) await page.screenshot({ path: 'error-confirmation-logic-predictive.png' });
            // Consider checking for explicit error elements even in this catch block if needed
            return { 
                success: false, 
                error: `Error in confirmation logic: ${e.message}`,
                submissionTime: parseFloat(((Date.now() - startTime) / 1000).toFixed(2))
            };
        }

    } catch (error) {
        logCapture(`[CompletePredictive] ❌ Unhandled error during submission process: ${error.message}`);
        if (DEBUG_MODE) await page.screenshot({ path: 'error-uncaught-predictive.png' }).catch(() => {});
        return { 
            success: false, 
            error: `Unhandled error during form submission: ${error.message}`,
            submissionTime: parseFloat(((Date.now() - startTime) / 1000).toFixed(2))
        };
    }
}

module.exports = { completeBooking };
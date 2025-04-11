// Re-implement helper functions here for now, or move to a shared utils file later
// Helper function for more efficient form filling
async function fastFill(page, selector, text) {
    // Special handling for phone fields - clear first then fill
    if (selector.includes('tel')) {
      await page.focus(selector);
      await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
      await page.keyboard.press('Backspace'); // Clear any existing text including country code
      await page.fill(selector, text);
      console.log(`[PredictiveBooking] Phone field cleared and filled directly: ${text}`);
      return;
    }
  
    // For non-phone fields, use regular approach
    try {
      await page.fill(selector, text);
      console.log(`[PredictiveBooking] Fast-filled "${text}" into field`);
  
      // Verify what was typed
      const value = await page.$eval(selector, el => el.value);
  
      if (value !== text) {
        // If direct fill doesn't work correctly, fall back to typing with minimal delay
        console.log(`[PredictiveBooking] Fast-fill resulted in "${value}", falling back to typing`);
        await humanType(page, selector, text);
      }
    } catch (e) {
      console.log(`[PredictiveBooking] Fast-fill failed: ${e.message}, falling back to typing`);
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
      console.log(`[PredictiveBooking] Phone field cleared and filled directly: ${text}`);
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
    console.log(`[PredictiveBooking] Typed "${text}" into field, current value: "${value}"`);
  
    if (value !== text) {
      console.log(`[PredictiveBooking] ⚠️ Warning: Field value "${value}" doesn't match expected "${text}". Retrying...`);
      await page.fill(selector, text);
    }
  }
  
  // *** NEW HELPER FUNCTION for finding fields with retry ***
  async function findFieldWithRetry(page, selector, fieldName, maxRetries, retryTimeout) {
      console.log(`[PredictiveBooking] Looking for ${fieldName} field ('${selector}') with retry...`);
      let fieldLocator = null;
  
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
              console.log(`[PredictiveBooking] ${fieldName} field attempt ${attempt}/${maxRetries}...`);
              fieldLocator = page.locator(selector);
              
              // Check visibility with timeout for this attempt
              await fieldLocator.waitFor({ state: 'visible', timeout: retryTimeout });
              
              console.log(`[PredictiveBooking] Found ${fieldName} field.`);
              return fieldLocator; // Success, return the locator
              
          } catch (e) {
              console.log(`[PredictiveBooking] ${fieldName} field attempt ${attempt} timed out or failed.`);
              if (attempt === maxRetries) {
                   const errorMessage = `❌ Error finding ${fieldName} field after all ${maxRetries} retries: ${e.message}`;
                   console.error('[PredictiveBooking]', errorMessage);
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
  
  // Set to false for performance since we don't need screenshots for preparation
  const DEBUG_MODE = false;
  
  /**
   * Prepares a Calendly booking by navigating directly to the booking URL and filling out the form 
   * but not submitting it
   * 
   * @param {import('playwright').Page} page - The Playwright page object
   * @param {string} bookingUrl - The specific Calendly booking URL with date/time
   * @param {string} name - The name to fill in the form
   * @param {string} email - The email to fill in the form
   * @param {string} phone - The phone number to fill in the form
   * @param {Function} logCapture - Function to capture logs
   * @returns {Promise<{success: boolean, error?: string, navigationTime?: number, totalTime?: number}>} - Result object
   */
  async function prepareBooking(page, bookingUrl, name, email, phone, logCapture = console.log) {
    logCapture('[PredictiveBooking] Starting preparation process for URL: ' + bookingUrl);
    const startTime = Date.now();
  
    try {
      // Navigate directly to the booking URL
      logCapture('[PredictiveBooking] Navigating directly to booking URL...');
      const response = await page.goto(bookingUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
      });
      
      if (!response || !response.ok()) {
          const status = response ? response.status() : 'unknown';
          throw new Error(`Failed to navigate to booking URL. Status: ${status}`);
      }
      
      const navigationTime = (Date.now() - startTime) / 1000;
      logCapture(`[PredictiveBooking] Navigation completed in ${navigationTime.toFixed(2)}s`);
      
      // Wait for page to be interactive
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => 
          logCapture(`[PredictiveBooking] Network idle wait timed out, continuing anyway...`));
  
      // Add the 300ms pause here using standard JavaScript
      await new Promise(resolve => setTimeout(resolve, 300));
  
      // Debug output of page title
      const pageTitle = await page.title();
      logCapture(`[PredictiveBooking] Page title: ${pageTitle}`);
      logCapture(`[PredictiveBooking] Current URL: ${await page.url()}`);
  
      // --- Cookie Consent Handling (Optional but recommended) ---
      logCapture('[PredictiveBooking] Handling cookie consent (quick check)...');
      const cookieSelector = '#onetrust-accept-btn-handler'; // Define selector once
      try {
          const cookieButton = await page.waitForSelector(cookieSelector, { timeout: 500 }).catch(() => null);
          if (cookieButton) {
              logCapture('[PredictiveBooking] Found cookie button via selector, clicking...');
              await cookieButton.click();
              // Replace fixed timeout with wait for button/banner to disappear
              logCapture('[PredictiveBooking] Waiting for cookie banner to hide...');
              await page.locator(cookieSelector).waitFor({ state: 'hidden', timeout: 2000 }); 
              logCapture('[PredictiveBooking] Cookie banner hidden.');
          } else {
               logCapture('[PredictiveBooking] No cookie button found quickly.');
          }
      } catch (e) {
        logCapture(`[PredictiveBooking] Cookie consent check skipped or failed: ${e.message}`);
      }
  
      // --- Form Filling ---
      logCapture('[PredictiveBooking] Locating required form fields in parallel...');
      
      // Wait for the main form container first 
      try {
          logCapture('[PredictiveBooking] Waiting for form container...');
          // Adjust selector if you find a more specific/stable one like 'form[data-testid="booking-form"]'
          await page.waitForSelector('form', { state: 'visible', timeout: 15000 });
          logCapture('[PredictiveBooking] Form container found.');
      } catch (e) {
          logCapture(`[PredictiveBooking] ❌ Error waiting for form container: ${e.message}`);
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
          logCapture('[PredictiveBooking] Starting parallel search for Name and Email fields using IDs...');
          [nameFieldLocator, emailFieldLocator] = await Promise.all([
              findFieldWithRetry(page, nameSelectorId, 'Name', maxRetries, retryTimeout),
              findFieldWithRetry(page, emailSelectorId, 'Email', maxRetries, retryTimeout)
          ]);
          logCapture('[PredictiveBooking] Found both Name and Email fields.');
  
          // *** FILL FIELDS *** (Now that locators are found)
          // Pass the specific ID selectors to fastFill
          await fastFill(page, nameSelectorId, name); 
          await fastFill(page, emailSelectorId, email);
  
      } catch (error) {
          // Error is thrown by findFieldWithRetry if retries fail for either field
          logCapture(`[PredictiveBooking] Failed to find required fields in parallel: ${error.message}`);
          return { success: false, error: `Failed parallel field find: ${error.message}` };
      }
      
      // --- *** REVISED Phone Field Handling (Quick Label Check First) *** ---
      logCapture('[PredictiveBooking] Starting improved phone field detection...');
      let phoneFilled = false;
      const phoneSelectorType = 'input[type="tel"]'; // Use type selector for stability
      
      // STEP 1: Quick check for phone label or container (500ms)
      logCapture('[PredictiveBooking] Checking for phone label or container (quick check: 500ms)...');
      const phoneLabels = [
          'label:has-text("Phone")',
          'label:has-text("phone")',
          'label:has-text("Phone Number")',
          'label:has-text("Mobile")',
          'label:has-text("Contact number")',
          'div:has-text("Phone"):not(:has(input))', // Text-only divs that might be labels
          'div[data-component="phone-field"]' // Known container from previous code
      ];
      
      let phoneFieldLikelyExists = false;
      
      try {
          // Use a locator that combines all potential phone label selectors
          const phoneLabelLocator = page.locator(phoneLabels.join(', '));
          phoneFieldLikelyExists = await phoneLabelLocator.count({ timeout: 500 }) > 0;
          
          if (phoneFieldLikelyExists) {
              logCapture('[PredictiveBooking] Found potential phone label/container. Will proceed with input field search.');
          } else {
              logCapture('[PredictiveBooking] No phone label/container found quickly. Assuming no phone field required.');
          }
      } catch (e) {
          logCapture(`[PredictiveBooking] Error during quick phone label check: ${e.message}`);
          // Assume no phone field if check fails
          phoneFieldLikelyExists = false;
      }
      
      // STEP 2: If label was found, proceed with multi-stage input field search
      if (phoneFieldLikelyExists) {
          logCapture('[PredictiveBooking] Proceeding with multi-stage phone input field search...');
          let phoneElement = null;
          
          // Stage 1: Quick Check (1.5 seconds)
          logCapture('[PredictiveBooking] Phone Check - Stage 1 (Quick: 1.5s timeout)...');
          try {
              phoneElement = await page.waitForSelector(phoneSelectorType, { state: 'visible', timeout: 1500 });
              logCapture('[PredictiveBooking] Found phone field in Stage 1.');
          } catch (e) {
              logCapture('[PredictiveBooking] Phone field not found in Stage 1. Waiting 0.5s...');
              await page.waitForTimeout(500); // Short wait after first failure
  
              // Stage 2: Medium Check (3 seconds)
              logCapture('[PredictiveBooking] Phone Check - Stage 2 (Medium: 3s timeout)...');
              try {
                  phoneElement = await page.waitForSelector(phoneSelectorType, { state: 'visible', timeout: 3000 });
                  logCapture('[PredictiveBooking] Found phone field in Stage 2.');
              } catch (e2) {
                  logCapture('[PredictiveBooking] Phone field not found in Stage 2. Waiting 1s...');
                  await page.waitForTimeout(1000); // Longer wait after second failure
  
                  // Stage 3: Final Check (5 seconds)
                  logCapture('[PredictiveBooking] Phone Check - Stage 3 (Final: 5s timeout)...');
                  try {
                      phoneElement = await page.waitForSelector(phoneSelectorType, { state: 'visible', timeout: 5000 });
                      logCapture('[PredictiveBooking] Found phone field in Stage 3.');
                  } catch (e3) {
                      logCapture('[PredictiveBooking] Phone field not found after all stages. Skipping phone field.');
                      phoneElement = null; // Ensure it's null if not found
                  }
              }
          }
  
          // Fill the field if it was found in any stage
          if (phoneElement) {
              try {
                  // Use the supplied phone number, not hardcoded
                  logCapture(`[PredictiveBooking] Filling phone number: ${phone}`);
                  // Use the stable selector 'phoneSelectorType' for filling
                  await page.focus(phoneSelectorType);
                  await page.click(phoneSelectorType, { clickCount: 3 });
                  await page.keyboard.press('Backspace');
                  await page.fill(phoneSelectorType, phone); 
                  logCapture('[PredictiveBooking] Phone field filled.');
                  phoneFilled = true;
              } catch (fillError) {
                  logCapture(`[PredictiveBooking] ⚠️ Error filling phone field even after finding it: ${fillError.message}`);
                  // Continue without phone if filling fails
              }
          }
      } else {
          logCapture('[PredictiveBooking] Skipping phone field search and fill (no label detected).');
      }
      // --- *** END REVISED Phone Field Handling *** ---
  
      // Look for submit button without clicking it (just to verify form is complete)
      logCapture('[PredictiveBooking] Verifying submit button exists but NOT clicking it...');
      let submitButtonExists = false;
      const primarySubmitSelector = 'button[type="submit"]';
  
      try {
          const primaryButton = page.locator(primarySubmitSelector).first();
          submitButtonExists = await primaryButton.count() > 0;
          
          if (submitButtonExists) {
              logCapture('[PredictiveBooking] Submit button found and form appears ready for submission.');
          } else {
              // Try fallback role-based detection without clicking
              const submitButton = page.locator('button[type="submit"]')
                  .or(page.getByRole('button', { name: /Schedule|Confirm|Book|Submit|Next|Continue|Complete|Finish|Reserve/i }))
                  .or(page.locator('form button:not([type="button"])').last());
              
              submitButtonExists = await submitButton.count() > 0;
              
              if (submitButtonExists) {
                  logCapture('[PredictiveBooking] Submit button found via fallback selector. Form appears ready.');
              } else {
                  logCapture('[PredictiveBooking] ⚠️ Warning: Could not find a submit button. Form may not be complete.');
              }
          }
      } catch (e) {
          logCapture(`[PredictiveBooking] Error checking for submit button: ${e.message}`);
          // Continue anyway - we're not clicking it
      }
  
      // *** IMPORTANT: We're stopping here - not submitting the form ***
      logCapture('[PredictiveBooking] Form filled successfully but NOT submitted as requested');
      
      // Calculate total preparation time
      const totalTime = (Date.now() - startTime) / 1000;
      logCapture(`[PredictiveBooking] Form preparation completed in ${totalTime.toFixed(2)}s`);
      
      // Return success results with timing information
      return {
          success: true,
          navigationTime: parseFloat(navigationTime.toFixed(2)),
          formFilled: true,
          formReady: submitButtonExists,
          totalTime: parseFloat(totalTime.toFixed(2))
      };
  
    } catch (error) {
      logCapture(`[PredictiveBooking] ❌ Error during form preparation: ${error.message}`);
      return { 
          success: false, 
          error: `Error in predictiveBookingService: ${error.message}`,
          totalTime: parseFloat(((Date.now() - startTime) / 1000).toFixed(2))
      };
    }
  }
  
  module.exports = { prepareBooking };
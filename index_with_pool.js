const { chromium } = require('playwright');
require('dotenv').config();
const { getIpSession, releaseSession, getWarmBrowser, isServerRunning } = require('./utils/ipPoolClient');
const config = require('./config');

// Configuration - Moving Calendly URL to code instead of .env
// List of Calendly time slots to cycle through
const CALENDLY_SLOTS = [
  "https://calendly.com/zachderhake/30min/2025-04-22T10:00:00-07:00", // April 22, 2025 at 10:00 AM PDT
  "https://calendly.com/zachderhake/30min/2025-04-22T14:30:00-07:00", // April 22, 2025 at 2:30 PM PDT
  "https://calendly.com/zachderhake/30min/2025-04-23T09:30:00-07:00", // April 23, 2025 at 9:30 AM PDT
  "https://calendly.com/zachderhake/30min/2025-04-23T16:00:00-07:00", // April 23, 2025 at 4:00 PM PDT
  "https://calendly.com/zachderhake/30min/2025-04-24T11:00:00-07:00", // April 24, 2025 at 11:00 AM PDT
  "https://calendly.com/zachderhake/30min/2025-04-24T13:30:00-07:00", // April 24, 2025 at 1:30 PM PDT
  "https://calendly.com/zachderhake/30min/2025-04-25T10:00:00-07:00", // April 25, 2025 at 10:00 AM PDT
  "https://calendly.com/zachderhake/30min/2025-04-25T15:00:00-07:00", // April 25, 2025 at 3:00 PM PDT
  "https://calendly.com/zachderhake/30min/2025-04-26T09:00:00-07:00", // April 26, 2025 at 9:00 AM PDT
  "https://calendly.com/zachderhake/30min/2025-04-26T11:30:00-07:00"  // April 26, 2025 at 11:30 AM PDT
];


// You can change this index to cycle through different time slots (0-9)
const SLOT_INDEX = 6; // Change this to try different slots

// Get current Calendly URL
const CALENDLY_URL = CALENDLY_SLOTS[SLOT_INDEX];

// Other configuration from .env
const NAME = "Happy Tony";
const EMAIL = "happytony@gmail.com";

// Phone number without hyphens
const PHONE_NUMBER = "+1 3109122380";

// OPTIMIZATION #5: Add debug mode flag to control screenshots and verbose logging
const DEBUG_MODE = false; // Set to false for maximum performance, true for debugging

// List of realistic user agents to rotate through
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
];

// Get a random user agent
const getRandomUserAgent = () => {
  const randomIndex = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[randomIndex];
};

// Get a random viewport size that looks realistic
const getRandomViewport = () => {
  const commonWidths = [1280, 1366, 1440, 1536, 1920];
  const commonHeights = [720, 768, 800, 864, 900, 1080];
  
  const randomWidth = commonWidths[Math.floor(Math.random() * commonWidths.length)];
  const randomHeight = commonHeights[Math.floor(Math.random() * commonHeights.length)];
  
  return { width: randomWidth, height: randomHeight };
};

// Helper function for more efficient form filling - OPTIMIZATION #3
async function fastFill(page, selector, text) {
  // Special handling for phone fields - clear first then fill
  if (selector.includes('tel')) {
    await page.focus(selector);
    await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
    await page.keyboard.press('Backspace'); // Clear any existing text including country code
    await page.fill(selector, text);
    console.log(`Phone field cleared and filled directly: ${text}`);
    return;
  }

  // For non-phone fields, use regular approach
  try {
    await page.fill(selector, text);
    console.log(`Fast-filled "${text}" into field`);
    
    // Verify what was typed
    const value = await page.$eval(selector, el => el.value);
    
    if (value !== text) {
      // If direct fill doesn't work correctly, fall back to typing with minimal delay
      console.log(`Fast-fill resulted in "${value}", falling back to typing`);
      await humanType(page, selector, text);
    }
  } catch (e) {
    console.log(`Fast-fill failed: ${e.message}, falling back to typing`);
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
    console.log(`Phone field cleared and filled directly: ${text}`);
    return;
  }

  await page.focus(selector);
  await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
  await page.keyboard.press('Backspace'); // Clear any existing text
  
  // OPTIMIZATION #3: Reduced typing delay from 30-130ms to 5-15ms
  // Type the text with minimal random delays between keystrokes
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 10) + 5 });
  }
  
  // Verify what was typed
  const value = await page.$eval(selector, el => el.value);
  console.log(`Typed "${text}" into field, current value: "${value}"`);
  
  if (value !== text) {
    console.log(`⚠️ Warning: Field value "${value}" doesn't match expected "${text}". Retrying...`);
    await page.fill(selector, text);
  }
}

/**
 * Main booking function using IP Pool and Warm Browser support
 */
async function runBooking() {
  try {
    console.log('Starting booking process with IP Pool and Warm Browser support...');
    
    // Check if IP Pool Server is running
    const serverRunning = await isServerRunning();
    if (!serverRunning) {
      throw new Error('IP Pool Server is not running! Start it with "node ipPoolServer.js" in a separate terminal.');
    }
    
    console.log('IP Pool Server is running, proceeding...');
    
    // Get time for performance metrics
    const startTime = Date.now();
    
    // Get an IP session from the pool
    console.log('Requesting IP session from pool...');
    const sessionStartTime = Date.now();
    
    const session = await getIpSession();
    
    const sessionTime = (Date.now() - sessionStartTime) / 1000;
    console.log(`Got IP session ${session.sessionId} in ${sessionTime.toFixed(2)}s`);
    
    try {
      // Get the warm browser for this session if available, or create a new one
      console.log('Getting browser...');
      const browserStartTime = Date.now();
      
      // Try to get a pre-warmed browser for this session
      const { browser, page, creationTime } = await getWarmBrowser(session);
      
      const browserTime = (Date.now() - browserStartTime) / 1000;
      console.log(`Got browser in ${browserTime.toFixed(2)}s (creation time: ${creationTime.toFixed(2)}s)`);
      
      // Set up page event handling for debugging
      page.on('console', msg => console.log('Browser console:', msg.text()));
      page.on('error', err => console.error('Browser error:', err));
      
      try {
        // Navigate to the booking page
        console.log('Navigating to booking page...');
        const navigationStartTime = Date.now();
        
        // Navigate to the target Calendly URL
        const calendlyUrl = config.CALENDLY_URL || CALENDLY_URL;
        console.log(`Using Calendly URL: ${calendlyUrl}`);
        await page.goto(calendlyUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
        
        const navigationTime = (Date.now() - navigationStartTime) / 1000;
        console.log(`Navigated to booking page in ${navigationTime.toFixed(2)}s`);
        
        // Fill out the form
        console.log('Filling out booking form...');
        const formStartTime = Date.now();
        
        // Wait for form fields to appear - these will be available if we're using a direct timeslot URL
        // Otherwise, we'll need to select a date and time first
        try {
          // First try to directly find the form fields
          const formVisible = await page.waitForSelector('input[name="full_name"]', { 
            timeout: 5000,
            visible: true
          }).then(() => true).catch(() => false);
          
          // If form isn't immediately visible, we may need to select a date/time first
          if (!formVisible) {
            console.log('Form not immediately visible, checking if we need to select a date/time...');
            
            // Check if we're on the date selection page
            const isDateSelection = await page.evaluate(() => {
              return document.querySelector('.calendar-table, [aria-label*="calendar"]') !== null;
            });
            
            if (isDateSelection) {
              console.log('Date selection page detected. We should use a direct time slot URL instead.');
              console.log('Available slots:');
              for (let i = 0; i < CALENDLY_SLOTS.length; i++) {
                console.log(`  ${i}: ${CALENDLY_SLOTS[i]}`);
              }
              console.log(`Current slot index: ${SLOT_INDEX}`);
              
              // Let's try again with a direct URL if we're not already using one
              if (!calendlyUrl.includes('/2025-')) {
                const directUrl = CALENDLY_SLOTS[SLOT_INDEX];
                console.log(`Retrying with direct time slot URL: ${directUrl}`);
                await page.goto(directUrl, { 
                  waitUntil: 'domcontentloaded',
                  timeout: 30000 
                });
                // Now wait for the form
                await page.waitForSelector('input[name="full_name"]', { timeout: 15000 });
              } else {
                throw new Error('Unable to find form fields even with direct time slot URL');
              }
            }
          }
          
          // Once we're sure the form is visible, fill it out
          await page.waitForSelector('input[name="full_name"]', { timeout: 15000 });
          await page.waitForSelector('input[name="email"]', { timeout: 15000 });
          
          console.log('Using enhanced form filling strategies...');
          
          // Fill out the form with the configured name and email using fastFill
          await fastFill(page, 'input[name="full_name"]', NAME || 'Test User');
          await fastFill(page, 'input[name="email"]', EMAIL || 'test@example.com');
          
          // Fill out phone if the field exists
          const phoneFieldExists = await page.$('input[type="tel"]').then(res => !!res).catch(() => false);
          if (phoneFieldExists && PHONE_NUMBER) {
            await fastFill(page, 'input[type="tel"]', PHONE_NUMBER);
          }
          
          // Take a screenshot of the filled form before submission
          await page.screenshot({ path: 'form-filled.png' });
          console.log('Form filled and screenshot taken, proceeding to submit...');
          
          // Enhanced button detection strategy from index.js
          console.log('Using advanced button detection strategy...');
    
    let submitButtonFound = false;
          
          // First try exact role and type - more reliable than CSS selectors
      console.log('Looking for button with type="submit"...');
          try {
      const submitButton = await page.locator('button[type="submit"]')
              .or(page.getByRole('button', { name: 'Schedule Event' }))
        .or(page.locator('form button:last-child'));
      
            // Check if we have more than one button
      const buttonCount = await submitButton.count();
            if (buttonCount > 0) {
        console.log(`Found ${buttonCount} potential submit buttons, trying the most likely one...`);
              
        // Try to get the specific "Schedule Event" button first based on text content
        const exactButton = await page.getByText('Schedule Event').first();
        if (await exactButton.count() > 0) {
          await exactButton.click({ force: true });
          submitButtonFound = true;
          console.log('Clicked "Schedule Event" button');
        } else {
          // Otherwise try button with type="submit"
          const submitTypeButton = await page.locator('button[type="submit"]').first();
          if (await submitTypeButton.count() > 0) {
            await submitTypeButton.click({ force: true });
            submitButtonFound = true;
            console.log('Clicked first submit-type button');
                } else {
                  // Try the form's last button
                  const lastButton = await page.locator('form button:last-child').first();
                  if (await lastButton.count() > 0) {
                    await lastButton.click({ force: true });
                    submitButtonFound = true;
                    console.log('Clicked last button in form');
                  }
                }
              }
            }
          } catch (e) {
            console.log(`Error during role-based button search: ${e.message}`);
          }
          
          // If role-based approach failed, try text-based matching
          if (!submitButtonFound) {
            console.log('Role-based button detection failed, trying text-based matching...');
            
            // Most likely text patterns for submit buttons
            const submitTexts = [
              'Schedule', 'Confirm', 'Book', 'Submit', 'Next',
              'Continue', 'Complete', 'Finish', 'Reserve'
            ];
        
        // Try each submit text directly
        for (const text of submitTexts) {
          if (submitButtonFound) break;
          
          console.log(`Looking for button with text "${text}"...`);
              try {
          const textButton = await page.getByText(text, { exact: false }).filter({ hasText: text });
          
          if (await textButton.count() > 0) {
            console.log(`Found button with text "${text}"`);
            // Check if it's actually a button or button-like element
            const tag = await textButton.evaluate(el => el.tagName.toLowerCase());
            
            if (tag === 'button' || tag === 'input' || 
                (tag === 'a' && await textButton.evaluate(el => el.href)) ||
                await textButton.evaluate(el => el.getAttribute('role') === 'button')) {
              
              // It's a clickable element, so click it
              console.log('Clicking text-matched button...');
              await textButton.scrollIntoViewIfNeeded();
              await textButton.click({ force: true });
              submitButtonFound = true;
              console.log('Text-matched button clicked successfully');
              break;
            } else {
              console.log(`Element with text "${text}" is not a button (${tag})`);
            }
          }
              } catch (e) {
                console.log(`Error trying to find/click "${text}" button: ${e.message}`);
        }
      }
    }
    
          // If all other approaches failed, try JavaScript form submission as a fallback
    if (!submitButtonFound) {
            console.log('All button detection methods failed, trying JavaScript form submission...');
      
      // JavaScript-based form submission as a last resort
            try {
      const formSubmitScript = `
        // Try to find the form
        const forms = document.querySelectorAll('form');
        if (forms.length > 0) {
          console.log('Found', forms.length, 'forms on the page');
          // Find the button in the last form
          const form = forms[forms.length - 1];
          const buttons = form.querySelectorAll('button');
          if (buttons.length > 0) {
            console.log('Found', buttons.length, 'buttons in the form');
            const button = buttons[buttons.length - 1];
            console.log('Clicking last button in form');
            button.click();
            return true;
          } else {
            // No button found in form, try to submit the form directly
            console.log('No buttons found, submitting form directly');
            form.submit();
            return true;
          }
        }
        return false;
      `;
      
        const result = await page.evaluate(formSubmitScript);
        if (result) {
          console.log('JavaScript form submission approach succeeded');
          submitButtonFound = true;
        } else {
          console.log('JavaScript form submission approach failed');
        }
      } catch (e) {
        console.log('Error with JavaScript form submission:', e.message);
      }
    }
    
    if (!submitButtonFound) {
      console.log('⚠️ Warning: Could not find or click any submit button');
        await page.screenshot({ path: 'no-submit-button-found.png' });
            throw new Error('Could not find or click any submit button');
    }
    
          // Wait for confirmation page or navigation
    console.log('Waiting for confirmation or next page...');
    try {
            // Use a more reliable parallel approach for confirmation detection
            console.log('Using enhanced confirmation detection...');
      
      const confirmationSelectors = [
        // Success indicators
        'div.confirmation-page', 
        'div.success-message',
        'div.thank-you-page',
        'div[class*="success"], div[class*="confirmed"]',
        'div[class*="thank"], div[class*="confirmation"]',
        // Text based - for sites without specific classes
        'h1:has-text("Confirmed")', 
        'div:has-text("successfully scheduled")',
              'p:has-text("confirmation")',
              // Generic text patterns that indicate success
              'text=/confirmed|success|thank you|scheduled|booked/i'
      ];
      
      // Try all selectors with short timeouts in parallel
      const confirmationPromises = confirmationSelectors.map(selector => 
              page.waitForSelector(selector, { timeout: 2000 })
          .then(() => {
            console.log(`Confirmation detected with selector: ${selector}`);
            return true;
          })
          .catch(() => false)
      );
      
      // Also add a navigation promise
            const navigationPromise = page.waitForNavigation({ timeout: 10000 })
        .then(() => {
          console.log('Page navigation detected');
          return true;
        })
        .catch(() => false);
      
            // Race all promises with a master timeout
            const confirmationTimeout = new Promise(resolve => setTimeout(() => {
              console.log('Master confirmation timeout reached');
              resolve(false);
            }, 15000));
            
            const results = await Promise.race([
              Promise.all([...confirmationPromises, navigationPromise]),
              confirmationTimeout
            ]);
            
            const confirmed = Array.isArray(results) && results.some(result => result === true);
      
      if (confirmed) {
              console.log('✅ Booking confirmation detected!');
              // Take a screenshot of the confirmation page
              await page.screenshot({ path: 'booking-confirmed.png' });
      } else {
              console.log('No confirmation indicators detected, but booking may still be successful');
              // Still take a screenshot to see the current state
              await page.screenshot({ path: 'post-submission.png' });
    }
    
    // Check for any error messages
    console.log('Checking for error messages...');
    const errorMessage = await page.$('div.error, p.error, div[class*="error"], span[class*="error"]');
    if (errorMessage) {
      const errorText = await errorMessage.textContent();
      console.log(`⚠️ Error detected: ${errorText}`);
      await page.screenshot({ path: 'error-detected.png' });
              throw new Error(`Form submission error: ${errorText}`);
            }
            
          } catch (e) {
            if (e.message.includes('Form submission error')) {
              throw e; // Re-throw form submission errors
            }
            console.log('Confirmation detection timeout, continuing anyway:', e.message);
            // Take a screenshot of the current state
            await page.screenshot({ path: 'confirmation-timeout.png' });
          }
          
        } catch (error) {
          console.error('Error during form filling:', error.message);
          
          // Take a screenshot to help diagnose issues
          await page.screenshot({ path: 'form-error.png' });
          throw error;
        }
        
        const formTime = (Date.now() - formStartTime) / 1000;
        console.log(`Filled out form in ${formTime.toFixed(2)}s`);
    
    // Calculate and log performance metrics
        const totalTime = (Date.now() - startTime) / 1000;
        console.log('\nPerformance summary:');
        console.log(`IP session time: ${sessionTime.toFixed(2)}s`);
        console.log(`Browser time: ${browserTime.toFixed(2)}s`);
        console.log(`Navigation time: ${navigationTime.toFixed(2)}s`);
        console.log(`Form fill time: ${formTime.toFixed(2)}s`);
        console.log(`Total booking time: ${totalTime.toFixed(2)}s`);
        
        console.log('\nBooking process completed successfully!');
        console.log('📅 Appointment has been scheduled.');
        console.log('See booking-confirmed.png for the confirmation screenshot');
    
  } catch (error) {
        console.error('Error during booking process:', error.message);
        
        // Take a screenshot to capture the error state
        try {
          await page.screenshot({ path: 'error-state.png' });
          console.log('Error state screenshot saved as error-state.png');
        } catch (e) {
          console.error('Failed to take error screenshot:', e.message);
        }
      } finally {
        // Close the browser
        try {
          await browser.close();
          console.log('Browser closed');
        } catch (e) {
          console.error('Error closing browser:', e.message);
        }
      }
  } finally {
      // Always release the session back to the pool
      try {
        await releaseSession(session.sessionId);
        console.log(`Released IP session ${session.sessionId} back to pool`);
      } catch (e) {
        console.error('Error releasing session:', e.message);
      }
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the booking process
runBooking().catch(console.error);
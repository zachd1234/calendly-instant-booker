const { chromium } = require('playwright');
require('dotenv').config();
const { getIpSession, releaseSession, getWarmBrowser, isServerRunning } = require('./utils/ipPoolClient');
const config = require('./config');

// Configuration - Moving Calendly URL to code instead of .env
// List of Calendly time slots to cycle through
const CALENDLY_SLOTS = [
"https://calendly.com/zachderhake/30min/2025-04-21T10:00:00-07:00", // April 21, 2025 at 10:00 AM PDT
"https://calendly.com/zachderhake/30min/2025-04-21T14:30:00-07:00", // April 21, 2025 at 2:30 PM PDT
"https://calendly.com/zachderhake/30min/2025-04-22T09:00:00-07:00", // April 22, 2025 at 9:00 AM PDT
"https://calendly.com/zachderhake/30min/2025-04-22T13:30:00-07:00", // April 22, 2025 at 1:30 PM PDT
"https://calendly.com/zachderhake/30min/2025-04-23T11:00:00-07:00", // April 23, 2025 at 11:00 AM PDT
"https://calendly.com/zachderhake/30min/2025-04-23T15:00:00-07:00", // April 23, 2025 at 3:00 PM PDT
"https://calendly.com/zachderhake/30min/2025-04-24T09:30:00-07:00", // April 24, 2025 at 9:30 AM PDT
"https://calendly.com/zachderhake/30min/2025-04-24T14:00:00-07:00", // April 24, 2025 at 2:00 PM PDT
"https://calendly.com/zachderhake/30min/2025-04-25T08:30:00-07:00", // April 25, 2025 at 8:30 AM PDT
"https://calendly.com/zachderhake/30min/2025-04-25T12:30:00-07:00"  // April 25, 2025 at 12:30 PM PDT
];

// You can change this index to cycle through different time slots (0-9)
const SLOT_INDEX = 7; // Change this to try different slots

// Get current Calendly URL
const CALENDLY_URL = CALENDLY_SLOTS[SLOT_INDEX];

// Other configuration from .env
const NAME = process.env.NAME || "Julian Bot";
const EMAIL = process.env.EMAIL || "julian@example.com";

// Phone number without hyphens
const PHONE_NUMBER = "+1 3109122380";

const PROXY_URL = process.env.PROXY_URL;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

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
async function bookCalendlyAppointment() {
  try {
    console.log('Starting Calendly booking process with IP Pool and Warm Browser support...');
    console.log(`Using time slot: ${CALENDLY_URL}`);
    
    // Check if IP Pool Server is running
    const serverRunning = await isServerRunning();
    if (!serverRunning) {
      throw new Error('IP Pool Server is not running! Start it with "node ipPoolServer.js" in a separate terminal.');
    }
    
    console.log('IP Pool Server is running, proceeding...');
    
    // Get time for performance metrics
    const startTime = Date.now();
    
    // Get random user agent and viewport for added realism
    const userAgent = getRandomUserAgent();
    const viewport = getRandomViewport();
    
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
      
      // FIX #1: Add explicit resource blocking to warm browser
      try {
        // Block unnecessary resources for faster loading
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const url = request.url();
          const resourceType = request.resourceType();
          
          if (
            (resourceType === 'image' && !url.includes('calendly')) || 
            (resourceType === 'font') ||
            url.includes('facebook') ||
            url.includes('analytics') ||
            url.includes('tracking') ||
            url.includes('doubleclick') ||
            url.includes('google-analytics') ||
            url.includes('hotjar')
          ) {
            request.abort();
          } else {
            request.continue();
          }
        });
      } catch (e) {
        console.log('Request interception already set up');
        // Continue anyway - interception might already be set up in warm browser
      }
      
      try {
        // Navigate to the Calendly page with some timeout tolerance - OPTIMIZATION #1
        console.log(`Navigating to ${CALENDLY_URL}`);
        const navigationStartTime = Date.now();
        
        // Use 'domcontentloaded' instead of 'load' for faster page navigation
        await page.goto(CALENDLY_URL, { 
          waitUntil: 'domcontentloaded', 
          timeout: 30000,
          referer: 'https://www.google.com/' // Set a referer to appear more natural
        });
        
        const navigationTime = (Date.now() - navigationStartTime) / 1000;
        console.log(`Navigated to booking page in ${navigationTime.toFixed(2)}s`);
        
        // Reduced wait time - just enough for basic UI stabilization
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Debug output of page title
        console.log('Page title:', await page.title());
        
        // FIX #2: Form fill timing
        const formStartTime = Date.now();
        
        // OPTIMIZATION #2: Faster cookie consent handling
        console.log('Handling cookie consent...');
        try {
          // Try immediately accepting via JavaScript (faster than waiting for selector)
          await page.evaluate(() => {
            // Common cookie consent buttons and identifiers
            const selectors = [
              '#onetrust-accept-btn-handler',
              '[aria-label="Accept cookies"]',
              '[aria-label="Accept all cookies"]',
              'button:has-text("Accept")',
              'button:has-text("Accept all")'
            ];
            
            // Try each selector
            for (const selector of selectors) {
              const button = document.querySelector(selector);
              if (button) {
                console.log('Found and clicking cookie button via JS:', selector);
                button.click();
                return true;
              }
            }
            return false;
          });
          
          // Fallback to traditional selector only if needed
          // Using a shorter timeout of 1500ms since we already tried JavaScript approach
          const cookieButton = await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 1500 }).catch(() => null);
          if (cookieButton) {
            console.log('Found cookie button via selector, clicking...');
            await cookieButton.click();
            // Use setTimeout instead of waitForTimeout
            await new Promise(resolve => setTimeout(resolve, 150));
          }
        } catch (e) {
          console.log('No cookie popup found or it was already dismissed');
        }
        
        // Take a screenshot after cookie handling - kept for debugging
        if (DEBUG_MODE) {
          await page.screenshot({ path: 'after-cookies.png' });
        }
        
        // Using generic attribute-based selectors that are less likely to change
        console.log('Using robust attribute-based selectors to find form fields...');
        
        // FIX #3: Proper selector racing with Promise.race()
        console.log('Looking for name field...');
        
        // Define specific selectors with shorter timeouts
        const nameSelectors = [
          'input[name="full_name"]',
          'input[name="name"]',
          'input[id*="name" i]',
          'input[placeholder*="name" i]',
          'input[type="text"]'
        ];
        
        console.log('Racing name selectors with short timeouts...');
        // OPTIMIZATION: Use the same Promise.race pattern as index.js for better performance
        const nameElement = await Promise.race([
          ...nameSelectors.map(selector => 
            page.waitForSelector(selector, { state: 'visible', timeout: 2000 })
              .then(elem => {
                console.log(`Quick match found with selector: ${selector}`);
                return { elem, selector };
              })
              .catch(() => null)
          )
        ].filter(Boolean))
        .catch(() => null);
        
        // Fallback to the combined selector if needed
        let nameSelector = 'input[name="full_name"], input[name="name"], input[id*="name" i], input[placeholder*="name" i], input[type="text"]';
        
        if (nameElement) {
          console.log(`Found name field quickly with selector: ${nameElement.selector}`);
          nameSelector = nameElement.selector;
          // OPTIMIZATION: Use fastFill instead of page.type for faster input
          await fastFill(page, nameSelector, NAME);
        } else {
          console.log('Quick match failed, falling back to combined selector');
          await page.waitForSelector(nameSelector, { state: 'visible', timeout: 4000 });
          console.log('Found name field with fallback selector');
          await fastFill(page, nameSelector, NAME);
        }
        
        // FIX #4: Similar approach with Promise.race for email field
        console.log('Looking for email field...');
        
        const emailSelectors = [
          'input[name="email"]', 
          'input[type="email"]',
          'input[id*="email" i]',
          'input[placeholder*="email" i]'
        ];
        
        console.log('Racing email selectors with short timeouts...');
        // OPTIMIZATION: Use the same Promise.race pattern as index.js
        const emailElement = await Promise.race([
          ...emailSelectors.map(selector => 
            page.waitForSelector(selector, { state: 'visible', timeout: 1500 })
              .then(elem => {
                console.log(`Quick match found with selector: ${selector}`);
                return { elem, selector };
              })
              .catch(() => null)
          )
        ].filter(Boolean))
        .catch(() => null);
        
        let emailSelector = 'input[name="email"], input[type="email"], input[id*="email" i], input[placeholder*="email" i]';
        
        if (emailElement) {
          console.log(`Found email field quickly with selector: ${emailElement.selector}`);
          emailSelector = emailElement.selector;
          // OPTIMIZATION: Use fastFill instead of page.type
          await fastFill(page, emailSelector, EMAIL);
        } else {
          console.log('Quick match failed, falling back to combined selector');
          await page.waitForSelector(emailSelector, { state: 'visible', timeout: 3000 });
          console.log('Found email field with fallback selector');
          await fastFill(page, emailSelector, EMAIL);
        }
        
        // FIX #5: Similar approach with Promise.race for phone field
        console.log('Looking for phone field...');
        
        const phoneSelectors = [
          'input[type="tel"]',
          'input[name*="phone" i]',
          'input[id*="phone" i]',
          'input[placeholder*="phone" i]'
        ];
        
        console.log('Racing phone selectors with short timeouts...');
        // OPTIMIZATION: Use the same Promise.race pattern as index.js
        const phoneElement = await Promise.race([
          ...phoneSelectors.map(selector => 
            page.waitForSelector(selector, { state: 'visible', timeout: 1000 })
              .then(elem => {
                console.log(`Quick match found with selector: ${selector}`);
                return { elem, selector };
              })
              .catch(() => null)
          )
        ].filter(Boolean))
        .catch(() => null);
        
        if (phoneElement) {
          console.log(`Found phone field quickly with selector: ${phoneElement.selector}`);
          console.log(`Using phone number: ${PHONE_NUMBER}`);
          
          // OPTIMIZATION: Use direct fill method for phone
          await page.focus(phoneElement.selector);
          await page.click(phoneElement.selector, { clickCount: 3 }); // Triple click to select all
          await page.keyboard.press('Backspace'); // Clear field including country code
          await page.fill(phoneElement.selector, PHONE_NUMBER);
          console.log('Phone field cleared and filled directly');
        } else {
          // Fallback approach
          const phoneSelector = 'input[type="tel"], input[name*="phone" i], input[id*="phone" i], input[placeholder*="phone" i]';
          try {
            console.log('Quick match failed, falling back to combined selector');
            await page.waitForSelector(phoneSelector, { state: 'visible', timeout: 2000 });
            console.log('Found phone field with fallback selector');
            
            console.log(`Using phone number: ${PHONE_NUMBER}`);
            
            // Clear and fill the phone field
            await page.focus(phoneSelector);
            await page.click(phoneSelector, { clickCount: 3 }); // Triple click to select all
            await page.keyboard.press('Backspace'); // Clear field including country code
            await page.fill(phoneSelector, PHONE_NUMBER);
            console.log('Phone field cleared and filled directly');
          } catch (e) {
            console.log('Phone field not found or not required:', e.message);
          }
        }
        
        // Take a screenshot of filled form
        if (DEBUG_MODE) {
          await page.screenshot({ path: 'form-filled.png' });
        }
        
        // FIX #6: Enhanced submit button detection
        console.log('Looking for submit button...');
        
        let submitButtonFound = false;
        
        // OPTIMIZATION: Use modern page.getByRole() for robust button detection like in index.js
        console.log('Using robust role-based button detection...');
        
        try {
          // Try to find the submit button using the best modern approach
          // This is much more reliable than CSS selectors
          console.log('Trying page.getByRole("button") with common submit texts...');
          
          // Most likely text patterns for submit buttons
          const submitTexts = [
            'Schedule', 'Confirm', 'Book', 'Submit', 'Next',
            'Continue', 'Complete', 'Finish', 'Reserve'
          ];
          
          // First try exact role and type
          console.log('Looking for button with type="submit"...');
          const submitButton = await page.locator('button[type="submit"]')
            .or(page.getByRole('button', { name: 'Schedule Event' })) // Based on what we saw in the last run
            .or(page.locator('form button:last-child'));
          
          // Check if we have more than one button - strict mode would cause issues if not handled
          const buttonCount = await submitButton.count();
          if (buttonCount > 1) {
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
              }
            }
          } else if (buttonCount === 1) {
            // Check if button is visible and enabled before clicking
            const isVisible = await submitButton.isVisible();
            const isEnabled = await submitButton.isEnabled();
            
            console.log(`Found submit button: visible=${isVisible}, enabled=${isEnabled}`);
            
            if (isVisible && isEnabled) {
              console.log('Clicking submit button...');
              // Scroll into view and click
              await submitButton.scrollIntoViewIfNeeded();
              await submitButton.click({ force: true });
              submitButtonFound = true;
              console.log('Submit button clicked successfully');
            } else {
              console.log('Button found but not clickable');
            }
          } else {
            console.log('No submit button found with role selector, trying exact text matches...');
            
            // Try each submit text directly
            for (const text of submitTexts) {
              if (submitButtonFound) break;
              
              console.log(`Looking for button with text "${text}"...`);
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
            }
          }
        } catch (e) {
          console.log(`Error during role-based button search: ${e.message}`);
        }
        
        if (!submitButtonFound) {
          console.log('⚠️ Warning: Could not find or click any submit button');
          await page.screenshot({ path: 'no-submit-button-found.png' });
        } else {
          console.log('Submit button clicked, waiting for confirmation...');
        }
        
        // FIX #7: Better confirmation detection
        console.log('Waiting for confirmation or next page...');
        
        // Use a more reliable parallel approach for confirmation detection
        try {
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
          
          // Also look for navigation events
          const navigationPromise = new Promise(resolve => {
            page.once('framenavigated', () => {
              console.log('Page navigation detected');
              resolve(true);
            });
            
            // Add a timeout to this promise
            setTimeout(() => resolve(false), 5000);
          });
          
          // Master timeout shorter than the previous 3000ms wait
          const timeoutPromise = new Promise(resolve => {
            setTimeout(() => {
              console.log('Confirmation detection timed out after 2.5 seconds');
              resolve(false);
            }, 2500);
          });
          
          // Race the navigation/confirmation detection against the timeout
          const detectionResult = await Promise.race([
            Promise.any([...confirmationPromises, navigationPromise]),
            timeoutPromise
          ]);
          
          if (detectionResult === true) {
            console.log('✅ Confirmation or navigation detected');
          } else {
            console.log('No explicit confirmation detected, continuing...');
          }
        } catch (e) {
          console.log('Error during confirmation detection:', e.message);
        }
        
        // Always take screenshot of result regardless of confirmation
        await page.screenshot({ path: 'submission-result.png' });
        console.log('Screenshot taken of submission result');
        
        // Check for any error messages
        console.log('Checking for error messages...');
        const hasError = await page.evaluate(() => {
          const errorElements = document.querySelectorAll('.error, .error-message, [class*="error"]');
          if (errorElements.length > 0) {
            return errorElements[0].textContent;
          }
          return null;
        });
        
        if (hasError) {
          console.log(`⚠️ Error detected: ${hasError}`);
          await page.screenshot({ path: 'error-detected.png' });
        } else {
          console.log('No visible errors detected');
        }
        
        // FIX #8: Form fill timing end
        const formTime = (Date.now() - formStartTime) / 1000;
        console.log(`Form filling completed in ${formTime.toFixed(2)}s`);
        
        console.log('Booking process completed!');
        
        // Calculate and log performance metrics
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        console.log(`\nPerformance summary:`);
        console.log(`IP session time: ${sessionTime.toFixed(2)}s`);
        console.log(`Browser time: ${browserTime.toFixed(2)}s`);
        console.log(`Navigation time: ${navigationTime.toFixed(2)}s`);
        console.log(`Form fill time: ${formTime.toFixed(2)}s`);
        console.log(`✅ Booking completed in ${duration.toFixed(2)} seconds`);
        
      } catch (error) {
        console.error('❌ Error during booking process:', error);
        // Always take a screenshot on error, even in production
        await page.screenshot({ path: 'error-state.png' }).catch(() => {});
      } finally {
        // FIX #9: Reduce final wait time
        // Wait briefly before closing to ensure any final actions complete
        await new Promise(resolve => setTimeout(resolve, 500));
        
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

/**
 * Extended booking function that accepts parameters from the web interface
 * @param {Object} options - Booking parameters
 * @param {string} options.calendlyUrl - The Calendly URL to book
 * @param {string} options.name - The name to use for booking
 * @param {string} options.email - The email to use for booking
 * @param {string} options.phone - The phone number to use for booking
 * @param {Function} options.logCapture - Optional function to capture logs
 * @returns {Promise<Object>} - Results containing timing information
 */
async function bookCalendlyWithParams(options) {
  // Default log function
  const log = options.logCapture || console.log;
  
  // Extract parameters
  const {
    calendlyUrl,
    name,
    email,
    phone
  } = options;
  
  // Performance metrics
  let sessionTime = 0;
  let browserTime = 0;
  let navigationTime = 0;
  let formTime = 0;
  let duration = 0;
  
  // Set up IP session
  let session = null;
  let browser = null;
  let page = null;
  
  try {
    log('Starting Calendly booking process with provided parameters...');
    log(`Using Calendly URL: ${calendlyUrl}`);
    log(`Using name: ${name}`);
    log(`Using email: ${email}`);
    log(`Using phone: ${phone}`);
    
    // Start timing
    const startTime = Date.now();
    
    // Check if IP Pool Server is running
    const serverRunning = await isServerRunning();
    if (!serverRunning) {
      log('IP Pool Server is not running. Using direct connection.');
      // Continue without IP pool
    } else {
      log('IP Pool Server is running, proceeding with IP session...');
      
      // Get an IP session from the pool
      log('Requesting IP session from pool...');
      const sessionStartTime = Date.now();
      
      try {
        session = await getIpSession();
        sessionTime = (Date.now() - sessionStartTime) / 1000;
        log(`Got IP session ${session.sessionId} in ${sessionTime.toFixed(2)}s`);
      } catch (e) {
        log(`Failed to get IP session: ${e.message}. Continuing with direct connection.`);
        // Continue without IP session
      }
    }
    
    // Get random user agent and viewport for added realism
    const userAgent = getRandomUserAgent();
    const viewport = getRandomViewport();
    
    log(`Using user agent: ${userAgent}`);
    log(`Using viewport: ${viewport.width}x${viewport.height}`);
    
    // Set up browser
    log('Setting up browser...');
    const browserStartTime = Date.now();
    
    try {
      // Try to get a pre-warmed browser if we have a session
      if (session) {
        const browserData = await getWarmBrowser(session);
        browser = browserData.browser;
        page = browserData.page;
        browserTime = (Date.now() - browserStartTime) / 1000;
        log(`Got warm browser in ${browserTime.toFixed(2)}s`);
      } else {
        // Launch a new browser directly
        browser = await chromium.launch({ 
          headless: true
        });
        
        // Create context with randomized settings
        const context = await browser.newContext({
          viewport: viewport,
          userAgent: userAgent,
          deviceScaleFactor: 1,
          locale: 'en-US',
          javaScriptEnabled: true,
          hasTouch: false,
          isMobile: false,
          serviceWorkers: 'block',
          extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
          }
        });
        
        page = await context.newPage();
        browserTime = (Date.now() - browserStartTime) / 1000;
        log(`Launched new browser in ${browserTime.toFixed(2)}s`);
      }
      
      // Set up page event handling for debugging
      page.on('console', msg => log('Browser console: ' + msg.text()));
      page.on('error', err => log('Browser error: ' + err));
      
      // Add explicit resource blocking
      try {
        // Block unnecessary resources for faster loading
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const url = request.url();
          const resourceType = request.resourceType();
          
          if (
            (resourceType === 'image' && !url.includes('calendly')) || 
            (resourceType === 'font') ||
            url.includes('facebook') ||
            url.includes('analytics') ||
            url.includes('tracking') ||
            url.includes('doubleclick') ||
            url.includes('google-analytics') ||
            url.includes('hotjar')
          ) {
            request.abort();
          } else {
            request.continue();
          }
        });
      } catch (e) {
        log('Request interception already set up');
        // Continue anyway - interception might already be set up in warm browser
      }
      
      // Navigate to the Calendly page
      log(`Navigating to ${calendlyUrl}`);
      const navigationStartTime = Date.now();
      
      await page.goto(calendlyUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000,
        referer: 'https://www.google.com/'
      });
      
      navigationTime = (Date.now() - navigationStartTime) / 1000;
      log(`Navigated to booking page in ${navigationTime.toFixed(2)}s`);
      
      // Wait briefly for UI stabilization
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get page title
      log('Page title: ' + await page.title());
      
      // Start form filling process
      const formStartTime = Date.now();
      
      // Handle cookie consent
      log('Handling cookie consent...');
      try {
        // Try JavaScript approach first
        await page.evaluate(() => {
          const selectors = [
            '#onetrust-accept-btn-handler',
            '[aria-label="Accept cookies"]',
            '[aria-label="Accept all cookies"]',
            'button:has-text("Accept")',
            'button:has-text("Accept all")'
          ];
          
          for (const selector of selectors) {
            const button = document.querySelector(selector);
            if (button) {
              console.log('Found and clicking cookie button via JS:', selector);
              button.click();
              return true;
            }
          }
          return false;
        });
        
        // Fallback to traditional selector
        const cookieButton = await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 1500 }).catch(() => null);
        if (cookieButton) {
          log('Found cookie button via selector, clicking...');
          await cookieButton.click();
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      } catch (e) {
        log('No cookie popup found or it was already dismissed');
      }
      
      // Fill name field
      log('Looking for name field...');
      const nameSelectors = [
        'input[name="full_name"]',
        'input[name="name"]',
        'input[id*="name" i]',
        'input[placeholder*="name" i]',
        'input[type="text"]'
      ];
      
      log('Racing name selectors with short timeouts...');
      const nameElement = await Promise.race([
        ...nameSelectors.map(selector => 
          page.waitForSelector(selector, { state: 'visible', timeout: 2000 })
            .then(elem => {
              log(`Quick match found with selector: ${selector}`);
              return { elem, selector };
            })
            .catch(() => null)
        )
      ].filter(Boolean))
      .catch(() => null);
      
      let nameSelector = 'input[name="full_name"], input[name="name"], input[id*="name" i], input[placeholder*="name" i], input[type="text"]';
      
      if (nameElement) {
        log(`Found name field quickly with selector: ${nameElement.selector}`);
        nameSelector = nameElement.selector;
        await fastFill(page, nameSelector, name);
      } else {
        log('Quick match failed, falling back to combined selector');
        await page.waitForSelector(nameSelector, { state: 'visible', timeout: 4000 });
        log('Found name field with fallback selector');
        await fastFill(page, nameSelector, name);
      }
      
      // Fill email field
      log('Looking for email field...');
      const emailSelectors = [
        'input[name="email"]', 
        'input[type="email"]',
        'input[id*="email" i]',
        'input[placeholder*="email" i]'
      ];
      
      log('Racing email selectors with short timeouts...');
      const emailElement = await Promise.race([
        ...emailSelectors.map(selector => 
          page.waitForSelector(selector, { state: 'visible', timeout: 1500 })
            .then(elem => {
              log(`Quick match found with selector: ${selector}`);
              return { elem, selector };
            })
            .catch(() => null)
        )
      ].filter(Boolean))
      .catch(() => null);
      
      let emailSelector = 'input[name="email"], input[type="email"], input[id*="email" i], input[placeholder*="email" i]';
      
      if (emailElement) {
        log(`Found email field quickly with selector: ${emailElement.selector}`);
        emailSelector = emailElement.selector;
        await fastFill(page, emailSelector, email);
      } else {
        log('Quick match failed, falling back to combined selector');
        await page.waitForSelector(emailSelector, { state: 'visible', timeout: 3000 });
        log('Found email field with fallback selector');
        await fastFill(page, emailSelector, email);
      }
      
      // Fill phone field
      log('Looking for phone field...');
      const phoneSelectors = [
        'input[type="tel"]',
        'input[name*="phone" i]',
        'input[id*="phone" i]',
        'input[placeholder*="phone" i]'
      ];
      
      log('Racing phone selectors with short timeouts...');
      const phoneElement = await Promise.race([
        ...phoneSelectors.map(selector => 
          page.waitForSelector(selector, { state: 'visible', timeout: 1000 })
            .then(elem => {
              log(`Quick match found with selector: ${selector}`);
              return { elem, selector };
            })
            .catch(() => null)
        )
      ].filter(Boolean))
      .catch(() => null);
      
      if (phoneElement) {
        log(`Found phone field quickly with selector: ${phoneElement.selector}`);
        log(`Using phone number: ${phone}`);
        
        await page.focus(phoneElement.selector);
        await page.click(phoneElement.selector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.fill(phoneElement.selector, phone);
        log('Phone field cleared and filled directly');
      } else {
        const phoneSelector = 'input[type="tel"], input[name*="phone" i], input[id*="phone" i], input[placeholder*="phone" i]';
        try {
          log('Quick match failed, falling back to combined selector');
          await page.waitForSelector(phoneSelector, { state: 'visible', timeout: 2000 });
          log('Found phone field with fallback selector');
          
          log(`Using phone number: ${phone}`);
          
          await page.focus(phoneSelector);
          await page.click(phoneSelector, { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await page.fill(phoneSelector, phone);
          log('Phone field cleared and filled directly');
        } catch (e) {
          log('Phone field not found or not required: ' + e.message);
        }
      }
      
      // Submit form
      log('Looking for submit button...');
      log('Using robust role-based button detection...');
      
      let submitButtonFound = false;
      try {
        log('Trying page.getByRole("button") with common submit texts...');
        
        const submitTexts = [
          'Schedule', 'Confirm', 'Book', 'Submit', 'Next',
          'Continue', 'Complete', 'Finish', 'Reserve'
        ];
        
        log('Looking for button with type="submit"...');
        const submitButton = await page.locator('button[type="submit"]')
          .or(page.getByRole('button', { name: 'Schedule Event' }))
          .or(page.locator('form button:last-child'));
        
        const buttonCount = await submitButton.count();
        if (buttonCount > 1) {
          log(`Found ${buttonCount} potential submit buttons, trying the most likely one...`);
          const exactButton = await page.getByText('Schedule Event').first();
          if (await exactButton.count() > 0) {
            await exactButton.click({ force: true });
            submitButtonFound = true;
            log('Clicked "Schedule Event" button');
          } else {
            const submitTypeButton = await page.locator('button[type="submit"]').first();
            if (await submitTypeButton.count() > 0) {
              await submitTypeButton.click({ force: true });
              submitButtonFound = true;
              log('Clicked first submit-type button');
            }
          }
        } else if (buttonCount === 1) {
          const isVisible = await submitButton.isVisible();
          const isEnabled = await submitButton.isEnabled();
          
          log(`Found submit button: visible=${isVisible}, enabled=${isEnabled}`);
          
          if (isVisible && isEnabled) {
            log('Clicking submit button...');
            await submitButton.scrollIntoViewIfNeeded();
            await submitButton.click({ force: true });
            submitButtonFound = true;
            log('Submit button clicked successfully');
          } else {
            log('Button found but not clickable');
          }
        } else {
          log('No submit button found with role selector, trying exact text matches...');
          
          for (const text of submitTexts) {
            if (submitButtonFound) break;
            
            log(`Looking for button with text "${text}"...`);
            const textButton = await page.getByText(text, { exact: false }).filter({ hasText: text });
            
            if (await textButton.count() > 0) {
              log(`Found button with text "${text}"`);
              const tag = await textButton.evaluate(el => el.tagName.toLowerCase());
              
              if (tag === 'button' || tag === 'input' || 
                  (tag === 'a' && await textButton.evaluate(el => el.href)) ||
                  await textButton.evaluate(el => el.getAttribute('role') === 'button')) {
                
                log('Clicking text-matched button...');
                await textButton.scrollIntoViewIfNeeded();
                await textButton.click({ force: true });
                submitButtonFound = true;
                log('Text-matched button clicked successfully');
                break;
              } else {
                log(`Element with text "${text}" is not a button (${tag})`);
              }
            }
          }
        }
      } catch (e) {
        log(`Error during role-based button search: ${e.message}`);
      }
      
      if (!submitButtonFound) {
        log('Role-based button detection failed, trying JavaScript form submission...');
        
        const formSubmitScript = `
          const forms = document.querySelectorAll('form');
          if (forms.length > 0) {
            console.log('Found', forms.length, 'forms on the page');
            const form = forms[forms.length - 1];
            const buttons = form.querySelectorAll('button');
            if (buttons.length > 0) {
              console.log('Found', buttons.length, 'buttons in the form');
              const button = buttons[buttons.length - 1];
              console.log('Clicking last button in form');
              button.click();
              return true;
            } else {
              console.log('No buttons found, submitting form directly');
              form.submit();
              return true;
            }
          }
          return false;
        `;
        
        try {
          const result = await page.evaluate(formSubmitScript);
          if (result) {
            log('JavaScript form submission approach succeeded');
            submitButtonFound = true;
          } else {
            log('JavaScript form submission approach failed');
          }
        } catch (e) {
          log('Error with JavaScript form submission: ' + e.message);
        }
      }
      
      if (!submitButtonFound) {
        log('⚠️ Warning: Could not find or click any submit button');
      } else {
        log('Submit button clicked, waiting for confirmation...');
      }
      
      // Wait for confirmation or next page
      log('Waiting for confirmation or next page...');
      try {
        log('Using fast CSS detection for confirmation...');
        
        const confirmationSelectors = [
          'div.confirmation-page', 
          'div.success-message',
          'div.thank-you-page',
          'div[class*="success"], div[class*="confirmed"]',
          'div[class*="thank"], div[class*="confirmation"]',
          'h1:has-text("Confirmed")', 
          'div:has-text("successfully scheduled")',
          'p:has-text("confirmation")'
        ];
        
        const confirmationPromises = confirmationSelectors.map(selector => 
          page.waitForSelector(selector, { timeout: 500 })
            .then(() => {
              log(`Confirmation detected with selector: ${selector}`);
              return true;
            })
            .catch(() => false)
        );
        
        const navigationPromise = page.waitForNavigation({ timeout: 5000 })
          .then(() => {
            log('Page navigation detected');
            return true;
          })
          .catch(() => false);
        
        const results = await Promise.all([...confirmationPromises, navigationPromise]);
        const confirmed = results.some(result => result === true);
        
        if (confirmed) {
          log('Booking confirmation detected quickly');
        } else {
          log('No immediate confirmation detected, continuing anyway');
        }
      } catch (e) {
        log('No clear confirmation detected, but continuing...');
      }
      
      // Check for error messages
      log('Checking for error messages...');
      const errorMessage = await page.$('div.error, p.error, div[class*="error"], span[class*="error"]');
      if (errorMessage) {
        const errorText = await errorMessage.textContent();
        log(`⚠️ Error detected: ${errorText}`);
      } else {
        log('No visible errors detected');
      }
      
      // Calculate form filling time
      formTime = (Date.now() - formStartTime) / 1000;
      log(`Form filling completed in ${formTime.toFixed(2)}s`);
      
      // Calculate total duration
      const endTime = Date.now();
      duration = (endTime - startTime) / 1000;
      
      log(`\nPerformance summary:`);
      if (session) log(`IP session time: ${sessionTime.toFixed(2)}s`);
      log(`Browser time: ${browserTime.toFixed(2)}s`);
      log(`Navigation time: ${navigationTime.toFixed(2)}s`);
      log(`Form fill time: ${formTime.toFixed(2)}s`);
      log(`✅ Booking completed in ${duration.toFixed(2)} seconds`);
      
      // Return the performance metrics
      return {
        success: true,
        sessionTime: sessionTime.toFixed(2),
        browserTime: browserTime.toFixed(2),
        navigationTime: navigationTime.toFixed(2),
        formTime: formTime.toFixed(2),
        duration: duration.toFixed(2)
      };
      
    } catch (error) {
      log('❌ Error during booking process: ' + error.message);
      throw {
        message: error.message,
        logs: error.logs || []
      };
    } finally {
      // Wait briefly before closing to ensure any final actions complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Close the browser if it was created
      if (browser) {
        try {
          await browser.close();
          log('Browser closed');
        } catch (e) {
          log('Error closing browser: ' + e.message);
        }
      }
      
      // Release the IP session if it was obtained
      if (session) {
        try {
          await releaseSession(session.sessionId);
          log(`Released IP session ${session.sessionId} back to pool`);
        } catch (e) {
          log('Error releasing session: ' + e.message);
        }
      }
    }
  } catch (error) {
    log('Fatal error: ' + error.message);
    throw error;
  }
}

// Export the function if this file is required as a module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    bookCalendlyAppointment,
    bookCalendlyWithParams
  };
}

// Run the script only if it's the main file
if (require.main === module) {
bookCalendlyAppointment().catch(console.error);
}
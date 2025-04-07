const { chromium } = require('playwright');
require('dotenv').config();

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
const SLOT_INDEX = 4; // Change this to try different slots

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

async function bookCalendlyAppointment() {
  console.log('Starting Calendly booking process...');
  console.log(`Using time slot: ${CALENDLY_URL}`);
  const startTime = Date.now();
  
  // Get random user agent and viewport for added realism
  const userAgent = getRandomUserAgent();
  const viewport = getRandomViewport();
  
  console.log(`Using proxy: ${PROXY_URL}`);
  console.log(`Using user agent: ${userAgent}`);
  console.log(`Using viewport: ${viewport.width}x${viewport.height}`);
  
  // PERFORMANCE LOGGING: Track browser creation time
  const browserStartTime = Date.now();
  
  // Set headless: false so we can see what's happening when debugging
  const browser = await chromium.launch({ 
    headless: true, // OPTIMIZATION #10: Run headless for best performance
    // Optimization #4: Remove slowMo completely for maximum speed
    // slowMo: 100, // This was slowing down the script by 100ms between actions
    proxy: {
      server: PROXY_URL,
      username: PROXY_USERNAME,
      password: PROXY_PASSWORD
    }
  });
  
  // Create a new browser context with our randomized settings
  const context = await browser.newContext({
    viewport: viewport,
    userAgent: userAgent,
    deviceScaleFactor: 1, // Simplified for now
    locale: 'en-US',
    // OPTIMIZATION #10: Disable unnecessary browser features to speed up page load
    javaScriptEnabled: true, // Keep JS enabled as it's required for Calendly
    hasTouch: false, // Disable touch simulation
    isMobile: false, // Not simulating mobile
    serviceWorkers: 'block', // Block service workers to prevent background processes
    // Block image loading to save bandwidth and speed up page load
    // Only use if you don't need images for the booking process
    extraHTTPHeaders: {
      // Disable image loading and animations to reduce page load time
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache' // Force latest content without cache validation
    }
  });
  
  const page = await context.newPage();
  
  // PERFORMANCE LOGGING: Log browser creation time
  const browserTime = (Date.now() - browserStartTime) / 1000;
  console.log(`Browser created in ${browserTime.toFixed(2)}s`);
  
  // OPTIMIZATION #10: Set route handlers to abort unnecessary requests
  await page.route('**/*.{png,jpg,jpeg,gif,svg,webp}', route => route.abort()); // Block images
  await page.route('**/*.{css}', route => route.continue()); // Let CSS through for layout
  await page.route('**/*.{woff,woff2,ttf,otf,eot}', route => route.abort()); // Block fonts
  await page.route('**/*ga*.js', route => route.abort()); // Block Google Analytics
  await page.route('**/*facebook*.js', route => route.abort()); // Block Facebook tracking
  await page.route('**/*pixel*.js', route => route.abort()); // Block pixel trackers
  
  try {
    // PERFORMANCE LOGGING: Track navigation time
    const navigationStartTime = Date.now();
    
    // Navigate to the Calendly page with some timeout tolerance - OPTIMIZATION #1
    console.log(`Navigating to ${CALENDLY_URL}`);
    // Use 'domcontentloaded' instead of 'load' for faster page navigation
    await page.goto(CALENDLY_URL, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000,
      // OPTIMIZATION #10: Additional page load options
      referer: 'https://www.google.com/' // Set a referer to appear more natural
    });
    
    // PERFORMANCE LOGGING: Log navigation time
    const navigationTime = (Date.now() - navigationStartTime) / 1000;
    console.log(`Navigated to booking page in ${navigationTime.toFixed(2)}s`);
    
    // Reduced wait time from 2000ms to 500ms - just enough for basic UI stabilization
    await page.waitForTimeout(500); 
    
    // Debug output of page title
    console.log('Page title:', await page.title());
    
    // PERFORMANCE LOGGING: Track form filling time
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
        await page.waitForTimeout(150); // Reduced wait time
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
    
    // OPTIMIZATION #6: Use Promise.race() for faster form field detection
    console.log('Looking for name field...');
    
    // Define specific selectors with shorter timeouts
    const nameSelectors = [
      'input[name="full_name"]',
      'input[name="name"]',
      'input[id*="name" i]',
      'input[placeholder*="name" i]',
      'input[type="text"]'
    ];
    
    // Race the selectors against each other
    console.log('Racing name selectors with short timeouts...');
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
      await fastFill(page, nameSelector, NAME);
    } else {
      console.log('Quick match failed, falling back to combined selector');
      await page.waitForSelector(nameSelector, { state: 'visible', timeout: 4000 });
      console.log('Found name field with fallback selector');
      await fastFill(page, nameSelector, NAME);
    }
    
    // OPTIMIZATION #6: Same approach for email field
    console.log('Looking for email field...');
    
    const emailSelectors = [
      'input[name="email"]', 
      'input[type="email"]',
      'input[id*="email" i]',
      'input[placeholder*="email" i]'
    ];
    
    console.log('Racing email selectors with short timeouts...');
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
      await fastFill(page, emailSelector, EMAIL);
    } else {
      console.log('Quick match failed, falling back to combined selector');
      await page.waitForSelector(emailSelector, { state: 'visible', timeout: 3000 });
      console.log('Found email field with fallback selector');
      await fastFill(page, emailSelector, EMAIL);
    }
    
    // OPTIMIZATION #6: Same approach for phone field
    console.log('Looking for phone field...');
    
    const phoneSelectors = [
      'input[type="tel"]',
      'input[name*="phone" i]',
      'input[id*="phone" i]',
      'input[placeholder*="phone" i]'
    ];
    
    console.log('Racing phone selectors with short timeouts...');
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
      
      // Clear and fill the phone field
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
    
    // Use a more generic and robust approach for the submit button
    console.log('Looking for submit button...');
    
    // OPTIMIZATION #9: Use modern page.getByRole() for robust button detection
    console.log('Using robust role-based button detection...');
    
    let submitButtonFound = false;
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
    
    // If role-based approach failed, try JavaScript submission as a fallback
    if (!submitButtonFound) {
      console.log('Role-based button detection failed, trying JavaScript form submission...');
      
      // JavaScript-based form submission as a last resort
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
      
      try {
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
      if (DEBUG_MODE) {
        await page.screenshot({ path: 'no-submit-button-found.png' });
      }
    } else {
      console.log('Submit button clicked, waiting for confirmation...');
    }
    
    // Wait for navigation or confirmation
    console.log('Waiting for confirmation or next page...');
    try {
      // OPTIMIZATION #7: Faster confirmation detection with specific CSS selectors
      // We use a very short timeout for each check and run them in parallel
      console.log('Using fast CSS detection for confirmation...');
      
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
        'p:has-text("confirmation")' 
      ];
      
      // Try all selectors with short timeouts in parallel
      const confirmationPromises = confirmationSelectors.map(selector => 
        page.waitForSelector(selector, { timeout: 500 })
          .then(() => {
            console.log(`Confirmation detected with selector: ${selector}`);
            return true;
          })
          .catch(() => false)
      );
      
      // Also add a navigation promise
      const navigationPromise = page.waitForNavigation({ timeout: 5000 })
        .then(() => {
          console.log('Page navigation detected');
          return true;
        })
        .catch(() => false);
      
      // Race all promises
      const results = await Promise.all([...confirmationPromises, navigationPromise]);
      const confirmed = results.some(result => result === true);
      
      if (confirmed) {
        console.log('Booking confirmation detected quickly');
      } else {
        console.log('No immediate confirmation detected, continuing anyway');
      }
    } catch (e) {
      console.log('No clear confirmation detected, but continuing...');
    }
    
    // Check for any error messages
    console.log('Checking for error messages...');
    const errorMessage = await page.$('div.error, p.error, div[class*="error"], span[class*="error"]');
    if (errorMessage) {
      const errorText = await errorMessage.textContent();
      console.log(`⚠️ Error detected: ${errorText}`);
      // Always take a screenshot on error, even in production
      await page.screenshot({ path: 'error-detected.png' });
    } else {
      console.log('No visible errors detected');
    }
    
    // PERFORMANCE LOGGING: Log form filling time
    const formTime = (Date.now() - formStartTime) / 1000;
    console.log(`Form filling completed in ${formTime.toFixed(2)}s`);
    
    // Take final screenshot
    if (DEBUG_MODE) {
      await page.screenshot({ path: 'final-result.png' });
    }
    
    console.log('Booking process completed!');
    
    // Calculate and log performance metrics
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    // PERFORMANCE LOGGING: Log detailed performance breakdown
    console.log(`\nPerformance summary:`);
    console.log(`Browser time: ${browserTime.toFixed(2)}s`);
    console.log(`Navigation time: ${navigationTime.toFixed(2)}s`);
    console.log(`Form fill time: ${formTime.toFixed(2)}s`);
    console.log(`✅ Booking completed in ${duration.toFixed(2)} seconds`);
    
  } catch (error) {
    console.error('❌ Error during booking process:', error);
    // Always take a screenshot on error, even in production
    await page.screenshot({ path: 'error-state.png' }).catch(() => {});
  } finally {
    // OPTIMIZATION #8: Remove unnecessary wait time completely
    // Only wait if in debug mode for visual checking
    if (DEBUG_MODE) {
      await page.waitForTimeout(2000); // Reduced even in debug mode
    }
    
    // Close everything
    await context.close();
    await browser.close();
  }
}

// Run the script
bookCalendlyAppointment().catch(console.error);
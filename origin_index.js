const { chromium } = require('playwright');
require('dotenv').config();
const { getIpSession, releaseSession, getWarmBrowser, isServerRunning } = require('./utils/ipPoolClient');
const config = require('./config');

// Configuration - Using main Calendly page and scheduling via calendar selection
const CALENDLY_BASE_URL = "https://calendly.com/zachderhake/30min?back=1&month=2025-04";

// Define available dates and times to select
const CALENDAR_OPTIONS = [
  { date: "7", time: "9 AM", selector: "9:00am" }, // Monday April 7, 9 AM
  { date: "7", time: "11 AM", selector: "11:00am" }, // Monday April 7, 11 AM
  { date: "10", time: "9 AM", selector: "9:00am" }, // Thursday April 10, 9 AM
  { date: "10", time: "11 AM", selector: "11:00am" } // Thursday April 10, 11 AM
];

// You can change this index to cycle through different time slots (0-3)
const SLOT_INDEX = 0; // Change this to try different slots

// Get current Calendly selection
const CURRENT_SLOT = CALENDAR_OPTIONS[SLOT_INDEX];

// Other configuration from .env
const NAME = process.env.NAME || "Julian Bot";
const EMAIL = process.env.EMAIL || "julian@example.com";

// Phone number without hyphens
const PHONE_NUMBER = "+1 3109122380";

const PROXY_URL = process.env.PROXY_URL;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

// Enable debug mode for visual inspection and screenshots
const DEBUG_MODE = true; // Set to true for debugging and screenshots

// Add a demo mode flag to slow down actions for visual observation
const DEMO_MODE = true; // Set to true to slow down actions for observation

// Helper function to wait a bit between actions in demo mode
async function demoWait(ms = 500) {
  if (DEMO_MODE) {
    console.log(`Demo mode: waiting ${ms}ms...`);
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

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
    
    if (DEMO_MODE) {
      // Type slowly in demo mode
      for (const char of text) {
        await page.keyboard.type(char, { delay: Math.floor(Math.random() * 100) + 50 });
        await demoWait(50);
      }
    } else {
      await page.fill(selector, text);
    }
    
    console.log(`Phone field cleared and filled directly: ${text}`);
    return;
  }

  await page.focus(selector);
  await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
  await page.keyboard.press('Backspace'); // Clear any existing text
  
  // Type the text with appropriate delays based on mode
  if (DEMO_MODE) {
    // Slower typing in demo mode for visibility
    for (const char of text) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 100) + 50 });
    }
  } else {
    // OPTIMIZATION #3: Reduced typing delay from 30-130ms to 5-15ms
    // Type the text with minimal random delays between keystrokes
    for (const char of text) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 10) + 5 });
    }
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
 * Helper function to find and click a calendar date using multiple strategies
 * @param {Page} page - Playwright page object 
 * @param {string} dateStr - Date string to find (e.g., "7" for 7th of the month)
 * @returns {Promise<boolean>} - True if date was found and clicked successfully
 */
async function findAndClickCalendarDate(page, dateStr) {
  console.log(`Attempting to find and click date: ${dateStr}`);
  
  await demoWait(1000); // Wait a moment to show the calendar
  
  // Strategy 1: Try using role-based selection (most reliable)
  try {
    const dateCell = await page.locator('td[role="gridcell"]')
      .filter({ hasText: new RegExp(`^${dateStr}$`) })
      .first();
    
    const count = await dateCell.count();
    if (count > 0) {
      // Check if clickable
      const isDisabled = await dateCell.getAttribute('aria-disabled')
        .then(val => val === 'true')
        .catch(() => false);
      
      if (!isDisabled) {
        // Highlight before clicking in demo mode
        if (DEMO_MODE) {
          await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (element) {
              element.style.border = '3px solid red';
              element.style.backgroundColor = 'yellow';
            }
          }, `td[role="gridcell"]:has-text("${dateStr}")`);
          
          await demoWait(1000);
        }
        
        await dateCell.click();
        console.log(`Successfully clicked date ${dateStr} using role strategy`);
        await demoWait(1000);
        return true;
      } else {
        console.log(`Date ${dateStr} found but is disabled`);
      }
    }
  } catch (e) {
    console.log(`Role-based date selection failed: ${e.message}`);
  }
  
  // Strategy 2: Try using the specific selector provided in the requirements
  try {
    // This is based on the selector pattern from the requirements
    // We'll make it more generic to improve chances of success
    const dateSelector = `table tbody tr td:has-text("${dateStr}")`;
    const dateElement = await page.locator(dateSelector).first();
    
    if (await dateElement.count() > 0) {
      await dateElement.click();
      console.log(`Successfully clicked date ${dateStr} using custom selector`);
      return true;
    }
  } catch (e) {
    console.log(`Custom selector date selection failed: ${e.message}`);
  }
  
  // Strategy 3: Fallback to simple text-based button detection
  try {
    const dateButton = await page.getByText(dateStr, { exact: true })
      .filter({ hasText: new RegExp(`^${dateStr}$`) })
      .first();
    
    if (await dateButton.count() > 0) {
      await dateButton.click();
      console.log(`Successfully clicked date ${dateStr} using text strategy`);
      return true;
    }
  } catch (e) {
    console.log(`Text-based date selection failed: ${e.message}`);
  }
  
  console.log(`Failed to find and click date: ${dateStr} with any strategy`);
  return false;
}

/**
 * Helper function to find and click a time slot using multiple strategies
 * @param {Page} page - Playwright page object
 * @param {string} timeStr - Time string to find (e.g., "9 AM")
 * @param {string} timeSelector - Optional selector text (e.g., "9:00am")
 * @returns {Promise<boolean>} - True if time slot was found and clicked successfully
 */
async function findAndClickTimeSlot(page, timeStr, timeSelector) {
  console.log(`Attempting to find and click time slot: ${timeStr}`);
  
  await demoWait(1000); // Wait a moment to show the time slots
  
  // Strategy 1: Try using exact text match with the selector
  if (timeSelector) {
    try {
      const timeElement = await page.getByText(timeSelector, { exact: true })
        .first();
      
      if (await timeElement.count() > 0) {
        // Find the closest button ancestor
        const timeButton = await timeElement.locator('xpath=ancestor::button').first();
        
        if (await timeButton.count() > 0) {
          // Check if it's disabled
          const isDisabled = await timeButton.getAttribute('aria-disabled')
            .then(val => val === 'true')
            .catch(() => false);
          
          if (!isDisabled) {
            // Highlight before clicking in demo mode
            if (DEMO_MODE) {
              await timeButton.evaluate(node => {
                node.style.border = '3px solid red';
                node.style.backgroundColor = 'yellow';
              });
              
              await demoWait(1000);
            }
            
            await timeButton.click();
            console.log(`Successfully clicked time ${timeStr} using exact selector text`);
            await demoWait(1000);
            return true;
          } else {
            console.log(`Time slot ${timeStr} found but is disabled`);
          }
        }
      }
    } catch (e) {
      console.log(`Exact selector text time selection failed: ${e.message}`);
    }
  }
  
  // Strategy 2: Try using the hour number with am/pm
  try {
    const timeDigit = timeStr.split(' ')[0]; // Get just the hour number
    const amPm = timeStr.split(' ')[1].toLowerCase(); // Get am/pm
    
    const timeButton = await page.locator(`button:has-text("${timeDigit}"):has-text("${amPm}")`).first();
    
    if (await timeButton.count() > 0) {
      const isDisabled = await timeButton.getAttribute('aria-disabled')
        .then(val => val === 'true')
        .catch(() => false);
      
      if (!isDisabled) {
        // Highlight before clicking in demo mode
        if (DEMO_MODE) {
          await timeButton.evaluate(node => {
            node.style.border = '3px solid red';
            node.style.backgroundColor = 'yellow';
          });
          
          await demoWait(1000);
        }
        
        await timeButton.click();
        console.log(`Successfully clicked time ${timeStr} using hour and am/pm`);
        await demoWait(1000);
        return true;
      } else {
        console.log(`Time slot ${timeStr} found but is disabled`);
      }
    }
  } catch (e) {
    console.log(`Hour and am/pm time selection failed: ${e.message}`);
  }
  
  // Strategy 3: Just try to find a button with the hour
  try {
    const timeDigit = timeStr.split(' ')[0]; // Get just the hour number
    const timeButton = await page.locator(`button:has-text("${timeDigit}")`).first();
    
    if (await timeButton.count() > 0) {
      // Highlight before clicking in demo mode
      if (DEMO_MODE) {
        await timeButton.evaluate(node => {
          node.style.border = '3px solid red';
          node.style.backgroundColor = 'yellow';
        });
        
        await demoWait(1000);
      }
      
      await timeButton.click();
      console.log(`Successfully clicked time containing ${timeDigit} (fallback strategy)`);
      await demoWait(1000);
      return true;
    }
  } catch (e) {
    console.log(`Simple hour-only time selection failed: ${e.message}`);
  }
  
  console.log(`Failed to find and click time: ${timeStr} with any strategy`);
  return false;
}

/**
 * Main booking function using IP Pool and Warm Browser support
 */
async function bookCalendlyAppointment() {
  let browser;
  let page;
  
  try {
    console.log('Starting Calendly booking process with direct browser launch...');
    console.log(`Using calendar approach - Date: ${CALENDAR_OPTIONS[SLOT_INDEX].date} ${CALENDAR_OPTIONS[SLOT_INDEX].time}`);
    
    // Skip IP Pool check for direct browser launch
    // Get time for performance metrics
    const startTime = Date.now();
    
    // Launch browser directly - GUARANTEED VISIBLE
    console.log('Launching visible browser directly...');
    const browserStartTime = Date.now();
    
    browser = await chromium.launch({
      headless: false, // FORCE VISIBLE BROWSER
      slowMo: 50, // Add slight delay between actions for visibility
      args: ['--start-maximized'] // Start with maximized window
    });
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: getRandomUserAgent()
    });
    
    page = await context.newPage();
    
    const browserTime = (Date.now() - browserStartTime) / 1000;
    console.log(`Browser launched in ${browserTime.toFixed(2)}s`);
    
    // Set up page event handling for debugging
    page.on('console', msg => console.log('Browser console:', msg.text()));
    page.on('error', err => console.error('Browser error:', err));
    
    try {
      // Navigate to the Calendly page
      console.log(`Navigating to ${CALENDLY_BASE_URL}`);
      const navigationStartTime = Date.now();
      
      await page.goto(CALENDLY_BASE_URL, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000
      });
      
      const navigationTime = (Date.now() - navigationStartTime) / 1000;
      console.log(`Navigated to booking page in ${navigationTime.toFixed(2)}s`);
      
      // Wait longer in demo mode to make sure page is fully loaded
      await demoWait(2000);
      
      // Debug output of page title
      console.log('Page title:', await page.title());
      
      // Take screenshot to verify we're on the right page
      if (DEBUG_MODE) {
        await page.screenshot({ path: 'calendly-page-loaded.png' });
        console.log('Screenshot saved: calendly-page-loaded.png');
      }
      
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
        const cookieButton = await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 1500 }).catch(() => null);
        if (cookieButton) {
          console.log('Found cookie button via selector, clicking...');
          await cookieButton.click();
          await demoWait(500);
        }
      } catch (e) {
        console.log('No cookie popup found or it was already dismissed');
      }
      
      // Check if calendar is visible and log it
      const calendarVisible = await page.locator('table[role="grid"]').isVisible()
        .catch(() => false);
        
      console.log(`Calendar visible: ${calendarVisible}`);
      
      if (!calendarVisible) {
        console.log('Calendar not immediately visible, waiting longer...');
        await demoWait(3000);
        await page.screenshot({ path: 'no-calendar-visible.png' });
      }
      
      // SPECIAL HANDLING: Log all visible dates on the page
      console.log('Checking for all visible dates on the page...');
      const visibleDates = await page.evaluate(() => {
        const dates = [];
        const cells = document.querySelectorAll('td[role="gridcell"]');
        cells.forEach(cell => {
          if (cell.textContent) {
            dates.push(cell.textContent.trim());
          }
        });
        return dates;
      });
      
      console.log('Visible dates on page:', visibleDates.join(', '));
      
      console.log(`Selecting date: April ${CURRENT_SLOT.date} and time: ${CURRENT_SLOT.time}`);
      
      // Step 1: Find and click on the date cell
      const dateSelectionStartTime = Date.now();
      
      // Use our helper function to find and click the date
      const dateSelected = await findAndClickCalendarDate(page, CURRENT_SLOT.date);
      
      if (!dateSelected) {
        console.log('Failed to find date with helper function, trying direct approach...');
        
        // DIRECT SELECTOR APPROACH BASED ON YOUR EXAMPLE
        const directDateSelector = `#root div table tbody tr td:has-text("${CURRENT_SLOT.date}")`;
        console.log(`Trying direct selector: ${directDateSelector}`);
        
        const directDateElement = await page.locator(directDateSelector).first();
        const directDateCount = await directDateElement.count();
        
        if (directDateCount > 0) {
          console.log('Found date with direct selector, clicking...');
          await directDateElement.click();
          await demoWait(1000);
        } else {
          throw new Error(`Could not select date: April ${CURRENT_SLOT.date}`);
        }
      }
      
      // Wait for time slots to appear
      console.log('Waiting for time slots to appear...');
      await page.waitForSelector('button:has-text("am"), button:has-text("pm")', { timeout: 5000 })
        .catch(() => console.log('Time slots not immediately visible, will attempt to find them anyway'));
      
      // Short wait for slot loading animations
      await demoWait(1000);
      
      // Take screenshot of time slots
      if (DEBUG_MODE) {
        await page.screenshot({ path: 'time-slots.png' });
        console.log('Screenshot saved: time-slots.png');
      }
      
      console.log('Looking for time slot:', CURRENT_SLOT.time);
      
      // Use our helper function to find and click the time slot
      const timeSelected = await findAndClickTimeSlot(page, CURRENT_SLOT.time, CURRENT_SLOT.selector);
      
      if (!timeSelected) {
        console.log('Failed to find time slot with helper function, trying direct approach...');
        
        // DIRECT APPROACH BASED ON YOUR EXAMPLE
        const directTimeSelector = `#root div div button:has-text("${CURRENT_SLOT.time}")`;
        console.log(`Trying direct time selector: ${directTimeSelector}`);
        
        const directTimeElement = await page.locator(directTimeSelector).first();
        const directTimeCount = await directTimeElement.count();
        
        if (directTimeCount > 0) {
          console.log('Found time with direct selector, clicking...');
          await directTimeElement.click();
          await demoWait(1000);
        } else {
          throw new Error(`Could not select time slot: ${CURRENT_SLOT.time}`);
        }
      }
      
      // CRITICAL: Click the next button after selecting time
      console.log('Looking for next button...');
      await demoWait(1000);
      
      // Try the exact selector provided
      const nextButtonSelector = '#root > div > div > div._cUP1np9gMvFQrcPftuf.OGcBAyJGBej5Gnyi9hGA.xahN8AEzyAvQtVj17TPv > div > div.RYnJj29bLVmiyJvHVmzb.nWu9Zvwiwu85_8rxv0te > div > div.lpx6VnBZqi_W0t49PbpN._UogyrpgpepFIi1ExEhD.h_naiTqQYnekEMXseja4.p5aCe_GsjzJXRgd9p0Vh._yt2xIzwJsjp0eWacJSD > div.VRGx4qsQJFRTeK5H1F9s.XAHgqNbjEjS_yCQMDsLx.JTf_klBsglL5HxNh042p > div > div > div:nth-child(1) > button.uvkj3lh.y9_mQD7Hd4ZLZ4SUzgyw.jyr1fbkKIhuAcffh_VRx.VfCFnsGvnnkn_bFdwv5V._jYiR9T_piWilfmGslIg._hOCj_sBOEZ7LFd5ZO9h';
      
      // Screenshot before trying to click next button
      if (DEBUG_MODE) {
        await page.screenshot({ path: 'before-next-button.png' });
        console.log('Screenshot saved: before-next-button.png');
      }
      
      // First try the specific selector provided
      try {
        console.log('Trying exact next button selector...');
        const nextButtonExact = await page.locator(nextButtonSelector).first();
        const nextButtonExactCount = await nextButtonExact.count();
        
        if (nextButtonExactCount > 0) {
          // Highlight the button before clicking in demo mode
          if (DEMO_MODE) {
            await nextButtonExact.evaluate(node => {
              node.style.border = '3px solid red';
              node.style.backgroundColor = 'yellow';
            });
            await demoWait(1000);
          }
          
          console.log('Found next button with exact selector, clicking...');
          await nextButtonExact.click();
          console.log('Clicked next button with exact selector');
          await demoWait(1000);
        } else {
          throw new Error('Next button not found with exact selector, trying alternatives');
        }
      } catch (e) {
        console.log(`Exact selector failed: ${e.message}`);
        
        // Try alternative selectors
        try {
          // Look for a button with text that indicates "next" or "continue"
          const nextButtonText = await page.getByRole('button', { name: /next|continue|schedule|proceed/i }).first();
          
          if (await nextButtonText.count() > 0) {
            // Highlight the button before clicking in demo mode
            if (DEMO_MODE) {
              await nextButtonText.evaluate(node => {
                node.style.border = '3px solid red';
                node.style.backgroundColor = 'yellow';
              });
              await demoWait(1000);
            }
            
            console.log('Found next button by text, clicking...');
            await nextButtonText.click();
            console.log('Clicked next button by text');
            await demoWait(1000);
          } else {
            // Try CSS-based approach
            const cssNextButton = await page.locator('button[class*="uvkj3lh"]').first();
            
            if (await cssNextButton.count() > 0) {
              // Highlight the button before clicking in demo mode
              if (DEMO_MODE) {
                await cssNextButton.evaluate(node => {
                  node.style.border = '3px solid red';
                  node.style.backgroundColor = 'yellow';
                });
                await demoWait(1000);
              }
              
              console.log('Found next button by class, clicking...');
              await cssNextButton.click();
              console.log('Clicked next button by class');
              await demoWait(1000);
            } else {
              console.log('Could not find next button with any approach. Taking screenshot for debugging...');
              await page.screenshot({ path: 'next-button-not-found.png' });
              throw new Error('Could not find next button after time selection');
            }
          }
        } catch (nextError) {
          console.error('Error finding or clicking next button:', nextError);
          await page.screenshot({ path: 'next-button-error.png' });
          throw nextError;
        }
      }
      
      // Wait for the form to appear
      console.log('Waiting for booking form to appear...');
      await page.waitForSelector('input[type="text"], input[name="full_name"], input[name="name"]', { timeout: 5000 });
      console.log('Booking form loaded');
      
      // Take screenshot of form if in debug mode
      if (DEBUG_MODE) {
        await page.screenshot({ path: 'booking-form.png' });
        console.log('Screenshot saved: booking-form.png');
      }
      
      const dateSelectionTime = (Date.now() - dateSelectionStartTime) / 1000;
      console.log(`Calendar selection completed in ${dateSelectionTime.toFixed(2)}s`);
      
      // FIX #2: Form fill timing
      const formStartTime = Date.now();
      
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
      
      // For demo purposes, we'll keep the browser open for inspection
      console.log('\n✅ BROWSER WINDOW KEPT OPEN FOR INSPECTION');
      console.log('Please close the browser window manually when finished');
      
      // Calculate and log performance metrics
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      console.log(`\nPerformance summary:`);
      console.log(`Browser time: ${browserTime.toFixed(2)}s`);
      console.log(`Navigation time: ${navigationTime.toFixed(2)}s`);
      console.log(`Calendar selection: April ${CURRENT_SLOT.date}, ${CURRENT_SLOT.time} in ${dateSelectionTime.toFixed(2)}s`);
      console.log(`Processing completed in ${duration.toFixed(2)} seconds`);
      
    } catch (error) {
      console.error('❌ Error during booking process:', error);
      // Always take a screenshot on error, even in production
      if (page) {
        await page.screenshot({ path: 'error-state.png' }).catch(() => {});
      }
      
      // Don't close browser on error so user can see what went wrong
      console.log('\n⚠️ Error occurred but browser kept open for inspection');
      console.log('Please close the browser window manually when finished');
    }
  } catch (error) {
    console.error('Fatal error:', error);
    // Only close browser in case of fatal error
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// Run the script
bookCalendlyAppointment().catch(console.error);
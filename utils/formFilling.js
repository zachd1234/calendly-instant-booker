/**
 * Form filling utilities with optimized techniques from our single-run implementation
 */

const config = require('../config');

/**
 * Fast field filling with fallback to human-like typing
 * 
 * @param {Object} page - Playwright page object
 * @param {string} selector - CSS selector for the form field
 * @param {string} text - Text to fill into the field
 * @returns {Promise<void>}
 */
async function fastFill(page, selector, text) {
  // Special handling for phone fields
  if (selector.includes('tel')) {
    await page.focus(selector);
    await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
    await page.keyboard.press('Backspace'); // Clear any existing text including country code
    await page.fill(selector, text);
    if (config.DEBUG) console.log(`Phone field cleared and filled directly: ${text}`);
    return;
  }

  // For non-phone fields, use regular approach with verification
  try {
    await page.fill(selector, text);
    if (config.DEBUG) console.log(`Fast-filled "${text}" into field`);
    
    // Verify what was typed
    const value = await page.$eval(selector, el => el.value);
    
    if (value !== text) {
      // If direct fill doesn't work correctly, fall back to typing with minimal delay
      if (config.DEBUG) console.log(`Fast-fill resulted in "${value}", falling back to typing`);
      await humanType(page, selector, text);
    }
  } catch (e) {
    if (config.DEBUG) console.log(`Fast-fill failed: ${e.message}, falling back to typing`);
    await humanType(page, selector, text);
  }
}

/**
 * Human-like typing with minimal delay
 * 
 * @param {Object} page - Playwright page object
 * @param {string} selector - CSS selector for the form field
 * @param {string} text - Text to type into the field
 * @returns {Promise<void>}
 */
async function humanType(page, selector, text) {
  // Special handling for phone fields
  if (selector.includes('tel')) {
    await page.focus(selector);
    await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
    await page.keyboard.press('Backspace'); // Clear any existing text including country code
    await page.fill(selector, text);
    if (config.DEBUG) console.log(`Phone field cleared and filled directly: ${text}`);
    return;
  }

  await page.focus(selector);
  await page.click(selector, { clickCount: 3 }); // Triple click to select all existing text
  await page.keyboard.press('Backspace'); // Clear any existing text
  
  // Type with minimal random delays between keystrokes (5-15ms)
  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 10) + 5 });
  }
  
  // Verify what was typed
  const value = await page.$eval(selector, el => el.value);
  if (config.DEBUG) console.log(`Typed "${text}" into field, current value: "${value}"`);
  
  if (value !== text) {
    if (config.DEBUG) console.log(`⚠️ Warning: Field value "${value}" doesn't match expected "${text}". Retrying...`);
    await page.fill(selector, text);
  }
}

/**
 * Find a form field using racing selectors for optimal speed
 * 
 * @param {Object} page - Playwright page object
 * @param {Array<string>} selectors - Array of CSS selectors to race
 * @param {number} raceTimeout - Timeout for each individual selector race
 * @param {number} fallbackTimeout - Timeout for fallback combined selector
 * @returns {Promise<string>} - The successful selector
 */
async function findFieldWithRacing(page, selectors, raceTimeout = 2000, fallbackTimeout = 4000) {
  if (config.DEBUG) console.log(`Racing selectors with ${raceTimeout}ms timeout: ${selectors.join(', ')}`);
  
  // Race all the selectors against each other
  const element = await Promise.race([
    ...selectors.map(selector => 
      page.waitForSelector(selector, { state: 'visible', timeout: raceTimeout })
        .then(elem => {
          if (config.DEBUG) console.log(`Quick match found with selector: ${selector}`);
          return { elem, selector };
        })
        .catch(() => null)
    )
  ].filter(Boolean))
  .catch(() => null);
  
  if (element) {
    return element.selector;
  }
  
  // If racing failed, fall back to a combined selector
  if (config.DEBUG) console.log('Quick match failed, falling back to combined selector');
  const combinedSelector = selectors.join(', ');
  await page.waitForSelector(combinedSelector, { state: 'visible', timeout: fallbackTimeout });
  
  // Find which specific selector matched
  for (const selector of selectors) {
    const found = await page.$(selector);
    if (found) {
      if (config.DEBUG) console.log(`Found field with fallback selector: ${selector}`);
      return selector;
    }
  }
  
  // If we got here, use the first selector as a fallback
  return selectors[0];
}

module.exports = {
  fastFill,
  humanType,
  findFieldWithRacing,
  
  // Common selector groups for reuse
  SELECTORS: {
    NAME: [
      'input[name="full_name"]',
      'input[name="name"]',
      'input[id*="name" i]',
      'input[placeholder*="name" i]',
      'input[type="text"]'
    ],
    EMAIL: [
      'input[name="email"]',
      'input[type="email"]',
      'input[id*="email" i]',
      'input[placeholder*="email" i]'
    ],
    PHONE: [
      'input[type="tel"]',
      'input[name*="phone" i]',
      'input[id*="phone" i]',
      'input[placeholder*="phone" i]'
    ],
    SUBMIT: [
      'button[type="submit"]',
      'button:has-text("Schedule")',
      'button:has-text("Confirm")',
      'button:has-text("Book")',
      'form button:last-child'
    ]
  }
}; 
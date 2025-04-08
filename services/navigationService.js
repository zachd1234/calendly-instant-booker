const { getIpSession, releaseSession, getWarmBrowser, isServerRunning } = require('../utils/ipPoolClient');
// Note: Playwright types are usually handled via JSDoc or implicitly in JS
// const { chromium } = require('playwright'); // Keep commented unless specific methods needed

/**
 * Sets up the navigation environment by acquiring an IP session and a warm browser.
 * Aims for maximum speed by leveraging the IP Pool and Warm Browser system.
 * Includes basic page setup like resource blocking and event listeners.
 *
 * @returns {Promise<{ page: import('playwright').Page, session: Object, browser: import('playwright').Browser }>}
 *          An object containing the Playwright page, the IP session details, and the browser instance.
 * @throws {Error} If the IP Pool Server is not running or fails to get a session/browser.
 */
async function setupNavigation() {
    console.log('[NavService] Setting up navigation environment...');
    const setupStartTime = Date.now();
    let session = null;
    let browser = null;
    let page = null;

    try {
        // 1. Check IP Pool Server
        const serverRunning = await isServerRunning();
        if (!serverRunning) {
            // For this service, we strictly require the IP pool server.
            throw new Error('[NavService] IP Pool Server is not running! Cannot set up navigation environment.');
        }
        console.log('[NavService] IP Pool Server is running.');

        // 2. Get IP Session
        console.log('[NavService] Requesting IP session...');
        const sessionStartTime = Date.now();
        session = await getIpSession(); // Assign directly
        const sessionTime = (Date.now() - sessionStartTime) / 1000;
        console.log(`[NavService] Got IP session ${session.sessionId} in ${sessionTime.toFixed(2)}s`);

        // 3. Get Warm Browser
        console.log('[NavService] Getting browser...');
        const browserStartTime = Date.now();
        const browserData = await getWarmBrowser(session); // Expects { browser, page, creationTime }
        browser = browserData.browser;
        page = browserData.page;
        const creationTime = browserData.creationTime;
        const browserTime = (Date.now() - browserStartTime) / 1000;
        console.log(`[NavService] Got browser in ${browserTime.toFixed(2)}s (creation time: ${creationTime.toFixed(2)}s)`);

        // 4. Basic Page Setup (Resource Blocking, Event Listeners) - Applied to the retrieved warm page
        console.log('[NavService] Applying standard page settings (resource blocking, listeners)...');

        // Ensure listeners are fresh
        page.removeAllListeners('console');
        page.removeAllListeners('error');
        page.on('console', msg => console.log('[Browser Console]', msg.text()));
        page.on('error', err => console.error('[Browser Error]', err));
        console.log('[NavService] Page event listeners (console, error) attached.');

        // Ensure request interception is active
        // try {
        //     await page.setRequestInterception(true);
        //     page.removeAllListeners('request'); // Clear existing interception listeners from warm browser
        //     page.on('request', (request) => {
        //       const url = request.url();
        //       const resourceType = request.resourceType();
        //       if (
        //         (resourceType === 'image' && !url.includes('calendly')) ||
        //         (resourceType === 'font') ||
        //         url.includes('facebook') ||
        //         url.includes('analytics') ||
        //         url.includes('tracking') ||
        //         url.includes('doubleclick') ||
        //         url.includes('google-analytics') ||
        //         url.includes('hotjar')
        //       ) {
        //          // Use .catch() on abort/continue as they can sometimes throw errors asynchronously
        //          request.abort().catch(err => console.error(`[NavService] Failed to abort request (${resourceType}): ${url}`, err.message));
        //       } else {
        //          request.continue().catch(err => console.error(`[NavService] Failed to continue request (${resourceType}): ${url}`, err.message));
        //       }
        //     });
        //     console.log('[NavService] Resource interception rules applied.');
        // } catch (e) {
        //     // This might happen if interception is already enabled and configured immutably. Log and continue.
        //     console.warn('[NavService] Could not set request interception (might already be set):', e.message);
        // }
        // Assuming getWarmBrowser provides a page with interception already set up.
        console.log('[NavService] Assuming request interception is handled by getWarmBrowser.');

        const setupEndTime = Date.now();
        console.log(`[NavService] Navigation environment setup completed in ${((setupEndTime - setupStartTime) / 1000).toFixed(2)}s.`);

        // Return the necessary objects for the booking logic to use
        return { page, session, browser };

    } catch (error) {
        console.error('[NavService] Error during navigation setup:', error);
        // Cleanup partially acquired resources *only if setup failed*
        if (browser) {
            console.log('[NavService] Closing browser due to setup error...');
            await browser.close().catch(e => console.error('[NavService] Error closing browser during cleanup:', e.message));
        }
        if (session && session.sessionId) {
            console.log(`[NavService] Releasing session ${session.sessionId} due to setup error...`);
            await releaseSession(session.sessionId).catch(e => console.error('[NavService] Error releasing session during cleanup:', e.message));
        }
        // Re-throw the error so the caller knows setup failed
        throw error;
    }
}

module.exports = { setupNavigation };

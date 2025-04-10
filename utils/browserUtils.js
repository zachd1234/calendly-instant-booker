/**
 * Performs a thorough one-time standardization of the browser context and page
 * to maintain consistent fingerprint throughout the session
 */
async function standardizeBrowserSession(browser, page, sessionId, logCapture) {
    logCapture(`[${sessionId}] Performing one-time comprehensive browser session standardization...`);
    
    try {
        // Store original IP info for consistency
        let ipInfo = null;
        try {
            logCapture(`[${sessionId}] Detecting IP information...`);
            ipInfo = await page.evaluate(async () => {
                try {
                    const response = await fetch('https://ipinfo.io/json', { timeout: 5000 });
                    if (response.ok) {
                        return await response.json();
                    }
                    return null;
                } catch (e) {
                    console.error('IP info fetch failed:', e);
                    return { error: e.message };
                }
            });
            
            if (ipInfo) {
                logCapture(`[${sessionId}] IP Information: ${JSON.stringify(ipInfo, null, 2)}`);
                // Store IP info in browser context for future reference
                await browser.storageState().then(state => {
                    state.ipInfo = ipInfo;
                    return browser.setStorageState(state);
                }).catch(e => logCapture(`[${sessionId}] Note: Could not store IP info: ${e.message}`));
            }
        } catch (ipError) {
            logCapture(`[${sessionId}] IP detection error (non-critical): ${ipError.message}`);
        }
        
        // 1. Standard user agent and headers that won't change
        const standardUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        
        // Apply at context level (persists across navigations)
        const context = page.context();
        await context.setExtraHTTPHeaders({
            'User-Agent': standardUserAgent,
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'sec-ch-ua': '"Google Chrome";v="124", " Not;A Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"'
        });
        
        // 2. Apply persistent JavaScript overrides via context route interception
        // This approach injects our standardization code into EVERY page that loads
        await context.route('**/*', async route => {
            const request = route.request();
            
            // Only intercept HTML documents
            if (request.resourceType() === 'document') {
                // Continue with the request
                const response = await route.fetch();
                const originalBody = await response.text();
                
                // Inject our standardization code at the top of <head>
                const newBody = originalBody.replace('<head>', `<head>
                <script>
                // Persistent browser standardization
                (function() {
                    // WebGL fingerprint evasion
                    if (window.WebGLRenderingContext) {
                        const getParameter = WebGLRenderingContext.prototype.getParameter;
                        WebGLRenderingContext.prototype.getParameter = function(parameter) {
                            if (parameter === 37445) return 'Intel Inc.';
                            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                            return getParameter.apply(this, arguments);
                        };
                    }
                    
                    // Canvas fingerprint evasion
                    if (HTMLCanvasElement) {
                        const orgToDataURL = HTMLCanvasElement.prototype.toDataURL;
                        HTMLCanvasElement.prototype.toDataURL = function() {
                            const context = this.getContext('2d');
                            if (context) {
                                const color = context.fillStyle;
                                context.fillStyle = 'rgba(255, 255, 255, 0.01)';
                                context.fillRect(
                                    Math.floor(Math.random() * this.width),
                                    Math.floor(Math.random() * this.height),
                                    1, 1
                                );
                                context.fillStyle = color;
                            }
                            return orgToDataURL.apply(this, arguments);
                        };
                    }
                    
                    // Mask webdriver
                    Object.defineProperty(navigator, 'webdriver', { get: () => false });
                    
                    // Standard language
                    try {
                        Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
                        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                    } catch(e) {}
                    
                    // Standard user agent
                    try {
                        Object.defineProperty(navigator, 'userAgent', { 
                            get: () => '${standardUserAgent}' 
                        });
                    } catch(e) {}
                    
                    // Timezone standardization
                    if (Intl && Intl.DateTimeFormat) {
                        const originalDateTimeFormat = Intl.DateTimeFormat;
                        Intl.DateTimeFormat = function(...args) {
                            if (args.length > 0 && args[1] && args[1].timeZone) {
                                args[1].timeZone = 'America/Los_Angeles';
                            }
                            return new originalDateTimeFormat(...args);
                        };
                        Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;
                    }
                    
                    // Standard plugins
                    if (Navigator.prototype.hasOwnProperty('plugins')) {
                        Object.defineProperty(navigator, 'plugins', {
                            get: () => {
                                const plugins = [
                                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
                                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                                ];
                                return plugins;
                            }
                        });
                    }
                    
                    // Permissions API
                    if (navigator.permissions) {
                        navigator.permissions.query = parameters => 
                            Promise.resolve({ state: 'granted', onchange: null });
                    }
                    
                    console.log('Persistent browser standardization applied');
                })();
                </script>`);
                
                // Fulfill with modified response
                await route.fulfill({
                    response,
                    body: newBody
                });
            } else {
                // For non-HTML resources, just continue the request as normal
                await route.continue();
            }
        });
        
        // 3. Set standard viewport dimensions (persists across navigations)
        await page.setViewportSize({ width: 1280, height: 800 });
        
        logCapture(`[${sessionId}] Browser session standardization complete`);
        logCapture(`[${sessionId}] - User-Agent: ${standardUserAgent}`);
        logCapture(`[${sessionId}] - Viewport: 1280x800`);
        logCapture(`[${sessionId}] - Timezone: America/Los_Angeles (LA)`);
        logCapture(`[${sessionId}] - Language: en-US`);
        
        // Optional: Take a screenshot of the standardized browser for verification
        try {
            await page.screenshot({ path: `session_standardized_${sessionId}.png` });
            logCapture(`[${sessionId}] Standardization verification screenshot saved`);
        } catch (e) {
            logCapture(`[${sessionId}] Note: Could not take verification screenshot: ${e.message}`);
        }
        
        return true;
    } catch (error) {
        logCapture(`[${sessionId}] ⚠️ Error during browser session standardization: ${error.message}`);
        return false;
    }
}

// Maintain this for backward compatibility
async function standardizeBrowserProfile(page, sessionId, logCapture) {
    logCapture(`[${sessionId}] Using lightweight standardization (for compatibility)...`);
    
    try {
        // Same as before but simplified
        
        return true;
    } catch (error) {
        logCapture(`[${sessionId}] ⚠️ Error standardizing browser profile: ${error.message}`);
        return false;
    }
}

// Add a method to safely remove routes
async function removeAllRoutes(page, sessionId, logCapture) {
    if (page && !page.isClosed()) {
        try {
            logCapture(`[${sessionId}] Safely removing all route handlers...`);
            await page.unrouteAll({ behavior: 'ignoreErrors' });
            logCapture(`[${sessionId}] Route handlers removed successfully`);
            return true;
        } catch (e) {
            logCapture(`[${sessionId}] Non-critical error unrouting: ${e.message}`);
            return false;
        }
    }
    return false;
}

module.exports = {
    standardizeBrowserProfile,
    standardizeBrowserSession,
    removeAllRoutes
}; 
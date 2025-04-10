// Test script for timezone detection and adjustment
require('dotenv').config();
const { startSession } = require('./sessionManager');
// Import parseCalendlyUrl directly from this file instead
const { parseCalendlyUrl } = require('./timezoneDetection');

// Simulate logging
const logs = [];
const logCapture = (message) => {
    console.log(message);
    logs.push(message);
};

// Sample Calendly URL with a specific time (for testing time parsing)
const sampleUrl = 'https://calendly.com/zachderhake/30min/2025-04-11T12:00:00-07:00?back=1&month=2025-04&date=2025-04-11';

async function testTimezoneDetection() {
    console.log('Starting timezone detection test...');
    console.log(`Sample URL for parsing: ${sampleUrl}`);
    
    // 1. Start a session
    console.log('\n--- Starting a session ---');
    // Use a real Calendly booking page (without a specific time) as base URL
    const baseUrl = 'https://calendly.com/zachderhake/30min';
    const sessionResult = await startSession(baseUrl, logCapture);
    
    if (!sessionResult.success) {
        console.error(`❌ Failed to start session: ${sessionResult.error}`);
        return;
    }
    
    console.log(`✅ Session started successfully. Session ID: ${sessionResult.sessionId}`);
    console.log('Session Duration:', sessionResult.duration);
    
    // 2. Test timezone detection results
    console.log('\n--- Timezone Detection Results ---');
    if (sessionResult.timezoneInfo) {
        console.log('Detected Timezone Offset:', sessionResult.timezoneInfo.detectedOffset);
        console.log('URL Time:', sessionResult.timezoneInfo.urlTime);
        console.log('Displayed Time:', sessionResult.timezoneInfo.displayedTime);
        
        // 3. Compare time parsing with and without timezone adjustment
        console.log('\n--- Time Parsing Comparison ---');
        
        // Parse without timezone info
        console.log('Parsing URL:', sampleUrl);
        const withoutAdjustment = parseCalendlyUrl(sampleUrl);
        console.log('Parsed without adjustment:', withoutAdjustment);
        
        // Parse with timezone info
        const withAdjustment = parseCalendlyUrl(sampleUrl, sessionResult.timezoneInfo);
        console.log('Parsed with adjustment:', withAdjustment);
        
        if (withoutAdjustment && withAdjustment) {
            if (withoutAdjustment.timeString !== withAdjustment.timeString) {
                console.log(`✅ Timezone adjustment working: ${withoutAdjustment.timeString} → ${withAdjustment.timeString}`);
            } else {
                console.log('⚠️ No difference in time after adjustment. Check if timezone detection found any difference.');
            }
        } else {
            console.log('❌ Error parsing URLs');
        }
    } else {
        console.log('❌ No timezone info detected in session');
    }
    
    console.log('\n--- Test Complete ---');
    
    // Keep the browser open for 2 minutes so you can inspect what happened
    console.log('Browser will stay open for 120 seconds for inspection...');
    await new Promise(resolve => setTimeout(resolve, 120000)); // 2 minutes
    
    console.log('Test finished, exiting');
    process.exit(0);
}

// Run the test
testTimezoneDetection().catch(error => {
    console.error('Test failed with error:', error);
    process.exit(1);
}); 
// Test script for timezone detection and adjustment
require('dotenv').config();
const { startSession } = require('./sessionManager');
const { parseCalendlyUrl } = require('./isp_dom_index');

// Simulate logging
const logs = [];
const logCapture = (message) => {
    console.log(message);
    logs.push(message);
};

// Sample Calendly URL with a specific time
const sampleUrl = 'https://calendly.com/example/meeting/2023-08-15T14:30:00-07:00'; // 2:30 PM Pacific Time

async function testTimezoneDetection() {
    console.log('Starting timezone detection test...');
    console.log(`Testing with sample URL: ${sampleUrl}`);
    
    // 1. Start a session
    console.log('\n--- Starting a session ---');
    const baseUrl = 'https://calendly.com/example/meeting';
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
        const withoutAdjustment = parseCalendlyUrl(sampleUrl);
        console.log('Parsed without adjustment:', withoutAdjustment);
        
        // Parse with timezone info
        const withAdjustment = parseCalendlyUrl(sampleUrl, sessionResult.timezoneInfo);
        console.log('Parsed with adjustment:', withAdjustment);
        
        if (withoutAdjustment.timeString !== withAdjustment.timeString) {
            console.log(`✅ Timezone adjustment working: ${withoutAdjustment.timeString} → ${withAdjustment.timeString}`);
        } else {
            console.log('⚠️ No difference in time after adjustment. Check if the timezone difference was detected correctly.');
        }
    } else {
        console.log('❌ No timezone info detected in session');
    }
    
    console.log('\n--- Test Complete ---');
    
    // Force exit to clean up browser instances
    setTimeout(() => process.exit(0), 1000);
}

// Run the test
testTimezoneDetection().catch(error => {
    console.error('Test failed with error:', error);
    process.exit(1);
}); 
// Import the booking function from refined_index.js
const { bookCalendlyWithParams } = require('./refined_index');

// Test parameters
const testParams = {
    calendlyUrl: "https://calendly.com/zachderhake/30min/2025-04-21T10:00:00-07:00", // Using the first URL from your list
    name: "Test User",
    email: "test@example.com",
    phone: "+1 3109122380",
    // Custom log function to output with timestamp
    logCapture: (message) => {
        const timestamp = new Date().toISOString().replace('T', ' ').substr(0, 19);
        console.log(`[${timestamp}] ${message}`);
    }
};

console.log("Starting test of bookCalendlyWithParams function...");
console.log("Test parameters:", JSON.stringify(testParams, null, 2));

// Call the function with test parameters
bookCalendlyWithParams(testParams)
    .then(result => {
        console.log("\n✅ TEST SUCCESSFUL!");
        console.log("Results:", JSON.stringify(result, null, 2));
    })
    .catch(error => {
        console.error("\n❌ TEST FAILED!");
        console.error("Error:", error.message);
        if (error.logs) {
            console.log("Error logs:", error.logs);
        }
    }); 
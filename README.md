# Calendly Booking Bot

A fast, stealthy Calendly booking bot using Playwright. This version integrates with residential proxies for enhanced stealth and reliability.

## Setup

1. Install dependencies:
```
npm install
npm install https-proxy-agent
```

2. Configure your `.env` file with your credentials and proxy settings:
```
NAME=Your Name
EMAIL=your@email.com
PROXY_URL=http://username:password@proxy-server:port
```

3. Configure time slots:
The script includes a list of Calendly time slots in the `index.js` file. You can modify the `SLOT_INDEX` variable to select different time slots.

4. Run the bot:
```
node index.js
```

## Features

- Launches a browser and navigates to a Calendly booking page
- Uses residential proxies to rotate IPs for enhanced stealth
- Randomizes browser fingerprints (user agent, viewport, etc.)
- Handles cookies consent popups
- Fills in contact information (name, email, phone) and completes the booking
- Detects and handles captchas with manual intervention
- Measures and reports booking performance

## Performance

The bot aims for a 7-11 second booking time in real-world scenarios.

## Proxy Integration

The bot uses Oxylabs residential proxies to:
- Rotate IP addresses for each session
- Present as a regular user from different locations
- Avoid rate limits and bot detection
- Bypass regional restrictions

## Advanced Features

- Randomized browser fingerprinting
- User agent rotation
- Viewport randomization
- Captcha detection and handling
- Error handling and recovery 
# Calendly Instant Booker 🚀

Automatically books Calendly appointments in under 7 seconds with Playwright and smart proxy management.

## 🧠 Why I Built This
Julian, 11x.ai's AI inbound sales rep, needed to instantly book Calendly meetings for account executives while calling live leads — and it had to feel **natural** during conversations.

Normal automated booking workflows were too slow and detectable, so I engineered a faster, stealthier solution using advanced browser anonymization, ISP proxies, and predictive caching strategies.

This is my best-performing automation yet: sub-7 second bookings, with multiple booking strategies depending on conversation flow.

## 🛠️ Tech Stack
- Node.js
- Express.js
- Playwright
- Puppeteer
- Axios
- Date-fns
- Luxon
- Docker

## 📦 Features
- ⚡ Sub-7 second Calendly bookings
- 🛡️ Full browser anonymization (custom user agents, stealth mode)
- 🌐 ISP proxy management for undetectability
- 🔥 Predictive caching to pre-warm booking flows
- 🧠 Smart fallback to direct booking when needed

## 🧩 Booking Strategies

### 1. Direct Booking
- Assigns a dedicated IP at session start.
- Navigates directly to customer's **general Calendly page** when call starts.
- When the full booking link is available, performs a `page.goto()` and autofills the booking form.
- **Speed**: ~12 seconds on average (can spike to 30s during heavy network load).

### 2. Predictive Booking (Advanced)
- When Julian proposes two times ("3 PM Thursday or 11 AM Friday?"), the system **prepares both bookings simultaneously**.
- Once the prospect confirms, the system **instantly submits** the prefilled booking form.
- **Speed**: 1–2 second booking times achieved under ideal conditions.

*(Note: Prefilling currently takes a few minutes due to cautious browser spin-up logic to preserve proxy integrity.)*

## 🛡️ Anonymity & Undetectability
- Custom user agents randomized per session.
- Browser fingerprinting resistance (viewport size, timezones, languages).
- Dedicated residential-grade ISP proxies per booking session.
- Cache-first navigation to minimize loading signals.
- Soft navigation paths and human-like click emulation (avoiding bot telltales).

Check the codebase for all the small tricks I built into the stealth layer. Every millisecond shaved matters at this level.

## 📹 Demo
https://calendly-bot.onrender.com/

## 🔗 Credits
Originally scoped in collaboration with 11x.ai to enhance inbound sales automation workflows. This project reflects my independent engineering work optimizing Calendly booking speed and stealth.

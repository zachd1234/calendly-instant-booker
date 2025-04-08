# 1. Choose a base Node.js image. Use a version compatible with your app (>=16)
#    Debian-based images like '-slim' are common and work well with apt-get.
FROM node:18-slim

# 2. Set the working directory inside the container
WORKDIR /app

# 3. Install the operating system dependencies needed by Playwright browsers
#    This list is based on Playwright's docs for Debian/Ubuntu.
#    It might need adjustments depending on the exact base image or Playwright version.
RUN apt-get update && \
    apt-get install -y \
    # === Playwright browser dependencies ===
    libnss3 \
    libnspr4 \
    libdbus-glib-1-2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    # === Extra dependencies that might be needed ===
    xvfb \
    fonts-liberation \
    # Clean up apt caches to keep image size down
    && rm -rf /var/lib/apt/lists/*

# 4. Copy package.json and package-lock.json (or yarn.lock) first
#    This leverages Docker layer caching. If these files don't change,
#    Docker won't re-run npm install in subsequent builds.
COPY package*.json ./

# 5. Install Node.js dependencies (including Playwright itself)
RUN npm install

# 6. Install Playwright browsers.
#    We don't need '--with-deps' here because we installed them manually above.
#    Consider explicitly installing only the browser you need (e.g., 'chromium')
#    RUN npx playwright install chromium
RUN npx playwright install

# 7. Copy the rest of your application code into the container
COPY . .

# 8. Expose the port your application listens on (if applicable, e.g., for a web server)
#    Adjust the port number (e.g., 3000) if your app uses a different one.
#    Render typically handles port mapping, but it's good practice.
# EXPOSE 3000

# 9. Define the command to run your application
#    This should match your 'Start Command' in Render.
CMD ["npm", "start"]
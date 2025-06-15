FROM node:18-slim

# install chromium & a virtual X server
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium xvfb \
 && rm -rf /var/lib/apt/lists/*

# make sure puppeteer-real-browser can find it
ENV CHROME_PATH=/usr/bin/chromium

# app setup
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# default port from BeamUp
RUN find . -maxdepth 2 -type f | sed 's/^/FILE: /'
ENV PORT=7000
CMD ["npm", "start"]

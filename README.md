# Bytewatch Stremio Addon

A Node.js-powered Stremio addon that scrapes multiple streaming sites using Puppeteer. It integrates them into the Stremio ecosystem through a single stream handler.

---

## Features

- Scrapes multiple providers from a single file
- Real browser scraping via `puppeteer-real-browser`
- Stremio addon-compatible manifest & stream handler
- Caching using `node-cache`
- Logging using `winston`

---

## Project Structure

```
bytewatch-stremio-addon/
│
├── index.js                # Entry point: defines manifest and stream handler
├── unified-extractor.js   # Centralized scraper logic for multiple providers
├── logger.js              # Logger setup using Winston
├── package.json           # Metadata and dependencies
└── README.md              # Documentation
```

---

## Requirements

### To Run Locally

- Node.js v18+ recommended
- npm (Node package manager)
- At least 1GB RAM (Puppeteer launches a browser)

### To Run Remotly 
 - A free render account

---

## Installation (Local Development)

1. **Clone the repository**
   ```bash
   git clone https://github.com/93bx/bytewatch-stremio-addon.git
   cd bytewatch-stremio-addon
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the addon**
   ```bash
   node index.js
   ```

4. **Test locally**
   Open your browser:
   ```
   http://localhost:7000/manifest.json
   ```

5. **Add it to Stremio**
   - Open Stremio desktop app
   - Go to: **Add-ons > Paste the URL in the search bar**
   

There are currently two such clients that you can test with:
    Stremio v4.4.10+
    Stremio Web Version
Note: if you want to load an addon by URL in Stremio, the URL must either be accessed on 127.0.0.1 or support HTTPS.

## Installation (Remote)

## 🚀 Deploy Your Own Instance (One-Click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/93bx/bytewatch-stremio-addon)

Sign in to Render (or create a free account)\
The button will automatically:
- Fork the repository
- Configure all environment variables
- Set up the build and start commands
- Deploy the service

**Or manually:**
1. Fork this repository
2. Sign up at [render.com](https://render.com)
3. Click "New Web Service"
4. Connect your forked repository
5. Set environment variable: `PORT = 10000`
6. Deploy!

After deploying the app, paste the render URL in Stremio searchbar to add it.

---

## Notes

- All scrapers are defined in `unified-extractor.js`.
- Logs will print to console using Winston (with timestamp and levels).
- Caching is in-memory using `node-cache` to improve performance and avoid repeat scraping.
- Puppeteer requires a headless-compatible environment — avoid deploying on memory-constrained VMs without swap.

---

## License

ISC License. Use freely and modify as needed.
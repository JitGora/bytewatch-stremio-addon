const { connect } = require("puppeteer-real-browser");
const logger = require("./logger");

const extractors = {
    broflix: (type, id, season, episode) =>
        type === 'movie'
            ? `https://broflix.si/watch/movie/${id}`
            : `https://broflix.si/watch/tv/${id}?season=${season}&episode=${episode}`,
    fmovies: (type, id, season, episode) =>
        type === 'movie'
            ? `https://fmovies.cat/watch/movie/${id}`
            : `https://fmovies.cat/watch/tv/${id}/${season}/${episode}`,
    videasy: (type, id, season, episode) =>
        type === 'movie'
            ? `https://player.videasy.net/movie/${id}`
            : `https://player.videasy.net/tv/${id}/${season}/${episode}`,
    vidora: (type, id, season, episode) =>
        type === 'movie'
            ? `https://watch.vidora.su/watch/movie/${id}`
            : `https://watch.vidora.su/watch/tv/${id}/${season}/${episode}`,
    vidsrc: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.xyz/embed/movie/${id}`
            : `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`,
    vilora: (type, id, season, episode) =>
        type === 'movie'
            ? `https://veloratv.ru/watch/movie/${id}`
            : `https://veloratv.ru/watch/tv/${id}/${season}/${episode}`
};

function randomUserAgent() {
  const versions = ['114.0.5735.198', '113.0.5672.126', '112.0.5615.138'];
  const version = versions[Math.floor(Math.random() * versions.length)];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

async function runExtractor(source, type, imdbId, season = null, episode = null) {
    // Check if the website is on the known list of websites
    if (!extractors[source]) throw new Error(`Unknown source: ${source}`);

    // Storage for stream urls
    const streamUrls = {};

    // Construct the website player url
    const url = extractors[source](type, imdbId, season, episode);

    // Create and configure the browser
    const {browser, page} = await connect({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            "--disable-dev-shm-usage",
            '--disable-features=IsolateOrigins,site-per-process',
            '--enable-popup-blocking'
        ],
        turnstile: true,
        customConfig: {},
        connectOption: {},
        disableXvfb: false,
        ignoreAllFlags: false,
    });
    await page.setUserAgent(randomUserAgent());
    await page.setExtraHTTPHeaders({
        url,
        'Sec-GPC': '1',
        'DNT': '1',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
    });

    // Enable request interception and monitoring
    await page.setRequestInterception(true);

    // Prevent pop-up ads
    await page.evaluateOnNewDocument(() => {
        window.open = () => null; // Prevents any script from opening new windows
    });

    // Accept any dialogs
    page.on('dialog', async dialog => {
        await dialog.accept();
    });

    // Monitor all network requests for m3u8 or mp4 files
    page.on('request', async request => {
        const url = request.url();
        if (
            url.includes('analytics') ||
            url.includes('ads') ||
            url.includes('social') ||
            url.includes('disable-devtool') ||
            url.includes('cloudflareinsights') ||
            url.includes('ainouzaudre') ||
            url.includes('pixel.embed') ||
            url.includes('histats')
        ) {
            // block the request for ads or tracking
            await request.abort();
        } else if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('/mp4')) {
            logger.info(`${source} stream URL detected in request`);
            // Categorize the stream URLs
            streamUrls[`${source} Link`] = url;
        } else {
            // allow the request
            await request.continue();
        }
    });

    // Start the process
    try {
        logger.info(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        logger.info('Player page loaded');

        if (source === 'videasy') {
            await page.click('button')
            logger.info('Clicked the play button for videasy')
        }

        if (source === 'vidsrc') {
            const outerIframeHandle = await page.$('iframe');
            logger.info('vidsrc iframe loaded')
            const outerFrame = await outerIframeHandle.contentFrame();
            await outerFrame.click('#pl_but');
            logger.info('vidsrc button clicked')
        }

        logger.info(`${source} Waiting for m3u8/mp4 URLs.`);
        const foundUrls = new Promise(resolve => {
            const interval = setInterval(() => {
                if (Object.keys(streamUrls).length > 0) {
                    clearInterval(interval);
                    resolve(true);
                }
            }, 500);
        });
         const timeout = new Promise((_, reject) =>
             setTimeout(() => reject(new Error('Timeout: No stream URL detected within 10 seconds')), 10000)
         );
        await Promise.race([foundUrls, timeout]);


        // Check if we found any stream URLs
        if (streamUrls.length === 0) {
            throw new Error('No stream URL found');
        }

        console.log(`${source} Stream URLs found: ${ streamUrls }`);
        return streamUrls;
    } catch (err) {
        logger.error(`Error extracting from ${source}: ${err.message}`);
        return {};
    } finally {
        await browser.close();
    }
}

module.exports = runExtractor;
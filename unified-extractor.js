const { connect } = require("puppeteer-real-browser");
const logger = require("./logger");
const axios = require('axios');
const { Parser } = require('m3u8-parser');

const extractors = {
    // ... (keep your existing extractors)
    wooflix: (type, id, season, episode) =>
        type === 'movie'
            ? `https://wooflixtv.co/watch/movie/${id}`
            : `https://wooflixtv.co/watch/tv/${id}?season=${season}&episode=${episode}`,
    vidsrc: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.xyz/embed/movie/${id}`
            : `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`,
    vilora: (type, id, season, episode) =>
        type === 'movie'
            ? `https://veloratv.ru/watch/movie/${id}`
            : `https://veloratv.ru/watch/tv/${id}/${season}/${episode}`,
    vidjoy: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidjoy.pro/embed/movie/${id}`
            : `https://vidjoy.pro/embed/tv/${id}/${season}/${episode}`,
    vidify: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidify.top/embed/movie/${id}`
            : `https://vidify.top/embed/tv/${id}/${season}/${episode}`,
    streamhub: (type, id, season, episode) =>
        type === 'movie'
            ? `https://thestreamhub.xyz/watch?media_id=${id}&media_type=tmdb&`
            : `https://thestreamhub.xyz/watch?media_id=${id}&media_type=tmdb&season=${season}&episode=${episode}`,
    vidfast: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidfast.pro/movie/${id}`
            : `https://vidfast.pro/tv/${id}/${season}/${episode}`
};

function randomUserAgent() {
    const versions = ['114.0.5735.198', '113.0.5672.126', '112.0.5615.138'];
    const version = versions[Math.floor(Math.random() * versions.length)];
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

// Function to parse M3U8 and extract quality variants
async function parseM3U8Playlist(playlistUrl, source, baseUrl = '') {
    try {
        logger.info(`Parsing M3U8 playlist for ${source}: ${playlistUrl}`);
        
        // Fetch the M3U8 playlist content
        const response = await axios.get(playlistUrl, {
            headers: {
                'User-Agent': randomUserAgent(),
                'Referer': baseUrl || playlistUrl.split('/').slice(0, 3).join('/')
            },
            timeout: 5000
        });

        const parser = new Parser();
        parser.push(response.data);
        parser.end();

        const parsedManifest = parser.manifest;
        const qualityStreams = {};

        // Check if this is a master playlist with multiple qualities
        if (parsedManifest.playlists && parsedManifest.playlists.length > 0) {
            logger.info(`Found ${parsedManifest.playlists.length} quality variants`);
            
            for (const playlist of parsedManifest.playlists) {
                const resolution = playlist.attributes?.RESOLUTION;
                const bandwidth = playlist.attributes?.BANDWIDTH;
                
                // Create quality label
                let qualityLabel = 'Unknown Quality';
                if (resolution) {
                    const height = resolution.height;
                    if (height >= 1080) qualityLabel = '1080p';
                    else if (height >= 720) qualityLabel = '720p';
                    else if (height >= 480) qualityLabel = '480p';
                    else qualityLabel = '360p';
                } else if (bandwidth) {
                    if (bandwidth >= 3000000) qualityLabel = '1080p';
                    else if (bandwidth >= 1500000) qualityLabel = '720p';
                    else if (bandwidth >= 800000) qualityLabel = '480p';
                    else qualityLabel = '360p';
                }

                // Resolve relative URLs
                let streamUrl = playlist.uri;
                if (!streamUrl.startsWith('http')) {
                    if (streamUrl.startsWith('/')) {
                        // Absolute path - use domain only
                        const urlObj = new URL(playlistUrl);
                        streamUrl = `${urlObj.protocol}//${urlObj.host}${streamUrl}`;
                    } else {
                        // Relative path - use directory
                        const playlistBase = playlistUrl.split('/').slice(0, -1).join('/');
                        streamUrl = `${playlistBase}/${streamUrl}`;
                    }
                }

                qualityStreams[`${source} ${qualityLabel}`] = streamUrl;
            }
        } else {
            // This is likely a direct stream playlist, return as-is
            qualityStreams[`${source} Link`] = playlistUrl;
        }

        return qualityStreams;
    } catch (error) {
        logger.error(`Error parsing M3U8 for ${source}: ${error.message}`);
        // Return original URL if parsing fails
        return { [`${source} Link`]: playlistUrl };
    }
}

async function runExtractor(source, type, imdbId, season = null, episode = null) {
    if (!extractors[source]) throw new Error(`Unknown source: ${source}`);

    const streamUrls = {};
    const url = extractors[source](type, imdbId, season, episode);

    const {browser, page} = await connect({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            "--disable-dev-shm-usage",
            '--disable-features=IsolateOrigins,site-per-process',
            '--enable-popup-blocking',
            '--disable-gpu',
            '--no-first-run',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
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

    await page.setRequestInterception(true);

    await page.evaluateOnNewDocument(() => {
        window.open = () => null;
    });

    page.on('dialog', async dialog => {
        await dialog.accept();
    });

    // Store the detected M3U8/MP4 URLs for parsing
    const detectedStreams = [];

    page.on('request', async request => {
        const requestUrl = request.url();

        if (
            requestUrl.includes('analytics') ||
            requestUrl.includes('ads') ||
            requestUrl.includes('social') ||
            requestUrl.includes('disable-devtool') ||
            requestUrl.includes('cloudflareinsights') ||
            requestUrl.includes('ainouzaudre') ||
            requestUrl.includes('pixel.embed') ||
            requestUrl.includes('histats')
        ) {
            await request.abort();
        } else if ((requestUrl.includes('.mp4') || requestUrl.includes('.m3u8') || requestUrl.includes('/mp4') || requestUrl.includes('kendrickl')) && !(requestUrl.includes('vidjoy'))) {
            logger.info(`${source} stream URL detected: ${requestUrl}`);
            detectedStreams.push(requestUrl);
            await page.close();
        } else {
            await request.continue();
        }
    });

    try {
        logger.info(`Navigating to ${url}`);
        if (source === 'vidify') {
            await page.goto(url, {timeout: 0});
        } else {
            await page.goto(url, { waitUntil: source !== 'wooflix' ? 'networkidle2':'domcontentloaded', timeout: 5000 });
        }
        logger.info(`${source} Player page loaded`);

        if (source === 'vidsrc') {
            const outerIframeHandle = await page.$('iframe');
            logger.info('vidsrc iframe loaded')
            const outerFrame = await outerIframeHandle.contentFrame();
            await outerFrame.click('#pl_but');
            logger.info('vidsrc button clicked')
        }

        if (source === 'vidfast') {
            logger.info('VidFast-specific handling...');
        }

        logger.info(`${source} Waiting for m3u8/mp4 URLs.`);

        const foundUrls = new Promise(resolve => {
            const interval = setInterval(() => {
                if (detectedStreams.length > 0) {
                    clearInterval(interval);
                    resolve(true);
                }
            }, 500);
        });
        
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout: No stream URL detected within 5 seconds')), 5000)
        );
        
        await Promise.race([foundUrls, timeout]);

        // Parse each detected stream URL
        for (const streamUrl of detectedStreams) {
            if (streamUrl.includes('.m3u8')) {
                // Parse M3U8 playlist for quality variants
                const parsedStreams = await parseM3U8Playlist(streamUrl, source, url);
                Object.assign(streamUrls, parsedStreams);
            } else {
                // Direct MP4 or other format
                streamUrls[`${source} Link`] = streamUrl;
            }
        }

        if (Object.keys(streamUrls).length === 0) {
            throw new Error('No stream URL found');
        }

        logger.info(`${source} Final streams: ${Object.keys(streamUrls).join(', ')}`);
        return streamUrls;
    } catch (err) {
        logger.error(`Error extracting from ${source}: ${err.message}`);
        return streamUrls;
    } finally {
        await browser.close();
    }
}

module.exports = runExtractor;

//unified-extractor.js - FIXED VERSION WITH PROPER STREAM DETECTION TIMING
const { connect } = require("puppeteer-real-browser");
const logger = require("./logger");
const axios = require('axios');
const { Parser } = require('m3u8-parser');

const extractors = {
    wooflix: (type, id, season, episode) =>
        type === 'movie'
            ? `https://wooflixtv.co/watch/movie/${id}`
            : `https://wooflixtv.co/watch/tv/${id}?season=${season}&episode=${episode}`,
    vilora: (type, id, season, episode) =>
        type === 'movie'
            ? `https://veloratv.ru/watch/movie/${id}`
            : `https://veloratv.ru/watch/tv/${id}/${season}/${episode}`,
    vidfast: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidfast.pro/movie/${id}`
            : `https://vidfast.pro/tv/${id}/${season}/${episode}`,
    onemovies: (type, id, season, episode) =>
        type === 'movie'
            ? `https://111movies.com/movie/${id}`
            : `https://111movies.com/tv/${id}/${season}/${episode}`,
    vidlink: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidlink.pro/movie/${id}`
            : `https://vidlink.pro/tv/${id}/${season}/${episode}`,
    mappletv: (type, id, season, episode) =>
        type === 'movie'
            ? `https://mappletv.uk/watch/movie/${id}`
            : `https://mappletv.uk/watch/tv/${id}-${season}-${episode}`
};

// --- BROWSER MANAGEMENT ---
let browserPromise = null;

function getBrowser() {
    if (!browserPromise) {
        logger.info('🚀 Launching new shared browser instance...');
        browserPromise = connect({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run'
            ],
            turnstile: true,
        }).then(({ browser }) => {
            browser.on('disconnected', () => {
                logger.warn('⚠️ Shared browser has disconnected. It will be re-launched on the next request.');
                browserPromise = null;
            });
            logger.info('✅ Shared browser launched successfully.');
            return browser;
        }).catch(err => {
            logger.error('❌ Failed to launch shared browser:', err);
            browserPromise = null;
            throw err;
        });
    }
    return browserPromise;
}

function randomUserAgent() {
    const versions = ['114.0.5735.198', '113.0.5672.126', '112.0.5615.138'];
    const version = versions[Math.floor(Math.random() * versions.length)];
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

async function parseM3U8Playlist(playlistUrl, source) {
    try {
        logger.info(`🔎 Parsing M3U8 for ${source}: ${playlistUrl.substring(0, 60)}...`);
        const response = await axios.get(playlistUrl, {
            headers: { 'User-Agent': randomUserAgent() },
            timeout: 8000,
        });

        const parser = new Parser();
        parser.push(response.data);
        parser.end();
        const { playlists } = parser.manifest;
        const qualityStreams = {};

        if (playlists && playlists.length > 0) {
            logger.info(`📊 Found ${playlists.length} quality variants for ${source}`);
            for (const playlist of playlists) {
                const { RESOLUTION: resolution, BANDWIDTH: bandwidth } = playlist.attributes;
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

                let streamUrl = playlist.uri;
                if (!streamUrl.startsWith('http')) {
                    streamUrl = new URL(streamUrl, playlistUrl).toString();
                }

                qualityStreams[`${source} ${qualityLabel}`] = streamUrl;
            }
        } else {
            qualityStreams[`${source} Link`] = playlistUrl;
        }
        return qualityStreams;
    } catch (error) {
        logger.error(`❌ M3U8 parse failed for ${source}: ${error.message}. Returning direct link.`);
        return { [`${source} Link`]: playlistUrl };
    }
}

// ✅ FIXED MAIN EXTRACTOR with proper timing for JavaScript-loaded streams
async function runExtractor(source, type, imdbId, season = null, episode = null) {
    if (!extractors[source]) throw new Error(`Unknown source: ${source}`);

    const url = extractors[source](type, imdbId, season, episode);
    let page;
    const detectedUrls = new Set();
    let streamDetectionActive = true;

    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        await page.setUserAgent(randomUserAgent());
        await page.setRequestInterception(true);
        await page.evaluateOnNewDocument(() => { window.open = () => null; });
        page.on('dialog', async dialog => { await dialog.accept(); });

        // ✅ IMPROVED: Continue monitoring during extended wait
        page.on('request', request => {
            if (!streamDetectionActive) {
                request.continue();
                return;
            }

            const requestUrl = request.url();
            const resourceType = request.resourceType();
            
            const blockedResourceTypes = ['image', 'stylesheet', 'font', 'media'];
            const blockedKeywords = ['analytics', 'ads', 'social', 'disable-devtool', 'cloudflareinsights', 'pixel.embed', 'histats'];
            const streamKeywords = ['.mp4', '.m3u8', '/mp4', 'kendrickl'];

            if (blockedResourceTypes.includes(resourceType) || blockedKeywords.some(keyword => requestUrl.includes(keyword))) {
                request.abort();
            } else if (streamKeywords.some(keyword => requestUrl.includes(keyword))) {
                logger.info(`🎯 ${source} stream DETECTED: ${requestUrl.substring(0, 80)}...`);
                detectedUrls.add(requestUrl);
                request.continue();
            } else {
                request.continue();
            }
        });

        logger.info(`🌐 Navigating to ${url} for source: ${source}`);
        
        // ✅ IMPROVED: Use domcontentloaded for faster initial load
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000 
        });

        logger.info(`📄 ${source} page loaded. Found ${detectedUrls.size} potential stream URLs.`);

        // ✅ FIXED: Wait for JavaScript to initialize while STILL monitoring for streams
        const maxWaitTime = 8000; // Total wait time
        const checkInterval = 500; // Check every 500ms
        const startTime = Date.now();
        
        while ((Date.now() - startTime) < maxWaitTime) {
            if (detectedUrls.size > 0) {
                logger.info(`🎯 ${source} found ${detectedUrls.size} streams, ending wait early`);
                break;
            }
            
            // Wait and check for new streams
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            logger.info(`⏳ ${source} waiting for streams... (${detectedUrls.size} found so far)`);
        }

        // Stop stream detection
        streamDetectionActive = false;
        
        logger.info(`🏁 ${source} detection finished. Total streams found: ${detectedUrls.size}`);

    } catch (err) {
        logger.error(`❌ ${source} extraction failed during browser navigation: ${err.message}`);
        streamDetectionActive = false;
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (closeError) {
                logger.warn(`⚠️ Error closing ${source} page: ${closeError.message}`);
            }
        }
    }

    // --- PHASE 2: PROCESS COLLECTED URLS ---
    if (detectedUrls.size === 0) {
        logger.warn(`⚠️ No stream URLs were detected for ${source}.`);
        return {};
    }

    const streamProcessingPromises = [];
    for (const streamUrl of detectedUrls) {
        if (streamUrl.includes('.m3u8')) {
            streamProcessingPromises.push(parseM3U8Playlist(streamUrl, source));
        } else {
            streamProcessingPromises.push(Promise.resolve({ [`${source} Link`]: streamUrl }));
        }
    }

    const resolvedStreamsArray = await Promise.all(streamProcessingPromises);
    const finalStreams = Object.assign({}, ...resolvedStreamsArray);

    logger.info(`✅ ${source} COMPLETED: Finalized ${Object.keys(finalStreams).length} streams.`);
    return finalStreams;
}

module.exports = runExtractor;

//unified-extractor.js - SIMPLIFIED REAL-TIME PROCESSING VERSION  
const { connect } = require("puppeteer-real-browser");
const logger = require("./logger");
const axios = require('axios');
const { Parser } = require('m3u8-parser');

const extractors = {
    wooflix: (type, id, season, episode) =>
        type === 'movie'
            ? `https://wooflixtv.co/watch/movie/${id}`
            : `https://wooflixtv.co/watch/tv/${id}?season=${season}&episode=${episode}`,
    // vidsrc: (type, id, season, episode) =>
    //     type === 'movie'
    //         ? `https://vidsrc.xyz/embed/movie/${id}`
    //         : `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`,
    // vilora: (type, id, season, episode) =>
    //     type === 'movie'
    //         ? `https://veloratv.ru/watch/movie/${id}`
    //         : `https://veloratv.ru/watch/tv/${id}/${season}/${episode}`,
    vidjoy: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidjoy.pro/embed/movie/${id}`
            : `https://vidjoy.pro/embed/tv/${id}/${season}/${episode}`,
    vidify: (type, id, season, episode) => // No ads
        type === 'movie'
            ? `https://vidify.top/embed/movie/${id}`
            : `https://vidify.top/embed/tv/${id}/${season}/${episode}`,
    vidfast: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidfast.pro/movie/${id}`
            : `https://vidfast.pro/tv/${id}/${season}/${episode}`,
    // ✅ NEW PROVIDERS
    vidlink: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidlink.pro/movie/${id}`
            : `https://vidlink.pro/tv/${id}/${season}/${episode}`,
    mappletv: (type, id, season, episode) =>
        type === 'movie'
            ? `https://mappletv.uk/watch/movie/${id}`
            : `https://mappletv.uk/watch/tv/${id}-${season}-${episode}`
    // autoembed: (type, id, season, episode) =>
    //     type === 'movie'
    //         ? `https://player.autoembed.cc/embed/movie/${id}`
    //         : `https://player.autoembed.cc/embed/tv/${id}/${season}/${episode}`,
    // 'autoembed-hindi': (type, id, season, episode) =>
    //     type === 'movie'
    //         ? `https://test.autoembed.cc/embed/movie/${id}?server=14`
    //         : `https://test.autoembed.cc/embed/tv/${id}/${season}/${episode}?server=14`
};

function randomUserAgent() {
    const versions = ['114.0.5735.198', '113.0.5672.126', '112.0.5615.138'];
    const version = versions[Math.floor(Math.random() * versions.length)];
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

// ✅ IMMEDIATE M3U8 parsing - no delays
async function parseM3U8PlaylistImmediate(playlistUrl, source) {
    try {
        logger.info(`⚡ IMMEDIATE M3U8 parsing for ${source}: ${playlistUrl.substring(0, 60)}...`);
        
        const response = await axios.get(playlistUrl, {
            headers: {
                'User-Agent': randomUserAgent()
            },
            timeout: 8000,
            validateStatus: function (status) {
                return status >= 200 && status < 300;
            }
        });

        const parser = new Parser();
        parser.push(response.data);
        parser.end();
        const parsedManifest = parser.manifest;
        const qualityStreams = {};

        if (parsedManifest.playlists && parsedManifest.playlists.length > 0) {
            logger.info(`📊 Found ${parsedManifest.playlists.length} quality variants for ${source}`);
            
            for (const playlist of parsedManifest.playlists) {
                const resolution = playlist.attributes?.RESOLUTION;
                const bandwidth = playlist.attributes?.BANDWIDTH;
                
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
                    if (streamUrl.startsWith('/')) {
                        const urlObj = new URL(playlistUrl);
                        streamUrl = `${urlObj.protocol}//${urlObj.host}${streamUrl}`;
                    } else {
                        const playlistBase = playlistUrl.split('/').slice(0, -1).join('/');
                        streamUrl = `${playlistBase}/${streamUrl}`;
                    }
                }

                qualityStreams[`${source} ${qualityLabel}`] = streamUrl;
                logger.info(`✅ IMMEDIATE: Added ${source} ${qualityLabel}`);
            }
        } else {
            qualityStreams[`${source} Link`] = playlistUrl;
            logger.info(`✅ IMMEDIATE: Direct stream for ${source}`);
        }

        return qualityStreams;
    } catch (error) {
        logger.error(`❌ IMMEDIATE M3U8 parse failed for ${source}: ${error.message}`);
        return { [`${source} Link`]: playlistUrl };
    }
}

// ✅ SIMPLIFIED MAIN EXTRACTOR - No special provider handling, uniform 20s timeout
async function runExtractor(source, type, imdbId, season = null, episode = null, progressCollector = null) {
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
            '--no-first-run'
        ],
        turnstile: true,
        customConfig: {},
        connectOption: {},
        disableXvfb: false,
        ignoreAllFlags: false,
    });
    
    await page.setUserAgent(randomUserAgent());
    await page.setRequestInterception(true);

    await page.evaluateOnNewDocument(() => {
        window.open = () => null;
    });

    page.on('dialog', async dialog => {
        await dialog.accept();
    });

    const detectedStreams = [];
    const processedUrls = new Set();

    // ✅ REAL-TIME request handler - process M3U8 IMMEDIATELY
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
        } else if (
            (requestUrl.includes('.mp4') || requestUrl.includes('.m3u8') || requestUrl.includes('/mp4') || requestUrl.includes('kendrickl')) && 
            !(requestUrl.includes('vidjoy')) &&
            !processedUrls.has(requestUrl)
        ) {
            logger.info(`🎯 ${source} stream DETECTED: ${requestUrl.substring(0, 80)}...`);
            detectedStreams.push(requestUrl);
            processedUrls.add(requestUrl);

            // ✅ IMMEDIATE PROCESSING - Parse M3U8 right now!
            if (requestUrl.includes('.m3u8')) {
                setImmediate(async () => {
                    try {
                        logger.info(`⚡ IMMEDIATE parsing M3U8 for ${source}`);
                        const parsedStreams = await parseM3U8PlaylistImmediate(requestUrl, source);
                        
                        Object.assign(streamUrls, parsedStreams);
                        
                        if (progressCollector && Object.keys(parsedStreams).length > 0) {
                            progressCollector.add(parsedStreams);
                            logger.info(`📈 REAL-TIME: ${source} added ${Object.keys(parsedStreams).length} streams to live results`);
                        }
                        
                    } catch (parseError) {
                        logger.error(`❌ IMMEDIATE M3U8 parse failed for ${source}: ${parseError.message}`);
                        const fallbackStream = { [`${source} Link`]: requestUrl };
                        Object.assign(streamUrls, fallbackStream);
                        if (progressCollector) {
                            progressCollector.add(fallbackStream);
                        }
                    }
                });
            } else {
                const directStream = { [`${source} Link`]: requestUrl };
                Object.assign(streamUrls, directStream);
                if (progressCollector) {
                    progressCollector.add(directStream);
                }
                logger.info(`✅ IMMEDIATE: Direct video stream for ${source}`);
            }
            
            await request.continue();
        } else {
            await request.continue();
        }
    });

    try {
        logger.info(`🌐 Navigating to ${url}`);
        
        // ✅ UNIFORM 20-second timeout for ALL providers - No special handling
        await page.goto(url, { 
            waitUntil: 'networkidle2', 
            timeout: 20000  // 20 seconds for ALL providers
        });

        logger.info(`📄 ${source} Player page loaded`);

        // ✅ NO SPECIAL PROVIDER HANDLING - Just wait for stream URLs
        logger.info(`⏳ ${source} Waiting for stream URLs...`);

        // ✅ Wait for streams with uniform timeout
        const foundUrls = new Promise(resolve => {
            const interval = setInterval(() => {
                if (detectedStreams.length > 0) {
                    clearInterval(interval);
                    resolve(true);
                }
            }, 200);
            
            // Auto-resolve after 15 seconds of waiting
            setTimeout(() => {
                clearInterval(interval);
                resolve(false);
            }, 15000);
        });
        
        await foundUrls;

        if (Object.keys(streamUrls).length === 0) {
            throw new Error('No stream URL found');
        }

        logger.info(`✅ ${source} COMPLETED: ${Object.keys(streamUrls).join(', ')}`);
        return streamUrls;

    } catch (err) {
        if (Object.keys(streamUrls).length > 0) {
            logger.info(`⚠️ ${source} partial success: ${Object.keys(streamUrls).join(', ')}`);
        } else {
            logger.error(`❌ ${source} extraction failed: ${err.message}`);
        }
        return streamUrls;
    } finally {
        try {
            processedUrls.clear();
            await browser.close();
        } catch (closeError) {
            logger.warn(`⚠️ Error closing ${source} browser: ${closeError.message}`);
        }
    }
}

module.exports = runExtractor;

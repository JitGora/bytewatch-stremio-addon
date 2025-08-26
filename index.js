//index.js - BATCH RESULTS VERSION (Waits for all providers)
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');
const logger = require('./logger');
const extractor = require('./unified-extractor');

// It's better to use environment variables for sensitive data like ports and API keys
const PORT = process.env.PORT || 7000;
const OMDB_API_KEY = process.env.OMDB_API_KEY || 'b1e4f11'; // Using environment variable is a good practice

const builder = new addonBuilder({
    id: 'org.bytetan.bytewatch',
    version: '4.1.0', // Incremented version for the change in behavior
    name: 'ByteWatch ⚡ Lightning Pro',
    description: '🚀 Fetches streams from 10 providers simultaneously for the best results!', // Updated description
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt']
});

const streamCache = new NodeCache({ stdTTL: 3600, checkperiod: 300, maxKeys: 1000 });
const failureCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// ✅ SOURCES - Add or remove as needed
const SOURCES = [
    // { name: 'vidsrc', timeout: 40000, priority: 1 },      // 20s page + 5s buffer
    { name: 'vidlink', timeout: 20000, priority: 2 },     // 20s page + 5s buffer
    // { name: 'wooflix', timeout: 20000, priority: 3 },     // 20s page + 5s buffer
    // { name: 'autoembed', timeout: 40000, priority: 4 },   // 20s page + 5s buffer
    { name: 'vidfast', timeout: 20000, priority: 1 },     // 20s page + 5s buffer
    { name: 'mappletv', timeout: 40000, priority: 6 },    // 20s page + 5s buffer
    { name: 'vilora', timeout: 20000, priority: 7 },      // 20s page + 5s buffer
    // { name: 'autoembed-hindi', timeout: 40000, priority: 8 }, // 20s page + 5s buffer
    // { name: 'vidify', timeout: 20000, priority: 9 },      // 20s page + 5s buffer
    // { name: 'vidjoy', timeout: 20000, priority: 10 }      // 20s page + 5s buffer
];

async function fetchOmdbDetails(imdbId) {
    try {
        const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`, {
            timeout: 5000
        });
        if (response.data.Response === 'False') {
            logger.warn(`OMDB API responded with an error for ${imdbId}: ${response.data.Error}`);
            return { Title: 'Unknown', Year: 'Unknown', Type: 'movie' };
        }
        return response.data;
    } catch (e) {
        logger.warn(`OMDB fetch failed for ${imdbId}: ${e.message}`);
        return { Title: 'Unknown', Year: 'Unknown', Type: 'movie' };
    }
}

// ✅ REFACTORED to wait for all results before returning
async function extractAllStreams({ type, imdbId, season, episode }) {
    const metadata = await fetchOmdbDetails(imdbId);
    const title = `${metadata.Title} ${season ? `S${season}E${episode}` : `(${metadata.Year})`}`;

    const failureKey = `failure:${type}:${imdbId}:${season}:${episode}`;
    const recentFailures = failureCache.get(failureKey) || [];
    const activeSources = SOURCES.filter(source => !recentFailures.includes(source.name));

    logger.info(`🚀 Starting extraction for: ${title}`);
    logger.info(`⚡ Querying ${activeSources.length}/${SOURCES.length} sources.`);

    // Create an array of promises for all active sources
    const extractionPromises = activeSources.map(source =>
        Promise.race([
            extractor(source.name, type, imdbId, season, episode),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`${source.name} timeout after ${source.timeout}ms`)), source.timeout)
            )
        ]).then(result => ({ source: source.name, result, status: 'success' }))
          .catch(error => ({ source: source.name, error: error.message, status: 'failed' }))
    );

    const startTime = Date.now();
    // Wait for all promises to settle (either resolve or reject)
    const results = await Promise.allSettled(extractionPromises);
    const finalDuration = Date.now() - startTime;

    const allStreams = {};
    const newFailures = [];

    // Process the results after all have completed
    results.forEach(settledResult => {
        if (settledResult.status === 'fulfilled') {
            const sourceResult = settledResult.value;
            if (sourceResult.status === 'success' && sourceResult.result && Object.keys(sourceResult.result).length > 0) {
                logger.info(`✅ ${sourceResult.source} COMPLETED: ${Object.keys(sourceResult.result).length} streams`);
                Object.assign(allStreams, sourceResult.result);
            } else if (sourceResult.status === 'failed') {
                logger.warn(`❌ ${sourceResult.source} FAILED: ${sourceResult.error}`);
                newFailures.push(sourceResult.source);
            } else {
                logger.warn(`⚠️ ${sourceResult.source} completed but no streams found`);
            }
        } else {
            logger.error(`💥 An unexpected error occurred during extraction promise settlement: ${settledResult.reason}`);
        }
    });

    // Update failure cache
    if (newFailures.length > 0) {
        const allFailures = [...new Set([...recentFailures, ...newFailures])].slice(-3);
        failureCache.set(failureKey, allFailures);
    }

    logger.info(`🏁 Extraction complete: Found ${Object.keys(allStreams).length} total streams in ${finalDuration}ms`);
    return allStreams;
}


function formatStreams(streams, metadata, season = null, episode = null) {
    const title = metadata.Title || 'Unknown';
    const year = metadata.Year || 'Unknown';
    const displayTitle = season ? `${title} S${season}E${episode}` : `${title} (${year})`;

    if (!streams || Object.keys(streams).length === 0) {
        return [
            {
                name: "❌ No Streams Available",
                url: "#", // Using a placeholder URL
                description: `No working streams found for ${displayTitle}. Sources may be temporarily down.`
            }
        ];
    }

    return Object.entries(streams)
        .sort(([a], [b]) => {
            const getQualityWeight = (name) => {
                if (name.includes('1080p')) return 1;
                if (name.includes('720p')) return 2;
                if (name.includes('480p')) return 3;
                return 4;
            };
            return getQualityWeight(a) - getQualityWeight(b);
        })
        .map(([name, url]) => ({
            name: name.includes('1080p') ? `🔥 ${name}` :
                  name.includes('720p') ? `⭐ ${name}` :
                  name.includes('480p') ? `📺 ${name}` :
                  name.includes('hindi') || name.includes('Hindi') ? `🇮🇳 ${name}` :
                  `🎥 ${name}`,
            url,
            description: displayTitle,
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `${title}-${year}`
            }
        }));
}

async function getMovieStreams(imdbId) {
    const cacheKey = `movie:${imdbId}`;
    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`💾 Cache hit for movie ${imdbId}`);
        const metadata = await fetchOmdbDetails(imdbId);
        return formatStreams(cached, metadata);
    }

    logger.info(`🎬 Starting movie processing: ${imdbId}`);
    const streams = await extractAllStreams({ type: 'movie', imdbId });

    if (Object.keys(streams).length > 0) {
        streamCache.set(cacheKey, streams, 7200);
    }

    const metadata = await fetchOmdbDetails(imdbId);
    return formatStreams(streams, metadata);
}

async function getSeriesStreams(imdbId, season, episode) {
    const cacheKey = `series:${imdbId}:${season}:${episode}`;
    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`💾 Cache hit for series ${imdbId} S${season}E${episode}`);
        const metadata = await fetchOmdbDetails(imdbId);
        return formatStreams(cached, metadata, season, episode);
    }

    logger.info(`📺 Starting series processing: ${imdbId} S${season}E${episode}`);
    const streams = await extractAllStreams({
        type: 'series',
        imdbId,
        season,
        episode
    });

    if (Object.keys(streams).length > 0) {
        streamCache.set(cacheKey, streams, 3600);
    }

    const metadata = await fetchOmdbDetails(imdbId);
    return formatStreams(streams, metadata, season, episode);
}


builder.defineStreamHandler(async ({ type, id }) => {
    const startTime = Date.now();
    logger.info(`🚀 REQUEST RECEIVED: ${type}, ${id}`);

    try {
        let streams = [];

        if (type === 'movie') {
            const imdbId = id.split(':')[0];
            streams = await getMovieStreams(imdbId);
        } else if (type === 'series') {
            const [imdbId, season, episode] = id.split(':');
            streams = await getSeriesStreams(imdbId, season, episode);
        }

        const duration = Date.now() - startTime;
        logger.info(`⚡ RESPONSE SENT: ${streams.length} streams in ${duration}ms`);

        return { streams };

    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`💥 Handler error after ${duration}ms for ${type}:${id}:`, error);

        return {
            streams: [{
                name: "⚠️ Service Error",
                url: "#",
                description: "An unexpected error occurred. Please try again later."
            }]
        };
    }
});

serveHTTP(builder.getInterface(), { port: PORT, hostname: "0.0.0.0" });
logger.info(`⚡🔥 ByteWatch LIGHTNING PRO running on port ${PORT} 🔥⚡`);

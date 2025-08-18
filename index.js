//index.js - PROGRESSIVE STREAMING VERSION
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');
const logger = require('./logger');
const extractor = require('./unified-extractor');

const PORT = process.env.PORT || 7000;

const builder = new addonBuilder({
    id: 'org.bytetan.bytewatch',
    version: '3.0.0',
    name: 'ByteWatch ⚡ Lightning',
    description: '🚀 Real-time progressive streaming - Results as they arrive!',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt']
});

const streamCache = new NodeCache({ stdTTL: 3600, checkperiod: 300, maxKeys: 1000 });
const failureCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const SOURCES = [
    { name: 'vidsrc', timeout: 8000, priority: 1 },
    { name: 'wooflix', timeout: 10000, priority: 2 },
    { name: 'vidfast', timeout: 12000, priority: 3 },
    { name: 'vilora', timeout: 15000, priority: 4 },
    { name: 'vidify', timeout: 15000, priority: 5 },
    { name: 'vidjoy', timeout: 18000, priority: 6 }
];

async function fetchOmdbDetails(imdbId) {
    try {
        const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=b1e4f11`, {
            timeout: 5000
        });
        if (response.data.Response === 'False') {
            return { Title: 'Unknown', Year: 'Unknown', Type: 'movie' };
        }
        return response.data;
    } catch (e) {
        logger.warn(`OMDB fetch failed for ${imdbId}: ${e.message}`);
        return { Title: 'Unknown', Year: 'Unknown', Type: 'movie' };
    }
}

// ✅ REAL-TIME PROGRESSIVE extraction - Process streams immediately
async function extractStreamsProgressively({type, imdbId, season, episode}) {
    const streamResults = {};
    const progressiveStreams = new Map(); // Track processed streams
    const metadata = await fetchOmdbDetails(imdbId);
    const title = `${metadata.Title} ${season ? `S${season}E${episode}` : `(${metadata.Year})`}`;
    
    const failureKey = `failure:${type}:${imdbId}:${season}:${episode}`;
    const recentFailures = failureCache.get(failureKey) || [];
    const activeSources = SOURCES.filter(source => !recentFailures.includes(source.name));
    
    logger.info(`🚀 PROGRESSIVE extraction for: ${title}`);
    logger.info(`⚡ ${activeSources.length} sources running with REAL-TIME processing!`);

    // ✅ Stream result handler - processes results as they arrive
    const streamResultCollector = {
        results: {},
        count: 0,
        add(sourceResults) {
            Object.assign(this.results, sourceResults);
            this.count = Object.keys(this.results).length;
            logger.info(`📈 PROGRESSIVE: Now ${this.count} total streams available`);
        }
    };

    // ✅ Create extraction promises with IMMEDIATE M3U8 processing
    const extractionPromises = activeSources.map(source => {
        const extractionPromise = Promise.race([
            // Pass the collector for real-time updates
            extractor(source.name, type, imdbId, season, episode, streamResultCollector),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`${source.name} timeout after ${source.timeout}ms`)), source.timeout)
            )
        ]);

        return extractionPromise
            .then(result => {
                if (result && Object.keys(result).length > 0) {
                    logger.info(`✅ ${source.name} COMPLETED: ${Object.keys(result).length} streams`);
                    streamResultCollector.add(result);
                    return { source: source.name, result, status: 'success' };
                } else {
                    logger.warn(`⚠️ ${source.name} completed but no streams found`);
                    return { source: source.name, result: {}, status: 'empty' };
                }
            })
            .catch(error => {
                logger.warn(`❌ ${source.name} FAILED: ${error.message}`);
                return { source: source.name, error: error.message, status: 'failed' };
            });
    });

    // ✅ Process all results concurrently with progress tracking
    const startTime = Date.now();
    let completedSources = 0;
    const newFailures = [];

    try {
        const results = await Promise.allSettled(extractionPromises);
        
        for (const result of results) {
            completedSources++;
            const duration = Date.now() - startTime;
            
            if (result.status === 'fulfilled') {
                const sourceResult = result.value;
                if (sourceResult.status === 'failed') {
                    newFailures.push(sourceResult.source);
                }
                
                logger.info(`📊 Progress: ${completedSources}/${activeSources.length}, ${streamResultCollector.count} streams, ${duration}ms elapsed`);
            }
        }

        // Update failure cache
        if (newFailures.length > 0) {
            const allFailures = [...recentFailures, ...newFailures].slice(-3);
            failureCache.set(failureKey, allFailures);
        }

        const finalDuration = Date.now() - startTime;
        logger.info(`🏁 PROGRESSIVE extraction complete: ${streamResultCollector.count} streams in ${finalDuration}ms`);
        
        return streamResultCollector.results;

    } catch (error) {
        logger.error(`💥 Progressive extraction error: ${error.message}`);
        return streamResultCollector.results; // Return whatever we got
    }
}

function formatStreams(streams, metadata, season = null, episode = null) {
    const title = metadata.Title || 'Unknown';
    const year = metadata.Year || 'Unknown';
    const displayTitle = season ? `${title} S${season}E${episode}` : `${title} (${year})`;

    if (!streams || Object.keys(streams).length === 0) {
        return [
            {
                name: "❌ No Streams Available",
                url: "https://example.com/unavailable", 
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
    const metadata = await fetchOmdbDetails(imdbId);
    
    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`💾 Cache hit for movie ${imdbId}`);
        return formatStreams(cached, metadata);
    }
    
    logger.info(`🎬 Starting PROGRESSIVE movie processing: ${imdbId}`);
    const startTime = Date.now();
    
    const streams = await extractStreamsProgressively({ type: 'movie', imdbId });
    
    const duration = Date.now() - startTime;
    logger.info(`🎬 Movie completed in ${duration}ms from extraction: ${Object.keys(streams).length} streams`);
    
    if (Object.keys(streams).length > 0) {
        streamCache.set(cacheKey, streams, 7200);
    }
    
    return formatStreams(streams, metadata);
}

async function getSeriesStreams(imdbId, season, episode) {
    const cacheKey = `series:${imdbId}:${season}:${episode}`;
    const metadata = await fetchOmdbDetails(imdbId);
    
    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`💾 Cache hit for series ${imdbId} S${season}E${episode}`);
        return formatStreams(cached, metadata, season, episode);
    }
    
    logger.info(`📺 Starting PROGRESSIVE series processing: ${imdbId} S${season}E${episode}`);
    const startTime = Date.now();
    
    const streams = await extractStreamsProgressively({ 
        type: 'series', 
        imdbId, 
        season, 
        episode 
    });
    
    const duration = Date.now() - startTime;
    logger.info(`📺 Series completed in ${duration}ms from extraction: ${Object.keys(streams).length} streams`);
    
    if (Object.keys(streams).length > 0) {
        streamCache.set(cacheKey, streams, 3600);
    }
    
    return formatStreams(streams, metadata, season, episode);
}

builder.defineStreamHandler(async ({type, id}) => {
    const startTime = Date.now();
    logger.info(`🚀 PROGRESSIVE REQUEST: ${type}, ${id}`);
    
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
        logger.info(`⚡ PROGRESSIVE RESPONSE: ${streams.length} streams in ${duration}ms`);
        
        return Promise.resolve({ streams });
        
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`💥 Progressive handler error after ${duration}ms: ${error.message}`);
        
        return Promise.resolve({
            streams: [{
                name: "⚠️ Service Temporarily Unavailable",
                url: "https://example.com/error",
                description: "Streaming service temporarily unavailable. Please try again."
            }]
        });
    }
});

serveHTTP(builder.getInterface(), {port: PORT, hostname: "0.0.0.0"});
logger.info(`⚡🔥 ByteWatch LIGHTNING running on port ${PORT} - PROGRESSIVE STREAMING! 🔥⚡`);

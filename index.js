//index.js
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');
const logger = require('./logger');
const extractor = require('./unified-extractor');

const PORT = process.env.PORT || 7000;

const builder = new addonBuilder({
    id: 'org.bytetan.bytewatch',
    version: '1.0.0',
    name: 'ByteWatch',
    description: 'Get stream links for tv shows and movies',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt']
});

// Setup cache to reduce load (cache for 2 hours)
const streamCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

// Fetch movie data for descriptions
async function fetchOmdbDetails(imdbId){
  try {
    const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=b1e4f11`);
     if (response.data.Response === 'False') {
      throw new Error(response.data || 'Failed to fetch data from OMDB API');
     }
    return response.data;
  } catch (e) {
    console.log(`Error fetching metadata: ${e}`)
    return null
  }
}

// Simplified extraction - use IMDB ID directly
async function extractAllStreams({type, imdbId, season, episode}) {
    const streams = {};
    
    console.log(`✅ Using IMDB ID directly: ${imdbId} for ${type}`);
    
    const [
        wooflixResult,
        viloraResult,
        vidsrcResult,
        vidjoyResult,
        vidifyResult,
        vidfastResult
    ] = await Promise.allSettled([
        extractor('wooflix', type, imdbId, season, episode),
        extractor('vilora', type, imdbId, season, episode),
        extractor('vidsrc', type, imdbId, season, episode),
        extractor('vidjoy', type, imdbId, season, episode),
        extractor('vidify', type, imdbId, season, episode),
        extractor('vidfast', type, imdbId, season, episode)
    ]);

    // Handle all results
    if (wooflixResult.status === 'fulfilled' && wooflixResult.value) {
        for (const label in wooflixResult.value) {
            streams[label] = wooflixResult.value[label];
        }
    } else {
        console.warn('❌ wooflix extraction failed:', wooflixResult.reason?.message);
    }

    if (viloraResult.status === 'fulfilled' && viloraResult.value) {
        for (const label in viloraResult.value) {
            streams[label] = viloraResult.value[label];
        }
    } else {
        console.warn('❌ Vilora extraction failed:', viloraResult.reason?.message);
    }

    if (vidsrcResult.status === 'fulfilled' && vidsrcResult.value) {
        for (const label in vidsrcResult.value) {
            streams[label] = vidsrcResult.value[label];
        }
    } else {
        console.warn('❌ VidSrc extraction failed:', vidsrcResult.reason?.message);
    }

    if (vidjoyResult.status === 'fulfilled' && vidjoyResult.value) {
        for (const label in vidjoyResult.value) {
            streams[label] = vidjoyResult.value[label];
        }
    } else {
        console.warn('❌ Vidjoy extraction failed:', vidjoyResult.reason?.message);
    }

    if (vidifyResult.status === 'fulfilled' && vidifyResult.value) {
        for (const label in vidifyResult.value) {
            streams[label] = vidifyResult.value[label];
        }
    } else {
        console.warn('❌ Vidify extraction failed:', vidifyResult.reason?.message);
    }

    if (vidfastResult.status === 'fulfilled' && vidfastResult.value) {
        for (const label in vidfastResult.value) {
            streams[label] = vidfastResult.value[label];
        }
    } else {
        console.warn('❌ VidFast extraction failed:', vidfastResult.reason?.message);
    }

    return streams;
}

// Function to handle streams for movies
async function getMovieStreams(imdbId) {
    const cacheKey = `movie:${imdbId}`;
    const metadata = await fetchOmdbDetails(imdbId);
    
    // Check cache first
    const cached = streamCache.get(cacheKey);
    if (cached) {
        console.log(`Using cached stream for movie ${imdbId}`);
        return Object.entries(cached).map(([name, url]) => ({
            name: name.includes('1080p') ? `🔥 ${name}` : 
                  name.includes('720p') ? `⭐ ${name}` : 
                  name.includes('480p') ? `📺 ${name}` : name,
            url,
            description: `${metadata?.Title || 'Movie'} (${metadata?.Year || 'Unknown'})`
        }));
    }
    
    const streams = await extractAllStreams({ type: 'movie', imdbId });
    streamCache.set(cacheKey, streams);
    
    return Object.entries(streams).map(([name, url]) => ({
        name: name.includes('1080p') ? `🔥 ${name}` : 
              name.includes('720p') ? `⭐ ${name}` : 
              name.includes('480p') ? `📺 ${name}` : name,
        url,
        description: `${metadata?.Title || 'Movie'} (${metadata?.Year || 'Unknown'})`
    }));
}

// Function to handle streams for TV series
async function getSeriesStreams(imdbId, season, episode) {
    const cacheKey = `series:${imdbId}:${season}:${episode}`;
    const metadata = await fetchOmdbDetails(imdbId);
    
    // Check cache first
    const cached = streamCache.get(cacheKey);
    if (cached) {
        console.log(`Using cached stream for series ${imdbId} S${season}E${episode}`);
        return Object.entries(cached).map(([name, url]) => ({
            name: name.includes('1080p') ? `🔥 ${name}` : 
                  name.includes('720p') ? `⭐ ${name}` : 
                  name.includes('480p') ? `📺 ${name}` : name,
            url,
            description: `${metadata?.Title || 'Series'} S${season}E${episode}`
        }));
    }
    
    const streams = await extractAllStreams({ type: 'series', imdbId, season, episode });
    
    // ✅ Fixed: Added missing cache storage for series
    streamCache.set(cacheKey, streams);
    
    return Object.entries(streams).map(([name, url]) => ({
        name: name.includes('1080p') ? `🔥 ${name}` : 
              name.includes('720p') ? `⭐ ${name}` : 
              name.includes('480p') ? `📺 ${name}` : name,
        url,
        description: `${metadata?.Title || 'Series'} S${season}E${episode}`
    }));
}

builder.defineStreamHandler(async ({type, id}) => {
    logger.info(`Stream request: ${type}, ${id}`);
    
    try {
        if (type === 'movie') {
            const imdbId = id.split(':')[0];
            const streams = await getMovieStreams(imdbId);
            return Promise.resolve( { streams });
        }

        if (type === 'series') {
            const [imdbId, season, episode] = id.split(':');
            const streams = await getSeriesStreams(imdbId, season, episode);
            return Promise.resolve({ streams });
        }

        return { streams: [] };
    } catch (error) {
        console.error('Error in stream handler:', error.message);
        return Promise.resolve({ streams: [] });
    }
});

serveHTTP(builder.getInterface(), {port: PORT, hostname: "0.0.0.0"})
logger.info(`Addon running on port ${PORT}`);

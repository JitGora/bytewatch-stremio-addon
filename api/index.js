const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { extractor } = require('../unified-extractor');
const { logger } = require('../logger');
const axios = require('axios');
const NodeCache = require('node-cache');

const PORT = process.env.PORT || 7000;

const builder = new addonBuilder({
    id: 'org.bytetan.bytewatch',
    name: 'Bytewatch Stremio Addon',
    description: 'A Node.js-powered Stremio addon that scrapes multiple streaming sites using Puppeteer',
    version: '1.0.0',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    logo: 'https://www.bytetan.com/static/img/logo.png',
    idPrefixes: ['tt']
});

// Setup cache to reduce load (cache for 2 hours)
const streamCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

// Fetch movie data
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

// Fetch TMDB ID
async function fetchTmdbId(imdbId){
  try {
      const response = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`,
          {
              method: 'GET',
              headers: {
                  accept: 'application/json',
                  Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3M2EyNzkwNWM1Y2IzNjE1NDUyOWNhN2EyODEyMzc0NCIsIm5iZiI6MS43MjM1ODA5NTAwMDg5OTk4ZSs5LCJzdWIiOiI2NmJiYzIxNjI2NmJhZmVmMTQ4YzVkYzkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.y7N6qt4Lja5M6wnFkqqo44mzEMJ60Pzvm0z_TfA1vxk'
              }
          });
      return response.data;
  } catch (e) {
      console.log(`Error fetching metadata: ${e}`)
      return null
  }
}

// Main extraction function
async function extractAllStreams({type, imdbId, season, episode}) {
    const streams = {};
    const tmdbRes = await fetchTmdbId(imdbId);

    const id = type === 'movie'
        ? tmdbRes['movie_results'][0]?.id
        : tmdbRes['tv_results'][0]?.id;

    if (!id) {
        console.warn('❌ TMDB ID not found');
        return streams;
    }

    const [
        wooflixResult,
        fmoviesResult,
        vidoraResult,
        videasyResult,
        viloraResult,
        vidsrcResult,
    ] = await Promise.allSettled([
        extractor('wooflix', type, id, season, episode),
        extractor('fmovies', type, id, season, episode),
        extractor('vidora', type, id, season, episode),
        extractor('videasy', type, id, season, episode),
        extractor('vilora', type, id, season, episode),
        extractor('vidsrc', type, id, season, episode),
    ]);

    if (fmoviesResult.status === 'fulfilled' && fmoviesResult.value) {
        for (const label in fmoviesResult.value) {
            streams[label] = fmoviesResult.value[label];
        }
    } else {
        console.warn('❌ Fmovies extraction failed:', fmoviesResult.reason?.message);
    }

    if (wooflixResult.status === 'fulfilled' && wooflixResult.value) {
        for (const label in wooflixResult.value) {
            streams[label] = wooflixResult.value[label];
        }
    } else {
        console.warn('❌ wooflix extraction failed:', wooflixResult.reason?.message);
    }

    if (vidoraResult.status === 'fulfilled' && vidoraResult.value) {
        for (const label in vidoraResult.value) {
            streams[label] = vidoraResult.value[label];
        }
    } else {
        console.warn('❌ Vidora extraction failed:', vidoraResult.reason?.message);
    }

    if (videasyResult.status === 'fulfilled' && videasyResult.value) {
        for (const label in videasyResult.value) {
            streams[label] = videasyResult.value[label];
        }
    } else {
        console.warn('❌ VideasyResult extraction failed:', vidoraResult.reason?.message);
    }

    if (viloraResult.status === 'fulfilled' && viloraResult.value) {
        for (const label in viloraResult.value) {
            streams[label] = viloraResult.value[label];
        }
    } else {
        console.warn('❌ Vilora Result extraction failed:', viloraResult.reason?.message);
    }

    if (vidsrcResult.status === 'fulfilled' && vidsrcResult.value) {
        for (const label in vidsrcResult.value) {
            streams[label] = vidsrcResult.value[label];
        }
    } else {
        console.warn('❌ VidSrc Result extraction failed:', vidsrcResult.reason?.message);
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
            name,
            url,
            description: `${metadata.Title} (${metadata.Year})`
        }));
    }
    const streams = await extractAllStreams({ type: 'movie', imdbId });
    streamCache.set(cacheKey, streams);

    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata.Title} (${metadata.Year})`
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
            name,
            url,
            description: `${metadata.Title} S${season}E${episode}`
        }));
    }

    const streams = await extractAllStreams({ type: 'series', imdbId, season, episode });
    // streamCache.set(cacheKey, streams);
    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata.Title} S${season}E${episode}`
    }));
}

builder.defineStreamHandler(async ({type, id}) => {
    logger.info(`Stream request: ${type}, ${id}`);
    try {
        if (type === 'movie') {
            // Movie IDs are in the format: tt1234567
            const imdbId = id.split(':')[0];
            const streams = await getMovieStreams(imdbId);
            return Promise.resolve( { streams });
        }
        if (type === 'series') {
            // Series IDs are in the format: tt1234567:1:1 (imdbId:season:episode)
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

// Export the handler for Vercel
module.exports = (req, res) => {
    const manifest = builder.getInterface();

    // Handle manifest request
    if (req.url === '/manifest.json' || req.url === '/') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }

        res.status(200).json(manifest);
        return;
    }

    // Handle stream requests
    if (req.url.startsWith('/stream/')) {
        const path = req.url.replace('/stream/', '');
        const [type, id] = path.split('/');

        if (type && id) {
            builder.getInterface().stream({ type, id })
                .then(result => {
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.status(200).json(result);
                })
                .catch(error => {
                    console.error('Stream error:', error);
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.status(500).json({ error: 'Internal server error' });
                });
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(400).json({ error: 'Invalid request' });
        }
        return;
    }

    // Default response
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(404).json({ error: 'Not found yet' });
};
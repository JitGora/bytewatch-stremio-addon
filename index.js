const { addonBuilder, serveHTTP }  = require('stremio-addon-sdk');
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
        viloraResult,
        vidsrcResult,
        vidjoyResult,
        vidifyResult
    ] = await Promise.allSettled([
        extractor('wooflix', type, id, season, episode),
        extractor('vilora', type, id, season, episode),
        extractor('vidsrc', type, id, season, episode),
        extractor('vidjoy', type, id, season, episode),
        extractor('vidify', type, id, season, episode)
    ]);

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
        console.warn('❌ Vilora Result extraction failed:', viloraResult.reason?.message);
    }

    if (vidsrcResult.status === 'fulfilled' && vidsrcResult.value) {
        for (const label in vidsrcResult.value) {
            streams[label] = vidsrcResult.value[label];
        }
    } else {
        console.warn('❌ VidSrc Result extraction failed:', vidsrcResult.reason?.message);
    }

    if (vidjoyResult.status === 'fulfilled' && vidjoyResult.value) {
        for (const label in vidjoyResult.value) {
            streams[label] = vidjoyResult.value[label];
        }
    } else {
        console.warn('❌ Vidjoy Result extraction failed:', vidjoyResult.reason?.message);
    }

    if (vidifyResult.status === 'fulfilled' && vidifyResult.value) {
        for (const label in vidifyResult.value) {
            streams[label] = vidifyResult.value[label];
        }
    } else {
        console.warn('❌ Vidify Result extraction failed:', vidifyResult.reason?.message);
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

serveHTTP(builder.getInterface(), {port: PORT, hostname: "0.0.0.0"})
logger.info(`Addon running on port ${PORT}`);
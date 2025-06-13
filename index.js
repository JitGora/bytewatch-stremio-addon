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

// Setup cache to reduce load (cache for 24 hours)
const streamCache = new NodeCache({ stdTTL: 86400, checkperiod: 120 });

// Fetch movie data
async function fetchOmdbDetails(imdbId){
  try {
    const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=b1e4f11`);
     if (response.data.Response === 'False') {
      throw new Error(response.data || 'Failed to fetch data from OMDB API');
     }
    return response.data;
  } catch (e) {
    logger.error(`Error fetching metadata: ${e}`)
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
      logger.error(`Error fetching metadata: ${e}`)
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
        logger.error('❌ TMDB ID not found');
        return streams;
    }

    const [
        broflixResult,
        fmoviesResult,
        vidoraResult,
        videasyResult,
    ] = await Promise.allSettled([
        extractor('broflix', type, id, season, episode),
        extractor('fmovies', type, id, season, episode),
        extractor('vidora', type, id, season, episode),
        extractor('videasy', type, id, season, episode),
    ]);

    if (fmoviesResult.status === 'fulfilled' && fmoviesResult.value) {
        for (const label in fmoviesResult.value) {
            streams[label] = fmoviesResult.value[label];
        }
    } else {
        logger.error('❌ Fmovies extraction failed:', fmoviesResult.reason?.message);
    }

    if (broflixResult.status === 'fulfilled' && broflixResult.value) {
        for (const label in broflixResult.value) {
            streams[label] = broflixResult.value[label];
        }
    } else {
        logger.error('❌ BroFlix extraction failed:', broflixResult.reason?.message);
    }

    if (vidoraResult.status === 'fulfilled' && vidoraResult.value) {
        for (const label in vidoraResult.value) {
            streams[label] = vidoraResult.value[label];
        }
    } else {
        logger.error('❌ Vidora extraction failed:', vidoraResult.reason?.message);
    }

    if (videasyResult.status === 'fulfilled' && videasyResult.value) {
        for (const label in videasyResult.value) {
            streams[label] = videasyResult.value[label];
        }
    } else {
        logger.error('❌ VideasyResult extraction failed:', vidoraResult.reason?.message);
    }

    return streams;
}

// Function to handle streams for movies
async function getMovieStreams(imdbId) {
    let finalStreams = [];
    const cacheKey = `movie:${imdbId}`;
    const metadata = await fetchOmdbDetails(imdbId);

    // Check cache first
    const cached = streamCache.get(cacheKey);
    if (cached) {
        logger.info(`Using cached stream for movie ${imdbId}`);
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
        logger.info(`Using cached stream for series ${imdbId} S${season}E${episode}`);
        return Object.entries(cached).map(([name, url]) => ({
            name,
            url,
            description: `${metadata.Title} S${season}E${episode}`
        }));
    }

    const streams = await extractAllStreams({ type: 'series', imdbId, season, episode });
    streamCache.set(cacheKey, streams);
    return Object.entries(streams).map(([name, url]) => ({
        name,
        url,
        description: `${metadata.Title} S${season}E${episode}`
    }));
}



builder.defineStreamHandler(async ({type, id}) => {
    logger.info('Stream request:', type, id);
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
        logger.error('Error in stream handler:', error.message);
        return Promise.resolve({ streams: [] });
    }
});

serveHTTP(builder.getInterface(), {port: PORT, hostname: "0.0.0.0"})
logger.info(`Addon running on port ${PORT}`);
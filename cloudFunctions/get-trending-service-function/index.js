const axios = require('axios');
const functions = require('@google-cloud/functions-framework');

// Genre Hash Table (ID to Genre Name)
const genreHashTable = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

// Reverse Genre Hash Table (Name to ID)
const genreNameToId = Object.keys(genreHashTable).reduce((acc, key) => {
  acc[genreHashTable[key].toLowerCase()] = key;
  return acc;
}, {});

// Provider Mapping (Name to ID)
const providerMapping = {
  'netflix': '8',
  'hulu': '15',
  'prime': '9',
  'disney': '337',
  'hbo': '49',
  'apple': '350',
  // Add more providers as needed
};

// Helper function to map genre IDs to names
function getGenres(movie) {
  // Ensure genre_ids exists and is an array
  if (!movie.genre_ids || !Array.isArray(movie.genre_ids)) {
    return 'Unknown Genre';
  }
  // Map genre_ids to genre names for the given movie
  const genreNames = movie.genre_ids.map(id => genreHashTable[id]).filter(Boolean).join(', ');
  return genreNames || 'Unknown Genre';
}

// Helper function to format the release date as "Month Year"
const formatReleaseDate = (releaseDate) => {
  if (!releaseDate) return 'N/A';
  const date = new Date(releaseDate);
  if (isNaN(date)) return 'N/A';
  const options = { year: 'numeric', month: 'short' }; // Short month name and year
  return date.toLocaleString('en-US', options);
};

// Truncate Overview
function truncateOverview(overview, maxLength = 85) {
  return overview && overview.length > maxLength
    ? `${overview.slice(0, maxLength)}...`
    : overview || 'No overview available.';
}

// Export the Cloud Function
functions.http('helloHttp', async (req, res) => {
  try {
    // Validate the presence of sessionInfo and parameters
    if (!req.body.sessionInfo || !req.body.sessionInfo.parameters) {
      throw new Error('Missing sessionInfo or parameters in the request.');
    }

    // Extract parameters safely
    const parameters = req.body.sessionInfo.parameters || {};

    // Extract 'provider', default to 'netflix' if not provided
    let provider = parameters.provider || 'netflix';
    provider = provider.toLowerCase();

    // Handle variations in provider names
    if (provider.includes('prime') || provider.includes('amazon')) {
      provider = 'prime';
    }
    if (provider.includes('apple')) {
      provider = 'apple';
    }
    if (provider.includes('disney')) {
      provider = 'disney';
    }
    if (provider.includes('hbo') || provider.includes('max')) {
      provider = 'hbo';
    }

    const providerId = providerMapping[provider];

    if (!providerId) {
      return res.status(400).json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [`Provider "${provider}" not recognized. Please try another provider.`],
              },
            },
          ],
        },
      });
    }

    // Extract 'genre' parameter if provided
    const genre = parameters.genre ? parameters.genre.toLowerCase() : null;
    const genreId = genre ? genreNameToId[genre] : null;

    if (genre && !genreId) {
      return res.status(400).json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [`Genre "${parameters.genre}" not recognized. Please try another genre.`],
              },
            },
          ],
        },
      });
    }

    // Safely extract 'year' from 'date-period'
    const datePeriod = parameters["date-period"] || null;
    const startYear = datePeriod?.startDate?.year || null;
    const year = startYear; // If only startYear is needed

    // Validate 'year' if provided
    if (year) {
      const yearNumber = parseInt(year, 10);
      const currentYear = new Date().getFullYear();
      if (isNaN(yearNumber) || yearNumber < 1900 || yearNumber > currentYear + 1) {
        return res.status(400).json({
          fulfillmentResponse: {
            messages: [
              {
                text: {
                  text: [`The release year "${year}" is not valid. Please provide a valid year.`],
                },
              },
            ],
          },
        });
      }
    }

    // TMDB API key - it's highly recommended to use environment variables for security
    const apiKey = process.env.TMDB_API_KEY;  // Replace with your TMDB API key or set as an environment variable

    // The Movie Database (TMDb) API request setup
    const baseUrl = 'https://api.themoviedb.org/3/discover/movie';
    const params = {
      api_key: apiKey,
      include_adult: false,
      include_video: false,
      language: 'en-US',
      page: 1,
      sort_by: 'popularity.desc',
      watch_region: 'US',
      with_watch_providers: providerId,
    };

    // Add genre filter if provided
    if (genreId) {
      params.with_genres = genreId;
    }

    // Add primary_release_year filter if provided
    if (year) {
      params.primary_release_year = year;
    }

    // Create the API URL with query string
    const queryString = new URLSearchParams(params).toString();
    const apiUrl = `${baseUrl}?${queryString}`;

    // Make the API request to discover movies
    const response = await axios.get(apiUrl);
    const movies = response.data.results;

    if (!movies || movies.length === 0) {
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [`I couldn't find any movies matching your request.`],
              },
            },
          ],
        },
        session_info: {
          ...req.body.sessionInfo,
          parameters: {
            ...parameters,
            searchedMovies: parameters.searchedMovies || [], // Keep existing searchedMovies unchanged
          },
        },
      });
    }

    // Limit to top 5 movies to avoid excessive data
    const topMovies = movies.slice(0, 5);

    // Get the existing searchedMovies from session parameters
    let searchedMovies = parameters.searchedMovies || [];

    // Append the new movies to the existing list, avoiding duplicates
    const newMovies = topMovies.filter(movie => !searchedMovies.some(searched => searched.id === movie.id));
    searchedMovies = [...searchedMovies, ...newMovies];

    // Optional: Limit the size of searchedMovies to prevent unbounded growth
    const MAX_SEARCHED_MOVIES = 50;
    if (searchedMovies.length > MAX_SEARCHED_MOVIES) {
      searchedMovies = searchedMovies.slice(searchedMovies.length - MAX_SEARCHED_MOVIES);
    }

    // Base image URL for TMDB
    const baseImageUrl = 'https://image.tmdb.org/t/p/w500';

    // Map movies to rich content messages
    const richContent = topMovies.map((movie, index) => ({
      type: 'info',
      title: `${movie.title} (${formatReleaseDate(movie.release_date)}) | ${getGenres(movie)} | Rating: ${movie.vote_average || 'N/A'}`,
      subtitle: `${movie.overview}`,
      image: {
        rawUrl: movie.poster_path
          ? `${baseImageUrl}${movie.poster_path}`
          : 'https://via.placeholder.com/500x750?text=No+Image',
      },
      actionLink: `https://www.themoviedb.org/movie/${movie.id}`,
      description: truncateOverview(movie.overview),
    }));

    // Prepare the session info to add movies to session.params, while keeping the old session data
    const sessionInfo = {
      ...req.body.sessionInfo,
      parameters: {
        ...parameters,
        searchedMovies: searchedMovies, // Update searchedMovies
      },
    };

    // Return the fulfillment messages to Dialogflow CX
    res.json({
      fulfillmentResponse: {
        messages: [
          {
            payload: {
              richContent: [
                richContent // Ensure richContent is wrapped in an array if needed by the frontend
              ],
            },
          },
        ],
      },
      session_info: sessionInfo, // Use snake_case as per Dialogflow CX requirements
    });

  } catch (error) {
    console.error('Error fetching movies:', error);

    // Attempt to extract provider name for error message
    let provider = req.body.sessionInfo?.parameters?.provider || 'the selected provider';

    res.json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: [`Error fetching movies for "${provider}". Please try again later.`],
            },
          },
        ],
      },
      session_info: req.body.sessionInfo, // Optionally, you can pass back sessionInfo to maintain state
    });
  }
});

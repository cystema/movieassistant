const functions = require('@google-cloud/functions-framework');
const axios = require('axios');

// Genre ID to Genre Name mapping
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
    37: "Western"
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

// Helper function to truncate the overview
function truncateOverview(overview, maxLength = 85) {
    return overview && overview.length > maxLength ? `${overview.slice(0, maxLength)}...` : overview || 'No overview available.';
}

// Define the Cloud Function
functions.http('helloHttp', async (req, res) => {
  try {
    // Validate the presence of sessionInfo and parameters
    if (!req.body.sessionInfo || !req.body.sessionInfo.parameters) {
      throw new Error('Missing sessionInfo or parameters in the request.');
    }

    // Extract parameters safely
    const parameters = req.body.sessionInfo.parameters || {};

    const provider = parameters.provider || null;
    const genre = parameters.genre || null;
    const searchedMovies = parameters.searchedMovies || [];

    // Safely extract 'year' from 'date-period'
    const datePeriod = parameters["date-period"] || null;
    const startYear = datePeriod?.startDate?.year || null;
    const year = startYear; // If only startYear is needed

    // TMDB API key - it's highly recommended to use environment variables for security
    const apiKey = process.env.TMDB_API_KEY;  // Replace with your TMDB API key or set as an environment variable

    // Define provider and genre mappings (ensure these IDs are correct and up-to-date)
    const providerMapping = {
      'hbo': '49',
      'netflix': '8',
      'hulu': '15',
      'disney': '337',
      'prime': '9',
      'apple': '350',
      // Add more providers as needed
    };

    const genreMapping = {
      'action': '28',
      'adventure': '12',
      'animation': '16',
      'comedy': '35',
      'crime': '80',
      'documentary': '99',
      'drama': '18',
      'family': '10751',
      'fantasy': '14',
      'history': '36',
      'horror': '27',
      'music': '10402',
      'mystery': '9648',
      'romance': '10749',
      'science fiction': '878',
      'thriller': '53',
      'war': '10752',
      'western': '37',
      // Add more genres as needed
    };

    // Function to build query parameters
    function buildQueryParams(provider, genre, year, apiKey, providerMapping, genreMapping) {
      const params = {
        api_key: apiKey,
        include_adult: false,
        include_video: false,
        language: 'en-US',
        page: 1,
        sort_by: 'popularity.desc',
        watch_region: 'US',
      };

      if (year) {
        params.primary_release_year = year;
      }

      if (genre) {
        const genreId = genreMapping[genre.toLowerCase()];
        if (genreId) {
          params.with_genres = genreId;
        }
      }

      if (provider) {
        const providerId = providerMapping[provider.toLowerCase()];
        if (providerId) {
          params.with_watch_providers = providerId;
        }
      }

      return params;
    }

    // Build the query parameters based on the user’s input
    const params = buildQueryParams(provider, genre, year, apiKey, providerMapping, genreMapping);

    // Create the API URL with query string
    const apiUrl = `https://api.themoviedb.org/3/discover/movie?${new URLSearchParams(params).toString()}`;

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
        sessionInfo: {
          ...req.body.sessionInfo,
          parameters: {
            ...parameters,
            searchedMovies: searchedMovies // Keep searchedMovies unchanged if no new movies found
          }
        }
      });
    }

    // Limit to top 5 movies to avoid excessive data
    const topMovies = movies.slice(0, 5);

    // Update the searchedMovies with the new results, avoiding duplicates
    const updatedSearchedMovies = [
      ...searchedMovies,
      ...topMovies.filter(movie => !searchedMovies.some(searched => searched.id === movie.id))
    ];

    // Optional: Limit the size of searchedMovies to prevent unbounded growth
    const MAX_SEARCHED_MOVIES = 50;
    if (updatedSearchedMovies.length > MAX_SEARCHED_MOVIES) {
      updatedSearchedMovies.splice(0, updatedSearchedMovies.length - MAX_SEARCHED_MOVIES);
    }

    // Base URL for images
    const baseImageUrl = 'https://www.themoviedb.org/t/p/w500'; // Adjust size as needed

    // Map the discovered movies into a richContent response with "info" type
    const richContent = topMovies.map((movie) => ({
      type: "info",
      title: `${movie.title} (${movie.release_date ? new Date(movie.release_date).getFullYear() : 'N/A'}) | ${getGenres(movie)} | Rating: ${movie.vote_average}`,
      subtitle: `${movie.overview}`,
      image: {
        rawUrl: movie.poster_path ? `${baseImageUrl}${movie.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Image',
      },
      actionLink: `https://www.themoviedb.org/movie/${movie.id}`,
      description: truncateOverview(movie.overview),
    }));

    // Prepare the session info to add movies to session.params, while keeping the old session data
    const sessionInfo = {
      ...req.body.sessionInfo,
      parameters: {
        ...parameters,
        searchedMovies: updatedSearchedMovies // Store the updated searchedMovies
      },
    };

    // Return the discovered movies as richContent to Dialogflow
    res.json({
      fulfillmentResponse: {
        messages: [
          {
            payload: {
              richContent: [
                richContent // Ensure richContent is wrapped in an array if needed by the frontend
              ]
            }
          }
        ]
      },
      sessionInfo // Keep session info updated
    });

  } catch (error) {
    console.error('Error discovering movies:', error);

    res.json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: ['Sorry, I couldn’t retrieve the movies. Please try again later.']
            }
          }
        ]
      },
      sessionInfo: req.body.sessionInfo // Optionally, you can pass back sessionInfo to maintain state
    });
  }
});

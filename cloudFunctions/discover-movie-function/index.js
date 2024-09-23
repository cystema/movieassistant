const axios = require('axios');
const functions = require('@google-cloud/functions-framework');

// Define a function to build the query parameters based on the user's request
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

// Helper function to truncate the overview
function truncateOverview(overview, maxLength = 85) {
  return overview.length > maxLength ? `${overview.slice(0, maxLength)}...` : overview;
}

// Define the Cloud Function
functions.http('discoverMovie', async (req, res) => {
  try {
    // Get parameters from the user's input
    const provider = req.body.sessionInfo.parameters.provider || null;
    const genre = req.body.sessionInfo.parameters.genre || null;
    const searchedMovies = req.body.sessionInfo.parameters.searchedMovies || [];

    // Safely extract 'year' from 'date-period'
    const datePeriod = req.body.sessionInfo.parameters["date-period"] || null;
    const startYear = datePeriod?.startDate?.year || null;
    const year = startYear;


    const apiKey = process.env.TMDB_API_KEY; // Replace with your TMDB API key

    // Define provider and genre mappings
    const providerMapping = {
      'hbo': '1899',
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

    // Build the query parameters based on the user’s input
    const params = buildQueryParams(provider, genre, year, apiKey, providerMapping, genreMapping);

    // Create the API URL with query string
    const apiUrl = `https://api.themoviedb.org/3/discover/movie?${new URLSearchParams(params).toString()}`;

    // Make the API request to discover movies
    const response = await axios.get(apiUrl);
    const movies = response.data.results;

    if (movies.length === 0) {
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [`I couldn't find any movie matching your request.`],
              },
            },
          ],
        },
        sessionInfo: req.body.sessionInfo
      });
    }

    // Update the searchedMovies with the new results
    const updatedSearchedMovies = [...searchedMovies, ...movies.slice(0, 5)];

    // Map the discovered movies into a richContent response
    const baseImageUrl = 'https://www.themoviedb.org/t/p/w1280';
    const richContent = movies.slice(0, 5).map((movie) => ([
      {
        type: "info",
        title: `${movie.title} (${new Date(movie.release_date).getFullYear()}) (Rating: ${movie.vote_average})`,
        subtitle: truncateOverview(movie.overview), // Truncate the overview to 85 characters
        image: {
          rawUrl: `${baseImageUrl}${movie.poster_path}`
        },
        anchor: {
          href: `https://www.themoviedb.org/movie/${movie.id}`
        }
      }
    ]));

    // Update the sessionInfo with the updated searchedMovies array
    const sessionInfo = {
      ...req.body.sessionInfo,
      parameters: {
        ...req.body.sessionInfo.parameters,
        searchedMovies: updatedSearchedMovies // Store the updated searchedMovies
      }
    };

    // Return the discovered movies as richContent to Dialogflow
    res.json({
      fulfillmentResponse: {
        messages: [
          {
            payload: {
              richContent
            }
          }
        ]
      },
      sessionInfo
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
      sessionInfo: req.body.sessionInfo
    });
  }
});

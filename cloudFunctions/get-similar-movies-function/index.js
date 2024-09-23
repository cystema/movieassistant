const axios = require('axios');
const functions = require('@google-cloud/functions-framework');

// Helper function to truncate the overview
function truncateOverview(overview, maxLength = 85) {
  return overview && overview.length > maxLength
    ? `${overview.slice(0, maxLength)}...`
    : overview || 'No overview available.';
}

// Define a function to fetch similar movies based on movie ID
async function fetchSimilarMovies(movieId, apiKey) {
  const similarMoviesUrl = `https://api.themoviedb.org/3/movie/${movieId}/similar?api_key=${apiKey}`;
  const response = await axios.get(similarMoviesUrl);
  return response.data.results;
}

// Define the Cloud Function
functions.http('helloHttp', async (req, res) => {
  try {
    const movieName = req.body.sessionInfo.parameters.movie;
    const searchedMovies = req.body.sessionInfo.parameters.searchedMovies || [];

    const apiKey = process.env.TMDB_API_KEY; // Use environment variable for API key

    // Check if the movie is already in the searchedMovies list
    let movie = searchedMovies.find(
      (m) => m.title.toLowerCase() === movieName.toLowerCase()
    );

    if (!movie) {
      // If the movie isn't in the searchedMovies, search for it via TMDB API
      const searchMovieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(
        movieName
      )}`;

      // Fetch the movie search results from TMDB
      const response = await axios.get(searchMovieUrl);
      const movies = response.data.results;

      if (movies.length === 0) {
        return res.json({
          fulfillmentResponse: {
            messages: [
              {
                text: {
                  text: [`I couldn't find any movie titled "${movieName}".`],
                },
              },
            ],
          },
          sessionInfo: req.body.sessionInfo,
        });
      }

      // Sort the movies by popularity (descending)
      const sortedMovies = movies.sort((a, b) => b.popularity - a.popularity);

      // Select the most popular movie (first after sorting)
      movie = sortedMovies[0];

      // Optionally, add the newly found movie to the searchedMovies list
      searchedMovies.push(movie);
    }

    // Fetch similar movies using the movie's ID
    const similarMovies = await fetchSimilarMovies(movie.id, apiKey);

    if (similarMovies.length === 0) {
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [`I couldn’t find any similar movies to "${movie.title}".`],
              },
            },
          ],
        },
        sessionInfo: req.body.sessionInfo,
      });
    }

    // Map the similar movies into a richContent response
    const baseImageUrl = 'https://image.tmdb.org/t/p/w500';
    const richContent = similarMovies.slice(0, 5).map((similarMovie) => [
      {
        type: 'info',
        title: `${similarMovie.title} (${
          similarMovie.release_date
            ? new Date(similarMovie.release_date).getFullYear()
            : 'N/A'
        }) (Rating: ${similarMovie.vote_average || 'N/A'})`,
        subtitle: truncateOverview(similarMovie.overview),
        image: {
          rawUrl: similarMovie.poster_path
            ? `${baseImageUrl}${similarMovie.poster_path}`
            : 'https://via.placeholder.com/500x750?text=No+Image',
        },
        actionLink: `https://www.themoviedb.org/movie/${similarMovie.id}`,
      },
    ]);

    // Update the sessionInfo with the updated searchedMovies array
    const sessionInfo = {
      ...req.body.sessionInfo,
      parameters: {
        ...req.body.sessionInfo.parameters,
        searchedMovies, // Store the updated searchedMovies
      },
    };

    // Return the similar movies as richContent to Dialogflow
    res.json({
      fulfillmentResponse: {
        messages: [
          {
            payload: {
              richContent,
            },
          },
        ],
      },
      sessionInfo,
    });
  } catch (error) {
    console.error('Error fetching similar movies:', error);
    res.json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: [
                `Sorry, I couldn’t retrieve similar movies. Please try again later. Error: ${error}`,
              ],
            },
          },
        ],
      },
      sessionInfo: req.body.sessionInfo,
    });
  }
});

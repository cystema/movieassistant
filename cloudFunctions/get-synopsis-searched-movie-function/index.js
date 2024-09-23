const axios = require('axios');
const functions = require('@google-cloud/functions-framework');

// Replace with your TMDB API key or set it as an environment variable
const apiKey = process.env.TMDB_API_KEY;

// Helper function to create rich content response
function createRichContentResponse(movie) {
  const baseImageUrl = 'https://image.tmdb.org/t/p/w500';
  const genres = movie.genres.map(genre => genre.name).join(', ');
  const castNames = movie.cast.slice(0, 3).map(member => member.name).join(', ');

  return {
    payload: {
      richContent: [
        [
          {
            type: 'info',
            title: `${movie.title} (${new Date(movie.release_date).getFullYear()}) | ${genres} | Rating: ${movie.vote_average}`,
            subtitle: `**Cast**: ${castNames} | **Overview**: ${movie.overview}`,
            image: {
              rawUrl: movie.poster_path
                ? `${baseImageUrl}${movie.poster_path}`
                : 'https://via.placeholder.com/500x750?text=No+Image',
            },
            actionLink: `https://www.themoviedb.org/movie/${movie.id}`,
            description: movie.overview || 'No synopsis available.',
          },
        ],
        [
          {
            type: 'chips',
            options: [
              {
                text: 'Watch Trailer',
                link: `https://www.youtube.com/results?search_query=${encodeURIComponent(movie.title + ' trailer')}`,
              },
              {
                text: 'More Info',
                link: `https://www.themoviedb.org/movie/${movie.id}`,
              },
            ],
          },
        ],
      ],
    },
  };
}

// Define a function that responds to HTTP POST requests
functions.http('getMovieSynopsis', async (req, res) => {
  try {
    // Extract parameters from the request
    const parameters = req.body.sessionInfo.parameters || {};
    const movieName = parameters.movie;
    const datePeriod = parameters["date-period"] || null;
    const searchedMovies = parameters.searchedMovies || [];

    // Extract and validate the year from date-period
    const startYear = datePeriod?.startDate?.year || null;
    const year = startYear; // Use startYear as primary_release_year

    if (year) {
      const yearNumber = parseInt(year, 10);
      const currentYear = new Date().getFullYear();
      if (isNaN(yearNumber) || yearNumber < 1900 || yearNumber > currentYear + 1) {
        return res.json({
          fulfillmentResponse: {
            messages: [
              {
                text: {
                  text: [`The release year "${year}" is not valid. Please provide a valid year.`],
                },
              },
            ],
          },
          sessionInfo: req.body.sessionInfo,
        });
      }
    }

    if (!movieName || movieName.trim() === '') {
      return res.json({
        fulfillmentResponse: {
          messages: [
            {
              text: {
                text: [`I didn't catch the movie name. Could you please provide the title of the movie you're interested in?`],
              },
            },
          ],
        },
        sessionInfo: req.body.sessionInfo,
      });
    }

    // Check if the movie is already in the searchedMovies list
    let movie = searchedMovies.find(
      (m) => m.title.toLowerCase() === movieName.toLowerCase()
    );

    if (!movie) {
      // If the movie isn't in the searchedMovies, search for it via TMDB API
      const searchParams = {
        api_key: apiKey,
        query: movieName,
      };

      if (year) {
        searchParams.primary_release_year = year;
      }

      const searchMovieUrl = `https://api.themoviedb.org/3/search/movie?${new URLSearchParams(searchParams).toString()}`;

      // Fetch the movie search results from TMDB
      const searchResponse = await axios.get(searchMovieUrl);
      const movies = searchResponse.data.results;

      if (!movies || movies.length === 0) {
        return res.json({
          fulfillmentResponse: {
            messages: [
              {
                text: {
                  text: [`I couldn't find any movie titled "${movieName}". Please check the title and try again.`],
                },
              },
            ],
          },
          sessionInfo: req.body.sessionInfo,
        });
      }

      if (movies.length === 1) {
        movie = movies[0];
      } else {
        // Multiple movies found. Ask user to clarify.
        const movieOptions = movies.slice(0, 5).map((m, index) => `${index + 1}. ${m.title} (${m.release_date ? new Date(m.release_date).getFullYear() : 'N/A'})`).join('\n');

        return res.json({
          fulfillmentResponse: {
            messages: [
              {
                text: {
                  text: [`I found multiple movies titled "${movieName}". Please type the movie name and year corresponding to the movie you're interested in:\n${movieOptions}`],
                },
              },
            ],
          },
          sessionInfo: {
            ...req.body.sessionInfo,
            parameters: {
              ...parameters,
              movieSearchResults: movies.slice(0, 5),
            },
          },
        });
      }

      // Add the newly found movie to the searchedMovies list
      searchedMovies.push(movie);
    }

    // Fetch the movie details to get genres
    const movieDetailsUrl = `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${apiKey}`;
    let movieDetailsResponse;
    try {
      movieDetailsResponse = await axios.get(movieDetailsUrl);
    } catch (err) {
      console.error('Error fetching movie details:', err);
      movieDetailsResponse = { data: { genres: [] } }; // Proceed without genre info if there's an error
    }

    const genres = movieDetailsResponse.data.genres || [];

    // Fetch the movie credits to get cast information
    const creditsUrl = `https://api.themoviedb.org/3/movie/${movie.id}/credits?api_key=${apiKey}`;
    let creditsResponse;

    try {
      creditsResponse = await axios.get(creditsUrl);
    } catch (err) {
      console.error('Error fetching movie credits:', err);
      // Proceed without cast information if there's an error
      creditsResponse = { data: { cast: [] } };
    }

    const cast = creditsResponse.data.cast || [];

    // Sort the cast by popularity (descending)
    const sortedCast = cast.sort((a, b) => b.popularity - a.popularity);

    // Get the names of the three most popular cast members
    const topCastNames = sortedCast.slice(0, 3).map((member) => member.name);

    // Fetch genres from movieDetailsResponse
    const genreNames = genres.map((genre) => genre.name).join(', ');

    // Construct the rich content response
    const richContentResponse = createRichContentResponse({
      ...movieDetailsResponse.data,
      cast: topCastNames.map(name => ({ name })),
    });

    // Respond with the rich content
    res.json({
      fulfillmentResponse: {
        messages: [
          richContentResponse,
        ],
      },
      sessionInfo: {
        ...req.body.sessionInfo,
        parameters: {
          ...parameters,
          searchedMovies, // Update the searchedMovies array
        },
      },
    });
  } catch (error) {
    console.error('Error fetching movie synopsis:', error);
    res.json({
      fulfillmentResponse: {
        messages: [
          {
            text: {
              text: [
                `Sorry, I couldn't retrieve the synopsis. Please try again later.`,
              ],
            },
          },
        ],
      },
      sessionInfo: req.body.sessionInfo, // Maintain session info
    });
  }
});

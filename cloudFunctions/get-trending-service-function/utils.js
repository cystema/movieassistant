const formatResponseForDialogflow = (texts, sessionInfo = '', targetFlow = '', targetPage = '') => {
    let messages = [];
    texts.forEach(text => {
        messages.push({
            text: {
                text: [text],
                redactedText: [text]
            },
            responseType: 'HANDLER_PROMPT',
            source: 'VIRTUAL_AGENT'
        });
    });

    let responseData = {
        fulfillment_response: {
            messages: messages
        }
    };

    if (sessionInfo) {
        responseData['sessionInfo'] = sessionInfo;
    }

    if (targetFlow) {
        responseData['targetFlow'] = targetFlow;
    }

    if (targetPage) {
        responseData['targetPage'] = targetPage;
    }

    return responseData;
};

const formatMoviesForResponse = (movies) => {
    return movies.slice(0, 5).map((movie, index) => 
        `${index + 1}. ${movie.title} (Rating: ${movie.vote_average}) - Released on ${movie.release_date}. \nSynopsis: ${movie.overview}`
    );
};

const getMoviesResponse = (movies, sessionInfo = '', targetFlow = '', targetPage = '') => {
    const movieTexts = formatMoviesForResponse(movies);

    return formatResponseForDialogflow(
        movieTexts,
        sessionInfo,
        targetFlow,
        targetPage
    );
};


const getErrorMessage = () => {

    return formatResponseForDialogflow(
        [
            'We are facing a technical issue.',
            'Please try after sometimes or contact the XYZ restaurant.'
        ],
        '',
        '',
        ''
    );
};

module.exports = {
    formatResponseForDialogflow,
    getErrorMessage,
    getMoviesResponse
};
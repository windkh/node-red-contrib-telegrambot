'use strict';

// Per-message request-timeout transport.
//
// The bot-wide undici headersTimeout (bot-node.js) caps how long a request may
// wait for Telegram to start answering. A single message can raise the
// deadline just for itself:
//
//   msg.payload.options.requestTimeoutMs = 120000;
//
// node-telegram-bot-api v1.2.0 spreads msg.payload.options into the Telegram
// form, and its HttpClient honours opts.timeoutMs per request (an
// AbortController around the fetch). TelegramBotEx._request lifts
// form.requestTimeoutMs into opts.timeoutMs and stamps a __requestTimeoutMs
// marker into the form so the value travels inside the request itself --
// concurrent requests cannot pick up each other's deadline.
//
// This module supplies the other half: the fetch wrapper installed per bot
// (options.request.fetch in instantiateBot). It strips the marker from the
// request body so it never reaches Telegram, and wraps the bot's dispatcher
// for this one request so undici's per-request headersTimeout (dispatch opts)
// matches the requested deadline. Without that, the bot-wide headersTimeout
// would destroy the socket before the AbortController fires and the per-message
// raise would be dead on arrival.

// Strip the marker from the request body and return the requested timeout
// (0 when there is none). Handles the two body shapes the lib's buildBody
// produces: multipart FormData and x-www-form-urlencoded strings.
function extractMarker(init) {
    let timeoutMs = 0;
    if (init && init.body instanceof FormData) {
        const marker = init.body.get('__requestTimeoutMs');
        if (marker !== null) {
            timeoutMs = Number(marker);
            init.body.delete('__requestTimeoutMs');
        }
    } else if (init && typeof init.body === 'string') {
        const params = new URLSearchParams(init.body);
        const marker = params.get('__requestTimeoutMs');
        if (marker !== null) {
            timeoutMs = Number(marker);
            params.delete('__requestTimeoutMs');
            init.body = params.toString();
        }
    }
    return timeoutMs;
}

// A dispatcher-shaped object that delegates to the real dispatcher with a
// per-request headersTimeout. Node's fetch only calls dispatch() on a
// dispatcher supplied via init.dispatcher (it also reads isMockActive, which
// stays undefined here), so there is no close/destroy plumbing: the bot owns
// the real dispatcher's lifecycle, and the wrapper holds no resources.
function buildTimeoutDispatcher(realDispatcher, headersTimeoutMs) {
    return {
        dispatch(opts, handler) {
            opts.headersTimeout = headersTimeoutMs;
            return realDispatcher.dispatch(opts, handler);
        },
    };
}

// Build the per-bot fetch wrapper. fetchImpl is injectable for tests and
// defaults to the global fetch. Requests without a marker pass through with
// their init untouched.
function buildFetchWrapper(realDispatcher, fetchImpl = fetch) {
    return async function fetchWithPerRequestTimeout(url, init) {
        const timeoutMs = extractMarker(init);
        if (timeoutMs > 0 && realDispatcher) {
            init.dispatcher = buildTimeoutDispatcher(realDispatcher, timeoutMs);
        }
        return fetchImpl(url, init);
    };
}

module.exports = {
    buildFetchWrapper,
    buildTimeoutDispatcher,
    extractMarker,
};

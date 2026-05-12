// Realistic Telegram Bot API payload shapes used across converter.test.js.
// Each builder returns a fresh object so tests can mutate without cross-talk.

function chat(overrides) {
    return Object.assign({ id: 123, type: 'private', username: 'alice', first_name: 'Alice' }, overrides || {});
}

function from(overrides) {
    return Object.assign({ id: 4242, is_bot: false, first_name: 'Alice', username: 'alice', language_code: 'en' }, overrides || {});
}

function baseMessage(overrides) {
    return Object.assign(
        {
            message_id: 7,
            chat: chat(),
            from: from(),
            date: 1715520000,
        },
        overrides || {}
    );
}

// A "text" message — the canonical happy path.
function textMessage(text) {
    return baseMessage({ text: text || 'hello' });
}

// A photo array with two resolutions; the second is larger.
function photoArray() {
    return [
        { file_id: 'lo', file_unique_id: 'l', width: 320, height: 240 },
        { file_id: 'hi', file_unique_id: 'h', width: 800, height: 600 },
    ];
}

// A callback_query update (the .message field is the *original* sent message).
function callbackQuery(overrides) {
    return Object.assign(
        {
            id: 'cb-1',
            from: from(),
            message: baseMessage({ text: 'open menu' }),
            chat_instance: 'xyz',
            data: 'choice-A',
        },
        overrides || {}
    );
}

// An inline_query update — chat-less.
function inlineQuery() {
    return {
        id: 'iq-1',
        from: from(),
        query: 'search-term',
        offset: '',
    };
}

// A channel_post — no `from`, has `sender_chat`.
function channelPost() {
    return {
        message_id: 99,
        sender_chat: chat({ type: 'channel', id: -1001234567890, title: 'A Channel' }),
        chat: chat({ type: 'channel', id: -1001234567890, title: 'A Channel' }),
        date: 1715520000,
        text: 'channel announcement',
    };
}

module.exports = {
    chat,
    from,
    baseMessage,
    textMessage,
    photoArray,
    callbackQuery,
    inlineQuery,
    channelPost,
};

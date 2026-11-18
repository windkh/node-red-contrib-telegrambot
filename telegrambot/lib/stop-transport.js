// Stops the update transport of one node-telegram-bot-api instance: the polling
// loop, or the webhook (both Telegram's registration and the local listener).
//
// The returned promise always resolves — a failed stop is not something the
// caller can act on, since the bot is being discarded either way. Every call is
// made on the `bot` passed in, never on a field re-read after an await, so a
// caller that clears its own reference meanwhile cannot make this throw (#540).
function stopTransport(bot) {
    let stopped;
    if (bot._polling) {
        // v1.0.0's `stopPolling({ cancel: true })` aborts the in-flight getUpdates
        // via an AbortController and halts the recursive polling loop in one call.
        stopped = bot.stopPolling({ cancel: true });
    } else if (bot._webHook) {
        // Telegram keeps the registered webhook URL until told to drop it. Delete
        // it before closing the local listener so a redeploy with a new URL takes
        // effect immediately; a failed delete still closes the listener.
        stopped = bot
            .deleteWebhook()
            .catch(function () {
                // ignore - we still want to close the local hook
            })
            .then(function () {
                return bot.closeWebHook();
            });
    } else {
        stopped = Promise.resolve();
    }
    return stopped.catch(function () {
        // ignore - the bot is discarded whether or not the stop succeeded
    });
}

module.exports = { stopTransport };

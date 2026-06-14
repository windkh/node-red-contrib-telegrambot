// CJS-to-ESM bridge for node-telegram-bot-api.
//
// V1.0.0 of the upstream library is ESM-only (`"type": "module"`). Node-RED
// nodes are CommonJS (`module.exports = function (RED) { ... }`), and there's
// no plan to migrate them off CJS — Node-RED loads them via `require()` from
// its own CJS runtime. The bridge between the two worlds is dynamic
// `import()`, which CJS callers can `await`.
//
// `loadTelegramBot()` returns a Promise resolving to the `TelegramBot`
// constructor (the default export). The Promise is memoised at module level
// so the first call kicks off the import and every subsequent caller awaits
// the same resolved value — no race, no double-load.
//
// Works on both v0.66 (CJS — Node's interop wraps the CJS module.exports as
// the dynamic-import namespace's `default`) and v1.0.0 (ESM — `.default` is
// the literal default export). The caller doesn't need to care which.

let telegramBotPromise = null;

// Returns a Promise<typeof TelegramBot>. Memoised — subsequent calls return
// the same Promise reference, so multiple node-creation paths can each
// `await loadTelegramBot()` without spawning parallel imports.
function loadTelegramBot() {
    if (!telegramBotPromise) {
        telegramBotPromise = import('node-telegram-bot-api').then(function (mod) {
            return mod.default;
        });
    }
    return telegramBotPromise;
}

// Reset the memoised import. Test-only — there's no production reason to
// re-import the library after the process has started.
function _resetForTests() {
    telegramBotPromise = null;
}

module.exports = { loadTelegramBot, _resetForTests };

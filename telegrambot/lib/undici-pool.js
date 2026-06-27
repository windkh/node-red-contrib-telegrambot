// Builds the undici dispatcher that backs a single bot's outbound HTTPS
// traffic. As of node-telegram-bot-api v1.1.1 the dispatcher is supplied
// PER BOT INSTANCE via `new TelegramBot(token, { request: { fetchOptions:
// { dispatcher } } })` — the lib's HttpClient merges `request.fetchOptions`
// into every `fetch(url, ...)` call, and Node's built-in fetch honours an
// undici `dispatcher` in the init object.
//
// This replaced the V18-beta.1 approach of installing a single dispatcher
// under the process-global `globalThis[Symbol.for("undici.globalDispatcher.1")]`
// symbol, which was only necessary because v1.0/v1.1.0 exposed no per-instance
// transport hook. Per-instance dispatchers restore the per-bot pool isolation
// V17 had (each `telegram bot` config node gets its own pool / proxy) and
// remove the process-global side effect (#466 / #465).
//
// Two things motivate owning the dispatcher rather than relying on undici's
// default:
//   1. SOCKS proxy support. The legacy `socks-proxy-agent` was a Node
//      http.Agent and stopped being applicable once the lib moved to fetch.
//      `fetch-socks` (https://npmjs.com/package/fetch-socks) provides an
//      undici-flavoured equivalent that produces a Dispatcher.
//   2. The #442 keep-alive-pool defence. The bot node closes its dispatcher
//      and builds a fresh one on `scheduleRestart` so a wedged socket can't
//      survive a recovery cycle. With per-instance dispatchers this is now
//      genuinely per-bot rather than process-wide.

const { Agent } = require('undici');
const { socksDispatcher } = require('fetch-socks');

// Construct a fresh undici dispatcher from the supplied options object.
// Shape:
//   { socks?: SocksProxyOpts, agent?: undici.Agent.Options }
// If `socks` is present, returns a `socksDispatcher` (an undici Agent whose
// connector tunnels through SOCKS); otherwise returns a plain `new Agent`.
// `agent` is passed through unchanged to either constructor's Agent-options
// argument (keepAlive timing, family pinning, etc.).
//
// Pure: builds and returns; the caller owns the lifecycle (pass it to the bot
// via request.fetchOptions.dispatcher, then closeDispatcher() on teardown).
function buildDispatcher(options) {
    let dispatcher;
    const opts = options || {};
    const agentOptions = opts.agent || {};
    if (opts.socks) {
        dispatcher = socksDispatcher(opts.socks, agentOptions);
    } else {
        dispatcher = new Agent(agentOptions);
    }
    return dispatcher;
}

// Close a dispatcher, draining its keep-alive pool. Tolerates null/undefined
// and a dispatcher without a `close` method. Returns a promise that resolves
// once the pool has drained (or immediately when there's nothing to close),
// so callers (node `on('close')`, `scheduleRestart`) can await clean shutdown.
function closeDispatcher(dispatcher) {
    let result = Promise.resolve();
    if (dispatcher && typeof dispatcher.close === 'function') {
        result = dispatcher.close();
    }
    return result;
}

module.exports = {
    buildDispatcher,
    closeDispatcher,
};

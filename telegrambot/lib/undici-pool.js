// Manages a process-wide undici dispatcher for outbound HTTPS traffic from
// the Telegram bot library. The dispatcher is installed as
// `globalThis[Symbol.for("undici.globalDispatcher.1")]`, which is the
// documented hook for swapping the dispatcher backing Node's built-in
// `globalThis.fetch`. node-telegram-bot-api v1.0.0 calls `fetch` directly
// with no `dispatcher` option, so the global symbol is the only path for us
// to influence its HTTP behaviour.
//
// Two things motivate owning the dispatcher rather than relying on undici's
// default:
//   1. SOCKS proxy support. The legacy `socks-proxy-agent` was a Node
//      http.Agent and stopped being applicable once the lib moved to fetch.
//      `fetch-socks` (https://npmjs.com/package/fetch-socks) provides an
//      undici-flavoured equivalent that produces a Dispatcher we can install.
//   2. The #442 keep-alive-pool defence. V17.4.5/V17.4.13 destroyed and
//      rebuilt the per-bot agent pool on `scheduleRestart` so a wedged
//      socket couldn't survive a recovery cycle. The equivalent here is
//      `destroyDispatcher()` from `scheduleRestart`'s success path — the
//      pool is process-wide rather than per-bot (since only one global
//      dispatcher can be installed at a time), but the rebuild semantics
//      carry over.
//
// The module owns a single "currently installed" dispatcher reference so
// repeated `installDispatcher(...)` calls close the previous one without
// caller bookkeeping. `destroyDispatcher()` is the cleanup hook for the
// node's `on('close')` and `scheduleRestart`.

const { Agent } = require('undici');
const { socksDispatcher } = require('fetch-socks');

// Well-known symbol that Node's built-in fetch reads to find the dispatcher.
// `.1` covers undici 6 (Node 20) and undici 7. undici 8 (when bundled by a
// future Node version) uses `.2` — fetch-socks documents both.
const GLOBAL_DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1');

let currentDispatcher = null;

// Construct a fresh undici dispatcher from the supplied options object.
// Shape:
//   { socks?: SocksProxyOpts, agent?: undici.Agent.Options }
// If `socks` is present, returns a `socksDispatcher` (an undici Agent whose
// connector tunnels through SOCKS); otherwise returns a plain `new Agent`.
// `agent` is passed through unchanged to either constructor's Agent-options
// argument (keepAlive timing, family pinning, etc.).
//
// Pure: builds and returns; does not install.
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

// Install a freshly-built dispatcher as the process-global one. If a previous
// dispatcher is already installed, close it asynchronously (fire-and-forget —
// we don't want callers to await pool teardown on the hot path; their next
// request can begin immediately on the new dispatcher).
//
// Returns the newly-installed dispatcher.
function installDispatcher(options) {
    const previous = currentDispatcher;
    const next = buildDispatcher(options);
    currentDispatcher = next;
    global[GLOBAL_DISPATCHER_SYMBOL] = next;
    if (previous && typeof previous.close === 'function') {
        previous.close().catch(function () {
            // ignore — closing a dispatcher that already has in-flight
            // requests waits for them to drain, and we don't want a stuck
            // request to surface here as an unhandled rejection.
        });
    }
    return next;
}

// Tear down the currently-installed dispatcher and clear the global symbol.
// Returns a promise that resolves once the underlying pool has drained, so
// callers (typically node `on('close')` handlers) can await full shutdown.
//
// Note: we assign `undefined` instead of using `delete`. Node's bundled
// undici may have defined the global-dispatcher symbol property as
// non-configurable (via `setGlobalDispatcher`'s internal
// `Object.defineProperty`), in which case `delete` silently fails in
// non-strict mode and the slot keeps the previous Agent. Assignment to
// `undefined` succeeds because the property stays writable, and undici's
// fetch treats a falsy value at the symbol as "fall back to default."
function destroyDispatcher() {
    const previous = currentDispatcher;
    currentDispatcher = null;
    if (global[GLOBAL_DISPATCHER_SYMBOL] === previous) {
        global[GLOBAL_DISPATCHER_SYMBOL] = undefined;
    }
    let result = Promise.resolve();
    if (previous && typeof previous.close === 'function') {
        result = previous.close();
    }
    return result;
}

// Return the currently-installed dispatcher reference (or `null` if none).
// Mainly useful for tests; the runtime doesn't need to consult it.
function getCurrentDispatcher() {
    return currentDispatcher;
}

module.exports = {
    buildDispatcher,
    installDispatcher,
    destroyDispatcher,
    getCurrentDispatcher,
    GLOBAL_DISPATCHER_SYMBOL,
};

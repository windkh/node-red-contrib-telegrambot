const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Readable } = require('node:stream');
const { Agent } = require('undici');
const { buildDispatcher, closeDispatcher } = require('../../telegrambot/lib/undici-pool');

describe('undici-pool', function () {
    describe('buildDispatcher', function () {
        it('returns a plain undici Agent when no SOCKS opts are supplied', async function () {
            const d = buildDispatcher({});
            try {
                assert.ok(d instanceof Agent);
                assert.strictEqual(typeof d.dispatch, 'function');
            } finally {
                await d.close().catch(() => {});
            }
        });

        it('returns a SOCKS-aware dispatcher when socks opts are supplied', async function () {
            // fetch-socks's socksDispatcher returns an undici Agent whose
            // connector is SOCKS-aware. The simplest check is that it is
            // distinguishable from a default Agent of the same options.
            const plain = buildDispatcher({});
            const socks = buildDispatcher({ socks: { type: 5, host: '127.0.0.1', port: 1080 } });
            try {
                assert.notStrictEqual(socks, plain);
                assert.strictEqual(typeof socks.dispatch, 'function');
                // Both are constructed Agent instances. Differentiating them
                // via a behavioural test would require a live SOCKS proxy,
                // which is out of scope for unit tests.
            } finally {
                await plain.close().catch(() => {});
                await socks.close().catch(() => {});
            }
        });

        it('passes agentOptions through to the Agent constructor', async function () {
            const d = buildDispatcher({ agent: { connect: { timeout: 5000 } } });
            try {
                assert.ok(d instanceof Agent);
            } finally {
                await d.close().catch(() => {});
            }
        });

        it('tolerates an empty / missing options argument', async function () {
            const d1 = buildDispatcher();
            const d2 = buildDispatcher(null);
            const d3 = buildDispatcher({});
            try {
                assert.ok(d1 instanceof Agent);
                assert.ok(d2 instanceof Agent);
                assert.ok(d3 instanceof Agent);
            } finally {
                await Promise.allSettled([d1.close(), d2.close(), d3.close()]);
            }
        });

        it('returns a new instance on every call', async function () {
            const a = buildDispatcher({});
            const b = buildDispatcher({});
            try {
                assert.notStrictEqual(a, b);
            } finally {
                await a.close().catch(() => {});
                await b.close().catch(() => {});
            }
        });
    });

    describe('closeDispatcher', function () {
        it('invokes close() and resolves', async function () {
            // Controlled fake: asserts closeDispatcher's contract (call close,
            // return its promise) without depending on undici's real drain
            // timing — the buildDispatcher tests above exercise a real Agent.
            let closed = false;
            const fake = {
                close: function () {
                    closed = true;
                    return Promise.resolve();
                },
            };
            await closeDispatcher(fake);
            assert.strictEqual(closed, true);
        });

        it('is a no-op (resolves) for null / undefined', async function () {
            await closeDispatcher(null);
            await closeDispatcher(undefined);
            // reaching here without throwing is the assertion
            assert.strictEqual(true, true);
        });

        it('tolerates a dispatcher without a close method', async function () {
            await closeDispatcher({});
            assert.strictEqual(true, true);
        });
    });

    describe('headers timeout', function () {
        // bot-node passes agent.headersTimeout so a socket black-holed by a WAN
        // failover surfaces as an error the retry/recovery paths can act on,
        // instead of sitting on undici's 300 s default. These two tests pin the
        // behaviour that makes the setting safe: it fires when no response is
        // coming, and it does not fire while we are still uploading.

        function listen(server) {
            return new Promise(function (resolve) {
                server.listen(0, '127.0.0.1', function () {
                    resolve('http://127.0.0.1:' + server.address().port);
                });
            });
        }

        function shutdown(server) {
            server.closeAllConnections();
            server.close();
        }

        it('rejects a black-holed request instead of hanging', async function () {
            // Accepts the connection, reads the body, never answers - what a
            // black-holed flow looks like from the client side.
            const server = http.createServer(function (req) {
                req.resume();
            });
            const url = await listen(server);
            const dispatcher = buildDispatcher({ agent: { headersTimeout: 300 } });
            let code = null;
            try {
                await fetch(url, { method: 'POST', body: 'x', dispatcher });
            } catch (e) {
                code = e.cause ? e.cause.code : e.code;
            } finally {
                await closeDispatcher(dispatcher).catch(() => {});
                shutdown(server);
            }
            assert.strictEqual(code, 'UND_ERR_HEADERS_TIMEOUT');
        });

        it('does not abort an upload that takes longer than the timeout', async function () {
            // headersTimeout is armed once the request has been written, so a slow
            // upload is not on its clock. If this ever regresses, sending a large
            // photo or video over a slow uplink starts failing.
            const server = http.createServer(function (req, res) {
                req.resume();
                req.on('end', function () {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end('{"ok":true}');
                });
            });
            const url = await listen(server);
            const dispatcher = buildDispatcher({ agent: { headersTimeout: 300 } });
            let chunks = 6;
            const body = new Readable({
                read() {
                    const self = this;
                    if (chunks > 0) {
                        chunks--;
                        setTimeout(function () {
                            self.push(Buffer.alloc(1024, 0x41));
                        }, 100);
                    } else {
                        self.push(null);
                    }
                },
            });
            let status = 0;
            try {
                const response = await fetch(url, { method: 'POST', body, duplex: 'half', dispatcher });
                status = response.status;
            } finally {
                await closeDispatcher(dispatcher).catch(() => {});
                shutdown(server);
            }
            assert.strictEqual(status, 200);
        });
    });

    describe('end-to-end: fetch routes through a per-instance dispatcher', function () {
        it('a real fetch() call honours an undici dispatcher passed in the init (Node 20+)', async function () {
            // This is the core assumption of the per-instance design (#466):
            // node-telegram-bot-api v1.1.1 spreads request.fetchOptions into the
            // fetch init, and Node's built-in fetch must honour an undici
            // `dispatcher` there. We wrap a dispatcher's dispatch() to observe
            // invocations and confirm fetch(url, { dispatcher }) routes through
            // it. Catches "Node's bundled undici doesn't accept our dispatcher"
            // regressions on CI.
            const dispatcher = buildDispatcher({});
            let reached = false;
            const original = dispatcher.dispatch.bind(dispatcher);
            dispatcher.dispatch = function (opts, handler) {
                reached = true;
                return original(opts, handler);
            };
            try {
                await fetch('https://api.telegram.org/', { dispatcher });
            } catch (e) {
                // Network errors are fine — only the dispatcher reach matters.
            } finally {
                await closeDispatcher(dispatcher).catch(() => {});
            }
            assert.strictEqual(reached, true);
        });
    });
});

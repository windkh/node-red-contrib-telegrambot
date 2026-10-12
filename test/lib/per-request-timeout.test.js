const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { buildDispatcher } = require('../../telegrambot/lib/undici-pool');
const {
    buildFetchWrapper,
    buildTimeoutDispatcher,
    extractMarker,
} = require('../../telegrambot/lib/per-request-timeout');

describe('per-request-timeout', function () {
    describe('extractMarker', function () {
        it('strips the marker from a FormData body and returns its value', function () {
            const fd = new FormData();
            fd.append('chat_id', '1');
            fd.append('__requestTimeoutMs', '120000');
            fd.append('caption', 'x');
            const init = { body: fd };
            assert.strictEqual(extractMarker(init), 120000);
            assert.strictEqual(fd.get('__requestTimeoutMs'), null);
            assert.strictEqual(fd.get('chat_id'), '1');
            assert.strictEqual(fd.get('caption'), 'x');
        });

        it('strips the marker from a urlencoded string body and returns its value', function () {
            const init = { body: 'chat_id=1&__requestTimeoutMs=120000&text=hi' };
            assert.strictEqual(extractMarker(init), 120000);
            const params = new URLSearchParams(init.body);
            assert.strictEqual(params.get('__requestTimeoutMs'), null);
            assert.strictEqual(params.get('chat_id'), '1');
            assert.strictEqual(params.get('text'), 'hi');
        });

        it('returns 0 when there is no marker or no body', function () {
            const fd = new FormData();
            fd.append('chat_id', '1');
            assert.strictEqual(extractMarker({ body: fd }), 0);
            assert.strictEqual(extractMarker({ body: 'chat_id=1' }), 0);
            assert.strictEqual(extractMarker({}), 0);
            assert.strictEqual(extractMarker(), 0);
        });
    });

    describe('buildTimeoutDispatcher', function () {
        it('sets the per-request headersTimeout and delegates to the real dispatcher', function () {
            const calls = [];
            const real = {
                dispatch: function (opts, handler) {
                    calls.push({ opts, handler });
                    return 'result';
                },
            };
            const wrapped = buildTimeoutDispatcher(real, 120000);
            const handler = {};
            const opts = {};
            const result = wrapped.dispatch(opts, handler);
            assert.strictEqual(opts.headersTimeout, 120000);
            assert.strictEqual(result, 'result');
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].opts, opts);
            assert.strictEqual(calls[0].handler, handler);
        });
    });

    describe('buildFetchWrapper', function () {
        it('passes unmarked requests through with the init untouched', async function () {
            const received = [];
            const wrapper = buildFetchWrapper({ dispatch: function () {} }, async function (url, init) {
                received.push({ url, init });
                return { ok: true };
            });
            const init = { method: 'POST', body: 'chat_id=1' };
            const response = await wrapper('http://x.test/sendMessage', init);
            assert.deepStrictEqual(response, { ok: true });
            assert.strictEqual(received.length, 1);
            assert.strictEqual(received[0].init, init);
            assert.strictEqual(init.dispatcher, undefined);
        });

        it('strips the marker and routes the request through a timeout dispatcher', async function () {
            const received = [];
            const real = {
                dispatch: function (opts) {
                    return opts;
                },
            };
            const wrapper = buildFetchWrapper(real, async function (url, init) {
                received.push({ url, init });
                return { ok: true };
            });
            const fd = new FormData();
            fd.append('chat_id', '1');
            fd.append('__requestTimeoutMs', '120000');
            const init = { method: 'POST', body: fd };
            await wrapper('http://x.test/sendMediaGroup', init);
            assert.strictEqual(fd.get('__requestTimeoutMs'), null);
            const dispatcher = received[0].init.dispatcher;
            const opts = {};
            const returned = dispatcher.dispatch(opts, {});
            assert.strictEqual(opts.headersTimeout, 120000);
            assert.strictEqual(returned, opts);
        });
    });

    describe('end-to-end: a marked request outlives the dispatcher default', function () {
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

        it('a marked request survives past the default headersTimeout', async function () {
            // The server holds its answer for 1500 ms. The dispatcher's 300 ms
            // default fires at the next fast-timer tick (~1 s resolution in
            // undici), i.e. well before the answer; the 2000 ms marker must lift
            // the per-request deadline so the response still arrives.
            let markerLeaked = false;
            const server = http.createServer(function (req, res) {
                const chunks = [];
                req.on('data', function (c) {
                    chunks.push(c);
                });
                req.on('end', function () {
                    const raw = Buffer.concat(chunks).toString('latin1');
                    markerLeaked = raw.includes('__requestTimeoutMs');
                    setTimeout(function () {
                        res.writeHead(200, { 'content-type': 'application/json' });
                        res.end('{"ok":true}');
                    }, 1500);
                });
            });
            const url = await listen(server);
            const dispatcher = buildDispatcher({ agent: { headersTimeout: 300 } });
            const wrapper = buildFetchWrapper(dispatcher);
            const fd = new FormData();
            fd.append('chat_id', '1');
            fd.append('__requestTimeoutMs', '2000');
            let status = 0;
            try {
                const response = await wrapper(url + '/sendMediaGroup', { method: 'POST', body: fd });
                status = response.status;
            } finally {
                await dispatcher.close().catch(() => {});
                shutdown(server);
            }
            assert.strictEqual(status, 200);
            assert.strictEqual(markerLeaked, false);
        });

        it('an unmarked request still dies at the default headersTimeout', async function () {
            const server = http.createServer(function (req, res) {
                req.resume();
                req.on('end', function () {
                    setTimeout(function () {
                        res.writeHead(200, { 'content-type': 'application/json' });
                        res.end('{"ok":true}');
                    }, 1500);
                });
            });
            const url = await listen(server);
            const dispatcher = buildDispatcher({ agent: { headersTimeout: 300 } });
            const wrapper = buildFetchWrapper(dispatcher);
            // The lib spreads request.fetchOptions (which carries the dispatcher)
            // into every fetch init, so an unmarked request still travels on the
            // bot's dispatcher and its default deadline applies.
            const init = { method: 'POST', body: 'chat_id=1', dispatcher };
            let code = null;
            try {
                await wrapper(url + '/sendMessage', init);
            } catch (e) {
                code = e.cause ? e.cause.code : e.code;
            } finally {
                await dispatcher.close().catch(() => {});
                shutdown(server);
            }
            assert.strictEqual(code, 'UND_ERR_HEADERS_TIMEOUT');
        });
    });
});

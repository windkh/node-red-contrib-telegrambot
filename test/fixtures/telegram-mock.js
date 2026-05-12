// A small HTTP server that impersonates api.telegram.org well enough for
// node-telegram-bot-api's polling and send paths to talk to it.
//
// Usage:
//   const { startMock } = require('./telegram-mock');
//   const mock = await startMock();
//   const flow = [{ ..., baseapiurl: mock.url, updatemode: 'polling' }];
//   ...
//   mock.pushUpdate({ update_id: 1, message: { ... } });
//   ...
//   await mock.stop();
//
// All endpoints respond with the standard Bot API envelope:
//   { ok: true, result: <result> }     on success
//   { ok: false, error_code: N, description: "..." }   on failure
//
// State is exposed for assertions:
//   mock.calls          array of { method, body, query } in arrival order
//   mock.pushUpdate(u)  enqueues an update for the next getUpdates poll
//   mock.failNext(spec) forces the next call to one method to return the given
//                       error; useful for retry-path tests
//
// The server uses HTTP (not HTTPS) and binds to 127.0.0.1 on a random port.

const http = require('http');
const url = require('url');
const { Buffer } = require('buffer');

function parseFormBody(buf) {
    const text = buf.toString('utf8');
    const out = {};
    if (!text) return out;
    text.split('&').forEach(function (pair) {
        const eq = pair.indexOf('=');
        const k = decodeURIComponent(pair.substr(0, eq).replace(/\+/g, ' '));
        const v = decodeURIComponent(pair.substr(eq + 1).replace(/\+/g, ' '));
        out[k] = v;
    });
    return out;
}

function parseMultipart(buf, boundary) {
    // Bare-bones multipart parser sufficient for the form-field name=value
    // pairs node-telegram-bot-api sends for sendPhoto etc. File parts are
    // captured as Buffer values.
    const out = {};
    const sep = Buffer.from('--' + boundary);
    let start = 0;
    while (true) {
        const idx = buf.indexOf(sep, start);
        if (idx === -1) break;
        const next = buf.indexOf(sep, idx + sep.length);
        if (next === -1) break;
        const partStart = idx + sep.length;
        // Skip the CRLF after the boundary
        let s = partStart;
        if (buf[s] === 0x0d && buf[s + 1] === 0x0a) s += 2;
        // Read headers
        const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), s);
        if (headerEnd === -1 || headerEnd >= next) break;
        const headers = buf.slice(s, headerEnd).toString('utf8');
        const bodyStart = headerEnd + 4;
        // Body ends 2 bytes before the next boundary (CRLF)
        const bodyEnd = next - 2;
        const body = buf.slice(bodyStart, bodyEnd);
        const m = headers.match(/name="([^"]+)"/);
        if (m) {
            out[m[1]] = body.length < 1024 && !/filename=/.test(headers) ? body.toString('utf8') : body;
        }
        start = next;
    }
    return out;
}

function startMock() {
    const state = {
        calls: [],
        updates: [],
        failures: {}, // method -> { code, description, retry_after }
        webhookInfo: { url: '' },
        nextMessageId: 1000,
    };

    function readBody(req) {
        return new Promise(function (resolve) {
            const chunks = [];
            req.on('data', function (c) {
                chunks.push(c);
            });
            req.on('end', function () {
                resolve(Buffer.concat(chunks));
            });
        });
    }

    const server = http.createServer(async function (req, res) {
        try {
            const parsed = url.parse(req.url, true);
            const m = parsed.pathname.match(/^\/bot([^/]+)\/([^/?#]+)$/);
            if (!m) {
                res.statusCode = 404;
                res.end('not found');
                return;
            }
            const method = m[2];

            const raw = await readBody(req);
            let body = {};
            const ct = req.headers['content-type'] || '';
            if (ct.includes('application/json')) {
                try {
                    body = JSON.parse(raw.toString('utf8'));
                } catch (e) {
                    body = {};
                }
            } else if (ct.includes('application/x-www-form-urlencoded')) {
                body = parseFormBody(raw);
            } else if (ct.includes('multipart/form-data')) {
                const boundary = (ct.match(/boundary=(.+)$/) || [])[1];
                if (boundary) body = parseMultipart(raw, boundary);
            }

            state.calls.push({ method: method, body: body, query: parsed.query });

            // Force-failure injection for the next call to this method
            if (state.failures[method]) {
                const fail = state.failures[method];
                delete state.failures[method];
                res.setHeader('content-type', 'application/json');
                res.statusCode = fail.code || 400;
                res.end(
                    JSON.stringify({
                        ok: false,
                        error_code: fail.code || 400,
                        description: fail.description || 'forced failure',
                        parameters: fail.retry_after ? { retry_after: fail.retry_after } : undefined,
                    })
                );
                return;
            }

            let result;
            if (method === 'getMe') {
                result = { id: 1, is_bot: true, first_name: 'mock', username: 'mockbot' };
            } else if (method === 'getUpdates') {
                // The library passes the next-expected `offset`; we just return what we have.
                const updates = state.updates.slice();
                state.updates = [];
                result = updates;
            } else if (method === 'sendMessage') {
                result = {
                    message_id: state.nextMessageId++,
                    chat: { id: Number(body.chat_id), type: 'private' },
                    date: Math.floor(Date.now() / 1000),
                    text: body.text,
                };
            } else if (method === 'setWebHook') {
                state.webhookInfo = { url: body.url, has_custom_certificate: false, pending_update_count: 0 };
                result = true;
            } else if (method === 'deleteWebHook') {
                state.webhookInfo = { url: '' };
                result = true;
            } else if (method === 'getWebHookInfo') {
                result = state.webhookInfo;
            } else if (method === 'setMyCommands' || method === 'deleteMyCommands') {
                result = true;
            } else if (method === 'answerCallbackQuery') {
                result = true;
            } else if (method.startsWith('send') || method.startsWith('edit') || method.startsWith('forward') || method.startsWith('copy')) {
                result = { message_id: state.nextMessageId++ };
            } else {
                result = true;
            }

            res.setHeader('content-type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, result: result }));
        } catch (err) {
            res.statusCode = 500;
            res.end(String(err && err.message));
        }
    });

    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            const port = server.address().port;
            resolve({
                url: 'http://127.0.0.1:' + port,
                state: state,
                calls: state.calls,
                pushUpdate: function (u) {
                    if (typeof u.update_id !== 'number') u.update_id = (u.update_id = (state.updates.length || 0) + 1);
                    state.updates.push(u);
                },
                failNext: function (method, spec) {
                    state.failures[method] = spec;
                },
                callsTo: function (method) {
                    return state.calls.filter(function (c) {
                        return c.method === method;
                    });
                },
                clearCalls: function () {
                    state.calls.length = 0;
                },
                stop: function () {
                    return new Promise(function (resolveStop) {
                        server.close(function () {
                            resolveStop();
                        });
                    });
                },
            });
        });
    });
}

module.exports = { startMock };

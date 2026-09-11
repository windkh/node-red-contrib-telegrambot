const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const TelegramBot = require('node-telegram-bot-api').default;
const { findTransientErrorCode } = require('../../telegrambot/lib/transient-errors');

// The shape node-telegram-bot-api produces for a transport failure: a FatalError
// wrapping fetch's TypeError wrapping the syscall error that carries the code.
function wrapped(code, message) {
    const leaf = new Error(message);
    leaf.code = code;
    const fetchFailure = new TypeError('fetch failed', { cause: leaf });
    const fatal = new Error('EFATAL: fetch failed');
    fatal.code = 'EFATAL';
    fatal.cause = fetchFailure;
    return fatal;
}

describe('transient-errors — findTransientErrorCode', function () {
    it('finds the syscall code two levels down the cause chain', function () {
        assert.strictEqual(findTransientErrorCode(wrapped('ECONNRESET', 'read ECONNRESET')), 'ECONNRESET');
    });

    it('reports the underlying code, not the EFATAL wrapper it arrived in', function () {
        const error = wrapped('ENOTFOUND', 'getaddrinfo ENOTFOUND api.telegram.org');
        assert.strictEqual(findTransientErrorCode(error), 'ENOTFOUND');
        assert.notStrictEqual(findTransientErrorCode(error), 'EFATAL');
    });

    it("does not appear in the top-level error's text, which is why the chain is walked", function () {
        // Guards the assumption the whole module exists for: the pre-19.0.4 check
        // was String(exception).includes('ECONNRESET') against exactly this error.
        const error = wrapped('ECONNRESET', 'read ECONNRESET');
        assert.strictEqual(String(error).includes('ECONNRESET'), false);
        assert.strictEqual(findTransientErrorCode(error), 'ECONNRESET');
    });

    it('recognises undici timeouts and closed sockets', function () {
        assert.strictEqual(
            findTransientErrorCode(wrapped('UND_ERR_HEADERS_TIMEOUT', 'Headers Timeout Error')),
            'UND_ERR_HEADERS_TIMEOUT'
        );
        assert.strictEqual(findTransientErrorCode(wrapped('UND_ERR_SOCKET', 'other side closed')), 'UND_ERR_SOCKET');
        assert.strictEqual(
            findTransientErrorCode(wrapped('UND_ERR_CONNECT_TIMEOUT', 'Connect Timeout Error')),
            'UND_ERR_CONNECT_TIMEOUT'
        );
    });

    it('walks AggregateError entries, as a dual-stack host produces', function () {
        // Both the A and the AAAA address failed; fetch reports one entry each.
        const v6 = new Error('connect ENETUNREACH 2001:67c:4e8::1:443');
        v6.code = 'ENETUNREACH';
        const v4 = new Error('connect ECONNREFUSED 149.154.167.220:443');
        v4.code = 'ECONNREFUSED';
        const aggregate = new AggregateError([v6, v4], 'all addresses failed');
        const fatal = new Error('EFATAL: fetch failed');
        fatal.code = 'EFATAL';
        fatal.cause = new TypeError('fetch failed', { cause: aggregate });
        assert.ok(['ENETUNREACH', 'ECONNREFUSED'].includes(findTransientErrorCode(fatal)));
    });

    it('returns null for an error Telegram actually answered with', function () {
        // ETELEGRAM means the request arrived and was rejected on its merits —
        // a malformed Markdown entity, a bad chat id. Repeating it changes nothing.
        const telegramError = new Error("ETELEGRAM: 400 Bad Request: can't parse entities");
        telegramError.code = 'ETELEGRAM';
        assert.strictEqual(findTransientErrorCode(telegramError), null);
    });

    it('returns null when the dispatcher was closed by us', function () {
        // A redeploy or scheduleRestart closes the dispatcher; retrying would
        // fight the shutdown that caused the error.
        assert.strictEqual(findTransientErrorCode(wrapped('UND_ERR_CLOSED', 'The client is closed')), null);
        assert.strictEqual(findTransientErrorCode(wrapped('UND_ERR_DESTROYED', 'The client is destroyed')), null);
    });

    it('tolerates null, strings and cyclic chains', function () {
        assert.strictEqual(findTransientErrorCode(null), null);
        assert.strictEqual(findTransientErrorCode('ECONNRESET'), null);
        const a = new Error('a');
        const b = new Error('b');
        a.cause = b;
        b.cause = a;
        assert.strictEqual(findTransientErrorCode(a), null);
    });

    it('finds the code in an error the library really threw', async function () {
        // Not a hand-built shape: a real send against a server that resets the
        // connection, through the real node-telegram-bot-api transport. If the
        // library ever changes how it wraps transport failures, this fails.
        const server = http.createServer(function (req) {
            req.socket.resetAndDestroy();
        });
        await new Promise(function (resolve) {
            server.listen(0, '127.0.0.1', resolve);
        });
        const bot = new TelegramBot('123:fake', {
            baseApiUrl: 'http://127.0.0.1:' + server.address().port,
        });
        let thrown = null;
        try {
            await bot.sendMessage(1, 'hello');
        } catch (e) {
            thrown = e;
        } finally {
            server.closeAllConnections();
            server.close();
        }
        assert.ok(thrown);
        assert.strictEqual(String(thrown).includes('ECONNRESET'), false);
        assert.strictEqual(findTransientErrorCode(thrown), 'ECONNRESET');
    });
});

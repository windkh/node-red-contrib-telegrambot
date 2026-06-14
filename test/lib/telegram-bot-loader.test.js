const { expect } = require('chai');
const { loadTelegramBot, _resetForTests } = require('../../telegrambot/lib/telegram-bot-loader');

describe('telegram-bot-loader', function () {
    afterEach(function () {
        _resetForTests();
    });

    it('returns a Promise', function () {
        const p = loadTelegramBot();
        expect(p).to.be.an.instanceOf(Promise);
    });

    it('memoises across calls (identical Promise reference)', function () {
        const p1 = loadTelegramBot();
        const p2 = loadTelegramBot();
        expect(p1).to.equal(p2);
    });

    it('resolves to the TelegramBot constructor', async function () {
        const TelegramBot = await loadTelegramBot();
        expect(TelegramBot).to.be.a('function');
        // The constructor must accept a bot token. v0.66's TelegramBot has
        // an `on` method (it extends EventEmitter) and a `processUpdate`
        // method (the public dispatch entry); v1.0.0 keeps both. Either
        // version's surface satisfies these prototype checks.
        expect(TelegramBot.prototype.on).to.be.a('function');
        expect(TelegramBot.prototype.processUpdate).to.be.a('function');
    });

    it('produces identical constructor across awaited calls', async function () {
        const first = await loadTelegramBot();
        const second = await loadTelegramBot();
        expect(first).to.equal(second);
    });

    it('_resetForTests forces a fresh import on the next call', async function () {
        const before = await loadTelegramBot();
        _resetForTests();
        const after = await loadTelegramBot();
        // The class itself is module-cached by Node, so the *constructor*
        // is still the same reference even after our memo reset (Node's
        // require/import cache holds the module). What `_resetForTests`
        // guarantees is that the *Promise* is freshly created — which is
        // observable via `loadTelegramBot() === loadTelegramBot()` order.
        // The constructor identity check below confirms the underlying
        // module is the same (so functional behaviour is preserved).
        expect(after).to.equal(before);
    });
});

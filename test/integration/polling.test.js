const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');
const { startMock } = require('../fixtures/telegram-mock.js');
const { loadTelegramBot } = require('../../telegrambot/lib/telegram-bot-loader');

helper.init(require.resolve('node-red'));

describe('integration: polling transport against a mocked Telegram API', function () {
    this.timeout(10000);

    let mock;

    before(async function () {
        // Pre-resolve the dynamic import of node-telegram-bot-api so the
        // module-level subclass (`TelegramBotEx` in bot-node.js) is built
        // before the first bot is constructed. In production this happens
        // automatically — by the time a flow runs, the import has long since
        // settled — but mocha tests call helper.load synchronously right
        // after the module require, so we have to preload explicitly.
        await loadTelegramBot();
        mock = await startMock();
        await new Promise(function (r) {
            helper.startServer(r);
        });
    });

    after(async function () {
        await new Promise(function (r) {
            helper.stopServer(r);
        });
        await mock.stop();
    });

    afterEach(async function () {
        // helper.unload returns a promise in newer versions, so await it to
        // ensure polling has really stopped before the next test reuses the bot.
        await helper.unload();
        mock.clearCalls();
    });

    function pollingFlow(extraBotFields) {
        return [
            Object.assign(
                {
                    id: 'b1',
                    type: 'telegram bot',
                    botname: 'b',
                    updatemode: 'polling',
                    baseapiurl: mock.url,
                    pollinterval: '50',
                },
                extraBotFields || {}
            ),
            { id: 'r1', type: 'telegram receiver', bot: 'b1', wires: [['out'], ['unauth']] },
            { id: 'out', type: 'helper' },
            { id: 'unauth', type: 'helper' },
        ];
    }

    it('starts polling the mock and delivers a queued update to the receiver', function (done) {
        helper.load(telegrambotModule, pollingFlow(), { b1: { token: 'fake' } }, function () {
            const out = helper.getNode('out');
            out.on('input', function (msg) {
                try {
                    expect(msg.payload.type).to.equal('message');
                    expect(msg.payload.content).to.equal('first update');
                    expect(mock.callsTo('getUpdates').length).to.be.greaterThan(0);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            // Inject the update; the next polling cycle (≤ 50 ms) will pick it up.
            mock.pushUpdate({
                update_id: 1,
                message: {
                    message_id: 1,
                    chat: { id: 123, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                    text: 'first update',
                },
            });
        });
    });

    it('keeps polling after a 502 Bad Gateway error from the API', function (done) {
        helper.load(telegrambotModule, pollingFlow(), { b1: { token: 'fake' } }, function () {
            const out = helper.getNode('out');

            // First poll: force a 502. The bot should recover and keep polling.
            mock.failNext('getUpdates', { code: 502, description: 'Bad Gateway' });

            out.on('input', function (msg) {
                try {
                    expect(msg.payload.content).to.equal('after error');
                    // Expect at least 2 calls: the one that 502'd plus a successor.
                    expect(mock.callsTo('getUpdates').length).to.be.greaterThan(1);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            // Push the recovery update; the next successful poll should pick it up.
            setTimeout(function () {
                mock.pushUpdate({
                    update_id: 2,
                    message: {
                        message_id: 2,
                        chat: { id: 123, type: 'private', username: 'alice' },
                        from: { id: 42, username: 'alice', is_bot: false },
                        date: 1,
                        text: 'after error',
                    },
                });
            }, 200);
        });
    });

    it('delivers updates to multiple receivers attached to the same bot', function (done) {
        const flow = pollingFlow();
        flow.push({ id: 'r2', type: 'telegram receiver', bot: 'b1', wires: [['out2'], ['unauth2']] });
        flow.push({ id: 'out2', type: 'helper' });
        flow.push({ id: 'unauth2', type: 'helper' });

        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            const out = helper.getNode('out');
            const out2 = helper.getNode('out2');
            let received = 0;
            const expectAt = function (msg) {
                try {
                    expect(msg.payload.content).to.equal('broadcast');
                    received++;
                    if (received === 2) done();
                } catch (err) {
                    done(err);
                }
            };
            out.on('input', expectAt);
            out2.on('input', expectAt);

            mock.pushUpdate({
                update_id: 1,
                message: {
                    message_id: 1,
                    chat: { id: 99, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                    text: 'broadcast',
                },
            });
        });
    });

    it('routes an unauthorized user to output 2', function (done) {
        const flow = pollingFlow({ usernames: 'bob' });
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            const out = helper.getNode('out');
            const unauth = helper.getNode('unauth');
            out.on('input', function () {
                done(new Error('authorized output should not fire for alice when allowlist is "bob"'));
            });
            unauth.on('input', function (msg) {
                try {
                    expect(msg.payload.content).to.equal('hello bot');
                    done();
                } catch (err) {
                    done(err);
                }
            });
            mock.pushUpdate({
                update_id: 1,
                message: {
                    message_id: 1,
                    chat: { id: 11, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                    text: 'hello bot',
                },
            });
        });
    });
});

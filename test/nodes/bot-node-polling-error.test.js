// Regression tests for issue #503 — "Node Red crash".
//
// A polling error that arrives from a bot instance the config node has already
// retired used to be handled as if it came from the live bot:
//
//   TypeError: Cannot read properties of null (reading 'stopPolling')
//       at TelegramBotEx.<anonymous> (telegrambot/nodes/bot-node.js:550:42)
//       at TelegramBotPolling._emitError (node-telegram-bot-api/dist/polling.cjs:82:18)
//
// abortBot() nulls self.telegramBot (and scheduleRestart() then installs a fresh
// bot), but the previous instance's aborted getUpdates still settles afterwards
// and emits polling_error on the instance the listener is bound to. Because the
// listener runs from a promise rejection inside an EventEmitter, the throw is an
// uncaught exception — it killed the whole Node-RED process.
//
// The listener now ignores events from any instance that is no longer installed.

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const helper = require('node-red-node-test-helper');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');
const { startMock } = require('../fixtures/telegram-mock.js');

helper.init(require.resolve('node-red'));

describe('bot-node — stale polling_error handling (issue #503)', function () {
    let mock;

    before(async function () {
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
        await helper.unload();
        mock.clearCalls();
    });

    function pollingFlow() {
        return [
            {
                id: 'b1',
                type: 'telegram bot',
                botname: 'b',
                updatemode: 'polling',
                baseapiurl: mock.url,
                pollinterval: '50',
            },
        ];
    }

    // Runs `body(node, bot)` once the polling bot is up, funnelling any
    // assertion failure into done().
    function withPollingBot(body) {
        return function (t, done) {
            helper.load(telegrambotModule, pollingFlow(), { b1: { token: 'fake' } }, function () {
                const node = helper.getNode('b1');
                const bot = node.getTelegramBot();
                try {
                    assert.ok(bot, 'polling bot should have been constructed');
                    assert.strictEqual(bot.listenerCount('polling_error'), 1);
                    body(node, bot, done);
                } catch (err) {
                    done(err);
                }
            });
        };
    }

    it(
        'does not throw when the retired instance reports a polling error after abortBot',
        withPollingBot(function (node, bot, done) {
            node.abortBot('test', function () {
                try {
                    assert.strictEqual(node.telegramBot, null, 'abortBot should have nulled telegramBot');

                    // This is the exact #503 reproduction: the aborted getUpdates of
                    // the retired instance settles and emits. EventEmitter.emit
                    // rethrows synchronously, so a listener that dereferences the
                    // nulled telegramBot surfaces right here.
                    assert.doesNotThrow(function () {
                        bot.emit('polling_error', new Error('EFATAL: fetch failed'));
                    });
                    done();
                } catch (err) {
                    done(err);
                }
            });
        })
    );

    it(
        'leaves the live bot untouched when a replaced instance reports a polling error',
        withPollingBot(function (node, bot, done) {
            // Stand in for the fresh bot scheduleRestart() installs after a
            // polling-burst restart. stopPolling must never be called on it.
            let stopPollingCalls = 0;
            node.telegramBot = {
                stopPolling: function () {
                    stopPollingCalls++;
                    return Promise.resolve();
                },
            };
            node.pollingErrorTimes = [];

            try {
                bot.emit('polling_error', new Error('EFATAL: fetch failed'));

                assert.strictEqual(stopPollingCalls, 0, 'the replacement bot must not be stopped');
                assert.deepStrictEqual(
                    node.pollingErrorTimes,
                    [],
                    "a retired instance must not pollute the live bot's circuit-breaker window"
                );
            } finally {
                // Put the real bot back so unload() can shut polling down cleanly.
                node.telegramBot = bot;
            }
            done();
        })
    );

    it(
        'still handles polling errors from the instance that is installed',
        withPollingBot(function (node, bot, done) {
            node.pollingErrorTimes = [];
            bot.emit('polling_error', new Error('EFATAL: fetch failed'));
            try {
                assert.strictEqual(
                    node.pollingErrorTimes.length,
                    1,
                    'the live instance must still feed the circuit breaker'
                );
                done();
            } catch (err) {
                done(err);
            }
        })
    );
});

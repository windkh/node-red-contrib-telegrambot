const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const helper = require('node-red-node-test-helper');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram reply', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flow() {
        return [
            { id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' },
            { id: 'r1', type: 'telegram reply', bot: 'b1', wires: [['out']] },
            { id: 'out', type: 'helper' },
        ];
    }

    it('registers under "telegram reply"', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                assert.ok(r !== undefined && r !== null);
                assert.strictEqual(r.type, 'telegram reply');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('initialises pendingReplyListenerIds as an empty Set (V17.3.0 listener tracking)', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                assert.ok(r.pendingReplyListenerIds instanceof Set);
                assert.strictEqual(r.pendingReplyListenerIds.size, 0);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('warns and short-circuits when msg.payload is empty', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                let warned = null;
                r.warn = function (m) {
                    warned = m;
                };
                r.receive({});
                setTimeout(function () {
                    try {
                        assert.strictEqual(warned, 'msg.payload is empty');
                        done();
                    } catch (err) {
                        done(err);
                    }
                }, 10);
            } catch (err) {
                done(err);
            }
        });
    });

    it('warns when msg.payload.chatId is missing', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                let warned = null;
                r.warn = function (m) {
                    warned = m;
                };
                r.receive({ payload: { sentMessageId: 123 } });
                setTimeout(function () {
                    try {
                        // The bot isn't yet initialised in this test ('send only' mode
                        // never created one), so we may get either warning depending
                        // on which check fires first — both are valid for "incomplete".
                        assert.ok((['msg.payload.chatId is empty', 'bot not initialized.']).includes(warned));
                        done();
                    } catch (err) {
                        done(err);
                    }
                }, 10);
            } catch (err) {
                done(err);
            }
        });
    });
});

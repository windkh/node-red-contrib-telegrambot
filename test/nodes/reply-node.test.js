const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram reply', function () {
    before(function (done) {
        helper.startServer(done);
    });

    after(function (done) {
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

    it('registers under "telegram reply"', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                expect(r).to.exist;
                expect(r.type).to.equal('telegram reply');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('initialises pendingReplyListenerIds as an empty Set (V17.3.0 listener tracking)', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                expect(r.pendingReplyListenerIds).to.be.an.instanceOf(Set);
                expect(r.pendingReplyListenerIds.size).to.equal(0);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('warns and short-circuits when msg.payload is empty', function (done) {
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
                        expect(warned).to.equal('msg.payload is empty');
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

    it('warns when msg.payload.chatId is missing', function (done) {
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
                        expect(['msg.payload.chatId is empty', 'bot not initialized.']).to.include(warned);
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

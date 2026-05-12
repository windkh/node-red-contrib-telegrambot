const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

// Minimal stub of the bot instance — records which method was called with which args
// and returns a resolved promise carrying a synthetic message_id.
function makeBotStub(record) {
    const stub = {
        options: { baseApiUrl: 'https://api.telegram.org' },
    };
    const methods = [
        'sendMessage',
        'sendPhoto',
        'sendAudio',
        'sendDocument',
        'sendSticker',
        'sendVideo',
        'sendLocation',
        'sendContact',
        'sendChatAction',
        'forwardMessage',
        'copyMessage',
        'answerCallbackQuery',
    ];
    methods.forEach(function (m) {
        stub[m] = function () {
            record.push({ method: m, args: Array.from(arguments) });
            return Promise.resolve({ message_id: 999 });
        };
    });
    return stub;
}

describe('telegram sender (out-node)', function () {
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
            { id: 's1', type: 'telegram sender', bot: 'b1', wires: [['out']] },
            { id: 'out', type: 'helper' },
        ];
    }

    it('registers under "telegram sender"', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                expect(s).to.exist;
                expect(s.type).to.equal('telegram sender');
                expect(s.queueManager).to.exist;
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('warns and short-circuits when msg.payload is empty', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                let warned = null;
                s.warn = function (m) {
                    warned = m;
                };
                s.receive({});
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

    it('dispatches a "message" send through the bot stub and emits on its output', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };

                out.on('input', function (msg) {
                    try {
                        // processResult writes the api result back to msg.payload.content
                        expect(msg.payload.sentMessageId).to.equal(999);
                        expect(record).to.have.length(1);
                        expect(record[0].method).to.equal('sendMessage');
                        expect(record[0].args[0]).to.equal(123); // chatId
                        expect(record[0].args[1]).to.equal('hello world');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 123, type: 'message', content: 'hello world' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('chunks a >4000-char text message into sequential sendMessage calls', function (done) {
        // Regression: the V17.2.x do-while dispatched all chunks in parallel.
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };

                out.on('input', function () {
                    try {
                        // 9001 chars in 4000-char chunks => 3 sends (4000 + 4000 + 1001).
                        expect(record).to.have.length(3);
                        record.forEach(function (call) {
                            expect(call.method).to.equal('sendMessage');
                            expect(call.args[1].length).to.be.lessThanOrEqual(4000);
                        });
                        // And only ONE pass through processResult — i.e., exactly one
                        // node.send emitted (out.on('input', ...) fired once).
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 123, type: 'message', content: 'a'.repeat(9001) } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('dispatches a "photo" send through the right bot method', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };

                out.on('input', function () {
                    try {
                        expect(record).to.have.length(1);
                        expect(record[0].method).to.equal('sendPhoto');
                        expect(record[0].args[1]).to.equal('photo-file-id');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 123, type: 'photo', content: 'photo-file-id' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('fans an array-of-chatIds payload out across cloned messages', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };

                let outputs = 0;
                out.on('input', function () {
                    outputs++;
                    if (outputs === 3) {
                        try {
                            // Three independent sendMessage calls, one per chatId.
                            expect(record).to.have.length(3);
                            const chatIds = record.map(function (c) {
                                return c.args[0];
                            });
                            expect(chatIds.sort()).to.deep.equal([1, 2, 3]);
                            done();
                        } catch (err) {
                            done(err);
                        }
                    }
                });

                s.receive({ payload: { chatId: [1, 2, 3], type: 'message', content: 'broadcast' } });
            } catch (err) {
                done(err);
            }
        });
    });
});

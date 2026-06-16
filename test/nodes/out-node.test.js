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

describe('telegram sender (out-node) — queue advance on empty-content drop (#450)', function () {
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

    it('advances the per-chatId queue when msg.payload.content is missing', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                s.warn = function () {};

                out.on('input', function (msg) {
                    try {
                        // The SECOND (non-empty) message reaches the bot stub —
                        // proving the queue advanced past the empty-content head.
                        expect(record).to.have.length(1);
                        expect(record[0].method).to.equal('sendMessage');
                        expect(msg.payload.sentMessageId).to.equal(999);
                        expect(s.queueManager.processing.get(123)).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                // First: empty-content message that would historically wedge the
                // queue (the case branch sees !hasContent, falls through to break
                // without calling processResult/processError or processNext, so
                // `processing` stays true forever).
                s.receive({ payload: { chatId: 123, type: 'message' } });
                // Second: proper content. Pre-fix, this would queue behind the
                // wedged head and never fire. Post-fix, queue advance unblocks it.
                s.receive({ payload: { chatId: 123, type: 'message', content: 'hello' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('per-chatId isolation preserved when both queues see an empty drop', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                s.warn = function () {};

                let outputs = 0;
                out.on('input', function () {
                    outputs++;
                    if (outputs === 2) {
                        try {
                            expect(record).to.have.length(2);
                            expect(s.queueManager.processing.get(123)).to.equal(false);
                            expect(s.queueManager.processing.get(456)).to.equal(false);
                            done();
                        } catch (err) {
                            done(err);
                        }
                    }
                });

                s.receive({ payload: { chatId: 123, type: 'message' } }); // empty, drops + advances
                s.receive({ payload: { chatId: 123, type: 'message', content: 'a' } });
                s.receive({ payload: { chatId: 456, type: 'message' } }); // empty, drops + advances on a different queue
                s.receive({ payload: { chatId: 456, type: 'message', content: 'b' } });
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('telegram sender (out-node) — queue advance on non-retry processError (#450 round 2)', function () {
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

    function makeRejectingThenAcceptingBotStub(record) {
        const stub = { options: { baseApiUrl: 'https://api.telegram.org' } };
        let calls = 0;
        stub.sendMessage = function () {
            calls++;
            record.push({ method: 'sendMessage', args: Array.from(arguments) });
            if (calls === 1) {
                return Promise.reject(new Error("ETELEGRAM: 400 Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 7"));
            }
            return Promise.resolve({ message_id: 999 });
        };
        return stub;
    }

    it('non-retryable error (Markdown parse failure) advances the queue so subsequent messages run', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeRejectingThenAcceptingBotStub(record);
                };
                s.error = function () {};
                s.warn = function () {};

                s.receive({
                    payload: {
                        chatId: 123,
                        type: 'message',
                        content: 'underscore _ inside',
                        options: { parse_mode: 'Markdown' },
                    },
                });

                setTimeout(function () {
                    s.receive({
                        payload: {
                            chatId: 123,
                            type: 'message',
                            content: 'plain text, no markdown specials',
                        },
                    });

                    setTimeout(function () {
                        try {
                            expect(record).to.have.length(2);
                            expect(record[0].args[1]).to.include('underscore');
                            expect(record[1].args[1]).to.include('plain text');
                            expect(s.queueManager.processing.get(123)).to.equal(false);
                            done();
                        } catch (err) {
                            done(err);
                        }
                    }, 50);
                }, 50);
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('telegram sender (out-node) — queue advance on remaining no-dispatch branches (#450 audit)', function () {
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

    // Each test sends two messages on the same chatId: the first hits a
    // no-dispatch branch (would historically wedge), the second is a normal
    // send. If queue advance is wired up correctly, the second reaches the
    // bot stub. Pre-fix, the second silently parks behind the wedged head.

    it('mediaGroup with non-array content advances the queue', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                s.warn = function () {};

                out.on('input', function (msg) {
                    try {
                        expect(msg.payload.sentMessageId).to.equal(999);
                        expect(s.queueManager.processing.get(789)).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 789, type: 'mediaGroup', content: 'not-an-array' } });
                s.receive({ payload: { chatId: 789, type: 'message', content: 'recovered' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('unknown msg.payload.type (no such bot method) advances the queue', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                s.warn = function () {};

                out.on('input', function (msg) {
                    try {
                        expect(msg.payload.sentMessageId).to.equal(999);
                        expect(s.queueManager.processing.get(789)).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 789, type: 'noSuchMethodOnBot', content: 'whatever' } });
                s.receive({ payload: { chatId: 789, type: 'message', content: 'recovered' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('missing msg.payload.type advances the queue', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                s.warn = function () {};

                out.on('input', function (msg) {
                    try {
                        expect(msg.payload.sentMessageId).to.equal(999);
                        expect(s.queueManager.processing.get(789)).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 789, content: 'whatever' } });
                s.receive({ payload: { chatId: 789, type: 'message', content: 'recovered' } });
            } catch (err) {
                done(err);
            }
        });
    });
});

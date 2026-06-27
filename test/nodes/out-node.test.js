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
        'editMessageMedia',
        'restrictChatMember',
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

describe('telegram sender (out-node) — legacy-options shim (#448)', function () {
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

    it('exposes deprecationWarnsSeen as an empty Set and migrateOptions as a function', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                expect(s.deprecationWarnsSeen).to.be.instanceOf(Set);
                expect(s.deprecationWarnsSeen.size).to.equal(0);
                expect(s.migrateOptions).to.be.a('function');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('rewrites reply_to_message_id on the send path and warns exactly once per node', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                const warns = [];
                s.warn = function (m) {
                    warns.push(m);
                };

                let outputs = 0;
                out.on('input', function () {
                    outputs++;
                    if (outputs === 2) {
                        try {
                            expect(record).to.have.length(2);
                            // Both sendMessage calls received the rewritten options.
                            record.forEach(function (call) {
                                expect(call.method).to.equal('sendMessage');
                                const sentOptions = call.args[2];
                                expect(sentOptions.reply_to_message_id).to.equal(undefined);
                                expect(sentOptions.reply_parameters).to.deep.equal({ message_id: 42 });
                            });
                            // Despite TWO sends with the deprecated field, exactly ONE warn.
                            const replyWarns = warns.filter(function (w) {
                                return /reply_to_message_id/.test(w);
                            });
                            expect(replyWarns).to.have.length(1);
                            done();
                        } catch (err) {
                            done(err);
                        }
                    }
                });

                s.receive({
                    payload: {
                        chatId: 123,
                        type: 'message',
                        content: 'first',
                        options: { reply_to_message_id: 42 },
                    },
                });
                s.receive({
                    payload: {
                        chatId: 123,
                        type: 'message',
                        content: 'second',
                        options: { reply_to_message_id: 42 },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('warns separately for each distinct deprecated field', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                const warns = [];
                s.warn = function (m) {
                    warns.push(m);
                };

                let outputs = 0;
                out.on('input', function () {
                    outputs++;
                    if (outputs === 2) {
                        try {
                            // Two distinct deprecated forms across two sends => two warns.
                            expect(warns.filter((w) => /reply_to_message_id/.test(w))).to.have.length(1);
                            expect(warns.filter((w) => /disable_web_page_preview/.test(w))).to.have.length(1);
                            done();
                        } catch (err) {
                            done(err);
                        }
                    }
                });

                s.receive({
                    payload: {
                        chatId: 123,
                        type: 'message',
                        content: 'a',
                        options: { reply_to_message_id: 42 },
                    },
                });
                s.receive({
                    payload: {
                        chatId: 123,
                        type: 'message',
                        content: 'b',
                        options: { disable_web_page_preview: true },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('produces zero deprecation warns when no deprecated fields are present', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                const warns = [];
                s.warn = function (m) {
                    warns.push(m);
                };

                out.on('input', function () {
                    try {
                        expect(warns.filter((w) => /DEPRECATED:/.test(w))).to.have.length(0);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 123,
                        type: 'message',
                        content: 'no-deprecated-options',
                        options: { reply_parameters: { message_id: 1 } },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('applies the shim to msg.payload.forward.options on the forwardMessage branch', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeBotStub(record);
                };
                const warns = [];
                s.warn = function (m) {
                    warns.push(m);
                };

                out.on('input', function () {
                    try {
                        expect(record).to.have.length(1);
                        expect(record[0].method).to.equal('forwardMessage');
                        const fwdOptions = record[0].args[3];
                        expect(fwdOptions.disable_web_page_preview).to.equal(undefined);
                        expect(fwdOptions.link_preview_options).to.deep.equal({ is_disabled: true });
                        expect(warns.filter((w) => /disable_web_page_preview/.test(w))).to.have.length(1);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 123,
                        messageId: 50,
                        forward: { chatId: 456, options: { disable_web_page_preview: true } },
                    },
                });
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
                            // Both content-bearing sends got through.
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

describe('telegram sender (out-node) — editMessageMedia pass-through (lib v1.1.1 handles local files natively)', function () {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let tmpFile;

    before(function (done) {
        // Real temp file on disk. As of lib v1.1.1 the node no longer pre-wraps
        // local paths with attach:// — the library uploads a bare local path
        // natively (detecting it via fs.existsSync) — so these tests assert the
        // wrapper passes msg.payload.content.media through unchanged.
        tmpFile = path.join(os.tmpdir(), 'out-node-test-' + Date.now() + '.png');
        fs.writeFileSync(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
        helper.startServer(done);
    });

    after(function (done) {
        try {
            fs.unlinkSync(tmpFile);
        } catch (e) {
            /* ignore */
        }
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

    it('passes a bare local file path through unchanged (lib v1.1.1 uploads it as multipart)', function (done) {
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
                        expect(record[0].method).to.equal('editMessageMedia');
                        // First positional arg is the InputMedia object. The node no
                        // longer pre-wraps the path: it is passed through verbatim and
                        // the library uploads the local file natively (see the real-lib
                        // test below that asserts the multipart attach:// form).
                        const media = record[0].args[0];
                        expect(media.media).to.equal(tmpFile);
                        expect(media.type).to.equal('photo');
                        expect(media.caption).to.equal('modified image');
                        // Second positional arg is `form` carrying chat/message ids.
                        const form = record[0].args[1];
                        expect(form.chat_id).to.equal(138708568);
                        expect(form.message_id).to.equal(34);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 138708568,
                        type: 'editMessageMedia',
                        content: {
                            type: 'photo',
                            media: tmpFile,
                            caption: 'modified image',
                        },
                        options: { chat_id: 138708568, message_id: 34 },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('leaves an attach:// path unchanged (idempotent on already-wrapped input)', function (done) {
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
                        expect(record[0].args[0].media).to.equal('attach://' + tmpFile);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 138708568,
                        type: 'editMessageMedia',
                        content: { type: 'photo', media: 'attach://' + tmpFile },
                        options: { chat_id: 138708568, message_id: 34 },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('leaves an https:// URL unchanged (no wrap; remote URL goes through as-is)', function (done) {
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
                        expect(record[0].args[0].media).to.equal('https://example.com/image.png');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 138708568,
                        type: 'editMessageMedia',
                        content: { type: 'photo', media: 'https://example.com/image.png' },
                        options: { chat_id: 138708568, message_id: 34 },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('leaves a Telegram file_id unchanged (no fs path match, no wrap)', function (done) {
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
                        expect(record[0].args[0].media).to.equal('AgACAgIAAxkBA-fake-file-id');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 138708568,
                        type: 'editMessageMedia',
                        content: { type: 'photo', media: 'AgACAgIAAxkBA-fake-file-id' },
                        options: { chat_id: 138708568, message_id: 34 },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('editMessageMedia — real library uploads a local file as multipart (lib v1.1.1)', function () {
    // This exercises the REAL node-telegram-bot-api class (not a stub), proving the
    // node no longer needs its own attach:// pre-wrap: the library uploads a bare
    // local path natively, and the legacy attach://<path> form resolves identically.
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    // lib v1.1.2 restored CommonJS — require the class synchronously.
    const TelegramBot = require('node-telegram-bot-api').default;
    let tmpFile;

    before(function () {
        tmpFile = path.join(os.tmpdir(), 'out-node-reallib-' + Date.now() + '.png');
        fs.writeFileSync(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    });

    after(function () {
        try {
            fs.unlinkSync(tmpFile);
        } catch (e) {
            /* ignore */
        }
    });

    // Build a real bot and capture what reaches the HTTP layer via _request.
    function captureRequest() {
        const bot = new TelegramBot('123456:fake-token', { polling: false });
        const captured = {};
        bot._request = function (method, opts) {
            captured.method = method;
            captured.opts = opts;
            return Promise.resolve({});
        };
        return { bot, captured };
    }

    it('rewrites a bare local path to attach://0_media and attaches the file part', async function () {
        const { bot, captured } = captureRequest();
        await bot.editMessageMedia({ type: 'photo', media: tmpFile, caption: 'x' }, { chat_id: 1, message_id: 2 });

        expect(captured.method).to.equal('editMessageMedia');
        const media = JSON.parse(captured.opts.form.media);
        expect(media.media).to.equal('attach://0_media');
        expect(media.type).to.equal('photo');
        expect(captured.opts.formData).to.have.property('0_media');
    });

    it('resolves the legacy attach://<local-path> form to the same multipart upload', async function () {
        const { bot, captured } = captureRequest();
        await bot.editMessageMedia({ type: 'photo', media: 'attach://' + tmpFile }, { chat_id: 1, message_id: 2 });

        const media = JSON.parse(captured.opts.form.media);
        expect(media.media).to.equal('attach://0_media');
        expect(captured.opts.formData).to.have.property('0_media');
    });

    it('passes a remote URL through without attaching a file', async function () {
        const { bot, captured } = captureRequest();
        await bot.editMessageMedia({ type: 'photo', media: 'https://example.com/i.png' }, { chat_id: 1, message_id: 2 });

        const media = JSON.parse(captured.opts.form.media);
        expect(media.media).to.equal('https://example.com/i.png');
        expect(captured.opts.formData).to.not.have.property('0_media');
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

    // A bot stub whose sendMessage rejects with the Markdown-parse-error shape
    // Telegram returns when an unescaped `_` / `*` / `[` is in the text.
    function makeRejectingThenAcceptingBotStub(record) {
        const stub = { options: { baseApiUrl: 'https://api.telegram.org' } };
        let calls = 0;
        stub.sendMessage = function () {
            calls++;
            record.push({ method: 'sendMessage', args: Array.from(arguments) });
            if (calls === 1) {
                // First call: simulate the Markdown parse error.
                return Promise.reject(new Error("ETELEGRAM: 400 Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 7"));
            }
            // Subsequent calls succeed.
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
                // Swallow node.error / node.warn output; we're checking queue mechanics.
                s.error = function () {};
                s.warn = function () {};

                // Send the first message — this one will fail with the
                // non-retryable Markdown parse error. Pre-fix: queue wedges.
                s.receive({
                    payload: {
                        chatId: 123,
                        type: 'message',
                        content: 'underscore _ inside',
                        options: { parse_mode: 'Markdown' },
                    },
                });

                // Send a second message a moment later. Post-fix: it should
                // make it to sendMessage and complete. Pre-fix: silently
                // queued behind a wedged head.
                setTimeout(function () {
                    s.receive({
                        payload: {
                            chatId: 123,
                            type: 'message',
                            content: 'plain text, no markdown specials',
                        },
                    });

                    // Give the second send a tick to reach the bot stub.
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

describe('telegram sender (out-node) — restrictChatMember V17 ergonomics (examples/supergroupadmin.json)', function () {
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

    it('lifts flat permission fields into the positional permissions arg', function (done) {
        // The shape supergroupadmin.json ships — options is the flat permissions
        // object, not nested under options.permissions.
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
                        expect(record[0].method).to.equal('restrictChatMember');
                        const args = record[0].args;
                        // v1.0.0 signature: (chatId, userId, permissions, form)
                        expect(args[0]).to.equal(456); // chatId
                        expect(args[1]).to.equal(42); // userId (content)
                        expect(args[2]).to.deep.equal({
                            can_send_messages: false,
                            can_send_media_messages: false,
                            can_send_polls: false,
                            can_send_other_messages: false,
                            can_add_web_page_previews: false,
                            can_change_info: false,
                            can_invite_users: false,
                            can_pin_messages: false,
                        });
                        // No unknown fields → form is empty.
                        expect(args[3]).to.deep.equal({});
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 456,
                        type: 'restrictChatMember',
                        content: 42,
                        options: {
                            can_send_messages: false,
                            can_send_media_messages: false,
                            can_send_polls: false,
                            can_send_other_messages: false,
                            can_add_web_page_previews: false,
                            can_change_info: false,
                            can_invite_users: false,
                            can_pin_messages: false,
                        },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('still accepts the nested options.permissions form', function (done) {
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
                        const args = record[0].args;
                        expect(args[2]).to.deep.equal({ can_send_messages: true });
                        expect(args[3]).to.deep.equal({}); // permissions key was lifted
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 456,
                        type: 'restrictChatMember',
                        content: 42,
                        options: { permissions: { can_send_messages: true } },
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('leaves non-permission fields on the form arg (until_date, use_independent_chat_permissions)', function (done) {
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
                        const args = record[0].args;
                        // Permission lifted into args[2].
                        expect(args[2]).to.deep.equal({ can_send_messages: false });
                        // Non-permission stays in form (args[3]).
                        expect(args[3]).to.deep.equal({
                            until_date: 1234567890,
                            use_independent_chat_permissions: true,
                        });
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 456,
                        type: 'restrictChatMember',
                        content: 42,
                        options: {
                            can_send_messages: false,
                            until_date: 1234567890,
                            use_independent_chat_permissions: true,
                        },
                    },
                });
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

describe('telegram sender (out-node) — callApi raw-API escape hatch', function () {
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

    // A richer stub than makeBotStub: records calls and resolves per-method.
    // Includes a blocklisted method (stopPolling) and a synchronously-throwing
    // method so we can prove neither wedges the queue.
    function makeCallApiStub(record) {
        const stub = { options: { baseApiUrl: 'https://api.telegram.org' } };
        ['setMyCommands', 'getMe', 'stopPolling', 'sendMessage'].forEach(function (m) {
            stub[m] = function () {
                record.push({ method: m, args: Array.from(arguments) });
                let result;
                if (m === 'getMe') {
                    result = { id: 1, is_bot: true };
                } else if (m === 'sendMessage') {
                    result = { message_id: 999 };
                } else {
                    result = { ok: true };
                }
                return Promise.resolve(result);
            };
        });
        stub.boomSync = function () {
            record.push({ method: 'boomSync', args: Array.from(arguments) });
            throw new Error('synchronous boom');
        };
        return stub;
    }

    it('invokes the named method with the given args and forwards the result', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeCallApiStub(record);
                };

                out.on('input', function (msg) {
                    try {
                        expect(record).to.have.lengthOf(1);
                        expect(record[0].method).to.equal('setMyCommands');
                        expect(record[0].args).to.deep.equal([[{ command: 'help', description: 'Help' }], {}]);
                        expect(msg.payload.content).to.deep.equal({ ok: true });
                        expect(s.queueManager.processing.get(123)).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({
                    payload: {
                        chatId: 123,
                        type: 'callApi',
                        method: 'setMyCommands',
                        args: [[{ command: 'help', description: 'Help' }], {}],
                    },
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('works without a chatId (bot-level call) and forwards the result', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeCallApiStub(record);
                };

                out.on('input', function (msg) {
                    try {
                        expect(record[0].method).to.equal('getMe');
                        expect(msg.payload.content).to.deep.equal({ id: 1, is_bot: true });
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { type: 'callApi', method: 'getMe', args: [] } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('refuses a blocklisted lifecycle method and advances the queue', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeCallApiStub(record);
                };
                s.warn = function () {};

                out.on('input', function (msg) {
                    try {
                        expect(record.some((r) => r.method === 'stopPolling')).to.equal(false);
                        expect(msg.payload.sentMessageId).to.equal(999);
                        expect(s.queueManager.processing.get(55)).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 55, type: 'callApi', method: 'stopPolling', args: [] } });
                s.receive({ payload: { chatId: 55, type: 'message', content: 'recovered' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('refuses an underscore-prefixed internal method and advances the queue', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    const stub = makeCallApiStub(record);
                    stub._request = function () {
                        record.push({ method: '_request', args: [] });
                        return Promise.resolve({});
                    };
                    return stub;
                };
                s.warn = function () {};

                out.on('input', function (msg) {
                    try {
                        expect(record.some((r) => r.method === '_request')).to.equal(false);
                        expect(msg.payload.sentMessageId).to.equal(999);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 55, type: 'callApi', method: '_request', args: [] } });
                s.receive({ payload: { chatId: 55, type: 'message', content: 'recovered' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('warns and advances the queue for a non-existent method', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeCallApiStub(record);
                };
                s.warn = function () {};

                out.on('input', function (msg) {
                    try {
                        expect(msg.payload.sentMessageId).to.equal(999);
                        expect(s.queueManager.processing.get(55)).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 55, type: 'callApi', method: 'noSuchMethod', args: [] } });
                s.receive({ payload: { chatId: 55, type: 'message', content: 'recovered' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('warns and advances the queue when args is not an array', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeCallApiStub(record);
                };
                s.warn = function () {};

                out.on('input', function (msg) {
                    try {
                        expect(record.some((r) => r.method === 'setMyCommands')).to.equal(false);
                        expect(msg.payload.sentMessageId).to.equal(999);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 55, type: 'callApi', method: 'setMyCommands', args: 'not-an-array' } });
                s.receive({ payload: { chatId: 55, type: 'message', content: 'recovered' } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('routes a synchronous throw into processError and advances the queue', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const s = helper.getNode('s1');
                const out = helper.getNode('out');
                const cfg = helper.getNode('b1');
                const record = [];
                cfg.getTelegramBot = function () {
                    return makeCallApiStub(record);
                };
                s.warn = function () {};
                s.error = function () {};

                out.on('input', function (msg) {
                    try {
                        expect(record.some((r) => r.method === 'boomSync')).to.equal(true);
                        expect(msg.payload.sentMessageId).to.equal(999);
                        expect(s.queueManager.processing.get(55)).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                s.receive({ payload: { chatId: 55, type: 'callApi', method: 'boomSync', args: [] } });
                s.receive({ payload: { chatId: 55, type: 'message', content: 'recovered' } });
            } catch (err) {
                done(err);
            }
        });
    });
});

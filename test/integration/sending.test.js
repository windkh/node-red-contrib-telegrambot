const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');
const { startMock } = require('../fixtures/telegram-mock.js');

helper.init(require.resolve('node-red'));

describe('integration: outbound send transport against a mocked Telegram API', function () {
    this.timeout(10000);

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

    function senderOnlyFlow() {
        // Send-only mode — the bot never polls. Sending still routes through baseApiUrl.
        return [
            {
                id: 'b1',
                type: 'telegram bot',
                botname: 'b',
                updatemode: 'sendonly',
                baseapiurl: mock.url,
            },
            { id: 's1', type: 'telegram sender', bot: 'b1', wires: [['out']] },
            { id: 'out', type: 'helper' },
        ];
    }

    it('POSTs to /bot<TOKEN>/sendMessage when a text "message" is enqueued', function (done) {
        helper.load(telegrambotModule, senderOnlyFlow(), { b1: { token: 'fake' } }, function () {
            const s = helper.getNode('s1');
            const out = helper.getNode('out');

            out.on('input', function (msg) {
                try {
                    const calls = mock.callsTo('sendMessage');
                    expect(calls).to.have.length(1);
                    expect(calls[0].body.chat_id).to.equal('999');
                    expect(calls[0].body.text).to.equal('hello over HTTP');
                    // processResult writes the api result onto msg.payload
                    expect(msg.payload.sentMessageId).to.equal(1000); // mock's first id
                    done();
                } catch (err) {
                    done(err);
                }
            });

            s.receive({ payload: { chatId: 999, type: 'message', content: 'hello over HTTP' } });
        });
    });

    it('chunks a >4000-char message into N sequential POSTs and emits exactly once', function (done) {
        helper.load(telegrambotModule, senderOnlyFlow(), { b1: { token: 'fake' } }, function () {
            const s = helper.getNode('s1');
            const out = helper.getNode('out');

            let emits = 0;
            out.on('input', function () {
                emits++;
            });

            s.receive({ payload: { chatId: 999, type: 'message', content: 'a'.repeat(9001) } });

            // Wait for the queue to drain — three sequential sends over the loopback
            // mock should complete well under 300 ms.
            setTimeout(function () {
                try {
                    const calls = mock.callsTo('sendMessage');
                    expect(calls).to.have.length(3);
                    calls.forEach(function (c) {
                        expect(c.body.text.length).to.be.lessThanOrEqual(4000);
                    });
                    // The chunk-sequencing fix in V17.3.0 guarantees exactly one emit per
                    // original message regardless of chunk count.
                    expect(emits).to.equal(1);
                    done();
                } catch (err) {
                    done(err);
                }
            }, 300);
        });
    });

    it('retries on HTTP 429 with the API-supplied retry_after delay', function (done) {
        helper.load(telegrambotModule, senderOnlyFlow(), { b1: { token: 'fake' } }, function () {
            const s = helper.getNode('s1');
            const out = helper.getNode('out');

            // First sendMessage fails with 429, retry_after = 1 second.
            // (retry_after MUST be > 0 — bot-node's processError uses `|| default`, so 0 falls
            // back to the 3-second default; and a missing `parameters` field would crash the
            // current handler. That defensive gap is tracked separately.)
            mock.failNext('sendMessage', { code: 429, description: 'Too Many Requests: retry after 1', retry_after: 1 });

            out.on('input', function (msg) {
                try {
                    const calls = mock.callsTo('sendMessage');
                    // Exactly one retry → two total POSTs.
                    expect(calls).to.have.length(2);
                    expect(msg.payload.sentMessageId).to.exist;
                    done();
                } catch (err) {
                    done(err);
                }
            });

            s.receive({ payload: { chatId: 999, type: 'message', content: 'will-retry' } });
        });
    });

    it('falls back to plain mode when Markdown parse fails on the first chunk', function (done) {
        helper.load(telegrambotModule, senderOnlyFlow(), { b1: { token: 'fake' } }, function () {
            const s = helper.getNode('s1');
            const out = helper.getNode('out');

            // First call fails the Markdown way; the chunk re-sends without parse_mode.
            mock.failNext('sendMessage', {
                code: 400,
                description: "Bad Request: can't parse entities in message text: unexpected character",
            });

            out.on('input', function () {
                try {
                    const calls = mock.callsTo('sendMessage');
                    expect(calls).to.have.length(2);
                    // First attempt carried parse_mode; the fallback attempt did not.
                    expect(calls[0].body.parse_mode).to.equal('Markdown');
                    expect(calls[1].body.parse_mode).to.be.undefined;
                    done();
                } catch (err) {
                    done(err);
                }
            });

            s.receive({
                payload: { chatId: 999, type: 'message', content: 'hello *_world_*', options: { parse_mode: 'Markdown' } },
            });
        });
    });

    it('routes "forward" payloads through forwardMessage', function (done) {
        helper.load(telegrambotModule, senderOnlyFlow(), { b1: { token: 'fake' } }, function () {
            const s = helper.getNode('s1');
            const out = helper.getNode('out');
            out.on('input', function () {
                try {
                    expect(mock.callsTo('forwardMessage')).to.have.length(1);
                    done();
                } catch (err) {
                    done(err);
                }
            });
            s.receive({
                payload: {
                    chatId: 100,
                    messageId: 555,
                    forward: { chatId: 200 },
                },
            });
        });
    });

    it('serialises sends to the same chat through the per-chat queue', function (done) {
        helper.load(telegrambotModule, senderOnlyFlow(), { b1: { token: 'fake' } }, function () {
            const s = helper.getNode('s1');
            const out = helper.getNode('out');

            let arrivals = 0;
            out.on('input', function () {
                arrivals++;
                if (arrivals === 3) {
                    try {
                        const calls = mock.callsTo('sendMessage');
                        expect(calls).to.have.length(3);
                        expect(calls.map(function (c) { return c.body.text; })).to.deep.equal(['one', 'two', 'three']);
                        done();
                    } catch (err) {
                        done(err);
                    }
                }
            });

            s.receive({ payload: { chatId: 7, type: 'message', content: 'one' } });
            s.receive({ payload: { chatId: 7, type: 'message', content: 'two' } });
            s.receive({ payload: { chatId: 7, type: 'message', content: 'three' } });
        });
    });
});

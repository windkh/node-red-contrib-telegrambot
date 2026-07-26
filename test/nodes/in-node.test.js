const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const helper = require('node-red-node-test-helper');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram receiver (in-node)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flowWithReceiver(extraReceiverFields) {
        return [
            { id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' },
            Object.assign(
                { id: 'r1', type: 'telegram receiver', bot: 'b1', wires: [['out'], ['unauth']] },
                extraReceiverFields || {}
            ),
            { id: 'out', type: 'helper' },
            { id: 'unauth', type: 'helper' },
        ];
    }

    it('registers under "telegram receiver" and resolves its config link', function (t, done) {
        helper.load(telegrambotModule, flowWithReceiver(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                assert.ok(r !== undefined && r !== null);
                assert.strictEqual(r.type, 'telegram receiver');
                assert.ok(r.config !== undefined && r.config !== null);
                assert.strictEqual(r.config.botname, 'b');
                // attachedListeners is initialised by the node, even if start() didn't fire any.
                assert.ok(Array.isArray(r.attachedListeners));
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('exposes start / stop / processMessage / on-close behaviour', function (t, done) {
        helper.load(telegrambotModule, flowWithReceiver(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                assert.strictEqual(typeof r.start, 'function');
                assert.strictEqual(typeof r.stop, 'function');
                assert.strictEqual(typeof r.processMessage, 'function');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('processMessage forwards an authorised text message to output 1', function (t, done) {
        helper.load(telegrambotModule, flowWithReceiver(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                const out = helper.getNode('out');
                const unauth = helper.getNode('unauth');

                // An authorised message must NOT reach the unauthorised output (output 2).
                unauth.on('input', function () {
                    done(new Error('authorised message must not reach the unauthorised output'));
                });

                out.on('input', function (msg) {
                    try {
                        assert.strictEqual(msg.payload.type, 'message');
                        assert.strictEqual(msg.payload.content, 'hi there');
                        assert.strictEqual(msg.payload.chatId, 123);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                // Synthesise a Telegram update through the node's own processMessage.
                r.processMessage('message', {
                    message_id: 1,
                    chat: { id: 123, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                    text: 'hi there',
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('processMessage routes an unauthorised user to output 2', function (t, done) {
        const flow = flowWithReceiver();
        // restrict to a different username so 'alice' is unauthorised
        flow[0].usernames = 'bob';
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                const out = helper.getNode('out');
                const unauth = helper.getNode('unauth');

                out.on('input', function () {
                    done(new Error('authorised output should not have fired'));
                });
                unauth.on('input', function (msg) {
                    try {
                        assert.strictEqual(msg.payload.content, 'hi from alice');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                r.processMessage('message', {
                    message_id: 1,
                    chat: { id: 123, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                    text: 'hi from alice',
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('processMessage skips known commands when filterCommands is enabled', function (t, done) {
        const flow = flowWithReceiver({ filterCommands: true });
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                const out = helper.getNode('out');

                // Pretend /known is registered with the config node
                r.config.registerCommand('cmd-node-1', '/known', 'd', undefined, 'default', true);

                let fired = false;
                out.on('input', function () {
                    fired = true;
                });

                r.processMessage('message', {
                    message_id: 1,
                    chat: { id: 123, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                    text: '/known',
                });

                // give Node-RED an event-loop tick to be sure it didn't fire
                setTimeout(function () {
                    try {
                        assert.strictEqual(fired, false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                }, 30);
            } catch (err) {
                done(err);
            }
        });
    });
});

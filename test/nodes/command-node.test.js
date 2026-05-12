const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram command', function () {
    before(function (done) {
        helper.startServer(done);
    });

    after(function (done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flowWithCommand(extra) {
        return [
            { id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' },
            Object.assign(
                {
                    id: 'c1',
                    type: 'telegram command',
                    bot: 'b1',
                    command: '/hello',
                    registercommand: false,
                    wires: [['out'], ['resp']],
                },
                extra || {}
            ),
            { id: 'out', type: 'helper' },
            { id: 'resp', type: 'helper' },
        ];
    }

    it('registers under "telegram command"', function (done) {
        helper.load(telegrambotModule, flowWithCommand(), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                expect(c).to.exist;
                expect(c.type).to.equal('telegram command');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('emits on output 1 when the matching /command is received', function (done) {
        helper.load(telegrambotModule, flowWithCommand(), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                const out = helper.getNode('out');

                out.on('input', function (msg) {
                    try {
                        expect(msg.payload.type).to.equal('message');
                        // command stripped from the text
                        expect(msg.payload.content.trim()).to.equal('arg1 arg2');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                c.processMessage({
                    message_id: 1,
                    chat: { id: 123, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                    text: '/hello arg1 arg2',
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('does not fire when a non-matching /other command arrives', function (done) {
        helper.load(telegrambotModule, flowWithCommand(), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                const out = helper.getNode('out');
                let fired = false;
                out.on('input', function () {
                    fired = true;
                });
                c.processMessage({
                    message_id: 1,
                    chat: { id: 123, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                    text: '/other arg1',
                });
                setTimeout(function () {
                    try {
                        expect(fired).to.equal(false);
                        done();
                    } catch (err) {
                        done(err);
                    }
                }, 20);
            } catch (err) {
                done(err);
            }
        });
    });

    it('routes a follow-up message to output 2 when hasresponse is set', function (done) {
        helper.load(telegrambotModule, flowWithCommand({ hasresponse: true }), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                const out = helper.getNode('out');
                const resp = helper.getNode('resp');

                let receivedCommand = false;
                out.on('input', function () {
                    receivedCommand = true;
                });

                resp.on('input', function (msg) {
                    try {
                        expect(receivedCommand).to.equal(true);
                        expect(msg.payload.content).to.equal('here is my answer');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                const userMsg = {
                    message_id: 1,
                    chat: { id: 123, type: 'private', username: 'alice' },
                    from: { id: 42, username: 'alice', is_bot: false },
                    date: 1,
                };
                // First the command...
                c.processMessage(Object.assign({}, userMsg, { text: '/hello' }));
                // ...then the response
                c.processMessage(Object.assign({}, userMsg, { message_id: 2, text: 'here is my answer' }));
            } catch (err) {
                done(err);
            }
        });
    });

    it('does not crash on a channel-post-style message with no botMsg.from', function (done) {
        // Regression: before V17.3.1 this dereferenced botMsg.from.username.
        helper.load(telegrambotModule, flowWithCommand(), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                c.processMessage({
                    message_id: 99,
                    chat: { id: -1001234, type: 'channel', title: 'A Channel' },
                    sender_chat: { id: -1001234, type: 'channel' },
                    date: 1,
                    text: 'channel announcement',
                });
                // If we got here without throwing, the regression test passed.
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

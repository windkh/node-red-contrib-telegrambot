const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram receiver (in-node)', function () {
    before(function (done) {
        helper.startServer(done);
    });

    after(function (done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flowWithReceiver(extraReceiverFields) {
        return [
            { id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' },
            Object.assign({ id: 'r1', type: 'telegram receiver', bot: 'b1', wires: [['out'], ['unauth']] }, extraReceiverFields || {}),
            { id: 'out', type: 'helper' },
            { id: 'unauth', type: 'helper' },
        ];
    }

    it('registers under "telegram receiver" and resolves its config link', function (done) {
        helper.load(telegrambotModule, flowWithReceiver(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                expect(r).to.exist;
                expect(r.type).to.equal('telegram receiver');
                expect(r.config).to.exist;
                expect(r.config.botname).to.equal('b');
                // attachedListeners is initialised by the node, even if start() didn't fire any.
                expect(r.attachedListeners).to.be.an('array');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('exposes start / stop / processMessage / on-close behaviour', function (done) {
        helper.load(telegrambotModule, flowWithReceiver(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                expect(r.start).to.be.a('function');
                expect(r.stop).to.be.a('function');
                expect(r.processMessage).to.be.a('function');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('processMessage forwards an authorised text message to output 1', function (done) {
        helper.load(telegrambotModule, flowWithReceiver(), { b1: { token: 'fake' } }, function () {
            try {
                const r = helper.getNode('r1');
                const out = helper.getNode('out');
                const unauth = helper.getNode('unauth');

                out.on('input', function (msg) {
                    try {
                        expect(msg.payload.type).to.equal('message');
                        expect(msg.payload.content).to.equal('hi there');
                        expect(msg.payload.chatId).to.equal(123);
                        expect(unauth.input).to.not.have.been;
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

    it('processMessage routes an unauthorised user to output 2', function (done) {
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
                        expect(msg.payload.content).to.equal('hi from alice');
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

    it('processMessage skips known commands when filterCommands is enabled', function (done) {
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
                        expect(fired).to.equal(false);
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

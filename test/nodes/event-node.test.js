const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram event', function () {
    before(function (done) {
        helper.startServer(done);
    });

    after(function (done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flowWithEvent(eventName) {
        return [
            { id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' },
            { id: 'e1', type: 'telegram event', bot: 'b1', event: eventName, wires: [['out']] },
            { id: 'out', type: 'helper' },
        ];
    }

    it('registers under "telegram event" and reads its event config', function (done) {
        helper.load(telegrambotModule, flowWithEvent('callback_query'), { b1: { token: 'fake' } }, function () {
            try {
                const e = helper.getNode('e1');
                expect(e).to.exist;
                expect(e.type).to.equal('telegram event');
                expect(e.event).to.equal('callback_query');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('emits on the configured event type when processMessage is invoked', function (done) {
        helper.load(telegrambotModule, flowWithEvent('callback_query'), { b1: { token: 'fake' } }, function () {
            try {
                const e = helper.getNode('e1');
                const out = helper.getNode('out');
                out.on('input', function (msg) {
                    try {
                        expect(msg.payload.type).to.equal('callback_query');
                        expect(msg.payload.content).to.equal('choice-A');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                e.processMessage({
                    id: 'cb-1',
                    from: { id: 42, username: 'alice', is_bot: false },
                    message: { chat: { id: 123, type: 'private', username: 'alice' }, message_id: 1, date: 1 },
                    chat_instance: 'x',
                    data: 'choice-A',
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('passes a non-callback event through without crashing on anonymous payloads', function (done) {
        helper.load(telegrambotModule, flowWithEvent('poll'), { b1: { token: 'fake' } }, function () {
            try {
                const e = helper.getNode('e1');
                const out = helper.getNode('out');
                out.on('input', function (msg) {
                    try {
                        expect(msg.payload.type).to.equal('poll');
                        expect(msg.payload.id).to.equal('p-1');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
                // A poll update has no `from` and no `chat` (chat-less event).
                e.processMessage({
                    id: 'p-1',
                    question: 'Q',
                    options: [],
                    total_voter_count: 0,
                    type: 'regular',
                });
            } catch (err) {
                done(err);
            }
        });
    });
});

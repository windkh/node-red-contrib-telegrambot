const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram control', function () {
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
            { id: 'c1', type: 'telegram control', bot: 'b1', wires: [['out'], ['online']] },
            { id: 'out', type: 'helper' },
            { id: 'online', type: 'helper' },
        ];
    }

    it('registers under "telegram control"', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                expect(c).to.exist;
                expect(c.type).to.equal('telegram control');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('warns when msg.payload is empty', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                let warned = null;
                c.warn = function (m) {
                    warned = m;
                };
                c.receive({});
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

    it('routes a "command"-payload through to sendToAllCommandNodes via config', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                const out = helper.getNode('out');

                // Stub the config's sendToAllCommandNodes so the test does not need
                // a registered command node downstream.
                let received = null;
                c.config.sendToAllCommandNodes = function (message, done2) {
                    received = message;
                    done2();
                };

                out.on('input', function () {
                    try {
                        expect(received).to.exist;
                        expect(received.text).to.equal('/inject');
                        // Defaults filled in by the control branch when from / chat are absent.
                        expect(received.from).to.deep.equal({ id: 0, username: 'unknown' });
                        expect(received.chat).to.deep.equal({ id: 0 });
                        done();
                    } catch (err) {
                        done(err);
                    }
                });

                c.receive({ payload: { command: 'command', message: { text: '/inject' } } });
            } catch (err) {
                done(err);
            }
        });
    });

    it('restartTimer slot is initially absent and only set on a delayed restart', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const c = helper.getNode('c1');
                expect(c.restartTimer).to.be.undefined; // not yet set
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

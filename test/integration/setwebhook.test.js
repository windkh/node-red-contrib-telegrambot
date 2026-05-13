const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');
const { startMock } = require('../fixtures/telegram-mock.js');

helper.init(require.resolve('node-red'));

describe('integration: control "setwebhook" command (issue #410)', function () {
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

    function flow() {
        // Send-only mode keeps the bot quiet (no polling) but the agent still uses
        // baseApiUrl, so setWebHook calls go to the mock.
        return [
            { id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly', baseapiurl: mock.url },
            { id: 'c1', type: 'telegram control', bot: 'b1', wires: [['out']] },
            { id: 'out', type: 'helper' },
        ];
    }

    it('forwards the new URL to bot.setWebHook against the mocked API', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            const c = helper.getNode('c1');
            const out = helper.getNode('out');

            out.on('input', function (msg) {
                try {
                    const calls = mock.callsTo('setWebHook');
                    expect(calls).to.have.length(1);
                    const url = (calls[0].body && calls[0].body.url) || (calls[0].query && calls[0].query.url) || '';
                    expect(String(url)).to.include('new-ngrok-tunnel');
                    expect(msg.payload.result).to.equal(true);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            c.receive({ payload: { command: 'setwebhook', url: 'https://new-ngrok-tunnel.example/bot' } });
        });
    });

    it('with an empty url, calls bot.deleteWebHook instead', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            const c = helper.getNode('c1');
            const out = helper.getNode('out');

            out.on('input', function () {
                try {
                    expect(mock.callsTo('setWebHook')).to.have.length(0);
                    expect(mock.callsTo('deleteWebHook')).to.have.length(1);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            c.receive({ payload: { command: 'setwebhook', url: '' } });
        });
    });

    it('surfaces a setWebHook error as msg.error on the same output', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            const c = helper.getNode('c1');
            const out = helper.getNode('out');

            mock.failNext('setWebHook', { code: 400, description: 'Bad Request: bad webhook url' });

            out.on('input', function (msg) {
                try {
                    expect(msg.error).to.match(/Bad Request: bad webhook url/);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            c.receive({ payload: { command: 'setwebhook', url: 'https://example.invalid/bot' } });
        });
    });
});

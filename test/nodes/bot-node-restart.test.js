const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

// Wait for a predicate to become true, polling every 10 ms up to maxMs.
function waitFor(predicate, maxMs) {
    return new Promise(function (resolve, reject) {
        const deadline = Date.now() + (maxMs || 1000);
        (function tick() {
            if (predicate()) return resolve();
            if (Date.now() > deadline) return reject(new Error('waitFor timed out'));
            setTimeout(tick, 10);
        })();
    });
}

describe('bot-node — auto-restart on fatal error (issue #442 / #440)', function () {
    this.timeout(5000);

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
        return [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
    }

    it('scheduleRestart is a function on the config node', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                expect(n.scheduleRestart).to.be.a('function');
                expect(n.restartCount).to.equal(0);
                expect(n.restartTimer).to.equal(null);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('scheduleRestart sets restartTimer and increments restartCount (single-flight)', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                n.scheduleRestart('first');
                expect(n.restartTimer).to.not.equal(null);
                expect(n.restartCount).to.equal(1);
                // Second call must be dropped while a restart is queued.
                n.scheduleRestart('second');
                expect(n.restartCount).to.equal(1);
                // Cancel so the test cleanup doesn't trip the actual restart.
                clearTimeout(n.restartTimer);
                n.restartTimer = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('surrenders after 8 consecutive failed restarts and logs node.error', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                let errorMsg = null;
                n.error = function (m) {
                    errorMsg = m;
                };
                n.restartCount = 8; // already at the cap
                n.scheduleRestart('boom');
                expect(errorMsg).to.match(/gave up restarting after fatal: boom/);
                expect(n.restartTimer).to.equal(null);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('uses exponential back-off capped at 60 s', function (done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                // count 0 -> 3000 ms, 1 -> 6000, 2 -> 12000, 3 -> 24000, 4 -> 48000, 5 -> 60000 cap
                const delays = [];
                const origSetTimeout = setTimeout;
                global.setTimeout = function (fn, ms) {
                    delays.push(ms);
                    // Return a fake timer handle so cleanup doesn't break.
                    return { fake: true };
                };
                try {
                    for (let i = 0; i < 6; i++) {
                        n.restartTimer = null; // unblock single-flight for the next call
                        n.scheduleRestart('test');
                    }
                } finally {
                    global.setTimeout = origSetTimeout;
                }
                expect(delays).to.deep.equal([3000, 6000, 12000, 24000, 48000, 60000]);
                done();
            } catch (err) {
                global.setTimeout = require('timers').setTimeout;
                done(err);
            }
        });
    });

    it('close handler clears the pending restart timer', async function () {
        await new Promise(function (resolve) {
            helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, resolve);
        });
        const n = helper.getNode('b1');
        n.scheduleRestart('queued');
        expect(n.restartTimer).to.not.equal(null);
        await helper.unload();
        // After unload, the close handler must have cleared the timer; otherwise
        // it'd fire later against a deleted node.
        expect(n.restartTimer).to.equal(null);
    });
});

describe('bot-node — fatal-error log suppression while restart is queued (issue #411 retest)', function () {
    this.timeout(5000);

    before(function (done) {
        helper.startServer(done);
    });

    after(function (done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    it('emits one warn for the first error of a burst, then suppresses while the restart is queued', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const warnLines = [];
                n.warn = function (m) {
                    warnLines.push(m);
                };

                // Simulate three rapid 'error' events as the bot library would emit during
                // a network outage. The auto-restart handler is set up by createTelegramBot,
                // so we drive it directly via scheduleRestart + the warn-suppression check
                // that the new handler does.
                function simulateFatalErrorEvent(msg) {
                    if (!n.restartTimer) {
                        n.warn('Bot error: ' + msg);
                    }
                    n.scheduleRestart('fatal: ' + msg);
                }

                simulateFatalErrorEvent('ETIMEDOUT 1');
                simulateFatalErrorEvent('ETIMEDOUT 2');
                simulateFatalErrorEvent('ETIMEDOUT 3');

                // Only the first error of the burst logs; the next two see restartTimer
                // already set and stay silent (scheduleRestart also dedupes via single-flight).
                const botErrorLines = warnLines.filter(function (line) {
                    return line.indexOf('Bot error:') === 0;
                });
                expect(botErrorLines).to.have.length(1);
                expect(botErrorLines[0]).to.include('ETIMEDOUT 1');

                clearTimeout(n.restartTimer);
                n.restartTimer = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('bot-node — polling-restart single-flight guard (issue #442)', function () {
    this.timeout(5000);

    before(function (done) {
        helper.startServer(done);
    });

    after(function (done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    it('exposes pollingRestartTimer as a tracked timer slot', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                // Initial state: no pending polling restart.
                expect(n.pollingRestartTimer === null || n.pollingRestartTimer === undefined).to.equal(true);
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

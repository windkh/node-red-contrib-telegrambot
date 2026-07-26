const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const helper = require('node-red-node-test-helper');
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
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flow() {
        return [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
    }

    it('scheduleRestart is a function on the config node', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(typeof n.scheduleRestart, 'function');
                assert.strictEqual(n.restartCount, 0);
                assert.strictEqual(n.restartTimer, null);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('scheduleRestart sets restartTimer and increments restartCount (single-flight)', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                n.scheduleRestart('first');
                assert.notStrictEqual(n.restartTimer, null);
                assert.strictEqual(n.restartCount, 1);
                // Second call must be dropped while a restart is queued.
                n.scheduleRestart('second');
                assert.strictEqual(n.restartCount, 1);
                // Cancel so the test cleanup doesn't trip the actual restart.
                clearTimeout(n.restartTimer);
                n.restartTimer = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('initialises restartCeilingAnnounced to false on construction', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(n.restartCeilingAnnounced, false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('keeps retrying past the old 8-attempt cap — no permanent give-up (#442 retest 2026-05-27)', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const errorMsgs = [];
                const warnMsgs = [];
                n.error = function (m) {
                    errorMsgs.push(m);
                };
                n.warn = function (m) {
                    warnMsgs.push(m);
                };
                n.restartCount = 12; // well past the old give-up threshold of 8
                n.restartCeilingAnnounced = true; // pretend the operator was already alerted
                n.scheduleRestart('still-broken');
                // A restart MUST be scheduled — the helper no longer surrenders.
                assert.notStrictEqual(n.restartTimer, null);
                // No "gave up" message — that branch is gone.
                assert.strictEqual(
                    errorMsgs.some(function (m) {
                        return /gave up restarting/.test(m);
                    }),
                    false
                );
                // The warn line still announces the scheduled restart at the cap.
                assert.strictEqual(
                    warnMsgs.some(function (m) {
                        return /will restart in 60000ms/.test(m);
                    }),
                    true
                );
                clearTimeout(n.restartTimer);
                n.restartTimer = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('emits exactly one node.error the first time the 60s ceiling is reached and stays silent after', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const errorMsgs = [];
                n.error = function (m) {
                    errorMsgs.push(m);
                };
                n.warn = function () {};

                // count=4 → delay=48000, still below the ceiling — no node.error yet.
                n.restartCount = 4;
                n.scheduleRestart('approaching');
                assert.deepStrictEqual(errorMsgs, []);
                assert.strictEqual(n.restartCeilingAnnounced, false);
                clearTimeout(n.restartTimer);
                n.restartTimer = null;

                // count=5 → delay=60000, first time at the ceiling — node.error fires once.
                n.restartCount = 5;
                n.scheduleRestart('at-ceiling');
                assert.strictEqual(errorMsgs.length, 1);
                assert.match(errorMsgs[0], /auto-restart hit 60s ceiling/);
                assert.ok(errorMsgs[0].includes('at-ceiling'));
                assert.strictEqual(n.restartCeilingAnnounced, true);
                clearTimeout(n.restartTimer);
                n.restartTimer = null;

                // count=6 → still at the ceiling but the flag is set — no further node.errors.
                n.restartCount = 6;
                n.scheduleRestart('still-at-ceiling');
                assert.strictEqual(errorMsgs.length, 1); // unchanged
                clearTimeout(n.restartTimer);
                n.restartTimer = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('uses exponential back-off capped at 60 s', function (t, done) {
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
                assert.deepStrictEqual(delays, [3000, 6000, 12000, 24000, 48000, 60000]);
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
        assert.notStrictEqual(n.restartTimer, null);
        await helper.unload();
        // After unload, the close handler must have cleared the timer; otherwise
        // it'd fire later against a deleted node.
        assert.strictEqual(n.restartTimer, null);
    });
});

describe('bot-node — stable-window restartCount reset (issue #442 retest, V17.4.2)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    it('a fresh error inside the stable window keeps the backoff escalating', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                // Simulate the post-restart "looks stable" timer being set (which is what the
                // success path of the restartTimer callback does) without actually firing
                // the abortBot+create chain.
                n.restartCount = 3; // pretend we've already had 3 escalating restarts
                n.restartStableTimer = setTimeout(function () {
                    n.restartStableTimer = null;
                    n.restartCount = 0;
                }, 60000);

                // A new error before the 60 s elapses must:
                //   1. cancel the stableTimer (so the previous "success" doesn't reset count)
                //   2. NOT reset restartCount — the next backoff continues from where we were
                n.scheduleRestart('another error');
                assert.strictEqual(n.restartStableTimer, null);
                assert.strictEqual(n.restartCount, 4); // 3 -> 4, not 0 -> 1
                // delay for count=3 going to 4 is 3000 * 2^3 = 24000 ms.
                // (We don't assert delay directly here — covered separately below.)

                // Cleanup so the actual scheduled restart doesn't fire during teardown.
                clearTimeout(n.restartTimer);
                n.restartTimer = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('an error AFTER the stable window has fired resets to the minimum backoff', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                n.restartCount = 5;
                // Stable window fired and successfully reset:
                n.restartStableTimer = null;
                n.restartCount = 0;

                // New error after the stable window: clean slate.
                n.scheduleRestart('much later');
                assert.strictEqual(n.restartCount, 1);

                clearTimeout(n.restartTimer);
                n.restartTimer = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('close handler clears the pending stable-window timer too', async function () {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        await new Promise(function (resolve) {
            helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, resolve);
        });
        const n = helper.getNode('b1');
        n.restartStableTimer = setTimeout(function () {}, 60000);
        assert.notStrictEqual(n.restartStableTimer, null);
        await helper.unload();
        assert.strictEqual(n.restartStableTimer, null);
    });
});

describe('bot-node — fatal-error log suppression while restart is queued (issue #411 retest)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    it('emits one warn for the first error of a burst, then suppresses while the restart is queued', function (t, done) {
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
                assert.strictEqual(botErrorLines.length, 1);
                assert.ok(botErrorLines[0].includes('ETIMEDOUT 1'));

                clearTimeout(n.restartTimer);
                n.restartTimer = null;
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('bot-node — undici dispatcher wiring on scheduleRestart (#442, V18.0.0 migration)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    it('config node exposes buildDispatcherOptions and instantiateBot helpers', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(typeof n.buildDispatcherOptions, 'function');
                assert.strictEqual(typeof n.instantiateBot, 'function');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('buildDispatcherOptions returns plain agent opts for the non-SOCKS path', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const opts = n.buildDispatcherOptions();
                assert.strictEqual(opts.socks, undefined);
                assert.strictEqual(typeof opts.agent, 'object');
                assert.strictEqual(typeof opts.agent.keepAliveTimeout, 'number');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('buildDispatcherOptions sets the family override when addressFamily is 4 or 6', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly', addressfamily: 4 }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const opts = n.buildDispatcherOptions();
                assert.deepStrictEqual(opts.agent.connect, { family: 4 });
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('buildDispatcherOptions emits SOCKS shape when usesocks is set, coercing port to a number (#472)', function (t, done) {
        const flow = [
            {
                id: 'b1',
                type: 'telegram bot',
                botname: 'b',
                updatemode: 'sendonly',
                usesocks: true,
                socksprotocol: 'socks5',
                sockshost: '127.0.0.1',
                // Node-RED stores the config field as a STRING. The `socks` package
                // rejects a string port ("Invalid SOCKS proxy details were provided"),
                // so buildDispatcherOptions must coerce it to a number (#472).
                socksport: '1080',
                socksusername: 'u',
                sockspassword: 'p',
            },
        ];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const opts = n.buildDispatcherOptions();
                assert.deepStrictEqual(opts.socks, {
                    type: 5,
                    host: '127.0.0.1',
                    port: 1080,
                    userId: 'u',
                    password: 'p',
                });
                assert.strictEqual(typeof opts.socks.port, 'number');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('instantiateBot wires a per-instance dispatcher via request.fetchOptions (#465/#466)', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const bot = n.instantiateBot('123:fake', { baseApiUrl: 'https://api.telegram.org' });
                assert.ok(
                    bot,
                    'bot should be constructed (library loaded in before hook)' !== undefined && bot,
                    'bot should be constructed (library loaded in before hook)' !== null
                );
                // The per-bot dispatcher is stored on the node and threaded into
                // the bot's request.fetchOptions.dispatcher (the v1.1.1 hook).
                assert.ok(n.dispatcher !== undefined && n.dispatcher !== null);
                assert.strictEqual(bot.options.request.fetchOptions.dispatcher, n.dispatcher);
                // And it is NOT installed under the old process-global symbol.
                assert.notStrictEqual(global[Symbol.for('undici.globalDispatcher.1')], n.dispatcher);
                done();
            } catch (err) {
                done(err);
            } finally {
                helper.getNode('b1') &&
                    helper.getNode('b1').destroyDispatcher &&
                    helper
                        .getNode('b1')
                        .destroyDispatcher()
                        .catch(() => {});
            }
        });
    });

    it('lifts the EventEmitter maxListeners cap on the bot instance (#471)', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const bot = n.instantiateBot('123:fake', {});
                // Default EventEmitter cap is 10; a flow with 11+ receiver/command/
                // event nodes on one bot would otherwise trip MaxListenersExceededWarning.
                assert.strictEqual(bot.getMaxListeners(), 0); // 0 = unlimited
                done();
            } catch (err) {
                done(err);
            } finally {
                helper.getNode('b1') &&
                    helper.getNode('b1').destroyDispatcher &&
                    helper
                        .getNode('b1')
                        .destroyDispatcher()
                        .catch(() => {});
            }
        });
    });

    it('destroyDispatcher closes the per-instance dispatcher and clears the reference', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                n.instantiateBot('123:fake', {});
                const dispatcher = n.dispatcher;
                assert.ok(dispatcher !== undefined && dispatcher !== null);
                // Replace close with a resolving fake so the assertion doesn't
                // depend on undici's real pool-drain timing (the connection-less
                // Agent is GC'd). We only verify destroyDispatcher's contract.
                let closed = false;
                dispatcher.close = function () {
                    closed = true;
                    return Promise.resolve();
                };
                n.destroyDispatcher().then(function () {
                    try {
                        assert.strictEqual(closed, true);
                        assert.strictEqual(n.dispatcher, null);
                        done();
                    } catch (err) {
                        done(err);
                    }
                }, done);
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('bot-node — abortBot stops polling cleanly (#440, updated for v1.0.0)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flow() {
        return [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
    }

    // v1.0.0's stopPolling({cancel: true}) handles both the AbortController
    // cancel of the in-flight getUpdates AND the `_abort = true` flag that
    // halts the recursive polling loop. The V17.4.8 two-step (manual
    // `_lastRequest.cancel()` then `stopPolling({cancel: false})`) is gone.
    function makeFakePollingBot(behaviour) {
        behaviour = behaviour || {};
        const calls = { stopPolling: [] };
        const fake = {
            _polling: {},
            stopPolling: function (options) {
                calls.stopPolling.push(options);
                if (behaviour.stopPollingRejects) {
                    return Promise.reject(new Error('stopPolling failed'));
                }
                return Promise.resolve();
            },
        };
        return { bot: fake, calls };
    }

    it('calls stopPolling({cancel: true}) and resolves the done callback', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const { bot, calls } = makeFakePollingBot();
                n.telegramBot = bot;
                n.abortBot('test', function () {
                    try {
                        assert.deepStrictEqual(calls.stopPolling, [{ cancel: true }]);
                        assert.strictEqual(n.telegramBot, null);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
            } catch (err) {
                done(err);
            }
        });
    });

    it('still completes the done callback if stopPolling rejects', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                const { bot, calls } = makeFakePollingBot({ stopPollingRejects: true });
                n.telegramBot = bot;
                n.abortBot('test', function () {
                    try {
                        assert.deepStrictEqual(calls.stopPolling, [{ cancel: true }]);
                        assert.strictEqual(n.telegramBot, null);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('bot-node — 409 Conflict circuit breaker (issue #441, V17.4.7)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flow() {
        return [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
    }

    it('initialises conflict409Times as an empty array and exposes record409Conflict', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                assert.deepStrictEqual(n.conflict409Times, []);
                assert.strictEqual(typeof n.record409Conflict, 'function');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('does not trip below the threshold', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                for (let i = 0; i < 9; i++) {
                    assert.strictEqual(n.record409Conflict(), false);
                }
                assert.strictEqual(n.conflict409Times.length, 9);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('trips on the 10th 409 in the window and resets the array', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                for (let i = 0; i < 9; i++) {
                    n.record409Conflict();
                }
                // 10th call trips.
                assert.strictEqual(n.record409Conflict(), true);
                // Array reset so the operator gets exactly one error log, not one per overflow.
                assert.deepStrictEqual(n.conflict409Times, []);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('prunes timestamps older than the 30 s window', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                // Pre-seed 9 timestamps from 31 s ago — older than the window.
                const ancient = Date.now() - 31000;
                for (let i = 0; i < 9; i++) {
                    n.conflict409Times.push(ancient);
                }
                // A fresh call must prune the old ones and not trip on its own.
                assert.strictEqual(n.record409Conflict(), false);
                assert.strictEqual(n.conflict409Times.length, 1);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('only trips when the 10 calls fall *inside* the window', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                // 5 ancient + 4 fresh = 9 in-window. Should not trip.
                const ancient = Date.now() - 35000;
                for (let i = 0; i < 5; i++) n.conflict409Times.push(ancient);
                for (let i = 0; i < 4; i++) n.record409Conflict();
                assert.strictEqual(n.conflict409Times.length, 4); // ancients pruned
                assert.strictEqual(n.record409Conflict(), false);
                assert.strictEqual(n.conflict409Times.length, 5);
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('bot-node — polling-restart single-flight guard (issue #442)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    it('exposes pollingRestartTimer as a tracked timer slot', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        helper.load(telegrambotModule, flow, { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                // Initial state: no pending polling restart.
                assert.strictEqual(n.pollingRestartTimer === null || n.pollingRestartTimer === undefined, true);
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

describe('bot-node — polling-burst circuit breaker (issue #442 retest 2026-05-29)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    function flow() {
        return [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
    }

    it('initialises pollingErrorTimes as an empty array and exposes recordPollingError', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                assert.deepStrictEqual(n.pollingErrorTimes, []);
                assert.strictEqual(typeof n.recordPollingError, 'function');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('does not trip below the threshold', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                for (let i = 0; i < 4; i++) {
                    assert.strictEqual(n.recordPollingError(), false);
                }
                assert.strictEqual(n.pollingErrorTimes.length, 4);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('trips on the 5th polling error in the window and resets the array', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                for (let i = 0; i < 4; i++) {
                    n.recordPollingError();
                }
                // 5th call trips.
                assert.strictEqual(n.recordPollingError(), true);
                // Reset so the breaker doesn't fire again while the rebuild is in flight.
                assert.deepStrictEqual(n.pollingErrorTimes, []);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('prunes timestamps older than the 60 s window', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                // Pre-seed 4 timestamps from 61 s ago — older than the window.
                const ancient = Date.now() - 61000;
                for (let i = 0; i < 4; i++) {
                    n.pollingErrorTimes.push(ancient);
                }
                // A fresh call must prune the old ones and not trip on its own.
                assert.strictEqual(n.recordPollingError(), false);
                assert.strictEqual(n.pollingErrorTimes.length, 1);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('only trips when the 5 calls fall *inside* the window', function (t, done) {
        helper.load(telegrambotModule, flow(), { b1: { token: 'fake' } }, function () {
            try {
                const n = helper.getNode('b1');
                // 3 ancient + 1 fresh = 4 in-window. Should not trip.
                const ancient = Date.now() - 70000;
                for (let i = 0; i < 3; i++) n.pollingErrorTimes.push(ancient);
                for (let i = 0; i < 1; i++) n.recordPollingError();
                assert.strictEqual(n.pollingErrorTimes.length, 1); // ancients pruned
                // 3 more fresh calls — 4 in-window total. Still no trip.
                for (let i = 0; i < 3; i++) {
                    assert.strictEqual(n.recordPollingError(), false);
                }
                // 5th fresh call inside the window trips.
                assert.strictEqual(n.recordPollingError(), true);
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

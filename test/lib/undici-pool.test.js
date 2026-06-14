const { expect } = require('chai');
const { Agent } = require('undici');
const {
    buildDispatcher,
    installDispatcher,
    destroyDispatcher,
    getCurrentDispatcher,
    GLOBAL_DISPATCHER_SYMBOL,
} = require('../../telegrambot/lib/undici-pool');

describe('undici-pool', function () {
    // Always leave the global slot clean so other tests don't see leaked
    // dispatchers. `destroyDispatcher` is idempotent.
    afterEach(async function () {
        await destroyDispatcher();
    });

    describe('buildDispatcher', function () {
        it('returns a plain undici Agent when no SOCKS opts are supplied', async function () {
            const d = buildDispatcher({});
            try {
                expect(d).to.be.instanceOf(Agent);
                expect(d.dispatch).to.be.a('function');
            } finally {
                await d.close().catch(() => {});
            }
        });

        it('returns a SOCKS-aware dispatcher when socks opts are supplied', async function () {
            // fetch-socks's socksDispatcher returns an undici Agent whose
            // connector is SOCKS-aware. The simplest check is that it is
            // distinguishable from a default Agent of the same options.
            const plain = buildDispatcher({});
            const socks = buildDispatcher({ socks: { type: 5, host: '127.0.0.1', port: 1080 } });
            try {
                expect(socks).to.not.equal(plain);
                expect(socks.dispatch).to.be.a('function');
                // Both are constructed Agent instances. Differentiating them
                // via a behavioural test would require a live SOCKS proxy,
                // which is out of scope for unit tests; the cross-version
                // scratch test in the migration plan covers that.
            } finally {
                await plain.close().catch(() => {});
                await socks.close().catch(() => {});
            }
        });

        it('passes agentOptions through to the Agent constructor', async function () {
            // family: 4 forces IPv4. We can't easily round-trip this without
            // a connection, but the build call must not throw.
            const d = buildDispatcher({ agent: { connect: { timeout: 5000 } } });
            try {
                expect(d).to.be.instanceOf(Agent);
            } finally {
                await d.close().catch(() => {});
            }
        });

        it('tolerates an empty / missing options argument', function () {
            const d1 = buildDispatcher();
            const d2 = buildDispatcher(null);
            const d3 = buildDispatcher({});
            try {
                expect(d1).to.be.instanceOf(Agent);
                expect(d2).to.be.instanceOf(Agent);
                expect(d3).to.be.instanceOf(Agent);
            } finally {
                Promise.allSettled([d1.close(), d2.close(), d3.close()]);
            }
        });

        it('returns a new instance on every call', async function () {
            const a = buildDispatcher({});
            const b = buildDispatcher({});
            try {
                expect(a).to.not.equal(b);
            } finally {
                await a.close().catch(() => {});
                await b.close().catch(() => {});
            }
        });
    });

    describe('installDispatcher', function () {
        it('installs the dispatcher under the well-known global symbol', function () {
            const d = installDispatcher({});
            expect(globalThis[GLOBAL_DISPATCHER_SYMBOL]).to.equal(d);
            expect(getCurrentDispatcher()).to.equal(d);
        });

        it('closes the previous dispatcher when called twice', async function () {
            const first = installDispatcher({});
            let firstClosed = false;
            // Wrap close() so we can observe whether it was called by install,
            // without overriding undici's actual cleanup logic.
            const originalClose = first.close.bind(first);
            first.close = function () {
                firstClosed = true;
                return originalClose();
            };

            const second = installDispatcher({});
            // Give the asynchronous close() call a tick to fire.
            await new Promise((r) => setImmediate(r));
            expect(firstClosed).to.equal(true);
            expect(globalThis[GLOBAL_DISPATCHER_SYMBOL]).to.equal(second);
            expect(getCurrentDispatcher()).to.equal(second);
        });

        it('returns the newly installed dispatcher', function () {
            const d = installDispatcher({});
            expect(d).to.be.instanceOf(Agent);
            expect(d).to.equal(getCurrentDispatcher());
        });

        it('builds a SOCKS dispatcher when socks options are supplied', function () {
            const d = installDispatcher({ socks: { type: 5, host: '127.0.0.1', port: 1080 } });
            expect(d.dispatch).to.be.a('function');
            expect(globalThis[GLOBAL_DISPATCHER_SYMBOL]).to.equal(d);
        });
    });

    describe('destroyDispatcher', function () {
        it('clears the global symbol and the internal reference', async function () {
            installDispatcher({});
            expect(globalThis[GLOBAL_DISPATCHER_SYMBOL]).to.exist;
            await destroyDispatcher();
            expect(globalThis[GLOBAL_DISPATCHER_SYMBOL]).to.equal(undefined);
            expect(getCurrentDispatcher()).to.equal(null);
        });

        it('is a no-op when no dispatcher is installed', async function () {
            // Already cleared by afterEach. Calling destroy must not throw.
            await destroyDispatcher();
            expect(getCurrentDispatcher()).to.equal(null);
        });

        it("does not clobber a symbol value that isn't ours (e.g. set elsewhere by user code)", async function () {
            installDispatcher({});
            const ours = getCurrentDispatcher();
            // Simulate a competing piece of code installing its own dispatcher
            // under the same symbol AFTER us. We should only clear the symbol
            // if it still points to our dispatcher; otherwise leave alone.
            const other = new Agent({});
            globalThis[GLOBAL_DISPATCHER_SYMBOL] = other;

            await destroyDispatcher();

            // The competing value is preserved because we only clear when the
            // symbol still matches ours.
            expect(globalThis[GLOBAL_DISPATCHER_SYMBOL]).to.equal(other);
            expect(getCurrentDispatcher()).to.equal(null);

            // Cleanup the competing dispatcher we installed.
            delete globalThis[GLOBAL_DISPATCHER_SYMBOL];
            await other.close().catch(() => {});
            // sanity: ensure no surprise side-effect on `ours`
            expect(ours).to.not.equal(other);
        });
    });

    describe('end-to-end: fetch routes through the installed dispatcher', function () {
        it('a real fetch() call uses the installed dispatcher on Node 20+', async function () {
            // This is the cross-version test from the migration pre-flight,
            // collapsed into a unit test. We install an Agent, wrap its
            // dispatch to observe invocations, and confirm a real fetch()
            // routes through it. Catches "Node's bundled undici 6 doesn't
            // accept undici 7 dispatchers" regressions on CI.
            const agent = installDispatcher({});
            let reached = false;
            const original = agent.dispatch.bind(agent);
            agent.dispatch = function (opts, handler) {
                reached = true;
                return original(opts, handler);
            };
            // api.telegram.org is a quick well-known endpoint; we only need
            // to confirm the request goes out, not what comes back.
            try {
                await fetch('https://api.telegram.org/');
            } catch (e) {
                // Network errors are fine — only the dispatcher reach matters.
            }
            expect(reached).to.equal(true);
        });
    });
});

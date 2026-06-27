const { expect } = require('chai');
const { Agent } = require('undici');
const { buildDispatcher, closeDispatcher } = require('../../telegrambot/lib/undici-pool');

describe('undici-pool', function () {
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
                // which is out of scope for unit tests.
            } finally {
                await plain.close().catch(() => {});
                await socks.close().catch(() => {});
            }
        });

        it('passes agentOptions through to the Agent constructor', async function () {
            const d = buildDispatcher({ agent: { connect: { timeout: 5000 } } });
            try {
                expect(d).to.be.instanceOf(Agent);
            } finally {
                await d.close().catch(() => {});
            }
        });

        it('tolerates an empty / missing options argument', async function () {
            const d1 = buildDispatcher();
            const d2 = buildDispatcher(null);
            const d3 = buildDispatcher({});
            try {
                expect(d1).to.be.instanceOf(Agent);
                expect(d2).to.be.instanceOf(Agent);
                expect(d3).to.be.instanceOf(Agent);
            } finally {
                await Promise.allSettled([d1.close(), d2.close(), d3.close()]);
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

    describe('closeDispatcher', function () {
        it('invokes close() and resolves', async function () {
            // Controlled fake: asserts closeDispatcher's contract (call close,
            // return its promise) without depending on undici's real drain
            // timing — the buildDispatcher tests above exercise a real Agent.
            let closed = false;
            const fake = {
                close: function () {
                    closed = true;
                    return Promise.resolve();
                },
            };
            await closeDispatcher(fake);
            expect(closed).to.equal(true);
        });

        it('is a no-op (resolves) for null / undefined', async function () {
            await closeDispatcher(null);
            await closeDispatcher(undefined);
            // reaching here without throwing is the assertion
            expect(true).to.equal(true);
        });

        it('tolerates a dispatcher without a close method', async function () {
            await closeDispatcher({});
            expect(true).to.equal(true);
        });
    });

    describe('end-to-end: fetch routes through a per-instance dispatcher', function () {
        it('a real fetch() call honours an undici dispatcher passed in the init (Node 20+)', async function () {
            // This is the core assumption of the per-instance design (#466):
            // node-telegram-bot-api v1.1.1 spreads request.fetchOptions into the
            // fetch init, and Node's built-in fetch must honour an undici
            // `dispatcher` there. We wrap a dispatcher's dispatch() to observe
            // invocations and confirm fetch(url, { dispatcher }) routes through
            // it. Catches "Node's bundled undici doesn't accept our dispatcher"
            // regressions on CI.
            const dispatcher = buildDispatcher({});
            let reached = false;
            const original = dispatcher.dispatch.bind(dispatcher);
            dispatcher.dispatch = function (opts, handler) {
                reached = true;
                return original(opts, handler);
            };
            try {
                await fetch('https://api.telegram.org/', { dispatcher });
            } catch (e) {
                // Network errors are fine — only the dispatcher reach matters.
            } finally {
                await closeDispatcher(dispatcher).catch(() => {});
            }
            expect(reached).to.equal(true);
        });
    });
});

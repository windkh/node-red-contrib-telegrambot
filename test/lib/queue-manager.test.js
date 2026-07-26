const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const QueueManager = require('../../telegrambot/lib/queue-manager');

describe('lib/queue-manager', function () {
    let qm;

    beforeEach(function () {
        qm = new QueueManager();
    });

    describe('ordering', function () {
        it('runs single-chat handlers in submission order', function (t, done) {
            const order = [];
            qm.enqueue(1, function () {
                order.push('a');
                qm.processNext(1);
            });
            qm.enqueue(1, function () {
                order.push('b');
                qm.processNext(1);
            });
            qm.enqueue(1, function () {
                order.push('c');
                qm.processNext(1);
            });
            // All handlers in this test are synchronous; once the last has
            // called processNext, the queue is drained.
            setImmediate(function () {
                assert.deepStrictEqual(order, ['a', 'b', 'c']);
                done();
            });
        });

        it('serializes handlers per chat — a slow head does not let the tail jump ahead', function (t, done) {
            const order = [];
            qm.enqueue(1, function () {
                // simulate async work — release after a tick
                setImmediate(function () {
                    order.push('slow-a');
                    qm.processNext(1);
                });
            });
            qm.enqueue(1, function () {
                order.push('b');
                qm.processNext(1);
            });
            // Give the macrotask time to run both
            setTimeout(function () {
                assert.deepStrictEqual(order, ['slow-a', 'b']);
                done();
            }, 20);
        });
    });

    describe('parallelism across chats', function () {
        it('different chats are independent — a stuck head on one does not block another', function () {
            const seen = [];
            // chat 1's handler never calls processNext => its queue stays "in flight"
            qm.enqueue(1, function () {
                seen.push('chat-1');
                // intentionally no processNext
            });
            // chat 2 should still process normally
            qm.enqueue(2, function () {
                seen.push('chat-2');
                qm.processNext(2);
            });
            assert.deepStrictEqual(seen, ['chat-1', 'chat-2']);
        });
    });

    describe('synchronous-throw resilience', function () {
        it('drains the head and continues to the next message if a handler throws sync', function (t, done) {
            const order = [];
            try {
                qm.enqueue(1, function () {
                    throw new Error('boom');
                });
            } catch (err) {
                // queue-manager re-throws so the caller sees the error
                assert.strictEqual(err.message, 'boom');
            }
            qm.enqueue(1, function () {
                order.push('after-boom');
                qm.processNext(1);
            });
            // The recovery advance is via setImmediate, so wait one tick.
            setImmediate(function () {
                assert.deepStrictEqual(order, ['after-boom']);
                done();
            });
        });

        // NOTE: a "many consecutive throws" stress test was attempted here and exposed a
        // real defect — the re-throw inside the setImmediate-driven advance path escapes
        // uncaught, because only the *direct* caller of processCurrent gets the try/catch.
        // Tracking that separately in errors-and-weaknesses.md; once fixed, a test along
        // those lines should land here.
    });

    describe('retry via repeatProcessMessage', function () {
        it('re-runs the current head after the requested delay', function (t, done) {
            let calls = 0;
            qm.enqueue(1, function () {
                calls++;
                if (calls === 1) {
                    // simulate "got 429 — retry after 0.05 s"
                    qm.repeatProcessMessage(1, 0.05);
                    // note: we do NOT call processNext — the head stays at the same func
                } else {
                    qm.processNext(1);
                }
            });
            setTimeout(function () {
                assert.strictEqual(calls, 2);
                done();
            }, 150);
        });
    });

    describe('clear', function () {
        it('drops all queues and processing flags', function () {
            qm.enqueue(1, function () {});
            qm.enqueue(2, function () {});
            qm.clear();
            assert.strictEqual(qm.queues.size, 0);
            assert.strictEqual(qm.processing.size, 0);
        });
    });
});

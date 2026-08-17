'use strict';

// A minimal Node-RED runtime stand-in for unit tests.
//
// Node files (`nodes/*.js`) export `function (RED) { ... }`, so their contents are unreachable
// without a RED object — which is why they tend to sit at 0% coverage while the logic extracted
// out of them is well covered. What stays behind is not trivial: input dispatch, error handling,
// status reporting and the request the node actually issues.
//
// This is deliberately not `node-red-node-test-helper`. That helper starts a real runtime and
// suits flow-level wiring tests; this is ~50 lines, starts nothing, and lets a single node be
// instantiated and driven so its HTTP calls can be intercepted with nock and asserted against
// the device or service API.
//
//   const server = makeFakeConfigNode({ ... });          // whatever the node reads off it
//   const harness = makeFakeRed(server);
//   const MyNode = require('../../nodes/my-node.js')(harness.RED);
//   new MyNode({ server: 'server-id', hostname: 'device.test' });
//   await harness.send({ payload: { ... } });
//   assert.equal(harness.errors.length, 0);
//
// Every status/warn/error/send the node performs is captured, so a test asserts on what the
// node tried to do rather than on internals.
function makeFakeRed(configNode) {
    const statuses = [];
    const warnings = [];
    const errors = [];
    const sends = [];

    let inputHandler;
    let closeHandler;

    const RED = {
        nodes: {
            createNode: function (node) {
                node.status = (s) => statuses.push(s);
                node.warn = (m) => warnings.push(m);
                // Node-RED passes the msg as a second argument so catch nodes can handle it;
                // keep both so a test can assert the message was forwarded.
                node.error = (m, msg) => errors.push({ message: m, msg: msg });
                node.send = (m) => sends.push(m);
                node.on = function (event, handler) {
                    if (event === 'input') {
                        inputHandler = handler;
                    } else if (event === 'close') {
                        closeHandler = handler;
                    }
                };
            },
            getNode: function () {
                return configNode;
            },
            registerType: function () {},
        },
        // Present because node files commonly reach for these at require time.
        httpAdmin: { get: function () {}, post: function () {} },
        log: { info: function () {}, warn: function () {}, error: function () {} },
    };

    return {
        RED: RED,
        statuses: statuses,
        warnings: warnings,
        errors: errors,
        sends: sends,
        // Feeds a message through the node's input handler. Await it: the handler is async in
        // most nodes, and without awaiting the assertions run before the request completes.
        send: function (msg) {
            return inputHandler(msg);
        },
        // Drives the close handler so teardown (timers cleared, listeners removed) is testable.
        close: function () {
            return new Promise((resolve) => closeHandler(resolve));
        },
    };
}

module.exports = { makeFakeRed };

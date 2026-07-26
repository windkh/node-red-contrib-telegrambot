const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const helper = require('node-red-node-test-helper');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram bot (config node)', function () {
    before(function (t, done) {
        helper.startServer(done);
    });

    after(function (t, done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    it('registers under the "telegram bot" type and exposes the expected methods', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'test-bot', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                assert.ok(n !== undefined && n !== null);
                assert.strictEqual(n.type, 'telegram bot');
                assert.strictEqual(n.botname, 'test-bot');
                // Methods that other nodes depend on:
                assert.strictEqual(typeof n.getTelegramBot, 'function');
                assert.strictEqual(typeof n.isAuthorized, 'function');
                assert.strictEqual(typeof n.registerCommand, 'function');
                assert.strictEqual(typeof n.unregisterCommand, 'function');
                assert.strictEqual(typeof n.start, 'function');
                assert.strictEqual(typeof n.stop, 'function');
                assert.strictEqual(typeof n.abortBot, 'function');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('applies pollInterval / publicBotPort defaults when fields are blank', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(n.pollInterval, 300);
                assert.strictEqual(n.publicBotPort, 8443);
                assert.strictEqual(n.localBotPort, 8443);
                assert.strictEqual(n.localBotHost, '0.0.0.0');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('honours explicit pollInterval / port config values', function (t, done) {
        const flow = [
            {
                id: 'b1',
                type: 'telegram bot',
                botname: 'b',
                updatemode: 'sendonly',
                pollinterval: '500',
                publicbotport: '9443',
                localbotport: '9999',
                localbothost: '127.0.0.1',
            },
        ];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(n.pollInterval, 500);
                assert.strictEqual(n.publicBotPort, 9443);
                assert.strictEqual(n.localBotPort, 9999);
                assert.strictEqual(n.localBotHost, '127.0.0.1');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('isAuthorized returns true when both allowlists are empty (default open)', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(n.isAuthorized(n, 42, 100, 'alice'), true);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('isAuthorized denies unknown user when usernames is set', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly', usernames: 'alice,bob' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(n.isAuthorized(n, 42, 100, 'alice'), true);
                assert.strictEqual(n.isAuthorized(n, 42, 100, 'carol'), false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('isAuthorized denies unknown chat when chatids is set', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly', chatids: '11,22' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(n.isAuthorized(n, 11, undefined, undefined), true);
                assert.strictEqual(n.isAuthorized(n, 99, undefined, undefined), false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('command-state helpers track per (user, chat) pending command', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(n.isCommandPending('/x', 'alice', 1), false);
                n.setCommandPending('/x', 'alice', 1);
                assert.strictEqual(n.isCommandPending('/x', 'alice', 1), true);
                // Different chat: no pending
                assert.strictEqual(n.isCommandPending('/x', 'alice', 2), false);
                // Different user: no pending
                assert.strictEqual(n.isCommandPending('/x', 'bob', 1), false);
                n.resetCommandPending('/x', 'alice', 1);
                assert.strictEqual(n.isCommandPending('/x', 'alice', 1), false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('registerCommand / unregisterCommand / isCommandRegistered round-trip', function (t, done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                assert.strictEqual(n.isCommandRegistered('/hello'), false);
                n.registerCommand('node-x', '/hello', 'desc', 'en', 'default', true);
                assert.strictEqual(n.isCommandRegistered('/hello'), true);
                n.unregisterCommand('node-x');
                assert.strictEqual(n.isCommandRegistered('/hello'), false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('coerces n.verboselogging to a strict boolean (issue #411, V17.4.6)', function () {
        // Run cases sequentially via promise chain so each load/unload completes
        // before the next starts — interleaved helper.load calls collide.
        const cases = [
            { input: true, expected: true },
            { input: false, expected: false },
            { input: undefined, expected: false },
            { input: 'true', expected: true },
            { input: 'false', expected: false },
            { input: 'on', expected: true },
            { input: '', expected: false },
        ];
        return cases.reduce(function (chain, tc) {
            return chain.then(function () {
                const flow = [
                    {
                        id: 'b1',
                        type: 'telegram bot',
                        botname: 'b',
                        updatemode: 'sendonly',
                        verboselogging: tc.input,
                    },
                ];
                return new Promise(function (resolve, reject) {
                    helper.load(telegrambotModule, flow, { b1: { token: 'tok' } }, function () {
                        try {
                            const n = helper.getNode('b1');
                            assert.strictEqual(n.verbose, tc.expected,
                                'input ' + JSON.stringify(tc.input) + ' should coerce to ' + tc.expected);
                            helper.unload().then(resolve, reject);
                        } catch (err) {
                            helper.unload().finally(function () {
                                reject(err);
                            });
                        }
                    });
                });
            });
        }, Promise.resolve());
    });

    it('refuses to register two bot configs with the same token', function (t, done) {
        const flow = [
            { id: 'b1', type: 'telegram bot', botname: 'first', updatemode: 'sendonly' },
            { id: 'b2', type: 'telegram bot', botname: 'second', updatemode: 'sendonly' },
        ];
        const creds = { b1: { token: 'shared-token' }, b2: { token: 'shared-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n1 = helper.getNode('b1');
                const n2 = helper.getNode('b2');
                assert.strictEqual(n1.tokenRegistered, true);
                // The second node should have aborted with tokenRegistered=false.
                assert.strictEqual(n2.tokenRegistered, false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

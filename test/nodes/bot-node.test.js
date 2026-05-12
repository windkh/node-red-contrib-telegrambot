const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const telegrambotModule = require('../../telegrambot/99-telegrambot.js');

helper.init(require.resolve('node-red'));

describe('telegram bot (config node)', function () {
    before(function (done) {
        helper.startServer(done);
    });

    after(function (done) {
        helper.stopServer(done);
    });

    afterEach(function () {
        helper.unload();
    });

    it('registers under the "telegram bot" type and exposes the expected methods', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'test-bot', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                expect(n).to.exist;
                expect(n.type).to.equal('telegram bot');
                expect(n.botname).to.equal('test-bot');
                // Methods that other nodes depend on:
                expect(n.getTelegramBot).to.be.a('function');
                expect(n.isAuthorized).to.be.a('function');
                expect(n.registerCommand).to.be.a('function');
                expect(n.unregisterCommand).to.be.a('function');
                expect(n.start).to.be.a('function');
                expect(n.stop).to.be.a('function');
                expect(n.abortBot).to.be.a('function');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('applies pollInterval / publicBotPort defaults when fields are blank', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                expect(n.pollInterval).to.equal(300);
                expect(n.publicBotPort).to.equal(8443);
                expect(n.localBotPort).to.equal(8443);
                expect(n.localBotHost).to.equal('0.0.0.0');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('honours explicit pollInterval / port config values', function (done) {
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
                expect(n.pollInterval).to.equal(500);
                expect(n.publicBotPort).to.equal(9443);
                expect(n.localBotPort).to.equal(9999);
                expect(n.localBotHost).to.equal('127.0.0.1');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('isAuthorized returns true when both allowlists are empty (default open)', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                expect(n.isAuthorized(n, 42, 100, 'alice')).to.equal(true);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('isAuthorized denies unknown user when usernames is set', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly', usernames: 'alice,bob' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                expect(n.isAuthorized(n, 42, 100, 'alice')).to.equal(true);
                expect(n.isAuthorized(n, 42, 100, 'carol')).to.equal(false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('isAuthorized denies unknown chat when chatids is set', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly', chatids: '11,22' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                expect(n.isAuthorized(n, 11, undefined, undefined)).to.equal(true);
                expect(n.isAuthorized(n, 99, undefined, undefined)).to.equal(false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('command-state helpers track per (user, chat) pending command', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                expect(n.isCommandPending('/x', 'alice', 1)).to.equal(false);
                n.setCommandPending('/x', 'alice', 1);
                expect(n.isCommandPending('/x', 'alice', 1)).to.equal(true);
                // Different chat: no pending
                expect(n.isCommandPending('/x', 'alice', 2)).to.equal(false);
                // Different user: no pending
                expect(n.isCommandPending('/x', 'bob', 1)).to.equal(false);
                n.resetCommandPending('/x', 'alice', 1);
                expect(n.isCommandPending('/x', 'alice', 1)).to.equal(false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('registerCommand / unregisterCommand / isCommandRegistered round-trip', function (done) {
        const flow = [{ id: 'b1', type: 'telegram bot', botname: 'b', updatemode: 'sendonly' }];
        const creds = { b1: { token: 'fake-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n = helper.getNode('b1');
                expect(n.isCommandRegistered('/hello')).to.equal(false);
                n.registerCommand('node-x', '/hello', 'desc', 'en', 'default', true);
                expect(n.isCommandRegistered('/hello')).to.equal(true);
                n.unregisterCommand('node-x');
                expect(n.isCommandRegistered('/hello')).to.equal(false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('refuses to register two bot configs with the same token', function (done) {
        const flow = [
            { id: 'b1', type: 'telegram bot', botname: 'first', updatemode: 'sendonly' },
            { id: 'b2', type: 'telegram bot', botname: 'second', updatemode: 'sendonly' },
        ];
        const creds = { b1: { token: 'shared-token' }, b2: { token: 'shared-token' } };
        helper.load(telegrambotModule, flow, creds, function () {
            try {
                const n1 = helper.getNode('b1');
                const n2 = helper.getNode('b2');
                expect(n1.tokenRegistered).to.equal(true);
                // The second node should have aborted with tokenRegistered=false.
                expect(n2.tokenRegistered).to.equal(false);
                done();
            } catch (err) {
                done(err);
            }
        });
    });
});

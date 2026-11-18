const { describe, it } = require('node:test');
const assert = require('node:assert');
const { stopTransport } = require('../../telegrambot/lib/stop-transport');

function makeWebhookBot(behaviour) {
    const calls = [];
    const bot = {
        _webHook: {},
        deleteWebhook: function () {
            calls.push('deleteWebhook');
            return behaviour.deleteRejects ? Promise.reject(new Error('delete failed')) : Promise.resolve(true);
        },
        closeWebHook: function () {
            calls.push('closeWebHook');
            return behaviour.closeRejects ? Promise.reject(new Error('close failed')) : Promise.resolve();
        },
    };
    return { bot, calls };
}

describe('stopTransport', function () {
    it('stops polling with cancel: true', async function () {
        const calls = [];
        const bot = {
            _polling: {},
            stopPolling: function (options) {
                calls.push(options);
                return Promise.resolve();
            },
        };
        await stopTransport(bot);
        assert.deepStrictEqual(calls, [{ cancel: true }]);
    });

    it('resolves when stopPolling rejects', async function () {
        const bot = {
            _polling: {},
            stopPolling: function () {
                return Promise.reject(new Error('stop failed'));
            },
        };
        await stopTransport(bot);
    });

    it('deletes the webhook before closing the local listener', async function () {
        const { bot, calls } = makeWebhookBot({});
        await stopTransport(bot);
        assert.deepStrictEqual(calls, ['deleteWebhook', 'closeWebHook']);
    });

    it('still closes the local listener when deleteWebhook rejects', async function () {
        const { bot, calls } = makeWebhookBot({ deleteRejects: true });
        await stopTransport(bot);
        assert.deepStrictEqual(calls, ['deleteWebhook', 'closeWebHook']);
    });

    it('resolves when closeWebHook rejects', async function () {
        const { bot, calls } = makeWebhookBot({ closeRejects: true });
        await stopTransport(bot);
        assert.deepStrictEqual(calls, ['deleteWebhook', 'closeWebHook']);
    });

    it('resolves immediately for a send-only bot', async function () {
        await stopTransport({});
    });
});

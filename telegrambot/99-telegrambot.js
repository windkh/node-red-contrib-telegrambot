// Created by Karl-Heinz Wind

// node-telegram-bot-api v1.0.0 uses native Promises (Bluebird was dropped
// together with the legacy `request` HTTP layer). The historical
// `Bluebird.config({ cancellation: true })` call here is no longer
// applicable; native Promises don't support cancellation and the lib's
// new HTTP layer uses AbortController instead.

module.exports = function (RED) {
    'use strict';

    const pkg = require('./../package.json');
    RED.log.info('node-red-contrib-telegrambot version: v' + pkg.version);

    const TelegramBotNode = require('./nodes/bot-node.js')(RED);
    RED.nodes.registerType('telegram bot', TelegramBotNode, {
        credentials: {
            token: { type: 'text' },
        },
    });

    const TelegramInNode = require('./nodes/in-node.js')(RED);
    RED.nodes.registerType('telegram receiver', TelegramInNode);

    const TelegramCommandNode = require('./nodes/command-node.js')(RED);
    RED.nodes.registerType('telegram command', TelegramCommandNode);

    const TelegramEventNode = require('./nodes/event-node.js')(RED);
    RED.nodes.registerType('telegram event', TelegramEventNode);

    const TelegramOutNode = require('./nodes/out-node.js')(RED);
    RED.nodes.registerType('telegram sender', TelegramOutNode);

    const TelegramReplyNode = require('./nodes/reply-node.js')(RED);
    RED.nodes.registerType('telegram reply', TelegramReplyNode);

    const TelegramControlNode = require('./nodes/control-node.js')(RED);
    RED.nodes.registerType('telegram control', TelegramControlNode);
};

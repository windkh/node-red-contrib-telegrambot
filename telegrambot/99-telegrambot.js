// Created by Karl-Heinz Wind

// Avoid that node-telegram-bot-api will enable automatic promise cancellation (fix for 0.30.0 api)
process.env['NTBA_FIX_319'] = '1';

const Bluebird = require('bluebird');
Bluebird.config({ cancellation: true });

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

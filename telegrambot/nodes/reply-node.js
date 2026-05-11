module.exports = function (RED) {
    const converter = require('../lib/converter.js');

    // --------------------------------------------------------------------------------------------
    // The output node receices the reply for a specified message and passes the msg through.
    // The payload needs three fields
    // chatId        : string destination chat
    // sentMessageId : string the id of the message the reply coresponds to.
    // content : message content
    function TelegramReplyNode(config) {
        RED.nodes.createNode(this, config);
        let node = this;
        this.bot = config.bot;

        // Tracks outstanding onReplyToMessage listener ids so we can clean them up on close.
        // Without this, replies that never arrive (chat deleted, user blocked the bot, etc.)
        // keep the callback closure - and the captured msg / nodeSend / nodeDone - alive
        // for the lifetime of the bot instance.
        this.pendingReplyListenerIds = new Set();

        this.start = function () {
            let telegramBot = this.config.getTelegramBot();
            if (telegramBot) {
                if (telegramBot._polling !== null || telegramBot._webHook !== null) {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'connected',
                    });
                } else {
                    node.status({
                        fill: 'grey',
                        shape: 'ring',
                        text: 'send only mode',
                    });
                }
            } else {
                node.warn('bot not initialized.');
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: 'bot not initialized',
                });
            }
        };

        this.stop = function () {
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            node.status({ fill: 'red', shape: 'ring', text: 'not connected' });
            node.onStatusChanged = function (status, nodeStatus) {
                node.status(nodeStatus);
                switch (status) {
                    case 'started':
                        node.start();
                        break;
                    case 'stopped':
                        node.stop();
                        break;
                    default:
                        break;
                }
            };
            node.config.addListener('status', node.onStatusChanged);

            node.start();
        } else {
            node.warn('config node failed to initialize.');
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'config node failed to initialize',
            });
        }

        this.on('input', function (msg, nodeSend, nodeDone) {
            node.status({ fill: 'green', shape: 'ring', text: 'connected' });

            if (msg.payload) {
                let telegramBot = this.config.getTelegramBot();
                if (telegramBot) {
                    if (msg.payload.chatId) {
                        if (msg.payload.sentMessageId) {
                            let chatId = msg.payload.chatId;
                            let messageId = msg.payload.sentMessageId;

                            let listenerId = telegramBot.onReplyToMessage(chatId, messageId, function (botMsg) {
                                node.pendingReplyListenerIds.delete(listenerId);
                                let messageDetails = converter.getMessageDetails(botMsg);
                                if (messageDetails) {
                                    msg.payload = messageDetails;
                                    msg.originalMessage = botMsg;
                                    nodeSend(msg);
                                }
                                if (nodeDone) {
                                    nodeDone();
                                }
                            });
                            node.pendingReplyListenerIds.add(listenerId);
                        } else {
                            node.warn('msg.payload.sentMessageId is empty');
                        }
                    } else {
                        node.warn('msg.payload.chatId is empty');
                    }
                } else {
                    node.warn('bot not initialized.');
                    node.status({
                        fill: 'red',
                        shape: 'ring',
                        text: 'bot not initialized',
                    });
                }
            } else {
                node.warn('msg.payload is empty');
            }
        });

        this.on('close', function (removed, done) {
            node.stop();

            if (node.onStatusChanged) {
                node.config.removeListener('status', node.onStatusChanged);
            }

            // Drop any reply listeners that never fired so we don't leak the captured msg/nodeSend/nodeDone.
            let telegramBot = node.config && node.config.getTelegramBot ? node.config.getTelegramBot(false) : null;
            if (telegramBot && typeof telegramBot.removeReplyListener === 'function') {
                node.pendingReplyListenerIds.forEach(function (id) {
                    telegramBot.removeReplyListener(id);
                });
            }
            node.pendingReplyListenerIds.clear();

            node.status({});
            done();
        });
    }

    return TelegramReplyNode;
};

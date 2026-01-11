module.exports = function (RED) {
    const fs = require('fs');
    const converter = require('../lib/converter.js<');

    // --------------------------------------------------------------------------------------------
    // The input node receives messages from the chat.
    // the message details are stored in the payload
    // chatId
    // type
    // content
    // depending on type caption and date is part of the output, too.
    // The original message is stored next to payload.
    //
    // The message ist send to output 1 if the message is from an authorized user
    // and to output2 if the message is not from an authorized user.
    //
    // Messages can be injected via the input if an external receiver is used.
    //
    // message : content string
    // photo   : content file_id of first image in array
    // audio   : content file_id
    // document: content file_id of document
    // sticker : content file_id
    // video   : content file_id
    // voice   : content file_id
    // location: content is object with latitude and longitude
    // contact : content is full contact object
    function TelegramInNode(config) {
        RED.nodes.createNode(this, config);
        let node = this;
        this.bot = config.bot;
        node.filterCommands = config.filterCommands || false;

        let hasInput = config.hasinput || false;
        let handleAllUpdates = config.handleallupdates || false;

        const events = [
            'edited_message',
            'channel_post',
            'edited_channel_post',
            'business_connection',
            'business_message',
            'edited_business_message',
            'deleted_business_messages',
            'message_reaction',
            'message_reaction_count',
            'inline_query',
            'chosen_inline_result',
            'callback_query',
            'shipping_query',
            'pre_checkout_query',
            'poll',
            'poll_answer',
            'my_chat_member',
            'chat_member',
            'chat_join_request',
            'chat_boost',
            'removed_chat_boost',
        ];

        this.start = function () {
            let telegramBot = this.config.getTelegramBot();
            if (telegramBot) {
                // Before starting we check if the download dir really exists.
                if (config.saveDataDir && !fs.existsSync(config.saveDataDir)) {
                    node.warn('The configured download directory does not exist: ' + config.saveDataDir);
                    node.status({
                        fill: 'red',
                        shape: 'ring',
                        text: 'download dir not accessible',
                    });
                } else {
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

                    telegramBot.on('message', (botMsg) => this.processMessage('message', botMsg));

                    if (handleAllUpdates) {
                        events.forEach((event) => {
                            telegramBot.on(event, (botMsg) => this.processMessage(event, botMsg));
                        });
                    }
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
            let telegramBot = this.config.getTelegramBot();
            if (telegramBot) {
                telegramBot.off('message');

                if (handleAllUpdates) {
                    events.forEach((event) => {
                        telegramBot.off(event);
                    });
                }
            }

            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.processMessage = function (type, botMsg) {
            node.status({
                fill: 'green',
                shape: 'ring',
                text: 'connected',
            });

            let userInfo = converter.getUserInfo(botMsg);
            let username = userInfo.username;
            let isAnonymous = userInfo.isAnonymous;
            let chatid = userInfo.chatid;
            let userid = userInfo.userid;

            let messageDetails = converter.convertMessage(type, chatid, botMsg);
            if (messageDetails) {
                let botDetails = {
                    botname: this.config.botname,
                    testEnvironment: this.config.testEnvironment,
                    baseApiUrl: this.config.telegramBot.options.baseApiUrl,
                };

                let msg = {
                    payload: messageDetails,
                    originalMessage: botMsg,
                    telegramBot: botDetails,
                };

                let telegramBot = this.config.getTelegramBot();

                if (isAnonymous || node.config.isAuthorized(node, chatid, userid, username)) {
                    // downloadable "blob" message?
                    if (messageDetails.blob) {
                        let fileId = msg.payload.content;
                        telegramBot.getFileLink(fileId).then(function (weblink) {
                            msg.payload.weblink = weblink;

                            // download and provide with path
                            if (config.saveDataDir) {
                                telegramBot.downloadFile(fileId, config.saveDataDir).then(function (path) {
                                    msg.payload.path = path;
                                    node.send([msg, null]);
                                });
                            } else {
                                node.send([msg, null]);
                            }
                        });
                        // vanilla message
                    } else if (node.filterCommands && node.config.isCommandRegistered(messageDetails.content)) {
                        // Do nothing
                    } else {
                        node.send([msg, null]);
                    }
                } else {
                    if (node.config.verbose) {
                        node.warn('Unauthorized incoming call from ' + username);
                    }
                    node.send([null, msg]);
                }
            }
        };

        // Initializes a new instance of the node:
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

        if (hasInput) {
            // Receives messages from external input like external webhooks.
            // note that the nodeSend, nodeDone arguments are not used!
            this.on('input', function (msg) {
                if (msg.payload) {
                    let telegramBot = this.config.getTelegramBot();
                    if (telegramBot) {
                        let updates;
                        // Check if the result comes from a http node otherwise msg.payload is directly used.
                        if (msg.payload.ok) {
                            if (msg.payload.ok === true) {
                                updates = msg.payload.result;
                            }
                        } else {
                            updates = msg.payload;
                        }

                        if (updates) {
                            if (Array.isArray(updates)) {
                                updates.forEach((update) => {
                                    telegramBot.processUpdate(update);
                                });
                            } else {
                                telegramBot.processUpdate(updates);
                            }
                        } else {
                            node.warn('msg.payload is invalid');
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
        }

        this.on('close', function (removed, done) {
            node.stop();

            if (node.onStatusChanged) {
                node.config.removeListener('status', node.onStatusChanged);
            }

            node.status({});

            done();
        });
    }

    return TelegramInNode;
};

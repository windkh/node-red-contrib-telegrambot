module.exports = function(RED) {
        
        // --------------------------------------------------------------------------------------------
    // The input node receives an event from the chat. See https://core.telegram.org/bots/api#update
    // The type of event can be configured:
    // - edited_message
    // - channel_post
    // - edited_channel_post
    // -  business_connection
    // -  business_message
    // -  edited_business_message
    // -  deleted_business_messages
    // -  message_reaction
    // -  message_reaction_count
    // - inline_query
    // - chosen_inline_result
    // - callback_query
    // - shipping_query
    // - pre_checkout_query
    // -  purchased_paid_media (not available)
    // - poll
    // - poll_answer
    // - my_chat_member
    // - chat_member
    // - chat_join_request
    // -  chat_boost
    // -  removed_chat_boost

    // Only the following are supported by see telegram.js processUpdate
    // - message
    // - edited_message
    // - channel_post;
    // - edited_channel_post;
    // - business_connection;
    // - business_message;
    // - edited_business_message;
    // - update.deleted_business_messages;
    // - message_reaction;
    // - message_reaction_count;
    // - inline_query;
    // - chosen_inline_result;
    // - callback_query;
    // - shipping_query;
    // - pre_checkout_query;
    // - poll;
    // - poll_answer;
    // - my_chat_member;
    // - chat_member;
    // - chat_join_request;
    // - chat_boost;
    // - removed_chat_boost;

    // - edited_message_text
    // - edited_message_caption
    // - edited_channel_post_text
    // - edited_channel_post_caption
    // The message details are stored in the payload
    // chatId
    // messageId
    // type
    // content
    // depending on type from and date is part of the output, too.
    // The original message is stored next to payload.
    // callback_query : content string
    function TelegramEventNode(config) {
        RED.nodes.createNode(this, config);
        let node = this;
        this.bot = config.bot;
        this.event = config.event;
        this.autoAnswerCallback = config.autoanswer;

        this.processError = function (exception, msg) {
            let errorMessage = 'Caught exception in event node:\r\n' + exception + '\r\nwhen processing message: \r\n' + JSON.stringify(msg);
            node.error(errorMessage, msg);

            node.status({
                fill: 'red',
                shape: 'ring',
                text: exception.message,
            });
        };

        this.start = function () {
            let telegramBot = this.config.getTelegramBot();
            if (telegramBot) {
                if (telegramBot._polling !== null || telegramBot._webHook !== null) {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'connected',
                    });

                    telegramBot.on(this.event, (botMsg) => this.processMessage(botMsg));
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
            let telegramBot = this.config.getTelegramBot();
            if (telegramBot) {
                telegramBot.off(this.event);
            }

            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.processMessage = function (botMsg) {
            let telegramBot = this.config.getTelegramBot();

            node.status({
                fill: 'green',
                shape: 'ring',
                text: 'connected',
            });

            node.status({
                fill: 'green',
                shape: 'ring',
                text: 'connected',
            });

            let username;
            let chatid;
            let userid;
            let isAnonymous = false;
            if (botMsg.chat) {
                //channel
                username = botMsg.chat.username;
                chatid = botMsg.chat.id;
                if (botMsg.from !== undefined) {
                    userid = botMsg.from.id;
                }
            } else if (botMsg.from) {
                //sender, group, supergroup
                if (botMsg.message !== undefined) {
                    chatid = botMsg.message.chat.id;
                }
                username = botMsg.from.username;
                userid = botMsg.from.id;
            } else {
                // chatid can be null in case of polls, inline_queries,...
                isAnonymous = true;
            }

            if (isAnonymous || node.config.isAuthorized(node, chatid, userid, username)) {
                let msg;
                let botDetails = {
                    botname: this.config.botname,
                    testEnvironment: this.config.testEnvironment,
                    baseApiUrl: this.config.telegramBot.options.baseApiUrl,
                };

                let messageId;
                if (botMsg.message !== undefined) {
                    messageId = botMsg.message.message_id;
                }

                let messageDetails = converter.convertMessage(this.event, botMsg);
                if (messageDetails) {

                    // sepcial callback query handling.
                    if(this.event === 'callback_query') {
                        if (node.autoAnswerCallback) {
                            telegramBot
                                .answerCallbackQuery(botMsg.id)
                                .catch(function (ex) {
                                    node.processError(ex, msg);
                                })
                                .then(function () {
                                    // nothing to do here
                                    // node.processResult(result);
                                });
                        }
                    }

                    msg = {
                        payload: messageDetails,
                        originalMessage: botMsg,
                        telegramBot: botDetails,
                    };
                    node.send(msg);
                }
            } else {
                // ignoring unauthorized calls
                if (node.config.verbose) {
                    node.warn('Unauthorized incoming call from ' + username);
                }
            }
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

            node.botname = this.config.botname;

            node.start();
        } else {
            node.warn('config node failed to initialize.');
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'config node failed to initialize',
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

    return TelegramEventNode;
};
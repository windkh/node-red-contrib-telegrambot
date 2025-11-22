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
                let messageDetails;
                let botDetails = {
                    botname: this.config.botname,
                    testEnvironment: this.config.testEnvironment,
                    baseApiUrl: this.config.telegramBot.options.baseApiUrl,
                };

                let messageId;
                if (botMsg.message !== undefined) {
                    messageId = botMsg.message.message_id;
                }

                switch (this.event) {
                    // Messages are handled using the receiver node.
                    // https://core.telegram.org/bots/api#message
                    case 'message':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            content: botMsg.text,
                            date: botMsg.date,
                            chat: botMsg.chat,
                            from: botMsg.from,
                        };
                        break;

                    // https://core.telegram.org/bots/api#callbackquery
                    case 'callback_query':
                        messageDetails = {
                            chatId: chatid,
                            messageId: messageId,
                            inlineMessageId: botMsg.inline_message_id,
                            type: this.event,
                            content: botMsg.data,
                            callbackQueryId: botMsg.id,
                            from: botMsg.from,
                        };

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
                        break;

                    // https://core.telegram.org/bots/api#inlinequery
                    // /setinline must be set before in botfather see https://core.telegram.org/bots/inline
                    case 'inline_query':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            content: botMsg.query,
                            inlineQueryId: botMsg.id,
                            offset: botMsg.offset,
                            from: botMsg.from,
                            location: botMsg.location, // location is only available when /setinlinegeo is set in botfather
                        };
                        // Right now this is not supported as a result is required!
                        //if (node.autoAnswerCallback) {
                        //    // result = https://core.telegram.org/bots/api#inlinequeryresult
                        //    telegramBot.answerInlineQuery(inlineQueryId, results).then(function (result) {
                        //        // Nothing to do here
                        //        ;
                        //    });
                        //}
                        break;

                    // https://core.telegram.org/bots/api#message
                    case 'edited_message':
                        messageDetails = {
                            chatId: chatid,
                            messageId: botMsg.message_id,
                            type: this.event,
                            content: botMsg.text,
                            editDate: botMsg.edit_date,
                            date: botMsg.date,
                            from: botMsg.from,
                            chat: botMsg.chat,
                            location: botMsg.location, // for live location updates
                        };
                        break;

                    // the text of an already sent message.
                    // not official
                    case 'edited_message_text':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            content: botMsg.text,
                            editDate: botMsg.edit_date,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // the caption of a document or an image ...
                    // not official
                    case 'edited_message_caption':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            content: botMsg.caption,
                            editDate: botMsg.edit_date,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#message
                    case 'channel_post':
                        messageDetails = {
                            chatId: chatid,
                            messageId: botMsg.message_id,
                            type: this.event,
                            content: botMsg.text,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#message
                    case 'edited_channel_post':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            content: botMsg.text,
                            editDate: botMsg.edit_date,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // not official
                    case 'edited_channel_post_text':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            content: botMsg.text,
                            editDate: botMsg.edit_date,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // not official
                    case 'edited_channel_post_caption':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            content: botMsg.caption,
                            editDate: botMsg.edit_date,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#businessconnection
                    case 'business_connection':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            id: botMsg.id,
                            user: botMsg.user,
                            userChatId: botMsg.user_chat_id,
                            date: botMsg.date,
                            rights: botMsg.rights,
                            isEnabled: botMsg.is_enabled,
                        };
                        break;

                    // https://core.telegram.org/bots/api#message
                    case 'business_message':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            content: botMsg.text, // TODO: this needs to be checked
                            date: botMsg.date,
                            chat: botMsg.chat,
                            from: botMsg.from,
                        };
                        break;

                    // https://core.telegram.org/bots/api#message
                    case 'edited_business_message':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            content: botMsg.text, // TODO: this needs to be checked
                            date: botMsg.date,
                            chat: botMsg.chat,
                            from: botMsg.from,
                        };
                        break;

                    // https://core.telegram.org/bots/api#businessmessagesdeleted
                    case 'deleted_business_messages':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageIds: botMsg.message_ids,
                            businessConnectionId: botMsg.business_connection_id,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#messagereactionupdated
                    case 'message_reaction':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            user: botMsg.user,
                            actorChat: botMsg.actor_chat,
                            date: botMsg.date,
                            oldReaction: botMsg.old_reaction,
                            newReaction: botMsg.new_reaction,
                        };
                        break;

                    // https://core.telegram.org/bots/api#messagereactioncountupdated
                    case 'message_reaction_count':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            messageId: botMsg.message_id,
                            date: botMsg.date,
                            chat: botMsg.chat,
                            reactions: botMsg.reactions,
                        };
                        break;

                    // https://core.telegram.org/bots/api#precheckoutquery
                    case 'pre_checkout_query':
                        messageDetails = {
                            preCheckoutQueryId: botMsg.id,
                            chatId: chatid,
                            type: this.event,
                            from: botMsg.from,
                            currency: botMsg.currency,
                            total_amount: botMsg.total_amount,
                            invoice_payload: botMsg.invoice_payload,
                            shipping_option_id: botMsg.shipping_option_id,
                            order_info: botMsg.order_info,
                            content: botMsg.invoice_payload,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#shippingquery
                    case 'shipping_query':
                        messageDetails = {
                            shippingQueryId: botMsg.id,
                            chatId: chatid,
                            type: this.event,
                            from: botMsg.from,
                            invoice_payload: botMsg.invoice_payload,
                            content: botMsg.invoice_payload,
                            shipping_address: botMsg.shipping_address,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#choseninlineresult
                    case 'chosen_inline_result':
                        messageDetails = {
                            result_id: botMsg.result_id,
                            chatId: chatid,
                            type: this.event,
                            from: botMsg.from,
                            location: botMsg.location,
                            inline_message_id: botMsg.inline_message_id,
                            query: botMsg.query,
                            content: botMsg.result_id,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#paidmediapurchased
                    case 'purchased_paid_media':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            from: botMsg.from,
                            paidMediaPayload: botMsg.paid_media_payload,
                        };
                        break;

                    // https://core.telegram.org/bots/api#pollanswer
                    case 'poll_answer':
                        messageDetails = {
                            poll_id: botMsg.poll_id,
                            chatId: chatid,
                            type: this.event,
                            user: botMsg.user,
                            option_ids: botMsg.option_ids,
                            content: botMsg.user,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#poll
                    case 'poll':
                        messageDetails = {
                            type: this.event,
                            id: botMsg.id,
                            question: botMsg.question,
                            options: botMsg.options,
                            total_voter_count: botMsg.total_voter_count,
                            is_closed: botMsg.is_closed,
                            is_anonymous: botMsg.is_anonymous,
                            pollType: botMsg.type,
                            allows_multiple_answers: botMsg.allows_multiple_answers,
                            correct_option_id: botMsg.correct_option_id,
                            explanation: botMsg.explanation,
                            explanation_entities: botMsg.explanation_entities,
                            open_period: botMsg.open_period,
                            close_date: botMsg.close_date,
                            content: botMsg.question,
                        };
                        break;

                    // https://core.telegram.org/bots/api#chatmemberupdated
                    case 'my_chat_member':
                    case 'chat_member':
                        messageDetails = {
                            from: botMsg.from,
                            old_chat_member: botMsg.old_chat_member,
                            new_chat_member: botMsg.new_chat_member,
                            invite_link: botMsg.invite_link,
                            chatId: chatid,
                            type: this.event,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#chatjoinrequest
                    case 'chat_join_request':
                        messageDetails = {
                            from: botMsg.from,
                            bio: botMsg.bio,
                            invite_link: botMsg.invite_link,
                            chatId: chatid,
                            type: this.event,
                            date: botMsg.date,
                            chat: botMsg.chat,
                        };
                        break;

                    // https://core.telegram.org/bots/api#chatboostupdated
                    case 'chat_boost':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            chat: botMsg.chat,
                            boost: botMsg.boost,
                        };
                        break;

                    // https://core.telegram.org/bots/api#chatboostremoved
                    case 'removed_chat_boost':
                        messageDetails = {
                            chatId: chatid,
                            type: this.event,
                            chat: botMsg.chat,
                            boostId: botMsg.boost_id,
                            removeDate: botMsg.remove_date,
                            source: botMsg.source,
                        };
                        break;
                    default:
                }

                if (messageDetails !== null) {
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
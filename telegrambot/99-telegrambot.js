/**
* Created by Karl-Heinz Wind
**/

// Temporary fix for 0.30.0 api
process.env["NTBA_FIX_319"] = 1;

module.exports = function (RED) {
    "use strict";
    var telegramBot = require('node-telegram-bot-api');

    // --------------------------------------------------------------------------------------------
    // The configuration node
    // holds the token
    // and establishes the connection to the telegram bot
    function TelegramBotNode(n) {
        RED.nodes.createNode(this, n);

        var self = this;
        this.botname = n.botname;
        this.verbose = n.verboselogging;
        this.status = "disconnected";

        this.nodes = [];

        this.usernames = [];
        if (n.usernames) {
            this.usernames = n.usernames.split(',');
        }

        this.chatids = [];
        if (n.chatids) {
            this.chatids = n.chatids.split(',').map(function (item) {
                return parseInt(item, 10);
            });
        }

        this.baseApiUrl = n.baseapiurl;
        this.pollInterval = parseInt(n.pollinterval);
        if (isNaN(this.pollInterval)) {
            this.pollInterval = 300;
        }


        // Activates the bot or returns the already activated bot. 
        this.getTelegramBot = function () {
            if (!this.telegramBot) {
                if (this.credentials) {
                    this.token = this.credentials.token;
                    if (this.token) {
                        this.token = this.token.trim();
                        if (!this.telegramBot) {
                            var polling =
                                {
                                    autoStart: true,
                                    interval: this.pollInterval
                                }
                            var options =
                                {
                                    polling: polling,
                                    baseApiUrl: this.baseApiUrl
                                };
                            this.telegramBot = new telegramBot(this.token, options);
                            self.status = "connected";

                            this.telegramBot.on('error', function (error) {
                                self.warn(error.message);

                                self.abortBot(error.message, function () {
                                    self.warn("Bot stopped: Fatal Error.");
                                });
                            });

                            this.telegramBot.on('polling_error', function (error) {
                                if(self.verbose) {
                                    self.warn(error.message);

                                    var stopPolling = false;
                                    var hint;
                                    if (error.message === "ETELEGRAM: 401 Unauthorized") {
                                        hint = "Please check if the bot token is valid: " + self.credentials.token;
                                        stopPolling = true;
                                    }
                                    else if (error.message.startsWith("EFATAL: Error: connect ETIMEDOUT")) {
                                        hint = "Timeout connecting to server. Trying again.";
                                    }
                                    else if (error.message.startsWith("EFATAL: Error: read ECONNRESET")) {
                                        hint = "Network connection may be down. Trying again.";
                                    }
                                    else if (error.message.startsWith("EFATAL: Error: getaddrinfo EAI_AGAIN")) {
                                        hint = "Network connection may be down. Trying again.";
                                    }
                                    else if (error.message.startsWith("EFATAL: Error: getaddrinfo ENOTFOUND")) {
                                        hint = "Network connection may be down. Trying again.";
                                    }
                                    else {
                                        // unknown error occured... we simply ignore it.
                                        hint = "Unknown error. Trying again.";
                                    }

                                    if (stopPolling) {
                                        self.abortBot(error.message, function () {
                                            self.warn("Bot stopped: " + hint);
                                        });
                                    }
                                    else {
                                        // here we simply ignore the bug and continue polling.
                                        // The following line is removed as this would create endless log files
                                        if(self.verbose){
                                            self.warn(hint);
                                        }
                                    }
                                }
                            });

                            this.telegramBot.on('webhook_error', function (error) {
                                self.warn(error.message);

                                self.abortBot(error.message, function () {
                                    self.warn("Bot stopped: Webhook error.");
                                });
                            });
                        }
                    }
                }
            }

            return this.telegramBot;
        }

        this.on('close', function (done) {
            self.abortBot("closing", done);
        });

        this.abortBot = function (hint, done) {
            if (self.telegramBot !== null && self.telegramBot._polling) {
                self.telegramBot.stopPolling()
                    .then(function () {
                        self.telegramBot = null;
                        self.status = "disconnected";
                        self.setNodesStatus({ fill: "red", shape: "ring", text: "bot stopped. " + hint })
                        done();
                    });
            }
            else {
                self.status = "disconnected";
                self.setNodesStatus({ fill: "red", shape: "ring", text: "bot stopped. " + hint })
                done();
            }
        }

        this.isAuthorizedUser = function (user) {
            var isAuthorized = false;
            if (self.usernames.length > 0) {
                if (self.usernames.indexOf(user) >= 0) {
                    isAuthorized = true;
                }
            }

            return isAuthorized;
        }

        this.isAuthorizedChat = function (chatid) {
            var isAuthorized = false;
            var length = self.chatids.length;
            if (length > 0) {
                for (var i = 0; i < length; i++) {
                    var id = self.chatids[i];
                    if (id === chatid) {
                        isAuthorized = true;
                        break;
                    }
                }
            }

            return isAuthorized;
        }

        this.isAuthorized = function (chatid, user) {
            var isAuthorizedUser = self.isAuthorizedUser(user);
            var isAuthorizedChatId = self.isAuthorizedChat(chatid);

            var isAuthorized = false;

            if (isAuthorizedUser || isAuthorizedChatId) {
                isAuthorized = true;
            } else {
                if (self.chatids.length === 0 && self.usernames.length === 0) {
                    isAuthorized = true;
                }
            }

            return isAuthorized;
        }

        this.register = function (node) {
            if (self.nodes.indexOf(node) === -1) {
                self.nodes.push(node);
            }
            else {
                self.warn("Node " + node.id + " registered twice at the configuration node: ignoring.");
            }
        }

        this.setNodesStatus = function (status) {
            self.nodes.forEach(function (node) {
                node.status(status);
            });
        }

    }
    RED.nodes.registerType("telegram bot", TelegramBotNode, {
        credentials: {
            token: { type: "text" }
        }
    });

    // adds the caption of the message into the options.
    function addCaptionToMessageOptions(msg) {
        var options = msg.payload.options;
        if (options === undefined) {
            options = {};
        }

        if (msg.payload.caption !== undefined) {
            options.caption = msg.payload.caption;
        }

        msg.payload.options = options;

        return msg;
    }

    function getPhotoIndexWithHighestResolution(photoArray) {
        var photoIndex = 0;
        var highestResolution = 0;

        photoArray.forEach(function (photo, index, array) {
            var resolution = photo.width * photo.height;
            if (resolution > highestResolution) {
                highestResolution = resolution;
                photoIndex = index;
            }
        });

        return photoIndex;
    }

    // creates the message details object from the original message
    function getMessageDetails(botMsg) {

        var messageDetails;
        if (botMsg.text) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'message', content: botMsg.text };
        } else if (botMsg.photo) {
            // photos are sent using several resolutions. Therefore photo is an array. We choose the one with the highest resolution in the array.
            var index = getPhotoIndexWithHighestResolution(botMsg.photo);
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'photo', content: botMsg.photo[index].file_id, caption: botMsg.caption, date: botMsg.date, blob: true, photos: botMsg.photo };
        } else if (botMsg.audio) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'audio', content: botMsg.audio.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.document) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'document', content: botMsg.document.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.sticker) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'sticker', content: botMsg.sticker.file_id, date: botMsg.date, blob: true };
        } else if (botMsg.video) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'video', content: botMsg.video.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.video_note) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'video_note', content: botMsg.video_note.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.voice) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'voice', content: botMsg.voice.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.location) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'location', content: botMsg.location, date: botMsg.date };
        } else if (botMsg.venue) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'venue', content: botMsg.venue, date: botMsg.date };
        } else if (botMsg.contact) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'contact', content: botMsg.contact, date: botMsg.date };
        } else if (botMsg.new_chat_title) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'new_chat_title', content: botMsg.new_chat_title, date: botMsg.date };
        } else if (botMsg.new_chat_photo) {
            // photos are sent using several resolutions. Therefore photo is an array. We choose the one with the highest resolution in the array.
            var index = getPhotoIndexWithHighestResolution(botMsg.new_chat_photo);
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'new_chat_photo', content: botMsg.new_chat_photo[index].file_id, date: botMsg.date, blob: true, photos: botMsg.new_chat_photo }; 
        } else if (botMsg.new_chat_members) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'new_chat_members', content: botMsg.new_chat_members, date: botMsg.date, };
        } else if (botMsg.left_chat_member) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'left_chat_member', content: botMsg.left_chat_member, date: botMsg.date, };
        } else if (botMsg.delete_chat_photo) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'delete_chat_photo', content: botMsg.delete_chat_photo, date: botMsg.date };
        } else if (botMsg.pinned_message) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'pinned_message', content: botMsg.pinned_message, date: botMsg.date };
        } else if (botMsg.channel_chat_created) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'channel_chat_created', content: botMsg.channel_chat_created, date: botMsg.date };
        } else if (botMsg.group_chat_created) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'group_chat_created', content: botMsg.group_chat_created, chat: botMsg.chat, date: botMsg.date };
        } else if (botMsg.supergroup_chat_created) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'supergroup_chat_created', content: botMsg.supergroup_chat_created, chat: botMsg.chat, date: botMsg.date };
        } else if (botMsg.migrate_from_chat_id) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'migrate_from_chat_id', content: botMsg.migrate_from_chat_id, chat: botMsg.chat, date: botMsg.date };
        } else if (botMsg.migrate_to_chat_id) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'migrate_to_chat_id', content: botMsg.migrate_to_chat_id, chat: botMsg.chat, date: botMsg.date };
        } else {
            // unknown type --> no output

            // TODO:
            // 'successful_payment',
            // 'invoice',
            // 'game',
        }

        return messageDetails;
    }

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
        var node = this;
        this.bot = config.bot;

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);

            node.status({ fill: "red", shape: "ring", text: "not connected" });

            node.telegramBot = this.config.getTelegramBot();
            if (node.telegramBot) {
                node.status({ fill: "green", shape: "ring", text: "connected" });

                node.telegramBot.on('message', function (botMsg) {
                    node.status({ fill: "green", shape: "ring", text: "connected" });

                    var username = botMsg.from.username;
                    var chatid = botMsg.chat.id;
                    var messageDetails = getMessageDetails(botMsg);
                    if (messageDetails) {
                        var msg = { payload: messageDetails, originalMessage: botMsg };

                        if (node.config.isAuthorized(chatid, username)) {
                            // downloadable "blob" message?
                            if (messageDetails.blob) {
                                node.telegramBot.getFileLink(messageDetails.content).then(function (weblink) {
                                    msg.payload.weblink = weblink;

                                    // download and provide with path
                                    if (config.saveDataDir) {
                                        node.telegramBot.downloadFile(messageDetails.content, config.saveDataDir).then(function (path) {
                                            msg.payload.path = path;
                                            node.send([msg, null]);
                                        });
                                    } else {
                                        node.send([msg, null]);
                                    }
                                });
                                // vanilla message
                            } else {
                                node.send([msg, null]);
                            }
                        } else {
                            if(node.config.verbose){
                                node.warn("Unauthorized incoming call from " + username);
                            }
                            node.send([null, msg]);
                        }
                    }
                });

                node.telegramBot.on('polling_error', function (error) {
                    node.status({ fill: "red", shape: "ring", text: "disconnected" });
                });
            } else {
                node.warn("bot not initialized");
                node.status({ fill: "red", shape: "ring", text: "bot not initialized" });
            }
        } else {
            node.warn("config node failed to initialize.");
            node.status({ fill: "red", shape: "ring", text: "config node failed to initialize" });
        }

        this.on("close", function () {
            node.telegramBot.off('message');
            node.status({});
        });
    }
    RED.nodes.registerType("telegram receiver", TelegramInNode);



    // --------------------------------------------------------------------------------------------
    // The input node receives a command from the chat.
    // The message details are stored in the payload
    // chatId
    // type
    // content
    // depending on type caption and date is part of the output, too.
    // The original message is stored next to payload.
    //
    // message : content string
    function TelegramCommandNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        var command = config.command;
        var strict = config.strict;
        this.bot = config.bot;

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);

            node.status({ fill: "red", shape: "ring", text: "not connected" });

            node.telegramBot = this.config.getTelegramBot();
            node.botname = this.config.botname;
            if (node.telegramBot) {
                node.status({ fill: "green", shape: "ring", text: "connected" });

                node.telegramBot.on('message', function (botMsg) {
                    node.status({ fill: "green", shape: "ring", text: "connected" });

                    var username = botMsg.from.username;
                    var chatid = botMsg.chat.id;
                    if (node.config.isAuthorized(chatid, username)) {
                        var msg;
                        var messageDetails;
                        if (botMsg.text) {
                            var message = botMsg.text;
                            var tokens = message.split(" ");

                            var isChatCommand = tokens[0] === command;
                            var command2 = command + "@" + node.botname;
                            var isDirectCommand = tokens[0] === command2;
                            var isGroupChat = chatid < 0;
                            
                            if (isDirectCommand || 
                                (isChatCommand && !isGroupChat) ||
                                (isChatCommand && isGroupChat && !strict)) {
                                
                                var remainingText;
                                if(isDirectCommand)
                                {
                                    remainingText = message.replace(command2, "");
                                }
                                else
                                {
                                    remainingText = message.replace(command, "");
                                }

                                messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'message', content: remainingText };
                                msg = { payload: messageDetails, originalMessage: botMsg };
                                node.send([msg, null]);
                            } else {
                                messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'message', content: botMsg.text };
                                msg = { payload: messageDetails, originalMessage: botMsg };
                                node.send([null, msg]);
                            }
                        } else {
                            // unknown type --> no output
                        }
                    } else {
                        // ignoring unauthorized calls
                        if(node.config.verbose){
                            node.warn("Unauthorized incoming call from " + username);
                        }
                    }
                });

                node.telegramBot.on('polling_error', function (error) {
                    node.status({ fill: "red", shape: "ring", text: "disconnected" });
                });
            } else {
                node.warn("bot not initialized.");
                node.status({ fill: "red", shape: "ring", text: "no bot token found in config" });
            }
        } else {
            node.warn("config node failed to initialize.");
            node.status({ fill: "red", shape: "ring", text: "config node failed to initialize" });
        }

        this.on("close", function () {
            node.telegramBot.off('message');
            node.status({});
        });
    }
    RED.nodes.registerType("telegram command", TelegramCommandNode);



    // --------------------------------------------------------------------------------------------
    // The input node receives an event from the chat.
    // The type of event can be configured:
    // - callback_query
    // - inline_query
    // - edited_message
    // - channel_post
    // - edited_channel_post
    // - edited_message_text
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
        var node = this;
        this.bot = config.bot;
        this.event = config.event;
        this.autoAnswerCallback = config.autoanswer;

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);

            node.status({ fill: "red", shape: "ring", text: "not connected" });

            node.telegramBot = this.config.getTelegramBot();
            node.botname = this.config.botname;
            if (node.telegramBot) {
                node.status({ fill: "green", shape: "ring", text: "connected" });

                node.telegramBot.on(this.event, (botMsg) => {
                    node.status({ fill: "green", shape: "ring", text: "connected" });

                    var username;
                    var chatid;
                    if (botMsg.chat) { //channel
                        username = botMsg.chat.username;
                        chatid = botMsg.chat.id;
                    } else if (botMsg.from) {       //private, group, supergroup
                        username = botMsg.from.username;
                        chatid = botMsg.from.id;
                    } else {
                        node.error("username or chatid undefined");
                    }
                    if (node.config.isAuthorized(chatid, username)) {
                        var msg;
                        var messageDetails;

                        switch (this.event) {
                            case 'callback_query':
                                var callbackQueryId = botMsg.id;
                                messageDetails = {
                                    chatId: chatid,
                                    messageId: botMsg.message.message_id,
                                    type: 'callback_query',
                                    content: botMsg.data,
                                    callbackQueryId: callbackQueryId,
                                    from: botMsg.from
                                };
                                if (node.autoAnswer) {
                                    node.telegramBot.answerCallbackQuery(callbackQueryId).then(function (sent) {
                                        // Nothing to do here
                                        ;
                                    });
                                }
                                break;

                            // /setinline must be set before in botfather see https://core.telegram.org/bots/inline
                            case 'inline_query':
                                var inlineQueryId = botMsg.id;
                                messageDetails = {
                                    chatId: chatid,
                                    type: 'inline_query',
                                    content: botMsg.query,
                                    inlineQueryId: inlineQueryId,
                                    offset: botMsg.offset,
                                    from: botMsg.from,
                                    location: botMsg.location // location is only available when /setinlinegeo is set in botfather
                                };
                                // Right now this is not supported as a result is required!
                                //if (node.autoAnswer) {
                                //    // result = https://core.telegram.org/bots/api#inlinequeryresult
                                //    node.telegramBot.answerInlineQuery(inlineQueryId, results).then(function (sent) {
                                //        // Nothing to do here
                                //        ;
                                //    });
                                //}
                                break;

                            case 'edited_message':
                                messageDetails = {
                                    chatId: chatid,
                                    messageId: botMsg.message_id,
                                    type: "edited_message",
                                    content: botMsg.text,
                                    editDate: botMsg.edit_date,
                                    date: botMsg.date,
                                    from: botMsg.from,
                                    chat: botMsg.chat,
                                    location: botMsg.location // for live location updates
                                };
                                break;

                            // the text of an already sent message.
                            case 'edited_message_text':
                                messageDetails = {
                                    chatId: chatid,
                                    type: "edited_message_text",
                                    messageId: botMsg.message_id,
                                    content: botMsg.text,
                                    editDate: botMsg.edit_date,
                                    date: botMsg.date,
                                    chat: botMsg.chat 
                                };
                                break;

                            // the caption of a document or an image ...
                            case 'edited_message_caption':
                                messageDetails = {
                                    chatId: chatid,
                                    type: "edited_message_caption",
                                    messageId: botMsg.message_id,
                                    content: botMsg.caption,
                                    editDate: botMsg.edit_date,
                                    date: botMsg.date,
                                    chat: botMsg.chat 
                                };
                                break;

                            case 'channel_post':
                                messageDetails = {
                                    chatId: chatid,
                                    messageId: botMsg.message_id,
                                    type: "channel_post",
                                    content: botMsg.text,
                                    date: botMsg.date,
                                    chat: botMsg.chat
                                };
                                break;

                            case 'edited_channel_post':
                                messageDetails = {
                                    chatId: chatid,
                                    type: "edited_channel_post",
                                    messageId: botMsg.message_id,
                                    content: botMsg.text,
                                    editDate: botMsg.edit_date,
                                    date: botMsg.date,
                                    chat: botMsg.chat 
                                };
                                break;

                            case 'edited_channel_post_text':
                                messageDetails = {
                                    chatId: chatid,
                                    type: "edited_channel_post_text",
                                    messageId: botMsg.message_id,
                                    content: botMsg.text,
                                    editDate: botMsg.edit_date,
                                    date: botMsg.date,
                                    chat: botMsg.chat 
                                };
                                break;

                            case 'edited_channel_post_caption':
                                messageDetails = {
                                    chatId: chatid,
                                    type: "edited_channel_post_caption",
                                    messageId: botMsg.message_id,
                                    content: botMsg.caption,
                                    editDate: botMsg.edit_date,
                                    date: botMsg.date,
                                    chat: botMsg.chat 
                                };
                                break;


                            // TODO: implement those
                            // chosen_inline_result, 
                            // shippingQuery, preCheckoutQuery, 
                            default:
                        }

                        if (messageDetails != null) {
                            msg = {
                                payload: messageDetails,
                                originalMessage: botMsg
                            };
                            node.send(msg);
                        }
                    } else {
                        // ignoring unauthorized calls
                        if(node.config.verbose){
                            node.warn("Unauthorized incoming call from " + username);
                        }
                    }
                });

                node.telegramBot.on('polling_error', function (error) {
                    node.status({ fill: "red", shape: "ring", text: "disconnected" });
                });
            } else {
                node.warn("bot not initialized.");
                node.status({ fill: "red", shape: "ring", text: "no bot token found in config" });
            }
        } else {
            node.warn("config node failed to initialize.");
            node.status({ fill: "red", shape: "ring", text: "config node failed to initialize" });
        }

        this.on("close", function () {
            node.telegramBot.off(this.event);
            node.status({});
        });
    }
    RED.nodes.registerType("telegram event", TelegramEventNode);



    // --------------------------------------------------------------------------------------------
    // The output node sends to the chat and passes the msg through.
    // The payload needs three fields
    // chatId  : string destination chat
    // type    : string type of message to send
    // content : message content
    // The type is a string can be any of the following:
    // message content is String
    // photo    content is String|stream.Stream|Buffer
    // audio    content is String|stream.Stream|Buffer
    // document content is String|stream.Stream|Buffer
    // sticker  content is String|stream.Stream|Buffer
    // video    content is String|stream.Stream|Buffer
    // voice    content is String|stream.Stream|Buffer
    // location content is an object that contains latitude and logitude
    // contact  content is full contact object
    // action   content is one of the following: 
    //                      typing, upload_photo, record_video, upload_video, record_audio, upload_audio,  
    //                      upload_document, find_location, record_video_note, upload_video_note
    function TelegramOutNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        this.bot = config.bot;

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);

            node.status({ fill: "red", shape: "ring", text: "not connected" });

            node.telegramBot = this.config.getTelegramBot();
            if (node.telegramBot) {
                node.status({ fill: "green", shape: "ring", text: "connected" });
            } else {
                node.warn("bot not initialized.");
                node.status({ fill: "red", shape: "ring", text: "bot not initialized" });
            }
        } else {
            node.warn("config node failed to initialize.");
            node.status({ fill: "red", shape: "ring", text: "config node failed to initialize" });
        }

        this.hasContent = function (msg) {
            var hasContent;
            if (msg.payload.content) {
                hasContent = true;
            }
            else {
                node.warn("msg.payload.content is empty");
                hasContent = false;
            }

            return hasContent;
        }

        this.on('input', function (msg) {

            node.status({ fill: "green", shape: "ring", text: "connected" });
            
            if (msg.payload) {
                if (msg.payload.chatId) {
                    if (msg.payload.type) {

                        var chatId = msg.payload.chatId;
                        var type = msg.payload.type;
                        addCaptionToMessageOptions(msg);

                        switch (type) {

                            // --------------------------------------------------------------------
                            case 'message':
                                if (this.hasContent(msg)) {
                                    // the maximum message size is 4096 so we must split the message into smaller chunks.
                                    var chunkSize = 4000;
                                    var message = msg.payload.content;

                                    var done = false;
                                    do {
                                        var messageToSend;
                                        if (message.length > chunkSize) {
                                            messageToSend = message.substr(0, chunkSize);
                                            message = message.substr(chunkSize);
                                        } else {
                                            messageToSend = message;
                                            done = true;
                                        }

                                        node.telegramBot.sendMessage(chatId, messageToSend, msg.payload.options).then(function (sent) {
                                            msg.payload.sentMessageId = sent.message_id;
                                            node.send(msg);
                                        }).catch(function (err) {
                                            // markdown error? try plain mode
                                            if (
                                                String(err).includes("can't parse entities in message text:") &&
                                                msg.payload.options && msg.payload.options.parse_mode === 'Markdown'
                                            ) {
                                                delete msg.payload.options.parse_mode;
                                                node.telegramBot.sendMessage(chatId, messageToSend, msg.payload.options).then(function (sent) {
                                                    msg.payload.sentMessageId = sent.message_id;
                                                    node.send(msg);
                                                });
                                                return;
                                            }
                                            throw err;
                                        });

                                    } while (!done)
                                }
                                break;
                        
                            case 'photo':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendPhoto(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'audio':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendAudio(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'document':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendDocument(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'sticker':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendSticker(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'video':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendVideo(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'video_note':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendVideoNote(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'voice':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendVoice(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;
                            
                            case 'location':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendLocation(chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'venue':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendVenue(chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.content.title, msg.payload.content.address, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'contact':
                                if (this.hasContent(msg)) {
                                    if (msg.payload.content.last_name) {
                                        if (!msg.payload.options) {
                                            msg.payload.options = {};
                                        }
                                        msg.payload.options.last_name = msg.payload.content.last_name;
                                    }
                                    node.telegramBot.sendContact(chatId, msg.payload.content.phone_number, msg.payload.content.first_name, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;
                            // --------------------------------------------------------------------
                            
                            case 'editMessageLiveLocation':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.editMessageLiveLocation(msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options).then(function (result) {
                                        msg.payload.content = result;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'stopMessageLiveLocation':
                                // This message requires the options to be set!
                                //if (this.hasContent(msg)) {
                                    node.telegramBot.stopMessageLiveLocation(msg.payload.options).then(function (result) {
                                        msg.payload.content = result;
                                        node.send(msg);
                                    });
                                //}
                                break;

                            case 'editMessageCaption':
                            case 'editMessageText':
                            case 'editMessageReplyMarkup':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.editMessageCaption(msg.payload.content, msg.payload.options).then(function (result) {
                                        msg.payload.content = result;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'callback_query':
                                if (this.hasContent(msg)) {
                                    // The new signature expects one object instead of three arguments.
                                    var callbackQueryId = msg.payload.callbackQueryId;
                                    var options = {
                                        callback_query_id: callbackQueryId,
                                        text: msg.payload.content,
                                        show_alert: msg.payload.options
                                    };
                                    node.telegramBot.answerCallbackQuery(callbackQueryId, options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'inline_query':
                                if (this.hasContent(msg)) {
                                    var inlineQueryId = msg.payload.inlineQueryId;
                                    var results = msg.payload.results; // this type requires results to be set: see https://core.telegram.org/bots/api#inlinequeryresult
                                    node.telegramBot.answerInlineQuery(inlineQueryId, results).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                }
                                break;

                            case 'action':
                                if (this.hasContent(msg)) {
                                    node.telegramBot.sendChatAction(chatId, msg.payload.content).then(function (result) {
                                        msg.payload.content = result;
                                        node.send(msg);
                                    });
                                }
                                break;

                            // --------------------------------------------------------------------
                            // Some of the following functions require the bot to be administrator of the chat/channel

                            case 'getChatAdministrators':
                            case 'getChatMembersCount':
                            case 'getChat':
                            case 'leaveChat':
                            case 'exportChatInviteLink':
                            case 'unpinChatMessage':
                            case 'deleteChatPhoto':
                                    node.telegramBot[type](chatId).then(function (result) {
                                        msg.payload.content = result;
                                        node.send(msg);
                                    });
                                break;

                            case 'kickChatMember':
                            case 'unbanChatMember':
                            case 'restrictChatMember':
                            case 'promoteChatMember':
                            case 'getChatMember':
                                // The userId must be passed in msg.payload.content: note that this is is a number not the username.
                                // Right now there is no way for resolving the user_id by username in the official API.
                                if (this.hasContent(msg)) {
                                    node.telegramBot[type](chatId, msg.payload.content).then(function (result) {
                                        msg.payload.content = result;
                                        node.send(msg);
                                    });
                                }
                                break;

                            // --------------------------------------------------------------------
                            case 'setChatTitle':
                            case 'setChatDescription':
                            case 'pinChatMessage':
                            case 'deleteMessage':            
                                if (this.hasContent(msg)) {
                                    node.telegramBot[type](chatId, msg.payload.content).then(function (result) {
                                        msg.payload.content = result;
                                        node.send(msg);
                                    });
                                }
                                break;
                            
                            case 'setChatPhoto':
                                if (this.hasContent(msg)) {
                                    node.telegramBot[type](chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                        msg.payload.content = result;
                                        node.send(msg);
                                    });
                                }
                                break;
                           
                            // TODO:                            
                            // getUserProfilePhotos, getFile, 
                            // setChatStickerSet, deleteChatStickerSet
                            // sendGame, setGameScore, getGameHighScores
                            // sendInvoice, answerShippingQuery, answerPreCheckoutQuery
                            // getStickerSet, uploadStickerFile, createNewStickerSet, addStickerToSet, setStickerPositionInSet, deleteStickerFromSet
                            // sendMediaGroup  

                            default:
                            // unknown type nothing to send.
                         }
                    } else {
                        node.warn("msg.payload.type is empty");
                    }
                } else {
                    node.warn("msg.payload.chatId is empty");
                }
            } else {
                node.warn("msg.payload is empty");
            }
        });

        node.telegramBot.on('polling_error', function (error) {
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });
    }
    RED.nodes.registerType("telegram sender", TelegramOutNode);



    // --------------------------------------------------------------------------------------------
    // The output node receices the reply for a specified message and passes the msg through.
    // The payload needs three fields
    // chatId        : string destination chat
    // sentMessageId : string the id of the message the reply coresponds to.
    // content : message content
    function TelegramReplyNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        this.bot = config.bot;

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);

            node.status({ fill: "red", shape: "ring", text: "not connected" });

            node.telegramBot = this.config.getTelegramBot();
            if (node.telegramBot) {
                node.status({ fill: "green", shape: "ring", text: "connected" });
            } else {
                node.warn("bot not initialized.");
                node.status({ fill: "red", shape: "ring", text: "bot not initialized" });
            }
        } else {
            node.warn("config node failed to initialize.");
            node.status({ fill: "red", shape: "ring", text: "config node failed to initialize" });
        }

        this.on('input', function (msg) {

            node.status({ fill: "green", shape: "ring", text: "connected" });
            
            if (msg.payload) {
                if (msg.payload.chatId) {
                    if (msg.payload.messageId) {

                        var chatId = msg.payload.chatId;
                        var messageId = msg.payload.sentMessageId;

                        node.telegramBot.onReplyToMessage(chatId, messageId, function (botMsg) {

                            var messageDetails = getMessageDetails(botMsg);
                            if (messageDetails) {
                                var newMsg = { payload: messageDetails, originalMessage: botMsg };
                                node.send(newMsg);
                            }
                        });

                    } else {
                        node.warn("msg.payload.messageId is empty");
                    }
                } else {
                    node.warn("msg.payload.chatId is empty");
                }
            } else {
                node.warn("msg.payload is empty");
            }
        });

        node.telegramBot.on('polling_error', function (error) {
            node.status({ fill: "red", shape: "ring", text: "disconnected" });
        });
    }
    RED.nodes.registerType("telegram reply", TelegramReplyNode);
}

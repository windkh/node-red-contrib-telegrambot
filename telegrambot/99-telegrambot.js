/**
* Created by Karl-Heinz Wind
**/

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

        if (this.credentials) {
            this.token = this.credentials.token;
            if (this.token) {
                this.token = this.token.trim();
                if (!this.telegramBot) {
                    this.telegramBot = new telegramBot(this.token, { polling: true });
                    this.telegramBot.setMaxListeners(0);
                    self.status = "connected";

                    this.telegramBot.on('polling_error', function(error) {
                        if (error.message === "ETELEGRAM: 401 Unauthorized") {
                            self.warn(error.message);
                            self.abortBot(function () {
                                self.warn("Bot stopped. Please check if the bot token is valid: " + self.credentials.token);
                            });
                        }
                    });

                    this.telegramBot.on('webhook_error', function(error) {
                        self.warn(error.message);
                    });
                }
            }
        }

        this.on('close', function (done) {
            self.abortBot(done);
        });

        this.abortBot = function(done) {
            if (self.telegramBot !== null && self.telegramBot._polling) {
                self.telegramBot.stopPolling()
                    .then(function () {
                    self.telegramBot = null;
                    self.status = "disconnected";
                    self.setNodesStatus({ fill: "red", shape: "ring", text: "bot stopped." })
                    done();
                });
            }
            else {
                self.status = "disconnected";
                self.setNodesStatus({ fill: "red", shape: "ring", text: "bot stopped." })
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
            if (self.nodes.indexOf(node) === -1){
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

    // creates the message details object from the original message
    function getMessageDetails(botMsg) {

        var messageDetails;
        if (botMsg.text) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'message', content: botMsg.text };
        } else if (botMsg.photo) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'photo', content: botMsg.photo[0].file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.audio) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'audio', content: botMsg.audio.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.document) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'document', content: botMsg.document.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.sticker) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'sticker', content: botMsg.sticker.file_id, blob: true };
        } else if (botMsg.video) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'video', content: botMsg.video.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.video_note) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'video_note', content: botMsg.video_note.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.voice) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'voice', content: botMsg.voice.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.location) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'location', content: botMsg.location };
        } else if (botMsg.venue) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'venue', content: botMsg.venue };
        } else if (botMsg.contact) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'contact', content: botMsg.contact };
        } else {
            // unknown type --> no output
        }

        return messageDetails;
    }

    // --------------------------------------------------------------------------------------------
    // The input node receives messages from the chat.
    // the message details are stored in the playload
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
    // docuemnt: content file_id of document
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

            this.status({ fill: "red", shape: "ring", text: "disconnected" });

            node.telegramBot = this.config.telegramBot;
            if (node.telegramBot) {
                this.status({ fill: "green", shape: "ring", text: "connected" });

                node.telegramBot.on('message', function (botMsg) {
                    var username = botMsg.from.username;
                    var chatid = botMsg.chat.id;
                    var messageDetails = getMessageDetails(botMsg);
                    if (messageDetails) {
                        var msg = { payload: messageDetails, originalMessage: botMsg };

                        if (node.config.isAuthorized(chatid, username)) {
                            // downloadable "blob" message? download and provide with path
                            if (config.saveDataDir && messageDetails.blob) {
                                node.telegramBot.downloadFile(messageDetails.content, config.saveDataDir).then(function(path) {
                                    msg.payload.path = path;
                                    node.send([msg, null]);
                                });
                            // vanilla message
                            } else {
                                node.send([msg, null]);
                            }
                        } else {
                            // node.warn("Unauthorized incoming call from " + username);
                            node.send([null, msg]);
                        }
                    }
                });
            } else {
                node.warn("bot not initialized");
                this.status({ fill: "red", shape: "ring", text: "bot not initialized" });
            }
        } else {
            node.warn("config node failed to initialize.");
            this.status({ fill: "red", shape: "ring", text: "config node failed to initialize." });
        }
    }
    RED.nodes.registerType("telegram receiver", TelegramInNode);



    // --------------------------------------------------------------------------------------------
    // The input node receives a command from the chat.
    // The message details are stored in the playload
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
        this.bot = config.bot;

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);

            this.status({ fill: "red", shape: "ring", text: "disconnected" });

            node.telegramBot = this.config.telegramBot;
            node.botname = this.config.botname;
            if (node.telegramBot) {
                this.status({ fill: "green", shape: "ring", text: "connected" });

                node.telegramBot.on('message', function (botMsg) {
                    var username = botMsg.from.username;
                    var chatid = botMsg.chat.id;
                    if (node.config.isAuthorized(chatid, username)) {
                        var msg;
                        var messageDetails;
                        if (botMsg.text) {
                            var message = botMsg.text;
                            var tokens = message.split(" ");

                            var command2 = command + "@" + node.botname;
                            if (tokens[0] === command || tokens[0] === command2) {
                                var remainingText = message.replace(command, "");

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
                        // node.warn("Unauthorized incoming call from " + username);
                    }
                });
            } else {
                node.warn("bot not initialized.");
                this.status({ fill: "red", shape: "ring", text: "no bot token found in config" });
            }
        } else {
            node.warn("config node failed to initialize.");
            this.status({ fill: "red", shape: "ring", text: "config node failed to initialize." });
        }
    }
    RED.nodes.registerType("telegram command", TelegramCommandNode);



    // --------------------------------------------------------------------------------------------
    // The input node receives a callback_query from the chat.
    // The message details are stored in the playload
    // chatId
    // type
    // content
    // depending on type caption and date is part of the output, too.
    // The original message is stored next to payload.
    //
    // callback_query : content string
    function TelegramCallbackQueryNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        this.bot = config.bot;

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);

            this.status({ fill: "red", shape: "ring", text: "disconnected" });

            node.telegramBot = this.config.telegramBot;
            node.botname = this.config.botname;
            if (node.telegramBot) {
                this.status({ fill: "green", shape: "ring", text: "connected" });

                node.telegramBot.on('callback_query', function (botMsg) {
                    var username = botMsg.from.username;
                    var chatid = botMsg.message.chat.id;

                    if (node.config.isAuthorized(chatid, username)) {
                        var msg;
                        var messageDetails;

                        if (botMsg.data) {

                            messageDetails = { chatId: botMsg.message.chat.id, messageId: botMsg.message_id, type: 'callback_query', content: botMsg.data, callbackQueryId : botMsg.id };

                            msg = { payload: messageDetails, originalMessage: botMsg };

                            node.send(msg);
                        } else {
                            // property data not set --> no output
                        }
                    } else {
                        // ignoring unauthorized calls
                        // node.warn("Unauthorized incoming call from " + username);
                    }
                });
            } else {
                node.warn("bot not initialized.");
                this.status({ fill: "red", shape: "ring", text: "no bot token found in config" });
            }
        } else {
            node.warn("config node failed to initialize.");
            this.status({ fill: "red", shape: "ring", text: "config node failed to initialize." });
        }
    }
    RED.nodes.registerType("telegram callback_query", TelegramCallbackQueryNode);



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
    function TelegramOutNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        this.bot = config.bot;

        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);

            this.status({ fill: "red", shape: "ring", text: "disconnected" });

            node.telegramBot = this.config.telegramBot;
            if (node.telegramBot) {
                this.status({ fill: "green", shape: "ring", text: "connected" });
            } else {
                node.warn("bot not initialized.");
                this.status({ fill: "red", shape: "ring", text: "bot not initialized" });
            }
        } else {
            node.warn("config node failed to initialize.");
            this.status({ fill: "red", shape: "ring", text: "config node failed to initialize." });
        }

        this.on('input', function (msg) {

            if (msg.payload) {
                if (msg.payload.content) {
                    if (msg.payload.chatId) {
                        if (msg.payload.type) {

                            var chatId = msg.payload.chatId;
                            var type = msg.payload.type;
                            addCaptionToMessageOptions(msg);

                            switch (type) {
                                case 'message':

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
                                    break;
                                case 'callback_query':
                                    node.telegramBot.answerCallbackQuery(msg.payload.callbackQueryId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;

                                case 'photo':
                                    node.telegramBot.sendPhoto(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'audio':
                                    node.telegramBot.sendAudio(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'document':
                                    node.telegramBot.sendDocument(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'sticker':
                                    node.telegramBot.sendSticker(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'video':
                                    node.telegramBot.sendVideo(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'video_note':
                                    node.telegramBot.sendVideoNote(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'voice':
                                    node.telegramBot.sendVoice(chatId, msg.payload.content, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'location':
                                    node.telegramBot.sendLocation(chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'venue':
                                    node.telegramBot.sendVenue(chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.content.title, msg.payload.content.address, msg.payload.options).then(function (sent) {
                                        msg.payload.sentMessageId = sent.message_id;
                                        node.send(msg);
                                    });
                                    break;
                                case 'contact':
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
                                    break;
                                default:
                                    // unknown type nothing to send.
                                    // TODO: 'channel_chat_created','delete_chat_photo','game','group_chat_created','invoice','left_chat_member','migrate_from_chat_id','migrate_to_chat_id',
                                    // 'new_chat_members','new_chat_photo','new_chat_title', 'pinned_message','successful_payment','supergroup_chat_created',
                            }
                        } else {
                            node.warn("msg.payload.type is empty");
                        }
                    } else {
                        node.warn("msg.payload.chatId is empty");
                    }
                } else {
                    node.warn("msg.payload.content is empty");
                }
            } else {
                node.warn("msg.payload is empty");
            }
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

            this.status({ fill: "red", shape: "ring", text: "disconnected" });

            node.telegramBot = this.config.telegramBot;
            if (node.telegramBot) {
                this.status({ fill: "green", shape: "ring", text: "connected" });
            } else {
                node.warn("bot not initialized.");
                this.status({ fill: "red", shape: "ring", text: "bot not initialized" });
            }
        } else {
            node.warn("config node failed to initialize.");
            this.status({ fill: "red", shape: "ring", text: "config node failed to initialize." });
        }

        this.on('input', function (msg) {

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
    }
    RED.nodes.registerType("telegram reply", TelegramReplyNode);
}

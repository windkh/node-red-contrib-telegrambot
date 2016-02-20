/**
* Created by Karl-Heinz Wind
**/

module.exports = function(RED) {
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

        this.usernames = [];
        if (n.usernames) {
            this.usernames = n.usernames.split(',');
        }

        this.chatids = [];
        if (n.chatids) {
            this.chatids = n.chatids.split(',');
        }

        if (this.credentials) {
            this.token = this.credentials.token;
            if (this.token) {
                this.token = this.token.trim();
                if (!this.telegramBot) {
                    this.telegramBot = new telegramBot(this.token, { polling: true });
                }
            }
        }


        this.on('close', function (done) {
            
            // Workaround: the api does not support stopping the polling timer which is neccessary on redeploy.
            // see https://github.com/yagop/node-telegram-bot-api/issues/69
            //self.telegramBot.stopPolling();
            
            if (self.telegramBot._polling) {
                self.telegramBot._polling.abort = true;
                self.telegramBot._polling.lastRequest.cancel('Polling stopped');
            }

            done();
        });
        
        this.isAuthorizedUser = function (user) {
            var isAuthorized = false;
            if (self.usernames.length > 0) {
                if (self.usernames.indexOf(user) >= 0) {
                    isAuthorized = true;
                }
            } else {
                isAuthorized = true;
            }
                
            return isAuthorized;
        }

        this.isAuthorizedChat = function (chatid) {
            var isAuthorized = false;
            if (self.usernames.length > 0) {
                if (self.chatids.indexOf(chatid) >= 0) {
                    isAuthorized = true;
                }
            } else {
                isAuthorized = true;
            }
                
            return isAuthorized;
        }

        this.isAuthorized = function (chatid, user) {
            var isAuthorizedUser = self.isAuthorizedUser(user);
            var isAuthorizedChatId = self.isAuthorizedChat(chatid);

            return isAuthorizedUser || isAuthorizedChatId;
        }
    }
    RED.nodes.registerType("telegram bot", TelegramBotNode, {
        credentials: {
            token: { type: "text" }
        }
    });
    
    // creates the message details object from the original message
    function getMessageDetails(botMsg) {

        var messageDetails;
        if (botMsg.text) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'message', content: botMsg.text };
        } else if (botMsg.photo) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'photo', content: botMsg.photo[0].file_id, caption: botMsg.caption, date: botMsg.date };
        } else if (botMsg.audio) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'audio', content: botMsg.audio.file_id, caption: botMsg.caption, date: botMsg.date };
        } else if (botMsg.document) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'document', content: botMsg.document.file_id, caption: botMsg.caption, date: botMsg.date };
        } else if (botMsg.sticker) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'sticker', content: botMsg.sticker.file_id };
        } else if (botMsg.video) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'video', content: botMsg.video.file_id, caption: botMsg.caption, date: botMsg.date };
        } else if (botMsg.voice) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'voice', content: botMsg.voice.file_id, caption: botMsg.caption, date: botMsg.date };
        } else if (botMsg.location) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'location', content: botMsg.location };
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
            this.status({ fill: "red", shape: "ring", text: "disconnected" });

            node.telegramBot = this.config.telegramBot;
            if (node.telegramBot) {
                this.status({ fill: "green", shape: "ring", text: "connected" });
            
                node.telegramBot.on('message', function(botMsg) {
                    var username = botMsg.from.username;
                    var chatid = botMsg.chat.id;
                    if (node.config.isAuthorized(chatid, username)) {

                        var messageDetails = getMessageDetails(botMsg);
                        if (messageDetails) {
                            var msg = { payload: messageDetails, originalMessage: botMsg };
                            node.send(msg);
                        }
                    } else {
                        // ignoring unauthorized calls
                        node.warn("Unauthorized incoming call from " + username);
                    }
                });
            } else {
                node.warn("no bot in config.");
            }
        } else {
            node.warn("no config.");
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
            this.status({ fill: "red", shape: "ring", text: "disconnected" });
            
            node.telegramBot = this.config.telegramBot;
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
                            if (message.slice(0, command.length) == command) {
                                //if (message.startsWith(command)) { // replaced with line above as as this requires ECMA-Standard 6!
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
                        node.warn("Unauthorized incoming call from " + username);
                    }
                });
            } else {
                node.warn("no bot in config.");
            }
        } else {
            node.warn("no config.");
        }
    }
    RED.nodes.registerType("telegram command", TelegramCommandNode);
    
    

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
            this.status({ fill: "red", shape: "ring", text: "disconnected" });

            node.telegramBot = this.config.telegramBot;
            if (node.telegramBot) {
                this.status({ fill: "green", shape: "ring", text: "connected" });
            } else {
                node.warn("no bot in config.");
            }
        } else {
            node.warn("no config.");
        }
        
        this.on('input', function (msg) {

            if (msg.payload) {
                if (msg.payload.content) {
                    if (msg.payload.chatId) {
                        if (msg.payload.type) {
                            
                            var chatId = msg.payload.chatId;
                            var type = msg.payload.type;

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
                                        });

                                } while (!done)
                                    

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
    // chatId  : string destination chat
    // type    : string type of message to send
    // content : message content
    function TelegramReplyNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        this.bot = config.bot;
        
        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.status({ fill: "red", shape: "ring", text: "disconnected" });
            
            node.telegramBot = this.config.telegramBot;
            if (node.telegramBot) {
                this.status({ fill: "green", shape: "ring", text: "connected" });
            } else {
                node.warn("no bot in config.");
            }
        } else {
            node.warn("no config.");
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
                        node.warn("msg.payload.type is empty");
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




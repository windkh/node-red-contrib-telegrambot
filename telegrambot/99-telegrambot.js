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
        RED.nodes.createNode(this,n);

        this.botname = n.botname;

        if (this.credentials) {
            this.token = this.credentials.token;
            if (this.token) {
                this.telegramBot = new telegramBot(this.token, { polling: true });
            }
        }
    }
    RED.nodes.registerType("telegram-bot", TelegramBotNode, {
        credentials: {
            token: { type: "text" }
        }
    });

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
            
                node.telegramBot.on('message', function (botMsg) {

                    var messageDetails;
                    if (botMsg.text) {
                        messageDetails =  { chatId : botMsg.chat.id, type : 'message', content: botMsg.text };
                    }
                    else if (botMsg.photo) {
                        messageDetails = { chatId : botMsg.chat.id, type : 'photo', content: botMsg.photo[0].file_id, caption : botMsg.caption, date : botMsg.date };
                    }
                    else if (botMsg.audio) {
                        messageDetails = { chatId : botMsg.chat.id, type : 'audio', content: botMsg.audio.file_id, caption : botMsg.caption, date : botMsg.date };
                    }
                    else if (botMsg.document) {
                        messageDetails = { chatId : botMsg.chat.id, type : 'document', content: botMsg.document.file_id, caption : botMsg.caption, date : botMsg.date };
                    }
                    else if (botMsg.sticker) {
                        messageDetails = { chatId : botMsg.chat.id, type : 'sticker', content: botMsg.sticker.file_id };
                    }
                    else if (botMsg.video) {
                        messageDetails = { chatId : botMsg.chat.id, type : 'video', content: botMsg.video.file_id, caption : botMsg.caption, date : botMsg.date };
                    }
                    else if (botMsg.voice) {
                        messageDetails = { chatId : botMsg.chat.id, type : 'voice', content: botMsg.voice.file_id, caption : botMsg.caption, date : botMsg.date };
                    } 
                    else if (botMsg.location) {
                        messageDetails = { chatId : botMsg.chat.id, type : 'location', content: botMsg.location };
                    }
                    else if (botMsg.contact) {
                        messageDetails = { chatId : botMsg.chat.id, type : 'contact', content: botMsg.contact };
                    }
                    else {
                        // unknown type --> no output
                    }
                    
                    if (messageDetails) {
                        var msg = { payload: messageDetails, originalMessage : botMsg };
                        node.send(msg);  
                    }
                });
            }
            
            this.status({ fill: "green", shape: "ring", text: "connected" });
        } else {
            node.warn("TelegramInNode: no config.");
        }
    }
    RED.nodes.registerType("telegram-in", TelegramInNode);

    
    
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
                    
                    var messageDetails;
                    if (botMsg.text) {
                        var message = botMsg.text;
                        if (message.startsWith(command)) {
                            var remainingText = message.replace(command, "");
                            messageDetails = { chatId : botMsg.chat.id, type : 'message', content: remainingText };
                        }
                    }
                    else {
                        // unknown type --> no output
                    }
                    
                    if (messageDetails) {
                        var msg = { payload: messageDetails, originalMessage : botMsg };
                        node.send(msg);
                    }
                });
            }
            
            this.status({ fill: "green", shape: "ring", text: "connected" });
        } else {
            node.warn("TelegramCommandNode: no config.");
        }
    }
    RED.nodes.registerType("telegram-command", TelegramCommandNode);
    
    

    // --------------------------------------------------------------------------------------------
    // The output node sends to the chat
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
            }
        } else {
            node.warn("TelegramInNode: no config.");
        }
        
        this.on('input', function (msg) {
            var chatId = msg.payload.chatId;
            var type = msg.payload.type;
            
            switch (type) {
                case 'message':
                    node.telegramBot.sendMessage(chatId, msg.payload.content);
                    break;
                case 'photo':
                    node.telegramBot.sendPhoto(chatId, msg.payload.content);
                    break;
                case 'audio':
                    node.telegramBot.sendAudio(chatId, msg.payload.content);
                    break;
                case 'document':
                    node.telegramBot.sendDocument(chatId, msg.payload.content);
                    break;
                case 'sticker':
                    node.telegramBot.sendSticker(chatId, msg.payload.content);
                    break;
                case 'video':
                    node.telegramBot.sendVideo(chatId, msg.payload.content, msg.payload.caption);
                    break;
                case 'voice':
                    node.telegramBot.sendVoice(chatId, msg.payload.content);
                    break;
                case 'location':
                    node.telegramBot.sendLocation(chatId, msg.payload.content.latitude, msg.payload.content.longitude);
                    break;
                default:
                    // unknown type nothing to send.
            }            
        });
    }
    RED.nodes.registerType("telegram-out", TelegramOutNode);   
}

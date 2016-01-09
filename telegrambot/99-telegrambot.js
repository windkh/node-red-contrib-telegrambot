/**
* Created by Karl-Heinz Wind
**/

module.exports = function(RED) {
    "use strict";
    //var settings = RED.settings;
    var events = require("events");
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
    // The input node receives messages from the bot
    // the message details are stored in the playload
    // chatId
    // text
    // The original message is stored next to payload.
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
                    var messageDetails = { chatId : botMsg.chat.id, text: botMsg.text };
                    var msg = { payload: messageDetails, originalMessage : botMsg };
                    node.send(msg);
                });

            }
            
            this.status({ fill: "green", shape: "ring", text: "connected" });
        } else {
            node.warn("TelegramInNode: no config.");
        }

        this.on("close", function () {
           
        });
    }
    RED.nodes.registerType("telegram-in", TelegramInNode);


    // --------------------------------------------------------------------------------------------
    // The output node sends messages to the chat
    // The payload needs two fields
    // chatId
    // text
    // Right now only text is supported.
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
            node.telegramBot.sendMessage(chatId, msg.payload.text);
        });
        
        
        this.on("close", function () {
           
        });
    }
    RED.nodes.registerType("telegram-out", TelegramOutNode);   
}

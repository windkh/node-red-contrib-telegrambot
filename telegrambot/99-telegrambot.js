/**
* Created by Karl-Heinz Wind
**/

module.exports = function(RED) {
    "use strict";
    //var settings = RED.settings;
    var events = require("events");
    var telegramBot = require('node-telegram-bot-api');
    
    // --------------------------------------------------------------------------------------------
    // The configuration node holds the token and establishes the connection to the telegram bot
    function TelegramBotNode(n) {
        RED.nodes.createNode(this,n);

        this.botname = n.botname;

        if (this.credentials) {
            this.token = this.credentials.token;
        }
    }
    RED.nodes.registerType("telegram-bot", TelegramBotNode, {
        credentials: {
            token: { type: "text" }
        }
    });

    // --------------------------------------------------------------------------------------------
    // The input node receives messages from the bot
    function TelegramInNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        this.bot = config.bot;
        
        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.status({ fill: "red", shape: "ring", text: "disconnected" });

            node.telegramBot = connectionPool.get(this.config.token);

            node.telegramBot.on('message', function (botMsg) {
                var messageDetails = { chatId : botMsg.chat.id, text: botMsg.text };
                var msg = { payload: messageDetails, originalMessage : botMsg };
                node.send(msg);
            });

            this.status({ fill: "green", shape: "ring", text: "connected" });
        } else {
            node.warn("TelegramInNode: no config.");
        }

        this.on("close", function () {
           
        });
    }
    RED.nodes.registerType("telegram-in", TelegramInNode);


    // --------------------------------------------------------------------------------------------
    // The output node receives messages from the bot
    function TelegramOutNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        this.bot = config.bot;
        
        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.status({ fill: "red", shape: "ring", text: "disconnected" });
            
            node.connection = connectionPool.get(this.config.token);
                        
            this.status({ fill: "green", shape: "ring", text: "connected" });
        } else {
            node.warn("TelegramInNode: no config.");
        }
        
        this.on('input', function (msg) {
            var chatId = msg.payload.chatId;
            node.connection.telegramBot.sendMessage(chatId, "Received: " + msg.payload.text);
        });
        
        
        this.on("close", function () {
           
        });
    }
    RED.nodes.registerType("telegram-out", TelegramOutNode);
    

    // --------------------------------------------------------------------------------------------
    var connectionPool = function () {
        var connections = {};
        return {
            get: function (token) {
                var id = token;
                if (!connections[id]) {
                    connections[id] = function () {
                        var obj = {
                            _emitter: new events.EventEmitter(),
                            telegramBot: null,
                            on: function (a, b) { this._emitter.on(a, b); },
                        }

                        var setupConnection = function () {
                            obj.telegramBot = new telegramBot(token, { polling: true });

                            obj.telegramBot.on('message', function (msg) {
                                obj._emitter.emit('message', msg);
                            });
                        }

                        setupConnection();
                        return obj;
                    }();
                }
                return connections[id];
            },
            close: function (token, done) {
                if (connections[token]) {
                    delete connections[token];
                } else {
                    done();
                }
            }
        }
    }();
}

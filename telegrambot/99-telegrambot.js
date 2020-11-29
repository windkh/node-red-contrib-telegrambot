/**
* Created by Karl-Heinz Wind
**/

// Temporary fix for 0.30.0 api
process.env["NTBA_FIX_319"] = 1;

module.exports = function (RED) {
    "use strict";
    var telegramBot = require('node-telegram-bot-api');
    const Agent = require('socks5-https-client/lib/Agent')

    // --------------------------------------------------------------------------------------------
    // The configuration node
    // holds the token
    // and establishes the connection to the telegram bot
    // you can either select between polling mode and webhook mode.
    function TelegramBotNode(n) {
        RED.nodes.createNode(this, n);

        var self = this;

        // this sandbox is a lightweight copy of the sandbox in the function node to be as compatible as possible to the syntax allowed there. 
        var sandbox = {
            node : {},

            context: {
                get: function() {
                    return sandbox.node.context().get.apply(sandbox.node,arguments);
                },
                keys: function() {
                    return sandbox.node.context().keys.apply(sandbox.node,arguments);
                },
                get global() {
                    return sandbox.node.context().global;
                },
                get flow() {
                    return sandbox.node.context().flow;
                }
            },
            flow: {
                get: function() {
                    return sandbox.node.context().flow.get.apply(sandbox.node,arguments);
                },
                keys: function() {
                    return sandbox.node.context().flow.keys.apply(sandbox.node,arguments);
                }
            },
            global: {
                get: function() {
                    return sandbox.node.context().global.get.apply(sandbox.node,arguments);
                },
                keys: function() {
                    return sandbox.node.context().global.keys.apply(sandbox.node,arguments);
                }
            },
            env: {
                get: function(envVar) {
                    var flow = sandbox.node._flow;
                    return flow.getSetting(envVar);
                }
            }
        };
        sandbox.node = this;

        this.pendingCommands = {};  // dictionary that contains all pending commands.
        this.commands = [];  // contains all configured command nodes

        this.config = n;

        // contains all the nodes that make use of the bot connection maintained by this configuration node.
        this.users = [];

        this.status = "disconnected";

        // Reading configuration properties...
        this.botname = n.botname;
        this.verbose = n.verboselogging;

        this.baseApiUrl = n.baseapiurl;

        this.updateMode = n.updatemode;
        if (!this.updateMode) {
            this.updateMode = "polling";
        }

        // 1. optional when polling mode is used
        this.pollInterval = parseInt(n.pollinterval);
        if (isNaN(this.pollInterval)) {
            this.pollInterval = 300;
        }

        // 2. optional when webhook is used.
        this.botHost = n.bothost;

        this.publicBotPort = parseInt(n.publicbotport);
        if (isNaN(this.publicBotPort)) {
            this.publicBotPort = 8443;
        }

        this.localBotPort = parseInt(n.localbotport);
        if (isNaN(this.localBotPort)) {
            this.localBotPort = this.publicBotPort;
        }

        // 3. optional when webhook and self signed certificate is used
        this.privateKey = n.privatekey;
        this.certificate = n.certificate;
        this.useSelfSignedCertificate = n.useselfsignedcertificate;
        this.sslTerminated = n.sslterminated;

        // 4. optional when request via SOCKS5 is used. 
        this.useSocks = n.usesocks;
        if (this.useSocks) {
            this.socksRequest = {
                agentClass: Agent,
                agentOptions: {
                    socksHost: n.sockshost,
                    socksPort: n.socksport,
                    socksUsername: n.socksusername,
                    socksPassword: n.sockspassword,
                },
            };
        }

        this.useWebhook = false;
        if (this.updateMode == "webhook") {
            if (this.botHost && (this.sslTerminated || (this.privateKey && this.certificate))) {
                this.useWebhook = true;
            } else {
                self.error("Configuration data for webhook is not complete. Defaulting to polling mode.");
            }
        }

        // Activates the bot or returns the already activated bot. 
        this.getTelegramBot = function () {
            if (!this.telegramBot) {
                if (this.credentials) {
                    this.token = this.getBotToken(this.credentials.token);
                    if (this.token) {
                        if (!this.telegramBot) {

                            if (this.useWebhook) {
                                var webHook =
                                {
                                    autoOpen: true,
                                    port: this.localBotPort,
                                };
                                if (!this.sslTerminated) {
                                    webHook.key = this.privateKey;
                                    webHook.cert = this.certificate;
                                }
                                var options =
                                {
                                    webHook: webHook,
                                    baseApiUrl: this.baseApiUrl,
                                    request: this.socksRequest,
                                };
                                this.telegramBot = new telegramBot(this.token, options);

                                this.telegramBot.on('webhook_error', function (error) {

                                    self.setUsersStatus({ fill: "red", shape: "ring", text: "webhook error" })

                                    if (self.verbose) {
                                        self.warn("Webhook error: " + error.message);
                                    }

                                    // TODO: check if we should abort in future when this happens
                                    // self.abortBot(error.message, function () {
                                    //     self.warn("Bot stopped: Webhook error.");
                                    // });
                                });

                                var botUrl = "https://" + this.botHost + ":" + this.publicBotPort + "/" + this.token;
                                var setWebHookOptions;
                                if (!this.sslTerminated && this.useSelfSignedCertificate) {
                                    setWebHookOptions = {
                                        certificate: options.webHook.cert,
                                    };
                                }
                                this.telegramBot.setWebHook(botUrl, setWebHookOptions).then(function (success) {

                                    if (self.verbose) {
                                        self.telegramBot.getWebHookInfo().then(function (result) {
                                            self.log("Webhook enabled: " + JSON.stringify(result));
                                        });
                                    }

                                    if (success) {
                                        self.status = "connected";
                                    }
                                    else {
                                        self.abortBot("Failed to set webhook " + botUrl, function () {
                                            self.warn("Bot stopped: Webhook not set.");
                                        });
                                    }
                                });
                            }
                            else {
                                var polling = {
                                    autoStart: true,
                                    interval: this.pollInterval
                                }

                                var options = {
                                    polling: polling,
                                    baseApiUrl: this.baseApiUrl,
                                    request: this.socksRequest,
                                };
                                this.telegramBot = new telegramBot(this.token, options);
                                self.status = "connected";

                                this.telegramBot.on('polling_error', function (error) {

                                    self.setUsersStatus({ fill: "red", shape: "ring", text: "polling error" })
                                    // We reset the polling status after the 80% of the timeout
                                    setTimeout( function()
                                    {
                                        self.setUsersStatus({ fill: "green", shape: "ring", text: "polling" })
                                    }, (self.pollInterval * 0.80));

                                    if (self.verbose) {
                                        self.warn(error.message);
                                    }
                                     
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
                                    else if (error.message.startsWith("EFATAL: Error: SOCKS connection failed. Connection refused.")) {
                                        hint = "Username or password may be be wrong or connection is down. Aborting.";
                                    }
                                    else if (error.message.startsWith("EFATAL: Error: connect ETIMEDOUT")) {
                                        hint = "Server did not respond. Maybe proxy blocked polling. Trying again.";
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
                                        if (self.verbose) {
                                            self.warn(hint);
                                        }
                                    }
                                });
                            }

                            this.telegramBot.on('error', function (error) {
                                self.warn("Bot error: " + error.message);

                                self.abortBot(error.message, function () {
                                    self.warn("Bot stopped: Fatal Error.");
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
            if (self.telegramBot !== null) {
                if (self.telegramBot._polling) {
                    self.telegramBot.stopPolling()
                        .then(function () {
                            self.telegramBot = null;
                            self.status = "disconnected";
                            self.setUsersStatus({ fill: "red", shape: "ring", text: "bot stopped. " + hint })
                            done();
                        });
                }

                if (self.telegramBot._webHook) {
                    self.telegramBot.deleteWebHook();
                    self.telegramBot.closeWebHook()
                        .then(function () {
                            self.telegramBot = null;
                            self.status = "disconnected";
                            self.setUsersStatus({ fill: "red", shape: "ring", text: "bot stopped. " + hint })
                            done();
                        });
                }
            }
            else {
                self.status = "disconnected";
                self.setUsersStatus({ fill: "red", shape: "ring", text: "bot stopped. " + hint })
                done();
            }
        }
          
        this.getBotToken = function (botToken) {
            botToken = this.credentials.token;
            if (botToken) {
                botToken = botToken.trim();
            }

            if(botToken.startsWith("{") && botToken.endsWith("}")){   
                
                var expression = botToken.substr(1, botToken.length - 2);
                var code = `sandbox.${expression};`;
             
                try {
                    botToken = eval(code);
                } catch (e) {
                    botToken = undefined;
                }
            }
            return botToken;
        }

        this.getUserNames = function(node){
            var usernames = [];
            if (self.config.usernames !== "") {
                var trimmedUsernames = self.config.usernames.trim(); 
                if(trimmedUsernames.startsWith("{") && trimmedUsernames.endsWith("}")){   
                    
                    var expression = trimmedUsernames.substr(1, trimmedUsernames.length - 2);
                    var code = `sandbox.${expression};`;
                 
                    try {

                        usernames = eval(code);
                        if(usernames === undefined){
                            usernames = [];
                        }
                    } catch (e) {
                        usernames = [];
                    }
                }
                else{
                    usernames = self.config.usernames.split(',');
                }
            }

            return usernames;
        }

        this.getChatIds = function(node){
            var chatids = [];
            if (self.config.chatids  !== "") {
                var trimmedChatIds = self.config.chatids.trim(); 
                if(trimmedChatIds.startsWith("{") && trimmedChatIds.endsWith("}")){   
                    
                    var expression = trimmedChatIds.substr(1, trimmedChatIds.length - 2);
                    var code = `sandbox.${expression};`;
                 
                    try {
                        chatids = eval(code);
                        if(chatids === undefined){
                            chatids = [];
                        }
                    } catch (e) {
                        chatids = [];
                    }
                }
                else{
                    chatids = self.config.chatids.split(',').map(function(item) {
                        return parseInt(item, 10);
                    });
                }
            }

            return chatids;
        }

        this.isAuthorizedUser = function (node, user) {
            var isAuthorized = false;

            var usernames = self.getUserNames(node);
            if (usernames.length > 0) {
                if (usernames.indexOf(user) >= 0) {
                    isAuthorized = true;
                }
            }

            return isAuthorized;
        }

        this.isAuthorizedChat = function (node, chatid) {
            var isAuthorized = false;
            var chatids = self.getChatIds(node);
            if (chatids.length > 0) {
                for (var i = 0; i < chatids.length; i++) {
                    var id = chatids[i];
                    if (id === chatid) {
                        isAuthorized = true;
                        break;
                    }
                }
            }

            return isAuthorized;
        }

        this.isAuthorized = function (node, chatid, user) {
            var isAuthorizedUser = self.isAuthorizedUser(node, user);
            var isAuthorizedChatId = self.isAuthorizedChat(node, chatid);

            var isAuthorized = false;

            if (isAuthorizedUser || isAuthorizedChatId) {
                isAuthorized = true;
            } else {
                if (self.config.chatids === "" && self.config.usernames === "") {
                    isAuthorized = true;
                }
            }

            return isAuthorized;
        }

        this.register = function (node) {
            var id = node.id;
            if (self.users.indexOf(id) === -1) {
                self.users.push(id);
            }
            else {
                if (self.verbose) {
                    // This warnin was removed as it caused confusion: see https://github.com/windkh/node-red-contrib-telegrambot/issues/87
                    // self.warn("Node " + id + " registered twice at the configuration node: ignoring.");	
                }
            }
        }

        this.setUsersStatus = function (status) {
            self.users.forEach(function (nodeId) {
                var userNode = RED.nodes.getNode(nodeId);
                if (userNode) {
                    userNode.status(status);
                }
            });
        }

        this.createUniqueKey = function (username, chatid) {
            return username + "@" + chatid;
        }

        this.setCommandPending = function (command, username, chatid) {
            var key = self.createUniqueKey(username, chatid);
            self.pendingCommands[key] = command;
        }
        
        this.resetCommandPending = function (command, username, chatid) {
            var key = self.createUniqueKey(username, chatid);
            delete self.pendingCommands[key];
        }

        this.isCommandPending = function (command, username, chatid) {
            var key = self.createUniqueKey(username, chatid);
            
            var isPending = false;
            if(self.pendingCommands[key] !== undefined){
                var value = self.pendingCommands[key];
                if(value === command){
                    isPending = true;
                }
            };
            return isPending;
        }

        this.registerCommand = function (command) {
            self.commands.push(command);
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

        // Note that photos and videos can be sent as media group. The bot will receive the contents as single messages.
        // Therefore the photo and video messages can contain a mediaGroupId if so....
        var messageDetails;
        if (botMsg.text) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'message', content: botMsg.text, date: botMsg.date };
        } else if (botMsg.photo) {
            // photos are sent using several resolutions. Therefore photo is an array. We choose the one with the highest resolution in the array.
            var index = getPhotoIndexWithHighestResolution(botMsg.photo);
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'photo', content: botMsg.photo[index].file_id, caption: botMsg.caption, date: botMsg.date, blob: true, photos: botMsg.photo, mediaGroupId: botMsg.media_group_id };
        } else if (botMsg.audio) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'audio', content: botMsg.audio.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.sticker) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'sticker', content: botMsg.sticker.file_id, date: botMsg.date, blob: true };
        } else if (botMsg.animation) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'animation', content: botMsg.animation.file_id, caption: botMsg.caption, date: botMsg.date, blob: true, mediaGroupId: botMsg.media_group_id };
        } else if (botMsg.video) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'video', content: botMsg.video.file_id, caption: botMsg.caption, date: botMsg.date, blob: true, mediaGroupId: botMsg.media_group_id };
        } else if (botMsg.video_note) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'video_note', content: botMsg.video_note.file_id, caption: botMsg.caption, date: botMsg.date, blob: true }; // maybe video_note will get a caption in future, right now it is not available.
        } else if (botMsg.voice) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'voice', content: botMsg.voice.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.location) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'location', content: botMsg.location, date: botMsg.date };
        } else if (botMsg.venue) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'venue', content: botMsg.venue, date: botMsg.date };
        } else if (botMsg.contact) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'contact', content: botMsg.contact, date: botMsg.date };
        } else if (botMsg.document) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'document', content: botMsg.document.file_id, caption: botMsg.caption, date: botMsg.date, blob: true };
        } else if (botMsg.poll) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'poll', content: botMsg.poll, date: botMsg.date, blob: false };
        } else if (botMsg.invoice) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'invoice', content: botMsg.invoice, date: botMsg.date };
        } else if (botMsg.successful_payment) {
            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'successful_payment', content: botMsg.successful_payment, date: botMsg.date };
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
        node.filterCommands = config.filterCommands || false;
        
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

                        if (node.config.isAuthorized(node, chatid, username)) {
                            // downloadable "blob" message?
                            if (messageDetails.blob) {
                                var fileId = msg.payload.content;
                                node.telegramBot.getFileLink(fileId).then(function (weblink) {
                                    msg.payload.weblink = weblink;

                                    // download and provide with path
                                    if (config.saveDataDir) {
                                        node.telegramBot.downloadFile(fileId, config.saveDataDir).then(function (path) {
                                            msg.payload.path = path;
                                            node.send([msg, null]);
                                        });
                                    } else {
                                        node.send([msg, null]);
                                    }
                                });
                                // vanilla message
                            } else if (node.filterCommands && node.config.commands.includes(messageDetails.content)) {
                                // Do nothing  
                            } else {
                                node.send([msg, null]);
                            }
                        } else {
                            if (node.config.verbose) {
                                node.warn("Unauthorized incoming call from " + username);
                            }
                            node.send([null, msg]);
                        }
                    }
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
        var useRegex = config.useRegex || false;

        var regEx;
        if(useRegex){
            try {
                regEx = new RegExp(command);
            } catch(ex) {
                node.status({ fill: "red", shape: "ring", text: ex.message });
                node.warn(ex.message);
                return;
            }
        }

        var strict = config.strict;
        var hasresponse = config.hasresponse;
        if(hasresponse === undefined){
            hasresponse = true;
        }

        this.bot = config.bot;
        
        this.config = RED.nodes.getNode(this.bot);
        if (this.config) {
            this.config.register(node);
            this.config.registerCommand(command);

            node.status({ fill: "red", shape: "ring", text: "not connected" });

            node.telegramBot = this.config.getTelegramBot();
            node.botname = this.config.botname;
            if (node.telegramBot) {
                node.status({ fill: "green", shape: "ring", text: "connected" });

                node.telegramBot.on('message', function (botMsg) {
                    node.status({ fill: "green", shape: "ring", text: "connected" });

                    var username = botMsg.from.username;
                    var chatid = botMsg.chat.id;
                    if (node.config.isAuthorized(node, chatid, username)) {
                        var msg;
                        var messageDetails;
                        if (botMsg.text) {
                            var message = botMsg.text;
                            var tokens = message.split(" ");

                            // check if this is a command at all first
                            var isCommandMessage = tokens[0].startsWith("/");

                            // then if this command is meant for this node
                            var isChatCommand = tokens[0] === command;
                            var command2 = command + "@" + node.botname;
                            var isDirectCommand = tokens[0] === command2;
                            var isGroupChat = chatid < 0;
                            var isRegExMatch = false;
                            if(useRegex){
                                isRegExMatch = regEx.test(tokens[0]);
                            }

                            if ( isDirectCommand ||
                                (isChatCommand && !isGroupChat) ||
                                (isChatCommand && isGroupChat && !strict) ||
                                (useRegex && isRegExMatch)) {

                                var remainingText;
                                if (isDirectCommand) {
                                    remainingText = message.replace(command2, "");
                                }
                                else {
                                    remainingText = message.replace(command, "");
                                }

                                messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'message', content: remainingText };
                                msg = { payload: messageDetails, originalMessage: botMsg };

                                if (hasresponse) {
                                    node.send([msg, null]);
                                    node.config.setCommandPending(command, username, chatid);
                                } else {
                                    node.send(msg);
                                }
                            } else {
                                // Here we check if the received message is probably a resonse to a pending command.
                                if (!isCommandMessage) {
                                    if (hasresponse) {
                                        var isPending = node.config.isCommandPending(command, username, chatid);
                                        if (isPending) {
                                            messageDetails = { chatId: botMsg.chat.id, messageId: botMsg.message_id, type: 'message', content: botMsg.text };
                                            msg = { payload: messageDetails, originalMessage: botMsg };
                                            node.send([null, msg]);
                                            node.config.resetCommandPending(command, username, chatid);
                                        }
                                    }
                                } else {
                                    // Here we just ignore what happened as we do not know if another node is registered for that command.
                                }
                            }
                        } else {
                            // unknown type --> no output
                        }
                    } else {
                        // ignoring unauthorized calls
                        if (node.config.verbose) {
                            node.warn("Unauthorized incoming call from " + username);
                        }
                    }
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
    // - edited_channel_post_text
    // - edited_channel_post_caption
    // - edited_message_text
    // - edited_message_caption
    // - pre_checkout_query
    // - shipping_query
    // - chosen_inline_result
    // - poll
    // - poll_answer
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
                        // polls can be anonymous, then we do not have a chatId.
                        if(this.event != 'poll'){
                            node.error("username or chatid undefined");
                        }
                    }
                    if (node.config.isAuthorized(node, chatid, username)) {
                        var msg;
                        var messageDetails;

                        switch (this.event) {
                            case 'callback_query':
                                var callbackQueryId = botMsg.id;
                                messageDetails = {
                                    chatId: chatid,
                                    messageId: botMsg.message.message_id,
                                    type: this.event,
                                    content: botMsg.data,
                                    callbackQueryId: callbackQueryId,
                                    from: botMsg.from
                                };
                                if (node.autoAnswerCallback) {
                                    node.telegramBot.answerCallbackQuery(callbackQueryId).then(function (result) {
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
                                    type: this.event,
                                    content: botMsg.query,
                                    inlineQueryId: inlineQueryId,
                                    offset: botMsg.offset,
                                    from: botMsg.from,
                                    location: botMsg.location // location is only available when /setinlinegeo is set in botfather
                                };
                                // Right now this is not supported as a result is required!
                                //if (node.autoAnswerCallback) {
                                //    // result = https://core.telegram.org/bots/api#inlinequeryresult
                                //    node.telegramBot.answerInlineQuery(inlineQueryId, results).then(function (result) {
                                //        // Nothing to do here
                                //        ;
                                //    });
                                //}
                                break;

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
                                    location: botMsg.location // for live location updates
                                };
                                break;

                            // the text of an already sent message.
                            case 'edited_message_text':
                                messageDetails = {
                                    chatId: chatid,
                                    type: this.event,
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
                                    type: this.event,
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
                                    type: this.event,
                                    content: botMsg.text,
                                    date: botMsg.date,
                                    chat: botMsg.chat
                                };
                                break;

                            case 'edited_channel_post':
                                messageDetails = {
                                    chatId: chatid,
                                    type: this.event,
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
                                    type: this.event,
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
                                    type: this.event,
                                    messageId: botMsg.message_id,
                                    content: botMsg.caption,
                                    editDate: botMsg.edit_date,
                                    date: botMsg.date,
                                    chat: botMsg.chat
                                };
                                break;

                            case 'pre_checkout_query':
                                var preCheckOutQueryId = botMsg.id;
                                messageDetails = {
                                    preCheckOutQueryId : preCheckOutQueryId,
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
                                    chat: botMsg.chat
                                };
                                break;

                            case 'shipping_query':
                                var shippingQueryId = botMsg.Id;
                                messageDetails = {
                                    shippingQueryId: shippingQueryId,
                                    chatId: chatid,
                                    type: this.event,
                                    from: botMsg.from,
                                    invoice_payload: botMsg.invoice_payload,
                                    content: botMsg.invoice_payload,
                                    shipping_address : botMsg.shipping_address,
                                    date: botMsg.date,
                                    chat: botMsg.chat
                                };
                                break;

                            case 'chosen_inline_result':
                                var result_id = botMsg.result_id;
                                messageDetails = {
                                    result_id: result_id,
                                    chatId: chatid,
                                    type: this.event,
                                    from: botMsg.from,
                                    location: botMsg.location,
                                    inline_message_id: botMsg.inline_message_id,
                                    query: botMsg.query,
                                    content: botMsg.result_id,
                                    date: botMsg.date,
                                    chat: botMsg.chat
                                };
                                break;

                            case 'poll_answer':
                                var poll_id = botMsg.poll_id;
                                messageDetails = {
                                    poll_id: poll_id,
                                    chatId: chatid,
                                    type: this.event,
                                    user: botMsg.user,
                                    option_ids: botMsg.option_ids,
                                    content: botMsg.user,
                                    date: botMsg.date,
                                    chat: botMsg.chat
                                };
                                break;

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
                        if (node.config.verbose) {
                            node.warn("Unauthorized incoming call from " + username);
                        }
                    }
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
    // message     content is String
    // photo       content is String|stream.Stream|Buffer
    // audio       content is String|stream.Stream|Buffer
    // document    content is String|stream.Stream|Buffer
    // sticker     content is String|stream.Stream|Buffer
    // video       content is String|stream.Stream|Buffer
    // voice       content is String|stream.Stream|Buffer
    // location    content is an object that contains latitude and logitude
    // contact     content is full contact object
    // mediaGroup  content is array of mediaObject
    // action      content is one of the following: 
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

        this.processMessage = function (chatId, msg, nodeSend, nodeDone) {

            if (msg.payload.forward) {
                // the message should be forwarded
                var toChatId = msg.payload.forward.chatId;

                // avoid forwarding the message to the chat where it comes from.
                if(toChatId != chatId){
                    var messageId = msg.payload.messageId;
                    node.telegramBot.forwardMessage(toChatId, chatId, messageId).then(function (result) {
                        msg.payload.content = result;
                        msg.payload.sentMessageId = result.message_id;
                        nodeSend(msg);
                        if (nodeDone) {
                            nodeDone();
                        }
                    });
                }
            }
            else {
                if (msg.payload.type) {
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

                                    node.telegramBot.sendMessage(chatId, messageToSend, msg.payload.options).then(function (result) {
                                        msg.payload.content = result;
                                        msg.payload.sentMessageId = result.message_id;
                                        nodeSend(msg);
                                        if (nodeDone) {
                                            nodeDone();
                                        }
                                    }).catch(function (err) {
                                        // markdown error? try plain mode
                                        if (
                                            String(err).includes("can't parse entities in message text:") &&
                                            msg.payload.options && msg.payload.options.parse_mode === 'Markdown'
                                        ) {
                                            delete msg.payload.options.parse_mode;
                                            node.telegramBot.sendMessage(chatId, messageToSend, msg.payload.options).then(function (result) {
                                                msg.payload.content = result;
                                                msg.payload.sentMessageId = result.message_id;
                                                nodeSend(msg);
                                                if (nodeDone) {
                                                    nodeDone();
                                                }
                                            });
                                            return;
                                        }
                                        if (nodeDone) {
                                            nodeDone(err);
                                        } else {
                                            throw err;
                                        }
                                    });

                                } while (!done)
                            }
                            break;

                        case 'photo':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendPhoto(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;
                        case 'mediaGroup':
                            if (this.hasContent(msg)) {
                                if (Array.isArray(msg.payload.content)) {
                                    for (var i = 0; i < msg.payload.content.length; i++) {
                                        var mediaItem = msg.payload.content[i];
                                        if (typeof mediaItem.type !== "string") {
                                            node.warn("msg.payload.content[" + i + "].type is not a string it is " + typeof mediaItem.type);
                                            break;
                                        }
                                        if (mediaItem.media === undefined) {
                                            node.warn("msg.payload.content[" + i + "].media is not defined");
                                            break;
                                        }
                                    }
                                    node.telegramBot.sendMediaGroup(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                        msg.payload.content = result;
                                        msg.payload.sentMessageId = result.message_id;
                                        nodeSend(msg);
                                        if (nodeDone) {
                                            nodeDone();
                                        }
                                    });
                                } else {
                                    node.warn("msg.payload.content for mediaGroup is not an array of mediaItem");
                                }
                            }
                            break;
                        case 'audio':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendAudio(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'document':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendDocument(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'poll':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendPoll(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'sticker':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendSticker(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'animation':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendAnimation(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'video':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendVideo(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'video_note':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendVideoNote(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'voice':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendVoice(chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'location':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendLocation(chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'venue':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendVenue(chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.content.title, msg.payload.content.address, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
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
                                node.telegramBot.sendContact(chatId, msg.payload.content.phone_number, msg.payload.content.first_name, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;
                        // --------------------------------------------------------------------

                        case 'editMessageLiveLocation':
                            if (this.hasContent(msg)) {
                                node.telegramBot.editMessageLiveLocation(msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'stopMessageLiveLocation':
                            // This message requires the options to be set!
                            //if (this.hasContent(msg)) {
                            node.telegramBot.stopMessageLiveLocation(msg.payload.options).then(function (result) {
                                msg.payload.content = result;
                                msg.payload.sentMessageId = result.message_id;
                                nodeSend(msg);
                                if (nodeDone) {
                                    nodeDone();
                                }
                            });
                            //}
                            break;

                        case 'callback_query':
                        case 'answerCallbackQuery':
                            if (this.hasContent(msg)) {
                                // The new signature expects one object instead of three arguments.
                                var callbackQueryId = msg.payload.callbackQueryId;
                                var options = {
                                    callback_query_id: callbackQueryId,
                                    text: msg.payload.content,
                                    show_alert: msg.payload.options
                                };
                                node.telegramBot.answerCallbackQuery(callbackQueryId, options).then(function (result) {
                                    msg.payload.content = result; // true if succeeded
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        case 'inline_query':
                        case 'answerInlineQuery':
                            //if (this.hasContent(msg)) {
                                var inlineQueryId = msg.payload.inlineQueryId;
                                var results = msg.payload.results; // this type requires results to be set: see https://core.telegram.org/bots/api#inlinequeryresult
                                node.telegramBot.answerInlineQuery(inlineQueryId, results).then(function (result) {
                                    msg.payload.content = result;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            //}
                            break;

                        case 'sendChatAction':
                        case 'action':
                            if (this.hasContent(msg)) {
                                node.telegramBot.sendChatAction(chatId, msg.payload.content).then(function (result) {
                                    msg.payload.content = result;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;
                            
                        // --------------------------------------------------------------------
                        // Some of the following functions require the bot to be administrator of the chat/channel

                        // 1 argument: chatId
                        case 'getChatAdministrators':
                        case 'getChatMembersCount':
                        case 'getChat':
                        case 'leaveChat':
                        case 'exportChatInviteLink':
                        case 'unpinAllChatMessages':
                        case 'deleteChatPhoto':
                            node.telegramBot[type](chatId).then(function (result) {
                                msg.payload.content = result;
                                nodeSend(msg);
                                if (nodeDone) {
                                    nodeDone();
                                }
                            });
                            break;

                        // 2 arguments: content, options
                        case 'editMessageCaption':
                        case 'editMessageText':
                        case 'editMessageReplyMarkup':
                            if (this.hasContent(msg)) {
                                node.telegramBot[type](msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    msg.payload.sentMessageId = result.message_id;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        // 2 arguments: chatId , content
                        case 'setChatTitle':
                        case 'setChatDescription':
                        case 'unpinChatMessage':
                        case 'deleteMessage':
                            if (this.hasContent(msg)) {
                                node.telegramBot[type](chatId, msg.payload.content).then(function (result) {
                                    msg.payload.content = result;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;
                                
                        // 3 arguments: chatId , content, options 
                        case 'pinChatMessage':
                        case 'setChatPhoto':
                        case 'kickChatMember':
                        case 'unbanChatMember':
                        case 'restrictChatMember':
                        case 'promoteChatMember':
                        case 'getChatMember':
                            // The userId must be passed in msg.payload.content: note that this is is a number not the username.
                            // Right now there is no way for resolving the user_id by username in the official API.
                            if (this.hasContent(msg)) {
                                node.telegramBot[type](chatId, msg.payload.content, msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            }
                            break;

                        // --------------------------------------------------------------------

                        // See https://core.telegram.org/bots/payments
                        // See https://core.telegram.org/bots/api#sendinvoice
                        case "sendInvoice":
                            //if (this.hasContent(msg)) {
                                node.telegramBot[type](chatId,
                                    msg.payload.content.title, 
                                    msg.payload.content.description, 
                                    msg.payload.content.payload, 
                                    msg.payload.content.providerToken, 
                                    msg.payload.content.startParameter, 
                                    msg.payload.content.currency, 
                                    msg.payload.content.prices, 
                                    msg.payload.options).then(function (result) {
                                    msg.payload.content = result;
                                    nodeSend(msg);
                                    if (nodeDone) {
                                        nodeDone();
                                    }
                                });
                            //}
                            break;

                            case "shipping_query":
                            case "answerShippingQuery":
                                //if (this.hasContent(msg)) {
                                    var shippingQueryId = msg.payload.shippingQueryId;
                                    var ok = msg.payload.ok; // this type requires ok to be set: see https://core.telegram.org/bots/api#answershippingquery
                                    var shippingOptions = msg.payload.options; // the optional shipping options
                                    var errorMeessage = msg.payload.errorMeessage; // the error message is optional when ok is false
                                    node.telegramBot.answerShippingQuery(
                                        shippingQueryId,
                                        ok, 
                                        shippingOptions,
                                        errorMeessage 
                                        ).then(function (result) {
                                        msg.payload.content = result;
                                        nodeSend(msg);
                                        if (nodeDone) {
                                            nodeDone();
                                        }
                                    });
                                //}
                                break;

                            case "pre_checkout_query":
                            case "answerPreCheckoutQuery":
                                //if (this.hasContent(msg)) {
                                    var preCheckOutQueryId = msg.payload.preCheckOutQueryId;
                                    var ok = msg.payload.ok; // this type requires ok to be set: see https://core.telegram.org/bots/api#answerprecheckoutquery
                                    node.telegramBot.answerPreCheckoutQuery(
                                        preCheckOutQueryId,
                                        ok
                                        ).then(function (result) {
                                        msg.payload.content = result;
                                        nodeSend(msg);
                                        if (nodeDone) {
                                            nodeDone();
                                        }
                                    });
                                //}
                                break;

                        // TODO:                            
                        // getUserProfilePhotos, getFile, 
                        // setChatStickerSet, deleteChatStickerSet
                        // sendGame, setGameScore, getGameHighScores
                        // getStickerSet, uploadStickerFile, createNewStickerSet, addStickerToSet, setStickerPositionInSet, deleteStickerFromSet

                        default:
                        // unknown type nothing to send.
                    }
                } else {
                    node.warn("msg.payload.type is empty");
                }
            } // forward
        }

        this.on('input', function (msg, nodeSend, nodeDone) {
            nodeSend = nodeSend || function () { node.send.apply(node, arguments) };

            node.status({ fill: "green", shape: "ring", text: "connected" });

            if (msg.payload) {
                if (msg.payload.chatId) {
                    if(!Array.isArray(msg.payload.chatId)){
                        var chatId = msg.payload.chatId;
                        this.processMessage(chatId, msg, nodeSend, nodeDone); 
                    } else{
                        var chatIds = msg.payload.chatId;
                        var length = chatIds.length;
                        for (var i = 0; i < length; i++) {
                            var chatId = chatIds[i];

                            var clonedMsg = RED.util.cloneMessage(msg);
                            clonedMsg.payload.chatId = chatId;
                            this.processMessage(chatId, clonedMsg, nodeSend, nodeDone); 
                        }
                    }   
                } else {
                    node.warn("msg.payload.chatId is empty");
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

        this.on('input', function (msg, nodeSend, nodeDone) {

            node.status({ fill: "green", shape: "ring", text: "connected" });

            if (msg.payload) {
                if (msg.payload.chatId) {
                    if (msg.payload.sentMessageId) {

                        var chatId = msg.payload.chatId;
                        var messageId = msg.payload.sentMessageId;

                        node.telegramBot.onReplyToMessage(chatId, messageId, function (botMsg) {

                            var messageDetails = getMessageDetails(botMsg);
                            if (messageDetails) {
                                msg.payload = messageDetails;
                                msg.originalMessage = botMsg;
                                nodeSend(msg);
                                if (nodeDone) {
                                    nodeDone();
                                }
                            }
                        });

                    } else {
                        node.warn("msg.payload.sentMessageId is empty");
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

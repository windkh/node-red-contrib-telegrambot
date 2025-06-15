// Created by Karl-Heinz Wind

// Avoid that node-telegram-bot-api will enable automatci promise cancellation (fix for 0.30.0 api)
process.env['NTBA_FIX_319'] = 1;

module.exports = function (RED) {
    'use strict';

    const path = require('path');
    const { pipeline } = require('stream');
    const fs = require('fs');

    let net = require('net');
    let Promise = require('bluebird');
    Promise.config({
        cancellation: true,
    });

    let telegramBot = require('node-telegram-bot-api');
    let telegramBotWebHook = require('node-telegram-bot-api/src/telegramWebHook');

    let { SocksProxyAgent } = require('socks-proxy-agent');

    const pkg = require('./../package.json');
    RED.log.info('node-red-contrib-telegrambot version: v' + pkg.version);

    // patch see #345
    // must be removed when https://github.com/yagop/node-telegram-bot-api/pull/1257 is merged into release
    let tgbe = require('node-telegram-bot-api/src/errors');
    class FatalError extends tgbe.BaseError {
        constructor(data) {
            const error = typeof data === 'string' ? null : data;
            const message = error ? error.message : data;
            super('SLIGHTLYBETTEREFATAL', message);
            if (error) this.stack = error.stack;
            if (error) this.cause = error;
        }
    }
    tgbe.FatalError = FatalError;

    // Orginal class is extended to be able to emit an event when getUpdates is called.
    class telegramBotWebHookEx extends telegramBotWebHook {
        constructor(bot) {
            super(bot);
        }

        open() {
            if (this.isOpen()) {
                return Promise.resolve();
            }
            return new Promise((resolve, reject) => {
                this._webServer.listen(this.options.port, this.options.host, () => {
                    RED.log.info('node-red-contrib-telegrambot: WebHook listening on ' + this.options.host + ':' + this.options.port);
                    this._open = true;
                    return resolve();
                });

                this._webServer.once('error', (err) => {
                    reject(err);
                });
            });
        }
    }

    // Orginal class is extended to be able to emit an event when getUpdates is called.
    class telegramBotEx extends telegramBot {
        constructor(token, options = {}) {
            super(token, options);
            this.cycle = 0;
        }

        getUpdates(form = {}) {
            this.cycle++;
            this.emit('getUpdates_start', this.cycle);
            let startTime = new Date().getTime();

            let result = super.getUpdates(form);
            result.then((updates) => {
                let endTime = new Date().getTime();
                this.emit('getUpdates_end', this.cycle, endTime - startTime, updates);
            });

            return result;
        }

        openWebHook() {
            if (this.isPolling()) {
                return Promise.reject('WebHook and Polling are mutually exclusive');
            }

            if (!this._webHook) {
                this._webHook = new telegramBotWebHookEx(this);
            }

            return this._webHook.open();
        }
    }

    let botsByToken = {};

    // --------------------------------------------------------------------------------------------
    // The configuration node
    // holds the token
    // and establishes the connection to the telegram bot
    // you can either select between polling mode and webhook mode.
    function TelegramBotNode(n) {
        RED.nodes.createNode(this, n);

        let self = this;

        // this is a dummy in case we abort to avoid problems in the nodes that make use of this function.
        // It will be overwritten during initialization!
        this.getTelegramBot = function () {
            return null;
        };

        this.tokenRegistered = false;

        // first of all check if the token is used twice: in this case we abort
        if (this.credentials !== undefined && this.credentials.token !== undefined) {
            this.token = this.credentials.token;

            let configNodeId = botsByToken[this.token];
            if (configNodeId === undefined) {
                botsByToken[self.token] = n.id;
                this.tokenRegistered = true;
            } else {
                if (configNodeId == n.id) {
                    this.tokenRegistered = true;
                } else {
                    this.tokenRegistered = false;
                    let conflictingConfigNode = RED.nodes.getNode(configNodeId);
                    self.error('Aborting: Token of ' + n.botname + ' is already in use by ' + conflictingConfigNode.botname + ': ' + self.token);
                    return;
                }
            }
        } else {
            self.warn('Aborting: Token of ' + n.botname + ' is not set');
            return;
        }

        // see https://github.com/windkh/node-red-contrib-telegrambot/issues/198
        self.setMaxListeners(0);

        // this sandbox is a lightweight copy of the sandbox in the function node to be as compatible as possible to the syntax allowed there.
        let sandbox = {
            node: {},

            context: {
                get: function () {
                    return sandbox.node.context().get.apply(sandbox.node, arguments);
                },
                keys: function () {
                    return sandbox.node.context().keys.apply(sandbox.node, arguments);
                },
                get global() {
                    return sandbox.node.context().global;
                },
                get flow() {
                    return sandbox.node.context().flow;
                },
            },
            flow: {
                get: function () {
                    return sandbox.node.context().flow.get.apply(sandbox.node, arguments);
                },
                keys: function () {
                    return sandbox.node.context().flow.keys.apply(sandbox.node, arguments);
                },
            },
            global: {
                get: function () {
                    return sandbox.node.context().global.get.apply(sandbox.node, arguments);
                },
                keys: function () {
                    return sandbox.node.context().global.keys.apply(sandbox.node, arguments);
                },
            },
            env: {
                get: function (envVar) {
                    let flow = sandbox.node._flow;
                    return flow.getSetting(envVar);
                },
            },
        };
        sandbox.node = this;

        this.pendingCommands = {}; // dictionary that contains all pending comands.
        this.commandsByNode = {}; // contains all configured command infos (command, description) by node.
        this.commandsByLanguage = {}; // contains all command sorted by language.

        this.config = n;

        this.status = 'disconnected';

        // Reading configuration properties...
        this.botname = n.botname;
        this.verbose = n.verboselogging;

        this.baseApiUrl = n.baseapiurl;
        this.testEnvironment = n.testenvironment;

        this.updateMode = n.updatemode;
        if (!this.updateMode) {
            this.updateMode = 'polling';
        }

        this.addressFamily = parseInt(n.addressfamily) || 0;

        // 1. optional when polling mode is used
        this.pollInterval = parseInt(n.pollinterval);
        if (isNaN(this.pollInterval)) {
            this.pollInterval = 300;
        }
        this.pollTimeout = 10; // seconds. This timeout is set to avoid close timeout on redeploy.

        // 2. optional when webhook is used.
        this.botHost = n.bothost;
        this.botPath = n.botpath;

        this.publicBotPort = parseInt(n.publicbotport);
        if (isNaN(this.publicBotPort)) {
            this.publicBotPort = 8443;
        }

        this.localBotPort = parseInt(n.localbotport);
        if (isNaN(this.localBotPort)) {
            this.localBotPort = this.publicBotPort;
        }

        this.localBotHost = n.localbothost || '0.0.0.0';
        if (this.localBotHost == '') {
            this.localBotHost = '0.0.0.0';
        }

        // 3. optional when webhook and self signed certificate is used
        this.privateKey = n.privatekey;
        this.certificate = n.certificate;
        this.useSelfSignedCertificate = n.useselfsignedcertificate;
        this.sslTerminated = n.sslterminated;

        // 4. optional when request via SOCKS is used.
        this.useSocks = n.usesocks;
        if (this.useSocks) {
            let socksprotocol = n.socksprotocol || 'socks5';
            let agentOptions = {
                hostname: n.sockshost,
                port: n.socksport,
                protocol: socksprotocol,
                // type: 5,
                timeout: 5000, // ms <-- does not really work
            };

            if (n.socksusername !== '') {
                agentOptions.username = n.socksusername;
            }

            if (n.sockspassword !== '') {
                agentOptions.password = n.sockspassword;
            }

            if (!isNaN(this.addressFamily)) {
                agentOptions.family = this.addressFamily;
            }

            this.request = {
                agentClass: SocksProxyAgent,
                agentOptions: agentOptions,
                pool: {},
            };
        } else {
            let agentOptions = {
                keepAlive: true,
            };

            if (!isNaN(this.addressFamily)) {
                agentOptions.family = this.addressFamily;
            }

            this.request = {
                agentOptions: agentOptions,
            };
        }

        this.useWebhook = false;
        if (this.updateMode == 'webhook') {
            if (this.botHost && (this.sslTerminated || (this.privateKey && this.certificate))) {
                this.useWebhook = true;
            } else {
                self.error('Configuration data for webhook is not complete. Defaulting to send only mode.');
            }
        }

        this.usePolling = false;
        if (this.updateMode == 'polling') {
            this.usePolling = true;
        }

        this.createTelegramBotForWebhookMode = function () {
            let newTelegramBot;

            let webHook = {
                autoOpen: false,
                port: this.localBotPort,
                host: this.localBotHost,
            };
            if (!this.sslTerminated) {
                webHook.key = this.privateKey;
                webHook.cert = this.certificate;
            }
            const options = {
                webHook: webHook,
                baseApiUrl: this.baseApiUrl,
                testEnvironment: this.testEnvironment,
                request: this.request,
            };

            newTelegramBot = new telegramBotEx(this.token, options);

            newTelegramBot
                .openWebHook()
                .then(function () {
                    // web hook listening on port, everything ok.
                })
                .catch(function (err) {
                    self.warn('Opening webhook failed: ' + err);

                    self.abortBot('Failed to listen on configured port', function () {
                        self.error('Bot stopped: failed to open web hook.');
                    });
                });

            newTelegramBot.on('webhook_error', function (error) {
                self.setStatus('error', 'webhook error');

                if (self.verbose) {
                    self.warn('Webhook error: ' + error.message);
                }

                // TODO: check if we should abort in future when this happens
                // self.abortBot(error.message, function () {
                //     self.warn("Bot stopped: Webhook error.");
                // });
            });

            const protocol = 'https://';

            // 1, check if the botHost contains a full path begining with https://
            let tempUrl = this.botHost;
            if (!tempUrl.startsWith(protocol)) {
                tempUrl = protocol + tempUrl;
            }

            // 2. check if the botHost contains a port; if not add publicBotPort
            const parsed = new URL(tempUrl);
            if (parsed.port == '') {
                parsed.port = this.publicBotPort;
            }

            // 3. check if the botHost contains a subpath: if not then add the botPath
            if (parsed.pathname == '' || parsed.pathname == '/') {
                parsed.pathname = this.botPath;
            } else {
                if (this.botPath != '') {
                    parsed.pathname = parsed.pathname + '/' + this.botPath;
                }
            }

            // 4. create the url from the patsed parts.
            let botUrl = parsed.href;

            if (!botUrl.endsWith('/')) {
                botUrl += '/';
            }

            botUrl += this.token;

            let setWebHookOptions;
            if (!this.sslTerminated && this.useSelfSignedCertificate) {
                setWebHookOptions = {
                    certificate: options.webHook.cert,
                };
            }
            newTelegramBot.setWebHook(botUrl, setWebHookOptions).then(function (success) {
                if (self.verbose) {
                    newTelegramBot.getWebHookInfo().then(function (result) {
                        self.log('Webhook enabled: ' + JSON.stringify(result));
                    });
                }

                if (success) {
                    self.status = 'connected'; // TODO: check if this must be SetStatus
                } else {
                    self.abortBot('Failed to set webhook ' + botUrl, function () {
                        self.error('Bot stopped: Webhook not set.');
                    });
                }
            });

            return newTelegramBot;
        };

        this.createTelegramBotForPollingMode = function () {
            function restartPolling() {
                setTimeout(function () {
                    // we check if abort was called in the meantime.
                    if (self.telegramBot !== undefined && self.telegramBot !== null) {
                        delete self.telegramBot._polling;
                        self.telegramBot._polling = null; // force the underlying API to recreate the class.
                        self.telegramBot.startPolling({ restart: true });
                    }
                }, 3000); // 3 seconds to not flood the output with too many messages.
            }

            let newTelegramBot;

            let polling = {
                autoStart: true,
                interval: this.pollInterval,
                params: {
                    timeout: this.pollTimeout,
                },
                // this is used when chat_member should be received.
                // params: {
                //     allowed_updates: [
                //         'update_id',
                //         'message',
                //         'edited_message',
                //         'channel_post',
                //         'edited_channel_post',
                //         'inline_query',
                //         'chosen_inline_result',
                //         'callback_query',
                //         'shipping_query',
                //         'pre_checkout_query',
                //         'poll',
                //         'poll_answer',
                //         'my_chat_member',
                //         'chat_member',
                //         'chat_join_request'],
                // }
            };

            const options = {
                polling: polling,
                baseApiUrl: this.baseApiUrl,
                testEnvironment: this.testEnvironment,
                request: this.request,
            };
            newTelegramBot = new telegramBotEx(this.token, options);

            self.status = 'connected';

            newTelegramBot.on('polling_error', function (error) {
                self.setStatus('error', 'polling error');

                // We reset the polling status after the 80% of the timeout
                setTimeout(function () {
                    // check if abort was called in the meantime.
                    if (self.telegramBot) {
                        self.setStatus('info', 'polling');
                    }
                }, self.pollInterval * 0.8);

                if (self.verbose) {
                    self.warn(error.message);

                    // patch see #345
                    self.warn(require('node:util').inspect(error, { depth: 5 }));
                }

                let stopPolling = false;
                let hint;
                if (error.message === 'ETELEGRAM: 401 Unauthorized') {
                    hint = 'Please check if the bot token is valid: ' + self.credentials.token;
                    stopPolling = true;
                } else {
                    // unknown error occured... we simply ignore it.
                    hint = 'Polling error --> Trying again.';
                }

                if (stopPolling) {
                    self.abortBot(error.message, function () {
                        self.error('Bot ' + self.botname + ' stopped: ' + hint);
                    });
                } else {
                    // here we simply ignore the bug and try to reestablish polling.
                    self.telegramBot.stopPolling({ cancel: false }).then(restartPolling, restartPolling);

                    // The following line is removed as this would create endless log files
                    if (self.verbose) {
                        self.warn(hint);
                    }
                }
            });

            return newTelegramBot;
        };

        this.createTelegramBotForSendOnlyMode = function () {
            let newTelegramBot;

            const options = {
                baseApiUrl: this.baseApiUrl,
                testEnvironment: this.testEnvironment,
                request: this.request,
            };
            newTelegramBot = new telegramBotEx(this.token, options);

            self.status = 'send only mode';

            return newTelegramBot;
        };

        this.createTelegramBot = function () {
            let newTelegramBot;
            if (this.useWebhook) {
                newTelegramBot = this.createTelegramBotForWebhookMode();
            } else if (this.usePolling) {
                newTelegramBot = this.createTelegramBotForPollingMode();
            } else {
                // here we configure send only mode. We do not poll nor use a web hook which means
                // that we can not receive messages.
                newTelegramBot = this.createTelegramBotForSendOnlyMode();
            }

            newTelegramBot.on('error', function (error) {
                self.warn('Bot error: ' + error.message);

                self.abortBot(error.message, function () {
                    self.warn('Bot stopped: Fatal Error.');
                });
            });

            return newTelegramBot;
        };

        // Activates the bot or returns the already activated bot.
        this.getTelegramBot = function () {
            if (!this.telegramBot) {
                if (this.credentials) {
                    this.token = this.getBotToken(this.credentials.token);
                    if (this.token) {
                        if (!this.telegramBot) {
                            this.telegramBot = this.createTelegramBot();
                        }
                    }
                }
            }
            return this.telegramBot;
        };

        // deletes the commands if we will register one.
        this.deleteMyCommands = function () {
            let botCommandsByLanguage = self.getBotCommands();
            if (Object.keys(botCommandsByLanguage).length > 0) {
                let telegramBot = self.getTelegramBot();
                if (telegramBot) {
                    // TODO:iterate over languages and delete the ones we do not have commands for.
                    // let languages = Object.keys(botCommandsByLanguage);

                    let scopes = ['default', 'all_private_chats', 'all_group_chats', 'all_chat_administrators'];
                    for (const scope of scopes) {
                        let options = {
                            scope: { type: scope },
                            language_code: '',
                        };

                        telegramBot
                            .deleteMyCommands(options)
                            .then(function (result) {
                                if (!result) {
                                    self.warn('Failed to call /deleteMyCommands');
                                }
                            })
                            .catch(function (err) {
                                self.warn('Failed to call /deleteMyCommands: ' + err);
                            });
                    }
                }
            }
        };

        // registers the bot commands at the telegram server.
        this.setMyCommands = function () {
            let botCommandsByLanguage = self.getBotCommands();
            if (Object.keys(botCommandsByLanguage).length > 0) {
                let scopes = ['default', 'all_private_chats', 'all_group_chats', 'all_chat_administrators'];

                // let languages = Object.keys(botCommandsByLanguage);

                let telegramBot = self.getTelegramBot();
                if (telegramBot) {
                    for (const scope of scopes) {
                        for (let language in botCommandsByLanguage) {
                            let botCommandsForLanguage = botCommandsByLanguage[language];

                            let botCommands = botCommandsForLanguage.filter(function (botCommand) {
                                return botCommand.scope == scope;
                            });

                            if (botCommands && botCommands.length > 0) {
                                let options = {
                                    scope: { type: scope },
                                    language_code: language,
                                };

                                telegramBot
                                    .setMyCommands(botCommands, options)
                                    .then(function (result) {
                                        if (!result) {
                                            self.warn('Failed to call /setMyCommands for language' + language);
                                        }
                                    })
                                    .catch(function (err) {
                                        self.warn('Failed to call /setMyCommands for language ' + language + ': ' + err);
                                    });
                            }
                        }
                    }
                }
            }
        };

        this.onStarted = function () {
            self.deleteMyCommands();
            self.setMyCommands();
        };

        RED.events.on('flows:started', this.onStarted);

        this.on('close', function (removed, done) {
            RED.events.removeListener('flows:started', this.onStarted);
            if (removed) {
                if (self.tokenRegistered) {
                    delete botsByToken[self.token];
                }
            }
            self.abortBot('closing', done);
        });

        this.abortBot = function (hint, done) {
            self.status = 'disconnecting';

            function setStatusDisconnected() {
                self.status = 'disconnected';
                self.setStatus('stopped', 'stopped ' + hint);
                self.telegramBot = null;
                done();
            }

            if (self.telegramBot !== undefined && self.telegramBot !== null) {
                if (self.telegramBot._polling) {
                    // cancel true only cancels the current request.
                    // cancel false aborts polling completely.
                    self.telegramBot.stopPolling({ cancel: false }).then(setStatusDisconnected, setStatusDisconnected);
                    let lastRequest = self.telegramBot._polling._lastRequest;
                    if (lastRequest) {
                        lastRequest.cancel('stopping');
                    }
                } else if (self.telegramBot._webHook) {
                    self.telegramBot.deleteWebHook();
                    self.telegramBot.closeWebHook().then(setStatusDisconnected, setStatusDisconnected);
                } else {
                    setStatusDisconnected();
                }
            } else {
                setStatusDisconnected();
            }
        };

        // stops the bot if not already stopped
        this.stop = function (hint, done) {
            if (self.telegramBot !== null && self.status === 'connected') {
                self.abortBot(hint, done);
            } else {
                done();
            }
        };

        // starts the bot if not already started
        this.start = function (hint, done) {
            if (self.telegramBot === null && self.status === 'disconnected') {
                self.status = 'connecting';
                self.getTelegramBot(); // trigger creation
                if (self.telegramBot !== null) {
                    self.status = 'connected';
                    self.setStatus('started', 'started ' + hint);
                }
            }
            done();
        };

        this.getBotToken = function (botToken) {
            botToken = this.credentials.token;
            if (botToken !== undefined) {
                botToken = botToken.trim();

                if (botToken.startsWith('{') && botToken.endsWith('}')) {
                    let expression = botToken.substr(1, botToken.length - 2);
                    let code = `sandbox.${expression};`;

                    try {
                        botToken = eval(code);
                    } catch (e) {
                        botToken = undefined;
                    }
                }
            }

            return botToken;
        };

        this.getUserNames = function () {
            let usernames = [];
            if (self.config.usernames !== '') {
                let trimmedUsernames = self.config.usernames.trim();
                if (trimmedUsernames.startsWith('{') && trimmedUsernames.endsWith('}')) {
                    let expression = trimmedUsernames.substr(1, trimmedUsernames.length - 2);
                    let code = `sandbox.${expression};`;

                    try {
                        usernames = eval(code);
                        if (usernames === undefined) {
                            usernames = [];
                        }
                    } catch (e) {
                        usernames = [];
                    }
                } else {
                    usernames = self.config.usernames.split(',');
                }
            }

            return usernames;
        };

        this.getChatIds = function () {
            let chatids = [];
            if (self.config.chatids !== '') {
                let trimmedChatIds = self.config.chatids.trim();
                if (trimmedChatIds.startsWith('{') && trimmedChatIds.endsWith('}')) {
                    let expression = trimmedChatIds.substr(1, trimmedChatIds.length - 2);
                    let code = `sandbox.${expression};`;

                    try {
                        chatids = eval(code);
                        if (chatids === undefined) {
                            chatids = [];
                        }
                    } catch (e) {
                        chatids = [];
                    }
                } else {
                    chatids = self.config.chatids.split(',').map(function (item) {
                        return parseInt(item, 10);
                    });
                }
            }

            return chatids;
        };

        this.isAuthorizedUser = function (node, user) {
            let isAuthorized = false;

            let usernames = self.getUserNames(node);
            if (usernames.length > 0) {
                if (usernames.indexOf(user) >= 0) {
                    isAuthorized = true;
                }
            }

            return isAuthorized;
        };

        this.isAuthorizedChat = function (node, chatid) {
            let isAuthorized = false;
            let chatids = self.getChatIds(node);
            if (chatids.length > 0) {
                for (let i = 0; i < chatids.length; i++) {
                    let id = chatids[i];
                    if (id === chatid) {
                        isAuthorized = true;
                        break;
                    }
                }
            }

            return isAuthorized;
        };

        this.isAuthorized = function (node, chatid, userid, user) {
            let isAuthorized = false;
            if (self.config.chatids === '' && self.config.usernames === '') {
                isAuthorized = true;
            } else {
                let isAuthorizedUser = false;
                if (user !== undefined) {
                    isAuthorizedUser = self.isAuthorizedUser(node, user);
                }

                let isAuthorizedChatId = false;
                if (chatid !== undefined) {
                    isAuthorizedChatId = self.isAuthorizedChat(node, chatid);
                }

                let isAuthorizedUserId = false;
                if (userid !== undefined) {
                    isAuthorizedUserId = self.isAuthorizedChat(node, userid);
                }

                if (isAuthorizedUser || isAuthorizedChatId || isAuthorizedUserId) {
                    isAuthorized = true;
                }
            }

            return isAuthorized;
        };

        this.setStatus = function (status, text = {}) {
            let nodeStatus = {};
            switch (status) {
                case 'started':
                    nodeStatus = {
                        fill: 'green',
                        shape: 'ring',
                        text: text,
                    };
                    break;

                case 'stopped':
                    nodeStatus = {
                        fill: 'red',
                        shape: 'ring',
                        text: text,
                    };
                    break;

                case 'info':
                    nodeStatus = {
                        fill: 'green',
                        shape: 'ring',
                        text: 'polling',
                    };
                    break;

                case 'error':
                    nodeStatus = {
                        fill: 'red',
                        shape: 'ring',
                        text: text,
                    };
                    break;
                default:
                    break;
            }

            self.emit('status', status, nodeStatus);
        };

        this.createUniqueKey = function (username, chatid) {
            return username + '@' + chatid;
        };

        this.setCommandPending = function (command, username, chatid) {
            let key = self.createUniqueKey(username, chatid);
            self.pendingCommands[key] = command;
        };

        this.resetCommandPending = function (command, username, chatid) {
            let key = self.createUniqueKey(username, chatid);
            delete self.pendingCommands[key];
        };

        this.isCommandPending = function (command, username, chatid) {
            let key = self.createUniqueKey(username, chatid);

            let isPending = false;
            if (self.pendingCommands[key] !== undefined) {
                let value = self.pendingCommands[key];
                if (value === command) {
                    isPending = true;
                }
            }
            return isPending;
        };

        this.registerCommand = function (node, command, description, language, scope, registerCommand) {
            let commandInfo = {
                command: command,
                description: description,
                registerCommand: registerCommand,
                language: language,
                scope: scope,
            };
            self.commandsByNode[node] = commandInfo;

            // if there is no language we can not register it at the server.
            if (language !== undefined) {
                if (!self.commandsByLanguage[language]) {
                    self.commandsByLanguage[language] = [];
                }
                self.commandsByLanguage[language].push(commandInfo);
            }
        };

        this.unregisterCommand = function (node) {
            delete self.commandsByNode[node];
        };

        this.isCommandRegistered = function (command) {
            let found = false;

            for (let key in self.commandsByNode) {
                if (self.commandsByNode[key].command === command) {
                    found = true;
                    break;
                }
            }

            return found;
        };

        this.sendToAllCommandNodes = function (botMsg, done) {
            for (let nodeId in self.commandsByNode) {
                let node = RED.nodes.getNode(nodeId);
                node.processMessage(botMsg);
            }

            done();
        };

        this.getBotCommands = function () {
            return self.commandsByLanguage;
        };
    }
    RED.nodes.registerType('telegram bot', TelegramBotNode, {
        credentials: {
            token: { type: 'text' },
        },
    });

    // adds the caption of the message into the options.
    function addCaptionToMessageOptions(msg) {
        let options = msg.payload.options;
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
        let photoIndex = 0;
        let highestResolution = 0;

        photoArray.forEach(function (photo, index) {
            let resolution = photo.width * photo.height;
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
        let messageDetails;
        if (botMsg.text) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'message',
                content: botMsg.text,
                date: botMsg.date,
            };
        } else if (botMsg.photo) {
            // photos are sent using several resolutions. Therefore photo is an array. We choose the one with the highest resolution in the array.
            const index = getPhotoIndexWithHighestResolution(botMsg.photo);
            const fileId = botMsg.photo[index].file_id;
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'photo',
                content: fileId,
                caption: botMsg.caption,
                date: botMsg.date,
                blob: true,
                photos: botMsg.photo,
                mediaGroupId: botMsg.media_group_id,
            };
        } else if (botMsg.audio) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'audio',
                content: botMsg.audio.file_id,
                caption: botMsg.caption,
                date: botMsg.date,
                blob: true,
            };
        } else if (botMsg.sticker) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'sticker',
                content: botMsg.sticker.file_id,
                date: botMsg.date,
                blob: true,
            };
        } else if (botMsg.dice) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'dice',
                content: botMsg.dice,
                date: botMsg.date,
                blob: false,
            };
        } else if (botMsg.animation) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'animation',
                content: botMsg.animation.file_id,
                caption: botMsg.caption,
                date: botMsg.date,
                blob: true,
                mediaGroupId: botMsg.media_group_id,
            };
        } else if (botMsg.video) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'video',
                content: botMsg.video.file_id,
                caption: botMsg.caption,
                date: botMsg.date,
                blob: true,
                mediaGroupId: botMsg.media_group_id,
            };
        } else if (botMsg.video_note) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'video_note',
                content: botMsg.video_note.file_id,
                caption: botMsg.caption,
                date: botMsg.date,
                blob: true,
            }; // maybe video_note will get a caption in future, right now it is not available.
        } else if (botMsg.voice) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'voice',
                content: botMsg.voice.file_id,
                caption: botMsg.caption,
                date: botMsg.date,
                blob: true,
            };
        } else if (botMsg.location) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'location',
                content: botMsg.location,
                date: botMsg.date,
            };
        } else if (botMsg.venue) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'venue',
                content: botMsg.venue,
                date: botMsg.date,
            };
        } else if (botMsg.contact) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'contact',
                content: botMsg.contact,
                date: botMsg.date,
            };
        } else if (botMsg.document) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'document',
                content: botMsg.document.file_id,
                caption: botMsg.caption,
                date: botMsg.date,
                blob: true,
            };
        } else if (botMsg.poll) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'poll',
                content: botMsg.poll,
                date: botMsg.date,
                blob: false,
            };
        } else if (botMsg.invoice) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'invoice',
                content: botMsg.invoice,
                date: botMsg.date,
            };
        } else if (botMsg.successful_payment) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'successful_payment',
                content: botMsg.successful_payment,
                date: botMsg.date,
            };
        } else if (botMsg.new_chat_title) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'new_chat_title',
                content: botMsg.new_chat_title,
                date: botMsg.date,
            };
        } else if (botMsg.new_chat_photo) {
            // photos are sent using several resolutions. Therefore photo is an array. We choose the one with the highest resolution in the array.
            const index = getPhotoIndexWithHighestResolution(botMsg.new_chat_photo);
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'new_chat_photo',
                content: botMsg.new_chat_photo[index].file_id,
                date: botMsg.date,
                blob: true,
                photos: botMsg.new_chat_photo,
            };
        } else if (botMsg.new_chat_members) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'new_chat_members',
                content: botMsg.new_chat_members,
                user: botMsg.new_chat_member,
                date: botMsg.date,
            };
        } else if (botMsg.left_chat_member) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'left_chat_member',
                content: botMsg.left_chat_member,
                user: botMsg.left_chat_member,
                date: botMsg.date,
            };
        } else if (botMsg.delete_chat_photo) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'delete_chat_photo',
                content: botMsg.delete_chat_photo,
                date: botMsg.date,
            };
        } else if (botMsg.pinned_message) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'pinned_message',
                content: botMsg.pinned_message,
                date: botMsg.date,
            };
        } else if (botMsg.channel_chat_created) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'channel_chat_created',
                content: botMsg.channel_chat_created,
                date: botMsg.date,
            };
        } else if (botMsg.group_chat_created) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'group_chat_created',
                content: botMsg.group_chat_created,
                chat: botMsg.chat,
                date: botMsg.date,
            };
        } else if (botMsg.supergroup_chat_created) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'supergroup_chat_created',
                content: botMsg.supergroup_chat_created,
                chat: botMsg.chat,
                date: botMsg.date,
            };
        } else if (botMsg.migrate_from_chat_id) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'migrate_from_chat_id',
                content: botMsg.migrate_from_chat_id,
                chat: botMsg.chat,
                date: botMsg.date,
            };
        } else if (botMsg.migrate_to_chat_id) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'migrate_to_chat_id',
                content: botMsg.migrate_to_chat_id,
                chat: botMsg.chat,
                date: botMsg.date,
            };
        } else if (botMsg.web_app_data) {
            messageDetails = {
                chatId: botMsg.chat.id,
                messageId: botMsg.message_id,
                type: 'web_app_data',
                content: botMsg.web_app_data,
                chat: botMsg.chat,
                date: botMsg.date,
            };
        } else {
            // unknown type --> no output
            // TODO: connected_website, passport_data, proximity_alert_triggered, voice_chat_scheduled, voice_chat_started, voice_chat_ended, voice_chat_participants_invited, reply_markup
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
        let node = this;
        this.bot = config.bot;
        node.filterCommands = config.filterCommands || false;

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

                        telegramBot.on('message', (botMsg) => this.processMessage(botMsg));
                    } else {
                        node.status({
                            fill: 'grey',
                            shape: 'ring',
                            text: 'send only mode',
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
            }

            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.processMessage = function (botMsg) {
            node.status({
                fill: 'green',
                shape: 'ring',
                text: 'connected',
            });

            let username = botMsg.from.username;
            let userid = botMsg.from.id;
            let chatid = botMsg.chat.id;
            let messageDetails = getMessageDetails(botMsg);
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

                if (node.config.isAuthorized(node, chatid, userid, username)) {
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

        this.on('close', function (removed, done) {
            node.stop();

            if (node.onStatusChanged) {
                node.config.removeListener('status', node.onStatusChanged);
            }

            node.status({});

            done();
        });
    }
    RED.nodes.registerType('telegram receiver', TelegramInNode);

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
        let node = this;
        let command = config.command;

        let registerCommand = config.registercommand;
        let description = config.description || '';
        let language = config.language || '';
        let scope = config.scope || 'default';

        let useRegex = config.useregex || false;
        let removeRegexCommand = config.removeregexcommand || false;

        let regEx;
        if (useRegex) {
            try {
                regEx = new RegExp(command);
            } catch (ex) {
                node.status({ fill: 'red', shape: 'ring', text: ex.message });
                node.warn(ex.message);
                return;
            }
        }

        let strict = config.strict;
        let hasresponse = config.hasresponse;
        if (hasresponse === undefined) {
            hasresponse = true;
        }

        this.bot = config.bot;

        // If the command should not be registered, then we invalidate the language.
        if (!registerCommand) {
            language = undefined;
        }

        this.start = function () {
            let telegramBot = this.config.getTelegramBot();
            if (telegramBot) {
                this.config.registerCommand(node.id, command, description, language, scope, registerCommand);

                node.botname = this.config.botname;

                if (telegramBot._polling !== null || telegramBot._webHook !== null) {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'connected',
                    });

                    telegramBot.on('message', (botMsg) => this.processMessage(botMsg));
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
                telegramBot.off('message');
            }

            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.processMessage = function (botMsg) {
            node.status({
                fill: 'green',
                shape: 'ring',
                text: 'connected',
            });

            let username = botMsg.from.username;
            let chatid = botMsg.chat.id;
            let userid = botMsg.from.id;
            if (node.config.isAuthorized(node, chatid, userid, username)) {
                let msg;
                let messageDetails;
                let botDetails = {
                    botname: this.config.botname,
                    testEnvironment: this.config.testEnvironment,
                    baseApiUrl: this.config.telegramBot.options.baseApiUrl,
                };

                if (botMsg.text) {
                    let message = botMsg.text;
                    let tokens = message.split(' ');

                    // check if this is a command at all first
                    let commandToken = tokens[0];
                    let isCommandMessage = commandToken.startsWith('/');
                    let isGroupChat = chatid < 0;
                    let toBot = '@' + node.botname;

                    // preprocess regex
                    let command1 = command;
                    let command2;

                    let isRegExMatch;
                    let isChatCommand = false;
                    let isDirectCommand = false;
                    if (useRegex) {
                        let match = regEx.exec(commandToken);
                        if (match !== null) {
                            isRegExMatch = true;
                            isChatCommand = true;
                            isDirectCommand = commandToken.endsWith(toBot);

                            if (removeRegexCommand) {
                                command1 = match[0];
                            }

                            if (!command1.endsWith(toBot)) {
                                command2 = command1 + toBot;
                            } else {
                                command2 = command1;
                            }
                        }
                    } else {
                        isRegExMatch = false;

                        isChatCommand = commandToken === command1;
                        command2 = command1 + toBot;
                        isDirectCommand = commandToken === command2;
                    }

                    // then if this command is meant for this node

                    if (isDirectCommand || (isChatCommand && !isGroupChat) || (isChatCommand && isGroupChat && !strict) || (useRegex && isRegExMatch)) {
                        let remainingText;
                        if (isDirectCommand) {
                            remainingText = message.replace(command2, '');
                        } else {
                            remainingText = message.replace(command1, '');
                        }

                        messageDetails = {
                            chatId: botMsg.chat.id,
                            messageId: botMsg.message_id,
                            type: 'message',
                            content: remainingText,
                        };

                        msg = {
                            payload: messageDetails,
                            originalMessage: botMsg,
                            telegramBot: botDetails,
                        };

                        if (hasresponse) {
                            node.send([msg, null]);
                            node.config.setCommandPending(command1, username, chatid);
                        } else {
                            node.send(msg);
                        }
                    } else {
                        // Here we check if the received message is probably a resonse to a pending command.
                        if (!isCommandMessage) {
                            if (hasresponse) {
                                let isPending = node.config.isCommandPending(command1, username, chatid);
                                if (isPending) {
                                    messageDetails = {
                                        chatId: botMsg.chat.id,
                                        messageId: botMsg.message_id,
                                        type: 'message',
                                        content: botMsg.text,
                                    };
                                    msg = {
                                        payload: messageDetails,
                                        originalMessage: botMsg,
                                        telegramBot: botDetails,
                                    };
                                    node.send([null, msg]);
                                    node.config.resetCommandPending(command1, username, chatid);
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

            node.config.unregisterCommand(node.id);
            node.status({});
            done();
        });
    }
    RED.nodes.registerType('telegram command', TelegramCommandNode);

    // --------------------------------------------------------------------------------------------
    // The input node receives an event from the chat. See https://core.telegram.org/bots/api#update
    // The type of event can be configured:
    // - edited_message
    // - edited_message_text
    // - edited_message_caption
    // - channel_post
    // - edited_channel_post
    // - edited_channel_post_text
    // - edited_channel_post_caption
    // - inline_query
    // - chosen_inline_result
    // - callback_query
    // - shipping_query
    // - pre_checkout_query
    // - poll
    // - poll_answer
    // - my_chat_member
    // - chat_member
    // - chat_join_request
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
    RED.nodes.registerType('telegram event', TelegramEventNode);

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
        let node = this;
        this.bot = config.bot;

        let haserroroutput = config.haserroroutput;
        if (haserroroutput === undefined) {
            haserroroutput = false;
        }

        this.hasContent = function (msg) {
            let hasContent;
            if (msg.payload.content) {
                hasContent = true;
            } else {
                node.warn('msg.payload.content is empty');
                hasContent = false;
            }

            return hasContent;
        };

        this.start = function () {
            node.status({
                fill: 'green',
                shape: 'ring',
                text: 'connected',
            });
        };

        this.stop = function () {
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.addChatIdToOptions = function (chatId, options) {
            if (chatId !== undefined && options !== undefined) {
                if (options.chat_id === undefined) {
                    options.chat_id = chatId;
                }
            }
        };

        this.processError = function (exception, msg, nodeSend, nodeDone) {
            let errorMessage = 'Caught exception in sender node:\r\n' + exception + '\r\nwhen processing message: \r\n' + JSON.stringify(msg);

            node.status({
                fill: 'red',
                shape: 'ring',
                text: exception.message,
            });

            if (haserroroutput) {
                let sendMessage = RED.util.cloneMessage(msg);
                sendMessage.error = errorMessage;
                nodeSend([null, sendMessage]);
            } else {
                if (nodeDone) {
                    node.error(errorMessage, msg);
                    nodeDone(errorMessage);
                } else {
                    node.error(errorMessage, msg);
                }
            }
        };

        this.processResult = function (result, msg, nodeSend, nodeDone) {
            if (result !== undefined) {
                msg.payload.content = result;
                msg.payload.sentMessageId = result.message_id;
                nodeSend(msg);
            }

            if (nodeDone) {
                nodeDone();
            }
        };

        this.processMessage = function (chatId, msg, nodeSend, nodeDone) {
            let telegramBot = this.config.getTelegramBot();

            if (msg.payload.forward) {
                // the message should be forwarded
                let toChatId = msg.payload.forward.chatId;

                let messageId = msg.payload.messageId;
                telegramBot
                    .forwardMessage(toChatId, chatId, messageId, msg.payload.forward.options)
                    .catch(function (ex) {
                        node.processError(ex, msg, nodeSend, nodeDone);
                    })
                    .then(function (result) {
                        node.processResult(result, msg, nodeSend, nodeDone);
                    });
            } else if (msg.payload.copy) {
                // the message should be copied
                let toChatId = msg.payload.copy.chatId;

                let messageId = msg.payload.messageId;
                telegramBot
                    .copyMessage(toChatId, chatId, messageId, msg.payload.copy.options)
                    .catch(function (ex) {
                        node.processError(ex, msg, nodeSend, nodeDone);
                    })
                    .then(function (result) {
                        node.processResult(result, msg, nodeSend, nodeDone);
                    });
            } else if (msg.payload.download) {
                let fileId = msg.payload.download.fileId;
                let filePath = msg.payload.download.filePath;
                let fileName = msg.payload.download.fileName;

                node.downloadFile(fileId, filePath, fileName)
                    .catch(function (ex) {
                        node.processError(ex, msg, nodeSend, nodeDone);
                    })
                    .then(function (result) {
                        node.processResult(result, msg, nodeSend, nodeDone);
                    });
            } else if (msg.payload.getfile) {
                let fileId = msg.payload.getfile.fileId;

                telegramBot
                    .getFile(fileId)
                    .catch(function (ex) {
                        node.processError(ex, msg, nodeSend, nodeDone);
                    })
                    .then(function (result) {
                        node.processResult(result, msg, nodeSend, nodeDone);
                    });
            } else {
                if (msg.payload.type) {
                    let type = msg.payload.type;
                    addCaptionToMessageOptions(msg);

                    switch (type) {
                        // --------------------------------------------------------------------
                        case 'message':
                            if (this.hasContent(msg)) {
                                // the maximum message size is 4096 so we must split the message into smaller chunks.
                                let chunkSize = 4000;
                                let message = msg.payload.content;

                                let done = false;
                                do {
                                    let messageToSend;
                                    if (message.length > chunkSize) {
                                        messageToSend = message.substr(0, chunkSize);
                                        message = message.substr(chunkSize);
                                    } else {
                                        messageToSend = message;
                                        done = true;
                                    }

                                    telegramBot
                                        .sendMessage(chatId, messageToSend, msg.payload.options || {})
                                        .then(function (result) {
                                            node.processResult(result, msg, nodeSend, nodeDone);
                                        })
                                        .catch(function (err) {
                                            // markdown error? try plain mode

                                            // TODO: MarkdownV2 issues error "Error: ETELEGRAM: 400 Bad Request: can't parse entities:"
                                            // adapt the following if so that MarkdownV2 also works.
                                            if (
                                                String(err).includes(
                                                    // eslint-disable-next-line quotes
                                                    "can't parse entities in message text:"
                                                ) &&
                                                msg.payload.options &&
                                                msg.payload.options.parse_mode === 'Markdown'
                                            ) {
                                                delete msg.payload.options.parse_mode;
                                                telegramBot
                                                    .sendMessage(chatId, messageToSend, msg.payload.options || {})
                                                    .catch(function (ex) {
                                                        node.processError(ex, msg, nodeSend, nodeDone);
                                                    })
                                                    .then(function (result) {
                                                        node.processResult(result, msg, nodeSend, nodeDone);
                                                    });
                                                return;
                                            } else {
                                                node.processError(err, msg, nodeSend, nodeDone);
                                            }
                                        });
                                } while (!done);
                            }
                            break;

                        case 'photo':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendPhoto(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;
                        case 'mediaGroup':
                            if (this.hasContent(msg)) {
                                if (Array.isArray(msg.payload.content)) {
                                    for (let i = 0; i < msg.payload.content.length; i++) {
                                        let mediaItem = msg.payload.content[i];
                                        if (typeof mediaItem.type !== 'string') {
                                            node.warn('msg.payload.content[' + i + '].type is not a string it is ' + typeof mediaItem.type);
                                            break;
                                        }
                                        if (mediaItem.media === undefined) {
                                            node.warn('msg.payload.content[' + i + '].media is not defined');
                                            break;
                                        }
                                    }
                                    telegramBot
                                        .sendMediaGroup(chatId, msg.payload.content, msg.payload.options || {})
                                        .catch(function (ex) {
                                            node.processError(ex, msg, nodeSend, nodeDone);
                                        })
                                        .then(function (result) {
                                            node.processResult(result, msg, nodeSend, nodeDone);
                                        });
                                } else {
                                    node.warn('msg.payload.content for mediaGroup is not an array of mediaItem');
                                }
                            }
                            break;
                        case 'audio':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendAudio(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
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
                                telegramBot
                                    .sendDocument(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'poll':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendPoll(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.optional)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'sticker':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendSticker(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'dice':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendDice(chatId, msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'animation':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendAnimation(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'video':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendVideo(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'video_note':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendVideoNote(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'voice':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendVoice(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'location':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendLocation(chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'venue':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendVenue(
                                        chatId,
                                        msg.payload.content.latitude,
                                        msg.payload.content.longitude,
                                        msg.payload.content.title,
                                        msg.payload.content.address,
                                        msg.payload.options || {}
                                    )
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
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
                                telegramBot
                                    .sendContact(chatId, msg.payload.content.phone_number, msg.payload.content.first_name, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;
                        // --------------------------------------------------------------------

                        case 'editMessageLiveLocation':
                            if (this.hasContent(msg)) {
                                node.addChatIdToOptions(chatId, msg.payload.options);
                                telegramBot
                                    .editMessageLiveLocation(msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'stopMessageLiveLocation':
                            // This message requires the options to be set!
                            //if (this.hasContent(msg)) {
                            node.addChatIdToOptions(chatId, msg.payload.options);
                            telegramBot
                                .stopMessageLiveLocation(msg.payload.options)
                                .catch(function (ex) {
                                    node.processError(ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        case 'callback_query':
                        case 'answerCallbackQuery':
                            {
                                let callbackQueryId = msg.payload.callbackQueryId;

                                let options = msg.payload.options;
                                if (options === undefined) {
                                    options = {};
                                }

                                if (options.text === undefined && msg.payload.content !== undefined) {
                                    options.text = msg.payload.content;
                                }

                                telegramBot
                                    .answerCallbackQuery(callbackQueryId, options)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'inline_query':
                        case 'answerInlineQuery':
                            //if (this.hasContent(msg)) {
                            // this type requires results to be set: see https://core.telegram.org/bots/api#inlinequeryresult
                            telegramBot
                                .answerInlineQuery(msg.payload.inlineQueryId, msg.payload.results, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        case 'answerWebAppQuery':
                            //if (this.hasContent(msg)) {
                            // this type requires results to be set: see https://core.telegram.org/bots/api#inlinequeryresult
                            telegramBot
                                .answerWebAppQuery(msg.payload.webAppQueryId, msg.payload.results, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        case 'sendChatAction':
                        case 'action':
                            if (this.hasContent(msg)) {
                                telegramBot
                                    .sendChatAction(chatId, msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // --------------------------------------------------------------------
                        // Some of the following functions require the bot to be administrator of the chat/channel

                        // 1 argument: chatId
                        case 'getChatAdministrators':
                        case 'getChatMemberCount':
                        case 'getChat':
                        case 'leaveChat':
                        case 'exportChatInviteLink':
                        case 'createChatInviteLink':
                        case 'unpinAllChatMessages':
                        case 'deleteChatPhoto':
                        case 'getForumTopicIconStickers':
                        case 'closeGeneralForumTopic':
                        case 'reopenGeneralForumTopic':
                        case 'hideGeneralForumTopic':
                        case 'unhideGeneralForumTopic':
                            telegramBot[type](chatId, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(result, msg, nodeSend, nodeDone);
                                });
                            break;

                        // 2 arguments: content, options
                        case 'editMessageCaption':
                        case 'editMessageText':
                        case 'editMessageReplyMarkup':
                            if (this.hasContent(msg)) {
                                node.addChatIdToOptions(chatId, msg.payload.options);
                                telegramBot[type](msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // TODO: https://github.com/windkh/node-red-contrib-telegrambot/issues/178
                        // https://github.com/yagop/node-telegram-bot-api/issues/876
                        case 'editMessageMedia':
                            if (this.hasContent(msg)) {
                                node.editMessageMedia(msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // 2 arguments: chatId, content
                        case 'setChatTitle':
                        case 'setChatPhoto':
                        case 'setChatDescription':
                        case 'unpinChatMessage':
                        case 'deleteMessage':
                            if (this.hasContent(msg)) {
                                telegramBot[type](chatId, msg.payload.content)
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // 3 arguments: chatId, content, options
                        case 'pinChatMessage':
                        case 'unbanChatMember':
                        case 'banChatMember':
                        case 'restrictChatMember':
                        case 'promoteChatMember':
                        case 'getChatMember':
                        case 'approveChatJoinRequest':
                        case 'declineChatJoinRequest':
                        case 'setChatAdministratorCustomTitle':
                        case 'stopPoll':
                        case 'setMessageReaction':
                            // The userId must be passed in msg.payload.content: note that this is is a number not the username.
                            // Right now there is no way for resolving the user_id by username in the official API.
                            if (this.hasContent(msg)) {
                                telegramBot[type](chatId, msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // 3 arguments: chatId, content, options
                        case 'createForumTopic':
                        case 'editForumTopic':
                        case 'closeForumTopic':
                        case 'reopenForumTopic':
                        case 'deleteForumTopic':
                        case 'unpinAllForumTopicMessages':
                        case 'editGeneralForumTopic':
                            // The message_thread_id must be passed in msg.payload.content: note that this is is a number not the username.
                            // Right now there is no way for resolving the user_id by username in the official API.
                            if (this.hasContent(msg)) {
                                telegramBot[type](chatId, msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // --------------------------------------------------------------------

                        // See https://core.telegram.org/bots/payments
                        // See https://core.telegram.org/bots/api#sendinvoice
                        case 'sendInvoice':
                            //if (this.hasContent(msg)) {
                            telegramBot[type](
                                chatId,
                                msg.payload.content.title,
                                msg.payload.content.description,
                                msg.payload.content.payload,
                                msg.payload.content.providerToken,
                                msg.payload.content.currency,
                                msg.payload.content.prices,
                                msg.payload.options || {}
                            )
                                .catch(function (ex) {
                                    node.processError(ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        case 'shipping_query':
                        case 'answerShippingQuery':
                            //if (this.hasContent(msg)) {
                            // this type requires ok to be set: see https://core.telegram.org/bots/api#answershippingquery
                            telegramBot
                                .answerShippingQuery(msg.payload.shippingQueryId, msg.payload.ok, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        case 'pre_checkout_query':
                        case 'answerPreCheckoutQuery':
                            //if (this.hasContent(msg)) {
                            // this type requires ok to be set: see https://core.telegram.org/bots/api#answerprecheckoutquery
                            telegramBot
                                .answerPreCheckoutQuery(msg.payload.preCheckoutQueryId, msg.payload.ok, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        // TODO:
                        // setChatPermissions
                        // editChatInviteLink, revokeChatInviteLink
                        // getUserProfilePhotos,
                        // getMyCommands
                        // setChatStickerSet, deleteChatStickerSet
                        // sendGame, setGameScore, getGameHighScores
                        // getStickerSet, uploadStickerFile, createNewStickerSet, addStickerToSet, setStickerPositionInSet, deleteStickerFromSet

                        default:
                            // unknown type we try the unthinkable.
                            if (type in telegramBot) {
                                if (this.hasContent(msg)) {
                                    telegramBot[type](chatId, msg.payload.content, msg.payload.options || {})
                                        .catch(function (ex) {
                                            node.processError(ex, msg, nodeSend, nodeDone);
                                        })
                                        .then(function (result) {
                                            node.processResult(result, msg, nodeSend, nodeDone);
                                        });
                                }
                            } else {
                                // type is not supported.
                                node.warn('msg.payload.type is not supported');
                            }
                    }
                } else {
                    node.warn('msg.payload.type is empty');
                }
            } // forward
        };

        // Derived from original code but with optional fileName
        this.downloadFile = function (fileId, downloadDir, fileName) {
            let resolve;
            let reject;
            const promise = new Promise((a, b) => {
                resolve = a;
                reject = b;
            });

            let form = {};
            let telegramBot = this.config.getTelegramBot();
            const fileStream = telegramBot.getFileStream(fileId, form);
            fileStream.on('info', (info) => {
                if (fileName === undefined) {
                    fileName = info.uri.slice(info.uri.lastIndexOf('/') + 1);
                }

                const filePath = path.join(downloadDir, fileName);
                pipeline(fileStream, fs.createWriteStream(filePath), (error) => {
                    if (!error) {
                        return resolve(filePath);
                    } else {
                        return reject(error);
                    }
                });
            });
            fileStream.on('error', (err) => {
                reject(err);
            });
            return promise;
        };

        // TODO: https://github.com/windkh/node-red-contrib-telegrambot/issues/178
        // TODO: https://github.com/yagop/node-telegram-bot-api/issues/876
        this.editMessageMedia = function (media, form = {}) {
            const opts = {
                qs: form,
            };
            opts.formData = {};

            const payload = Object.assign({}, media);
            delete payload.media;
            delete payload.fileOptions;

            let telegramBot = this.config.getTelegramBot();

            try {
                const attachName = String(0);
                const [formData, fileId] = telegramBot._formatSendData(attachName, media.media, media.fileOptions);
                if (formData) {
                    opts.formData[attachName] = formData[attachName];
                    payload.media = `attach://${attachName}`;
                } else {
                    payload.media = fileId;
                }
            } catch (ex) {
                return Promise.reject(ex);
            }

            opts.qs.media = JSON.stringify(payload);
            return telegramBot._request('editMessageMedia', opts);
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

            let telegramBot = this.config.getTelegramBot();
            if (telegramBot) {
                node.status({
                    fill: 'green',
                    shape: 'ring',
                    text: 'connected',
                });
            } else {
                node.warn('bot not initialized.');
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: 'bot not initialized',
                });
            }
        } else {
            node.warn('config node failed to initialize.');
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'config node failed to initialize',
            });
        }

        this.on('input', function (msg, nodeSend, nodeDone) {
            nodeSend =
                nodeSend ||
                function () {
                    node.send.apply(node, arguments);
                };

            node.status({ fill: 'green', shape: 'ring', text: 'connected' });

            if (msg.payload) {
                let telegramBot = this.config.getTelegramBot();
                if (telegramBot) {
                    if (!Array.isArray(msg.payload.chatId)) {
                        this.processMessage(msg.payload.chatId, msg, nodeSend, nodeDone);
                    } else {
                        let chatIds = msg.payload.chatId;
                        let length = chatIds.length;
                        for (let i = 0; i < length; i++) {
                            let chatId = chatIds[i];

                            let clonedMsg = RED.util.cloneMessage(msg);
                            clonedMsg.payload.chatId = chatId;
                            this.processMessage(chatId, clonedMsg, nodeSend, nodeDone);
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
            } else {
                node.warn('msg.payload is empty');
            }
        });

        this.on('close', function (removed, done) {
            node.stop();

            if (node.onStatusChanged) {
                node.config.removeListener('status', node.onStatusChanged);
            }

            node.status({});
            done();
        });
    }
    RED.nodes.registerType('telegram sender', TelegramOutNode);

    // --------------------------------------------------------------------------------------------
    // The output node receices the reply for a specified message and passes the msg through.
    // The payload needs three fields
    // chatId        : string destination chat
    // sentMessageId : string the id of the message the reply coresponds to.
    // content : message content
    function TelegramReplyNode(config) {
        RED.nodes.createNode(this, config);
        let node = this;
        this.bot = config.bot;

        this.start = function () {
            let telegramBot = this.config.getTelegramBot();
            if (telegramBot) {
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
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
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

            node.start();
        } else {
            node.warn('config node failed to initialize.');
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'config node failed to initialize',
            });
        }

        this.on('input', function (msg, nodeSend, nodeDone) {
            node.status({ fill: 'green', shape: 'ring', text: 'connected' });

            if (msg.payload) {
                let telegramBot = this.config.getTelegramBot();
                if (telegramBot) {
                    if (msg.payload.chatId) {
                        if (msg.payload.sentMessageId) {
                            let chatId = msg.payload.chatId;
                            let messageId = msg.payload.sentMessageId;

                            telegramBot.onReplyToMessage(chatId, messageId, function (botMsg) {
                                let messageDetails = getMessageDetails(botMsg);
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
                            node.warn('msg.payload.sentMessageId is empty');
                        }
                    } else {
                        node.warn('msg.payload.chatId is empty');
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

        this.on('close', function (removed, done) {
            node.stop();

            if (node.onStatusChanged) {
                node.config.removeListener('status', node.onStatusChanged);
            }

            node.status({});
            done();
        });
    }
    RED.nodes.registerType('telegram reply', TelegramReplyNode);

    // --------------------------------------------------------------------------------------------
    // The control node can start stop a bot.
    // The payload needs these fields
    // command : string 'start' 'stop' 'restart'
    // delay : optional time in milliseconds for restart.
    function TelegramControlNode(config) {
        RED.nodes.createNode(this, config);
        let node = this;
        this.bot = config.bot;

        let checkconnection = config.checkconnection;
        if (checkconnection === undefined) {
            checkconnection = false;
        }
        let hostname = config.hostname;
        let interval = (config.interval || 10) * 1000;
        let connectionTimeout = (config.timeout || 10) * 1000;

        this.start = function () {
            let telegramBot = node.config.getTelegramBot();
            if (telegramBot) {
                telegramBot.on('getUpdates_start', function (cycle) {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'polling cycle ' + cycle,
                    });
                });
                telegramBot.on('getUpdates_end', function (cycle, duration, updates) {
                    let durationMs = Math.round(duration);

                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'polling cycle ' + cycle + ': ' + durationMs + 'ms',
                    });

                    let msg = {
                        payload: {
                            cycle: cycle,
                            duration: duration,
                            updates: updates,
                        },
                    };
                    node.send(msg);
                });

                node.status({
                    fill: 'green',
                    shape: 'ring',
                    text: 'connected',
                });
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
            let telegramBot = node.config.getTelegramBot();
            if (telegramBot) {
                telegramBot.off('getUpdates_start');
                telegramBot.off('getUpdates_end');
            }

            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'disconnected',
            });
        };

        this.checkConnection = function () {
            let effectiveUrl = node.config.baseApiUrl || 'https://api.telegram.org';
            if (hostname !== '') {
                effectiveUrl = hostname;
            }
            let url = new URL(effectiveUrl);
            let host = url.hostname;
            let port = url.port || 80;
            let timeout = connectionTimeout;
            node.isHostReachable(host, port, timeout).then(
                function () {
                    let msg = {
                        payload: {
                            isOnline: true,
                        },
                    };
                    node.send([null, msg]);
                },
                function (err) {
                    let msg = {
                        payload: {
                            isOnline: false,
                            error: err,
                        },
                    };
                    node.send([null, msg]);
                }
            );
        };

        this.isHostReachable = function (host, port, timeout) {
            return new Promise(function (resolve, reject) {
                let timer = setTimeout(function () {
                    reject('timeout');
                    socket.end();
                }, timeout);
                let socket = net.createConnection(port, host, function () {
                    clearTimeout(timer);
                    resolve();
                    socket.end();
                });
                socket.on('error', function (err) {
                    clearTimeout(timer);
                    reject(err);
                });
            });
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

            node.start();

            // start supervisor
            if (checkconnection) {
                node.checkConnectionTimer = setInterval(function () {
                    node.checkConnection();
                }, interval);
            }
        } else {
            node.warn('config node failed to initialize.');
            node.status({
                fill: 'red',
                shape: 'ring',
                text: 'config node failed to initialize',
            });
        }

        this.on('input', function (msg) {
            node.status({ fill: 'green', shape: 'ring', text: 'connected' });

            if (msg.payload) {
                let command = msg.payload.command;
                switch (command) {
                    case 'stop': {
                        node.config.stop('by control node', function () {
                            node.send(msg);
                        });
                        break;
                    }
                    case 'start': {
                        node.config.start('by control node', function () {
                            node.send(msg);
                        });
                        break;
                    }
                    case 'restart': {
                        node.config.stop('by control node', function () {
                            let delay = msg.payload.delay;
                            if (delay !== undefined && delay > 0) {
                                setTimeout(function () {
                                    node.config.start('by control node', function () {
                                        node.send(msg);
                                    });
                                }, delay);
                            } else {
                                node.config.start('by control node', function () {
                                    node.send(msg);
                                });
                            }
                            node.send(msg);
                        });
                        break;
                    }
                    case 'command': {
                        let message = msg.payload.message;
                        if (message.from === undefined) {
                            message.from = {
                                id: 0,
                                username: 'unknown',
                            };
                        }

                        if (message.chat === undefined) {
                            message.chat = {
                                id: 0,
                            };
                        }

                        node.config.sendToAllCommandNodes(message, function () {
                            node.send(msg);
                        });
                        break;
                    }
                    default:
                        break;
                }
            } else {
                node.warn('msg.payload is empty');
            }
        });

        this.on('close', function (removed, done) {
            // Stop supervisor
            if (node.checkConnectionTimer) {
                clearTimeout(node.checkConnectionTimer);
                node.checkConnectionTimer = null;
            }

            node.stop();

            if (node.onStatusChanged) {
                node.config.removeListener('status', node.onStatusChanged);
            }

            node.status({});
            done();
        });
    }
    RED.nodes.registerType('telegram control', TelegramControlNode);
};

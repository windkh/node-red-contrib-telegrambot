module.exports = function(RED) {
    
    let telegramBot = require('node-telegram-bot-api');
    let telegramBotWebHook = require('node-telegram-bot-api/src/telegramWebHook');

    let { SocksProxyAgent } = require('socks-proxy-agent');

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

        _request(_path, options = {}) {
            let result;
            if (_path !== 'getUpdates') {
                // TODO: add catch and retry later here.
                result = super._request(_path, options);
                // result.catch(function (err) {
                //     ;
                // });
            } else {
                result = super._request(_path, options); // no special handling for polling updates.
            }

            return result;
        }
    }

    // --------------------------------------------------------------------------------------------

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
                // These events can be used https://core.telegram.org/bots/api#update
                // see event node: e.g.
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

    return TelegramBotNode;
};
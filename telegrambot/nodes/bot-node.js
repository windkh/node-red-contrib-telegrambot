// Walks an Error's .cause chain (Node 16+ standard) and any nested .errors arrays
// (AggregateError) to collect the leaf error messages — i.e. the ones that actually
// carry the useful diagnostic (typically the syscall-level message like
// "connect ETIMEDOUT 149.154.166.110:443" rather than the intermediate library
// wrappers' generic "AggregateError" / "RequestError" labels).
//
// The whole point is to get a one-line warn that tells an operator what to actually
// fix (IPv4 vs IPv6, DNS, blocked port, ...) without needing to enable verbose
// logging and read a 5-deep util.inspect dump.
//
// Returns a string formatted as: "<message1>; <message2>; ..." with consecutive
// duplicates removed. Empty input -> empty string.
function formatErrorChain(error) {
    const seen = new Set();
    const leaves = [];
    function walk(e, depth) {
        if (!e || typeof e !== 'object' || seen.has(e) || depth > 10) return;
        seen.add(e);
        const isAgg = Array.isArray(e.errors) && e.errors.length > 0;
        const hasCause = e.cause && typeof e.cause === 'object';
        if (isAgg) {
            e.errors.forEach(function (inner) {
                walk(inner, depth + 1);
            });
        }
        if (hasCause) {
            walk(e.cause, depth + 1);
        }
        if (!isAgg && !hasCause) {
            // Prefer e.message; for plain string inputs, the string itself; else nothing.
            // Avoid String(e) so a shape-less object doesn't show up as "[object Object]".
            const msg = e.message || (typeof e === 'string' ? e : '');
            if (msg) leaves.push(msg);
        }
    }
    walk(error, 0);
    // De-duplicate while preserving order.
    const dedup = [];
    leaves.forEach(function (m) {
        if (dedup.indexOf(m) === -1) dedup.push(m);
    });
    if (dedup.length === 0) {
        // Avoid the JS default "[object Object]" for shape-less inputs — fall back to
        // the message if present, the raw string itself if the caller passed a string,
        // else empty.
        if (!error) return '';
        if (typeof error === 'string') return error;
        return error.message || '';
    }
    return dedup.join('; ');
}

// Parses a comma-separated list of single- or double-quoted string literals.
// Returns the array of decoded strings, or null if the input is not a valid list of string literals.
// Lifted to module scope so it can be unit-tested directly without a RED runtime.
function parseStringArgList(input) {
    const args = [];
    let ok = true;
    let i = 0;
    const skipWs = function () {
        while (i < input.length && /\s/.test(input[i])) i++;
    };
    skipWs();
    while (ok && i < input.length) {
        const quote = input[i];
        if (quote !== '"' && quote !== "'") {
            ok = false;
        } else {
            i++;
            let val = '';
            while (i < input.length && input[i] !== quote) {
                if (input[i] === '\\' && i + 1 < input.length) {
                    const next = input[i + 1];
                    val += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
                    i += 2;
                } else {
                    val += input[i++];
                }
            }
            if (input[i] !== quote) {
                ok = false;
            } else {
                i++;
                args.push(val);
                skipWs();
                if (i < input.length) {
                    if (input[i] !== ',') {
                        ok = false;
                    } else {
                        i++;
                        skipWs();
                    }
                }
            }
        }
    }
    return ok ? args : null;
}

// Safely evaluates the small subset of expressions allowed in token / usernames / chatids fields.
// Supported forms (see README):
//   flow.get("key"[, "store"])     flow.keys()
//   global.get("key"[, "store"])   global.keys()
//   context.get("key"[, "store"])  context.keys()
//   context.flow.get(...)          context.global.get(...)
//   env.get("VAR")
// Anything else evaluates to undefined.
// Lifted to module scope so it can be unit-tested directly without a RED runtime.
function evalContextExpression(node, expression) {
    let result;
    const trimmed = String(expression).trim();
    const match = trimmed.match(/^(flow|global|context|env)(?:\.(flow|global))?\.(get|keys)\s*\(([\s\S]*)\)\s*$/);
    if (match) {
        const [, scope, subScope, method, argsRaw] = match;
        const args = parseStringArgList(argsRaw);
        if (args !== null) {
            if (scope === 'env') {
                if (!subScope && method === 'get' && args.length === 1) {
                    try {
                        result = node._flow.getSetting(args[0]);
                    } catch (e) {
                        // ignore — result stays undefined
                    }
                }
            } else {
                let target;
                const ctx = node.context();
                if (scope === 'context') {
                    target = subScope ? ctx[subScope] : ctx;
                } else if (!subScope) {
                    target = ctx[scope];
                }
                if (target && typeof target[method] === 'function') {
                    try {
                        result = target[method](...args);
                    } catch (e) {
                        // ignore — result stays undefined
                    }
                }
            }
        }
    }
    return result;
}

module.exports = function (RED) {
    let telegramBot = require('node-telegram-bot-api');
    let telegramBotWebHook = require('node-telegram-bot-api/src/telegramWebHook');

    let { SocksProxyAgent } = require('socks-proxy-agent');

    // Override upstream's FatalError so the underlying cause is preserved on the thrown
    // error (upstream copies error.stack but not error itself). PR #1257, which originally
    // added FatalError to node-telegram-bot-api, has long since been merged, so the class
    // exists upstream - we only keep the override for the `this.cause = error` line. The
    // 'SLIGHTLYBETTEREFATAL' code marks the patched form so it is distinguishable in logs
    // from the stock 'EFATAL' string. Original context: issue #345.
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
            result
                .then((updates) => {
                    let endTime = new Date().getTime();
                    this.emit('getUpdates_end', this.cycle, endTime - startTime, updates);
                })
                .catch(() => {
                    // Errors from getUpdates are handled by the caller; suppress unhandled rejection here.
                });

            return result;
        }

        processUpdate(update) {
            this.emit('update', update);
            super.processUpdate(update);
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
                    self.error('Aborting: Token of ' + n.botname + ' is already in use by ' + conflictingConfigNode.botname);
                    return;
                }
            }
        } else {
            self.warn('Aborting: Token of ' + n.botname + ' is not set');
            return;
        }

        // Issue #198: many runtime nodes attach to the config node's 'status' event,
        // and the default cap of 10 fires a "possible EventEmitter memory leak" warning
        // for legitimate flows. Bumping to a generous-but-finite cap keeps the warning
        // available if a real listener leak ever re-emerges (e.g. a future regression of
        // the listener-tracking work in ADR 0005), instead of suppressing it entirely.
        self.setMaxListeners(50);

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

        // Only 4 (IPv4) and 6 (IPv6) are valid for http.Agent.family. parseInt yields NaN
        // when the field is empty, which we use further down to mean "leave unset and let
        // node pick both stacks". The previous `|| 0` here mapped that case to 0, which is
        // not a documented family value and confused the agent.
        this.addressFamily = parseInt(n.addressfamily);

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

            if (this.addressFamily === 4 || this.addressFamily === 6) {
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

            if (this.addressFamily === 4 || this.addressFamily === 6) {
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
                let missing = [];
                if (!this.botHost) {
                    missing.push('botHost');
                }
                if (!this.sslTerminated && !(this.privateKey && this.certificate)) {
                    missing.push('sslTerminated OR (privateKey AND certificate)');
                }
                self.error(
                    'Bot ' +
                        n.botname +
                        ': webhook mode requested but configuration is incomplete (missing: ' +
                        missing.join(', ') +
                        '). Falling back to send-only mode - this bot will NOT receive messages until the configuration is fixed.'
                );
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
            newTelegramBot
                .setWebHook(botUrl, setWebHookOptions)
                .then(function (success) {
                    if (self.verbose) {
                        newTelegramBot
                            .getWebHookInfo()
                            .then(function (result) {
                                self.log('Webhook enabled: ' + JSON.stringify(result));
                            })
                            .catch(function (err) {
                                self.warn('Failed to get webhook info: ' + err);
                            });
                    }

                    if (success) {
                        self.status = 'connected';
                        // Broadcast the started status so receiver / event / command nodes can
                        // attach their listeners. Without this, the webhook-success branch only
                        // updated the local string and downstream nodes stayed in "not connected".
                        self.setStatus('started', 'webhook enabled');
                    } else {
                        self.abortBot('Failed to set webhook ' + botUrl, function () {
                            self.error('Bot stopped: Webhook not set.');
                        });
                    }
                })
                .catch(function (err) {
                    self.abortBot('Failed to set webhook ' + botUrl + ': ' + err, function () {
                        self.error('Bot stopped: Webhook not set.');
                    });
                });

            return newTelegramBot;
        };

        this.createTelegramBotForPollingMode = function () {
            function restartPolling() {
                // Single-flight guard: if a restart is already pending, drop this one.
                // Without it, a burst of polling_error events queues N parallel 3 s timers
                // and the bot ends up scheduling several startPolling calls in parallel
                // (the root cause behind issue #442's "12 cycles in 3 minutes" pattern).
                if (self.pollingRestartTimer) {
                    return;
                }
                self.pollingRestartTimer = setTimeout(function () {
                    self.pollingRestartTimer = null;
                    // Check if abort was called in the meantime.
                    if (self.telegramBot) {
                        // startPolling({ restart: true }) is the documented way to ask the library
                        // to tear down its current polling state and start a new loop.
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
                    // formatErrorChain extracts the leaf-level messages (e.g.
                    // "connect ETIMEDOUT 149.154.166.110:443") so the headline log line is
                    // immediately actionable rather than just showing "AggregateError".
                    self.warn(formatErrorChain(error));

                    // patch see #345
                    // node-telegram-bot-api error objects can carry the request URL deep in their
                    // structure (e.g. https://api.telegram.org/bot<TOKEN>/getUpdates). Redact the
                    // token before writing the inspected dump to Node-RED's log/UI.
                    let inspected = require('node:util').inspect(error, { depth: 5 });
                    if (self.token) {
                        inspected = inspected.split(self.token).join('<token>');
                    }
                    self.warn(inspected);
                }

                let stopPolling = false;
                let hint;
                if (error.message === 'ETELEGRAM: 401 Unauthorized') {
                    hint = 'Please check if the bot token is valid.';
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
                // During a network outage the bot library can emit 'error' many times in
                // rapid succession (each pending request fails its own way). The single-
                // flight in scheduleRestart already collapses the *restart attempts* to one,
                // but the per-event warn line below was still flooding the log with
                // "Bot error: ..." duplicates (issue #411 retest, 14 May 2026). Suppress
                // the warn while a restart is already queued — the original warn for the
                // first error of the burst plus the scheduleRestart "will restart in Xms"
                // message together describe the situation, and additional copies add no
                // information.
                //
                // formatErrorChain walks the .cause + .errors hierarchy down to the leaf
                // messages so the warn line carries the actionable detail
                // (e.g. "connect ETIMEDOUT 149.154.166.110:443") rather than the
                // intermediate wrapper labels ("AggregateError", "RequestError") that
                // node-telegram-bot-api / request-promise-core stack on top.
                const detail = formatErrorChain(error);
                if (!self.restartTimer) {
                    self.warn('Bot error: ' + detail);
                }
                // Schedule a backoff-restart so the bot recovers from transient fatal
                // failures (stale keep-alive sockets, prolonged proxy outages, etc.)
                // without operator intervention. Issues #442 / #440.
                self.scheduleRestart('fatal: ' + detail);
            });

            return newTelegramBot;
        };

        // Activates the bot or returns the already activated bot.
        this.getTelegramBot = function (createIfMissing = true) {
            if (createIfMissing && !this.telegramBot) {
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

        // Used by the control node's "setwebhook" command (issue #410) — exposes
        // bot.setWebHook / deleteWebHook so flows can swap the public URL at runtime
        // (e.g. when an ngrok tunnel restarts with a new URL). Best-effort: only
        // meaningful in webhook mode; Telegram rejects setWebHook while polling is
        // active. Empty url => deleteWebHook.
        this.setWebHookDynamically = function (url, options, callback) {
            let telegramBot = self.getTelegramBot();
            if (!telegramBot) {
                callback(new Error('bot not initialized'));
                return;
            }
            let p;
            if (!url || url === '') {
                p = telegramBot.deleteWebHook();
            } else {
                p = telegramBot.setWebHook(url, options || {});
            }
            p.then(
                function (result) {
                    callback(null, result);
                },
                function (err) {
                    callback(err);
                }
            );
        };

        RED.events.on('flows:started', this.onStarted);

        this.on('close', function (removed, done) {
            RED.events.removeListener('flows:started', this.onStarted);
            // Cancel any pending restart / polling-restart / stable-window timer so we
            // don't fire on a deleted node.
            if (self.restartTimer) {
                clearTimeout(self.restartTimer);
                self.restartTimer = null;
            }
            if (self.pollingRestartTimer) {
                clearTimeout(self.pollingRestartTimer);
                self.pollingRestartTimer = null;
            }
            if (self.restartStableTimer) {
                clearTimeout(self.restartStableTimer);
                self.restartStableTimer = null;
            }
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
                    // cancel:true asks node-telegram-bot-api to abort the in-flight
                    // getUpdates so stopPolling resolves immediately instead of waiting
                    // for the long-poll timeout. Previously we passed cancel:false and
                    // then reached into _polling._lastRequest.cancel() to achieve the
                    // same thing - same outcome, two racing cancellations, internal API.
                    self.telegramBot.stopPolling({ cancel: true }).then(setStatusDisconnected, setStatusDisconnected);
                } else if (self.telegramBot._webHook) {
                    // Telegram keeps the previously registered webhook URL on file until we tell it
                    // to drop it. Wait for deleteWebHook to complete (or fail) before tearing the
                    // local listener down so a redeploy with a new URL takes effect immediately.
                    // Either branch falls through to closing the local hook.
                    self.telegramBot
                        .deleteWebHook()
                        .catch(function () {
                            // ignore - we still want to close the local hook
                        })
                        .then(function () {
                            self.telegramBot.closeWebHook().then(setStatusDisconnected, setStatusDisconnected);
                        });
                } else {
                    setStatusDisconnected();
                }
            } else {
                setStatusDisconnected();
            }
        };

        // Tear the bot down, then rebuild it after a back-off. This is the recovery
        // path for fatal failures emitted on the bot's 'error' event — keep-alive socket
        // pools going stale, proxy interruptions that outlive the polling-restart logic,
        // etc. Without this the bot stays silent until manual redeploy (issues #442, #440).
        //
        // Single-flight: while a restart is queued or in progress, further calls are dropped.
        // Backoff: 3 s, 6 s, 12 s, 24 s, 48 s, capped at 60 s. After 8 failed restarts in a
        // row the helper logs a node.error and gives up — operator intervention required.
        //
        // Stable-window: a "successful" restart only counts as such once the bot has been
        // operational for STABLE_WINDOW_MS without another error. Until that timer fires,
        // a fresh error keeps the count climbing through the backoff curve. Without this,
        // persistent network problems (issue #442 retest, where errors arrive every ~5 s)
        // would have the helper oscillate at the minimum 3 s delay forever and never let
        // the exponential curve do its job.
        const STABLE_WINDOW_MS = 60000;
        this.restartCount = 0;
        this.restartTimer = null;
        this.restartStableTimer = null;
        this.scheduleRestart = function (reason) {
            if (self.restartTimer) {
                return;
            }
            // A fresh error invalidates any in-progress "looks stable" countdown — the
            // previous restart's success was illusory.
            if (self.restartStableTimer) {
                clearTimeout(self.restartStableTimer);
                self.restartStableTimer = null;
            }
            if (self.restartCount >= 8) {
                self.error('Bot ' + self.botname + ' gave up restarting after fatal: ' + reason);
                return;
            }
            const delay = Math.min(60000, 3000 * Math.pow(2, self.restartCount));
            self.restartCount++;
            self.warn('Bot ' + self.botname + ' will restart in ' + delay + 'ms (' + reason + ')');
            self.restartTimer = setTimeout(function () {
                self.restartTimer = null;
                self.abortBot('pre-restart', function () {
                    // abortBot already nulled self.telegramBot via setStatusDisconnected.
                    // Re-create through the standard path; a successful create rebuilds the
                    // http.Agent so a stale keep-alive pool is replaced.
                    self.status = 'disconnected';
                    const bot = self.getTelegramBot();
                    if (bot) {
                        self.status = 'connected';
                        self.setStatus('started', 'restarted after ' + reason);
                        // Don't reset restartCount yet. If another error fires inside the
                        // stable window, scheduleRestart will clear this timer and treat
                        // the next failure as a continuation of the same outage so the
                        // backoff keeps escalating.
                        self.restartStableTimer = setTimeout(function () {
                            self.restartStableTimer = null;
                            self.restartCount = 0;
                        }, STABLE_WINDOW_MS);
                    } else {
                        // creation failed (e.g. webhook config incomplete); back off again
                        self.scheduleRestart('retry-create');
                    }
                });
            }, delay);
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
            // On first construction self.telegramBot is undefined, not null. abortBot()
            // explicitly sets it back to null, so allow both forms here - otherwise a
            // control-node "start" on a never-started bot would be a silent no-op.
            if (!self.telegramBot && self.status === 'disconnected') {
                self.status = 'connecting';
                self.getTelegramBot(); // trigger creation
                if (self.telegramBot) {
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
                    botToken = evalContextExpression(self, expression);
                }
            }

            return botToken;
        };

        this.getUserNames = function () {
            let usernames = [];
            // Truthiness check rather than !== '' so undefined / null (e.g. flow JSON that
            // omits the field entirely) is handled the same as an empty string.
            if (self.config.usernames) {
                let trimmedUsernames = self.config.usernames.trim();
                if (trimmedUsernames.startsWith('{') && trimmedUsernames.endsWith('}')) {
                    let expression = trimmedUsernames.substr(1, trimmedUsernames.length - 2);
                    let result = evalContextExpression(self, expression);
                    if (Array.isArray(result)) {
                        usernames = result;
                    } else if (typeof result === 'string') {
                        // env.get / flow.get / global.get may yield a raw string when the
                        // stored value is e.g. a process env var ("alice,bob"). Split on
                        // commas to match the literal-comma branch below.
                        usernames = result.split(',');
                    }
                } else {
                    usernames = self.config.usernames.split(',');
                }
            }

            return usernames;
        };

        this.getChatIds = function () {
            let chatids = [];
            // Same truthiness reasoning as getUserNames.
            if (self.config.chatids) {
                let trimmedChatIds = self.config.chatids.trim();
                if (trimmedChatIds.startsWith('{') && trimmedChatIds.endsWith('}')) {
                    let expression = trimmedChatIds.substr(1, trimmedChatIds.length - 2);
                    let result = evalContextExpression(self, expression);
                    if (Array.isArray(result)) {
                        chatids = result;
                    } else if (typeof result === 'string') {
                        // env.get / flow.get / global.get may yield a raw string when the
                        // stored value is e.g. a process env var ("123,456"). Split and
                        // coerce to numbers to match the literal-comma branch below.
                        chatids = result.split(',').map(function (item) {
                            return parseInt(item, 10);
                        });
                    } else if (typeof result === 'number') {
                        chatids = [result];
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
            // Allowlists are "empty" if the field is omitted from the flow JSON (undefined)
            // or set to the empty string by the editor — both mean "default open".
            if (!self.config.chatids && !self.config.usernames) {
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

// Exposed for unit tests. Not part of the public Node-RED API — do not consume from flows.
module.exports.__test = { parseStringArgList, evalContextExpression, formatErrorChain };

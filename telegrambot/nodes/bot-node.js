const { formatErrorChain } = require('../lib/error-chain');
const { evalContextExpression } = require('../lib/context-expression');

module.exports = function (RED) {
    let telegramBot = require('node-telegram-bot-api');
    let telegramBotWebHook = require('node-telegram-bot-api/src/telegramWebHook');

    let { SocksProxyAgent } = require('socks-proxy-agent');

    // See this.conflict409Times in the config-node constructor for the rationale.
    const CONFLICT_409_THRESHOLD = 10;
    const CONFLICT_409_WINDOW_MS = 30000;

    // See this.pollingErrorTimes in the config-node constructor for the rationale.
    // 5 polling errors in 60 s = sustained problem, escalate from the cheap
    // restartPolling path (which reuses the same _polling instance and the same
    // HTTP agent pool) to scheduleRestart (which rebuilds the bot and the agent
    // pool from scratch). #442 retest 2026-05-29: petermeter69's wedge showed
    // every error going through the polling path and never triggering the
    // 'error' event, so the V17.4.5 agent-pool rebuild never ran.
    const POLLING_ERROR_THRESHOLD = 5;
    const POLLING_ERROR_WINDOW_MS = 60000;

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
        // Coerce to strict boolean. n.verboselogging is bound to an HTML checkbox so
        // it should be true/false, but older configs (or hand-edited / imported
        // flows.json) can carry the value as the *string* 'false', which is truthy
        // and silently flips every verbose-gated `self.warn(...)` to fire even when
        // the UI checkbox is unchecked. Issue #411 retest, May 2026.
        this.verbose = !!n.verboselogging && n.verboselogging !== 'false';

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

        // Builds the @cypress/request options object that node-telegram-bot-api passes
        // into every HTTP call. Returned with a fresh `pool: {}` reference each call —
        // see destroyRequestPool below for why. Earlier versions of this code passed
        // `agentOptions` with no `pool` field for the non-SOCKS path, which silently
        // routed all bot traffic through @cypress/request's process-global pool. That
        // meant the keep-alive socket pool persisted across bot rebuilds — exactly the
        // wedge petermeter69 reported on #442 ("connection to TG is dead until manual
        // redeploy, network itself is fine"). With a fresh per-bot `pool: {}` and the
        // explicit destroy on rebuild, scheduleRestart genuinely replaces the agent.
        this.buildRequestOptions = function () {
            const pool = {};
            self.requestPool = pool;
            let result;
            if (self.useSocks) {
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

                if (self.addressFamily === 4 || self.addressFamily === 6) {
                    agentOptions.family = self.addressFamily;
                }

                result = {
                    agentClass: SocksProxyAgent,
                    agentOptions: agentOptions,
                    pool: pool,
                };
            } else {
                let agentOptions = {
                    keepAlive: true,
                };

                if (self.addressFamily === 4 || self.addressFamily === 6) {
                    agentOptions.family = self.addressFamily;
                }

                result = {
                    agentOptions: agentOptions,
                    pool: pool,
                };
            }
            return result;
        };

        // Destroys every agent currently cached in self.requestPool. @cypress/request
        // populates the pool keyed by protocol + cert/cipher options (see request.js
        // getNewAgent) and reuses the same agent instance across requests with the same
        // key. Without explicit destroy(), the agent's keep-alive sockets stay open
        // until they idle out or the agent is garbage-collected — neither happens
        // promptly when a dropped network link silently kills half-open sockets, which
        // is the root cause of the "bot says polling but nothing flows" wedge in #442.
        this.destroyRequestPool = function () {
            const pool = self.requestPool;
            if (pool && typeof pool === 'object') {
                for (const key of Object.keys(pool)) {
                    const agent = pool[key];
                    if (agent && typeof agent.destroy === 'function') {
                        agent.destroy();
                    }
                }
            }
            self.requestPool = null;
        };

        this.request = this.buildRequestOptions();

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
                        // Properly halt the existing polling instance before starting a new
                        // poll. Earlier versions of this code (V17.4.4) nulled _polling
                        // before calling startPolling, but that doesn't actually stop the
                        // recursive setTimeout loop already scheduled inside the old polling
                        // instance — the OLD instance is held alive by its .finally()
                        // closure and keeps making getUpdates against Telegram, racing with
                        // the new one (#440 retest). The only thing that stops the loop is
                        // setting _abort=true on the polling instance, which is what
                        // stopPolling({cancel:false}) does. After it resolves, the loop is
                        // genuinely halted and startPolling can safely begin a fresh cycle
                        // on the same _polling instance (lib's start() recreates _lastRequest).
                        const polling = self.telegramBot._polling;
                        if (polling && polling._lastRequest && typeof polling._lastRequest.cancel === 'function') {
                            polling._lastRequest.cancel('restartPolling');
                        }
                        self.telegramBot.stopPolling({ cancel: false }).then(
                            function () {
                                if (self.telegramBot) {
                                    self.telegramBot.startPolling({ restart: true });
                                }
                            },
                            function () {
                                if (self.telegramBot) {
                                    self.telegramBot.startPolling({ restart: true });
                                }
                            }
                        );
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
                let skipRestart = false;
                let hint;
                if (error.message === 'ETELEGRAM: 401 Unauthorized') {
                    hint = 'Please check if the bot token is valid.';
                    stopPolling = true;
                } else if (error.message && error.message.indexOf('ETELEGRAM: 409 Conflict') === 0) {
                    // 409 means Telegram saw another getUpdates request for the same token —
                    // typically the previous one is still being processed server-side after a
                    // restart or redeploy. The library's polling loop will naturally retry on
                    // the next interval; calling stopPolling+restartPolling on top of that
                    // races yet ANOTHER getUpdates and perpetuates the conflict (issue #442
                    // retest, "ETELEGRAM: 409 Conflict ... on pressing the deploy button").
                    // Skip the restart, let it clear on its own.
                    hint = '409 Conflict — another getUpdates still in flight server-side; letting it clear naturally.';
                    skipRestart = true;
                } else {
                    // unknown error occured... we simply ignore it.
                    hint = 'Polling error --> Trying again.';
                }

                if (stopPolling) {
                    self.abortBot(error.message, function () {
                        self.error('Bot ' + self.botname + ' stopped: ' + hint);
                    });
                } else if (skipRestart) {
                    // Reached only via the 409 Conflict branch. Track to distinguish
                    // a transient same-process race (clears in seconds, V17.4.4
                    // scenario) from a persistent second-poller (#441, never clears).
                    if (self.record409Conflict()) {
                        const giveUpMsg =
                            'Bot ' +
                            self.botname +
                            ' stopped: ' +
                            CONFLICT_409_THRESHOLD +
                            ' "409 Conflict" responses in ' +
                            CONFLICT_409_WINDOW_MS / 1000 +
                            's — another getUpdates is actively in flight for this bot token. ' +
                            'Check https://api.telegram.org/bot<TOKEN>/getWebhookInfo, kill any duplicate bot instance, then redeploy.';
                        self.abortBot('409-loop', function () {
                            self.error(giveUpMsg);
                        });
                    } else if (self.verbose) {
                        self.warn(hint);
                    }
                } else {
                    // Normal polling failure path. Two recovery modes:
                    //
                    // 1. Cheap path (transient blip): stopPolling+restartPolling on
                    //    the same _polling instance. Same _polling state, same
                    //    HTTP agent pool. Works fine when the failure is genuinely
                    //    transient.
                    // 2. Escalation path (sustained burst): recordPollingError trips
                    //    after POLLING_ERROR_THRESHOLD failures in
                    //    POLLING_ERROR_WINDOW_MS. The cheap path is no longer enough
                    //    because (a) repeated overlapping stopPolling/startPolling
                    //    cycles can wedge the lib's polling state machine and
                    //    (b) the underlying keep-alive pool may be handing out dead
                    //    sockets. Escalate to scheduleRestart, which abortBot's the
                    //    bot, destroyRequestPool's the agent pool, and constructs a
                    //    fresh bot — the only path that genuinely rebuilds the agent
                    //    pool on the polling code path. #442 retest 2026-05-29.
                    if (self.recordPollingError()) {
                        self.scheduleRestart('polling-burst: ' + (error.message || 'unknown'));
                    } else {
                        self.telegramBot.stopPolling({ cancel: false }).then(restartPolling, restartPolling);
                    }

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
            self.abortBot('closing', function () {
                // Tear down the keep-alive socket pool too, so a redeploy doesn't leave
                // dangling sockets behind. See destroyRequestPool for context.
                self.destroyRequestPool();
                done();
            });
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
                    // We need BOTH halves of node-telegram-bot-api's stop() semantics here:
                    //
                    // - cancel:false sets the polling instance's `_abort = true`, which is
                    //   the ONLY thing that stops the recursive setTimeout loop inside
                    //   `_polling()` (see telegramPolling.js:163 `.finally()`). Without
                    //   _abort, the cancelled HTTP request settles via the .catch path,
                    //   `.finally()` runs, sees no abort, and schedules ANOTHER `_polling()`
                    //   iteration. Result: the old polling instance keeps making
                    //   getUpdates requests after stopPolling resolves, racing with whatever
                    //   the next bot construction sets up. Telegram sees two getUpdates for
                    //   the same token and 409 Conflicts the loser (#440, #441 retest).
                    //
                    // - We *also* call .cancel() on the in-flight request directly so the
                    //   local socket closes immediately rather than waiting up to
                    //   pollTimeout seconds for Telegram's long-poll to time out. Without
                    //   this, stopPolling can take up to 10 s on the happy path (when the
                    //   in-flight getUpdates is just waiting), which would push redeploys
                    //   past Node-RED's close timeout.
                    //
                    // V17.3.0 dropped the explicit `.cancel()` in favour of cancel:true, and
                    // V17.4.4 added a `_polling = null` hack to compensate. Neither actually
                    // stopped the recursive loop. This restores the pattern that does.
                    const polling = self.telegramBot._polling;
                    if (polling._lastRequest && typeof polling._lastRequest.cancel === 'function') {
                        polling._lastRequest.cancel('abortBot');
                    }
                    self.telegramBot.stopPolling({ cancel: false }).then(setStatusDisconnected, setStatusDisconnected);
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
        // Backoff: 3 s, 6 s, 12 s, 24 s, 48 s, then 60 s forever — there is no give-up.
        // V17.4.12 and earlier capped the retry count at 8 and then permanently silenced
        // the bot, but that left the operator with the same recourse as not retrying at
        // all (manual redeploy) while removing any chance of automatic recovery when the
        // underlying network eventually came back (#442 retest 2026-05-27, 15-minute
        // wedge from a transient EAI_AGAIN burst). The helper now keeps trying at the
        // 60 s ceiling indefinitely; a single node.error fires the first time the
        // ceiling is reached (~90 s into a sustained outage) so the operator gets one
        // actionable alert without being spammed every minute.
        //
        // Stable-window: a "successful" restart only counts as such once the bot has been
        // operational for STABLE_WINDOW_MS without another error. Until that timer fires,
        // a fresh error keeps the count climbing through the backoff curve. Without this,
        // persistent network problems (issue #442 retest, where errors arrive every ~5 s)
        // would have the helper oscillate at the minimum 3 s delay forever and never let
        // the exponential curve do its job. The same callback also clears
        // restartCeilingAnnounced so a future outage can raise the ceiling alert again.
        const STABLE_WINDOW_MS = 60000;
        this.restartCount = 0;
        this.restartTimer = null;
        this.restartStableTimer = null;
        // Tracks whether the "auto-restart hit 60s ceiling" node.error has already
        // fired for the current outage. Set by scheduleRestart on the first ceiling
        // hit; cleared by the stable-window callback when the bot has run cleanly
        // for STABLE_WINDOW_MS.
        this.restartCeilingAnnounced = false;
        // Persistent-409-Conflict circuit breaker (issue #441). The library's polling
        // loop naturally retries every pollInterval, so on a genuine same-process race
        // (V17.4.4 scenario) the conflict clears within seconds. But if a *separate*
        // bot instance is actively polling the same token — a second Node-RED, a
        // forgotten Docker container, a webhook accidentally registered — the 409s
        // persist forever and the log fills with thousands of lines per minute.
        // CONFLICT_409_THRESHOLD failures within CONFLICT_409_WINDOW_MS trip the
        // breaker: we call abortBot and log a single actionable node.error. Operator
        // intervention is required (kill the other poller, then redeploy).
        this.conflict409Times = [];

        // Record one 409 Conflict observation. Returns true if the breaker has tripped
        // (caller should abortBot and log a node.error); false to continue letting the
        // library's natural retry handle it. Resets the window when it trips so the
        // operator gets exactly one error log per outage, not one per overflow.
        this.record409Conflict = function () {
            const now = Date.now();
            self.conflict409Times.push(now);
            while (self.conflict409Times.length > 0 && now - self.conflict409Times[0] > CONFLICT_409_WINDOW_MS) {
                self.conflict409Times.shift();
            }
            let trip = false;
            if (self.conflict409Times.length >= CONFLICT_409_THRESHOLD) {
                self.conflict409Times = [];
                trip = true;
            }
            return trip;
        };

        // Polling-burst circuit breaker (issue #442 retest 2026-05-29). The
        // polling_error event fires for every transient network failure; the
        // cheap recovery is stopPolling+restartPolling on the same _polling
        // instance, which keeps the HTTP keep-alive agent pool intact. That
        // pool can hold zombie sockets after a real network drop, and many
        // rapid stop/start cycles can wedge the lib's polling state machine.
        // POLLING_ERROR_THRESHOLD failures within POLLING_ERROR_WINDOW_MS trip
        // the breaker: caller escalates to scheduleRestart, which destroys the
        // agent pool and constructs a fresh bot. Reset on bot rebuild in
        // scheduleRestart's success path so the new bot starts with a clean
        // window.
        this.pollingErrorTimes = [];

        // Record one polling-error observation. Returns true if the breaker
        // has tripped (caller should escalate to scheduleRestart); false to
        // continue with the cheap restartPolling path. Resets the window when
        // it trips so the breaker doesn't fire repeatedly while the rebuild
        // is in flight.
        this.recordPollingError = function () {
            const now = Date.now();
            self.pollingErrorTimes.push(now);
            while (self.pollingErrorTimes.length > 0 && now - self.pollingErrorTimes[0] > POLLING_ERROR_WINDOW_MS) {
                self.pollingErrorTimes.shift();
            }
            let trip = false;
            if (self.pollingErrorTimes.length >= POLLING_ERROR_THRESHOLD) {
                self.pollingErrorTimes = [];
                trip = true;
            }
            return trip;
        };

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
            const delay = Math.min(60000, 3000 * Math.pow(2, self.restartCount));
            if (delay >= 60000 && !self.restartCeilingAnnounced) {
                // Backoff has reached the 60 s ceiling — the exponential ramp
                // (3 + 6 + 12 + 24 + 48 ≈ 90 s of sustained failures) has been
                // fully consumed without any restart surviving the stable window.
                // Emit one node.error so the operator gets a single actionable
                // alert that automatic recovery is no longer making forward
                // progress; the helper keeps retrying at the ceiling silently
                // after this. V17.4.12 and earlier hit a hard give-up at 8
                // attempts instead, which left the bot permanently silent until
                // manual redeploy with no upside (#442 retest 2026-05-27).
                self.restartCeilingAnnounced = true;
                self.error(
                    'Bot ' +
                        self.botname +
                        ' auto-restart hit 60s ceiling — sustained failure (' +
                        reason +
                        '). Will keep retrying every 60s until network/Telegram recovers.'
                );
            }
            self.restartCount++;
            self.warn('Bot ' + self.botname + ' will restart in ' + delay + 'ms (' + reason + ')');
            self.restartTimer = setTimeout(function () {
                self.restartTimer = null;
                self.abortBot('pre-restart', function () {
                    // abortBot already nulled self.telegramBot via setStatusDisconnected.
                    // Destroy every agent in the per-bot request pool and replace it with
                    // a fresh empty pool before re-creating the bot. @cypress/request keys
                    // its agent cache on the pool object and reuses agent instances across
                    // requests with the same protocol/cert combination — without an
                    // explicit destroy, half-dead keep-alive sockets from the previous
                    // outage stay parked in the pool and the new bot inherits the same
                    // wedge (issue #442: "bot says polling, nothing flows, only manual
                    // redeploy recovers"). The buildRequestOptions call hands back a
                    // request option object with a fresh pool reference, which
                    // createTelegramBot then passes into the new bot.
                    self.status = 'disconnected';
                    self.destroyRequestPool();
                    self.request = self.buildRequestOptions();
                    const bot = self.getTelegramBot();
                    if (bot) {
                        self.status = 'connected';
                        self.setStatus('started', 'restarted after ' + reason);
                        // New bot, fresh agent pool — clear the polling-burst
                        // breaker so the new bot starts with a clean window.
                        self.pollingErrorTimes = [];
                        // Don't reset restartCount yet. If another error fires inside the
                        // stable window, scheduleRestart will clear this timer and treat
                        // the next failure as a continuation of the same outage so the
                        // backoff keeps escalating.
                        self.restartStableTimer = setTimeout(function () {
                            self.restartStableTimer = null;
                            self.restartCount = 0;
                            // Clear the ceiling-announced flag so a future outage
                            // can raise the operator alert again.
                            self.restartCeilingAnnounced = false;
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

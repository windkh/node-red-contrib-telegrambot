const { formatErrorChain } = require('../lib/error-chain');
const { evalContextExpression } = require('../lib/context-expression');
const { buildDispatcher, closeDispatcher } = require('../lib/undici-pool');

// node-telegram-bot-api v1.1.2 restored CommonJS consumption (dual ESM + CJS
// build), so we load the constructor synchronously at module load: require()
// returns the module namespace and `.default` is the TelegramBot class. The
// v1.0.0–1.1.1 ESM-only era forced an async dynamic-import shim
// (telegram-bot-loader.js, now removed); with the floor pinned to ^1.1.2 the
// synchronous require is always available, which also removes the first-load
// race the dynamic import caused.
const TelegramBot = require('node-telegram-bot-api').default;

// A TelegramBot subclass that emits getUpdates_start / getUpdates_end so the
// control node can drive its "live polling activity" status, and 'update' so
// the receiver node can dispatch any update shape. Defined once at module load
// (depends only on TelegramBot, not RED).
class TelegramBotEx extends TelegramBot {
    constructor(token, options = {}) {
        super(token, options);
        this.cycle = 0;
    }

    getUpdates(form = {}) {
        this.cycle++;
        this.emit('getUpdates_start', this.cycle);
        const startTime = Date.now();
        const result = super.getUpdates(form);
        result
            .then((updates) => {
                this.emit('getUpdates_end', this.cycle, Date.now() - startTime, updates);
            })
            .catch(() => {
                // Errors from getUpdates are handled by the caller;
                // suppress unhandled rejection here.
            });
        return result;
    }

    processUpdate(update) {
        this.emit('update', update);
        super.processUpdate(update);
    }
}

module.exports = function (RED) {
    // See this.conflict409Times in the config-node constructor for the rationale.
    const CONFLICT_409_THRESHOLD = 10;
    const CONFLICT_409_WINDOW_MS = 30000;

    // See this.pollingErrorTimes in the config-node constructor for the rationale.
    // 5 polling errors in 60 s = sustained problem, escalate from the cheap
    // restartPolling path (which reuses the same _polling instance and the same
    // HTTP keep-alive pool) to scheduleRestart (which rebuilds the bot and the
    // pool from scratch). #442 retest 2026-05-29: petermeter69's wedge showed
    // every error going through the polling path and never triggering the
    // 'error' event, so the V17.4.5 agent-pool rebuild never ran.
    const POLLING_ERROR_THRESHOLD = 5;
    const POLLING_ERROR_WINDOW_MS = 60000;

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

        // Coerce empty string to undefined so v1.0.0's `baseApiUrl ?? "https://api.telegram.org"`
        // default kicks in. The `??` operator does NOT short-circuit on empty
        // string, so passing '' through leaves the lib with a URL like
        // `/bot<TOKEN>/getUpdates` (no scheme) which fetch rejects with
        // `EFATAL: Failed to parse URL`.
        this.baseApiUrl = n.baseapiurl ? n.baseapiurl : undefined;
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

        // The undici dispatcher backing THIS bot's outbound HTTPS traffic.
        // Built in instantiateBot, passed to the bot via
        // request.fetchOptions.dispatcher, and closed in destroyDispatcher
        // (on node close and on scheduleRestart). Per-bot, not process-global.
        this.dispatcher = null;

        // Builds the options object passed to `buildDispatcher` (see
        // telegrambot/lib/undici-pool). node-telegram-bot-api v1.1.1 accepts a
        // per-instance transport via `request.fetchOptions.dispatcher`, so each
        // bot gets its own undici Agent (or `fetch-socks` socksDispatcher) —
        // restoring the per-bot pool/proxy isolation V17 had. The V17.4.5 /
        // V17.4.13 #442 defence is preserved via close+rebuild on
        // `scheduleRestart`.
        this.buildDispatcherOptions = function () {
            const agent = { keepAliveTimeout: 4000 };
            if (self.addressFamily === 4 || self.addressFamily === 6) {
                agent.connect = { family: self.addressFamily };
            }
            let result;
            if (self.useSocks) {
                const socksType = (n.socksprotocol || 'socks5') === 'socks4' ? 4 : 5;
                const socks = {
                    type: socksType,
                    host: n.sockshost,
                    port: n.socksport,
                };
                if (n.socksusername) socks.userId = n.socksusername;
                if (n.sockspassword) socks.password = n.sockspassword;
                result = { socks, agent };
            } else {
                result = { agent };
            }
            return result;
        };

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
            };

            newTelegramBot = self.instantiateBot(this.token, options);
            if (!newTelegramBot) {
                return null;
            }

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
                .setWebhook(botUrl, setWebHookOptions)
                .then(function (success) {
                    if (self.verbose) {
                        newTelegramBot
                            .getWebhookInfo()
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
                        // v1.0.0's `stopPolling({cancel: true})` uses AbortController
                        // internally to cancel the in-flight getUpdates and sets the
                        // polling instance's `_abort = true` to halt the recursive
                        // loop in one go — replacing the V17.4.8 dance that called
                        // `_lastRequest.cancel()` then `stopPolling({cancel: false})`
                        // by hand because v0.x's `{cancel: true}` didn't set _abort.
                        self.telegramBot.stopPolling({ cancel: true }).then(
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
            };
            newTelegramBot = self.instantiateBot(this.token, options);
            if (!newTelegramBot) {
                return null;
            }

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
                    //    sockets. Escalate to scheduleRestart, which abortBot's
                    //    the bot, destroys the undici dispatcher pool, and
                    //    constructs a fresh bot — the only path that genuinely
                    //    rebuilds the agent pool on the polling code path.
                    //    #442 retest 2026-05-29.
                    if (self.recordPollingError()) {
                        self.scheduleRestart('polling-burst: ' + (error.message || 'unknown'));
                    } else {
                        self.telegramBot.stopPolling({ cancel: true }).then(restartPolling, restartPolling);
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
            };
            newTelegramBot = self.instantiateBot(this.token, options);
            if (newTelegramBot) {
                self.status = 'send only mode';
            }
            return newTelegramBot;
        };

        // Construct a bot (subclass of TelegramBot with our event-emitting
        // overrides), giving it a freshly-built per-instance undici dispatcher
        // (address-family / SOCKS configuration) via the v1.1.1
        // `request.fetchOptions.dispatcher` transport hook. TelegramBotEx is
        // require()'d synchronously at module load (lib v1.1.2 CJS), so it's
        // always available here.
        this.instantiateBot = function (token, options) {
            const dispatcher = buildDispatcher(self.buildDispatcherOptions());
            // Close any previous dispatcher we never explicitly tore down
            // (e.g. a control-node stop→start that re-instantiates without
            // going through on('close') / scheduleRestart) so its pool
            // doesn't leak. Fire-and-forget: the old bot is already gone.
            const previous = self.dispatcher;
            self.dispatcher = dispatcher;
            if (previous && previous !== dispatcher) {
                closeDispatcher(previous).catch(function () {});
            }
            // Merge the dispatcher into options.request.fetchOptions without
            // clobbering any request fields a caller may already have set.
            const request = Object.assign({}, options.request);
            request.fetchOptions = Object.assign({}, request.fetchOptions, { dispatcher });
            const optionsWithTransport = Object.assign({}, options, { request });
            const bot = new TelegramBotEx(token, optionsWithTransport);
            return bot;
        };

        // Close this bot's undici dispatcher (draining its keep-alive pool) and
        // clear the reference. Returns a promise so callers can await a clean
        // shutdown. Replaces the V18-beta.1 process-global destroyDispatcher().
        this.destroyDispatcher = function () {
            const dispatcher = self.dispatcher;
            self.dispatcher = null;
            return closeDispatcher(dispatcher);
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
                p = telegramBot.deleteWebhook();
            } else {
                p = telegramBot.setWebhook(url, options || {});
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
                // Tear down this bot's undici dispatcher so a redeploy doesn't
                // leave dangling sockets behind. Async — wait for the pool to
                // drain before calling done() so Node-RED's close timeout
                // sees a clean shutdown.
                self.destroyDispatcher().then(done, done);
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
                    // v1.0.0's `stopPolling({cancel: true})` aborts the in-flight
                    // getUpdates via an AbortController AND sets the polling
                    // instance's `_abort = true` to halt the recursive loop in
                    // one call. Resolves once the active request settles, so the
                    // V17.4.8 two-step (`_lastRequest.cancel()` then
                    // `stopPolling({cancel: false})`) is no longer needed — both
                    // halves now happen inside the public API.
                    self.telegramBot.stopPolling({ cancel: true }).then(setStatusDisconnected, setStatusDisconnected);
                } else if (self.telegramBot._webHook) {
                    // Telegram keeps the previously registered webhook URL on file until we tell it
                    // to drop it. Wait for deleteWebHook to complete (or fail) before tearing the
                    // local listener down so a redeploy with a new URL takes effect immediately.
                    // Either branch falls through to closing the local hook.
                    self.telegramBot
                        .deleteWebhook()
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
                    // Close this bot's undici dispatcher (which closes every
                    // keep-alive socket in the pool) and let the next bot
                    // construction build a fresh one. Same #442 defence as
                    // V17.4.5 / V17.4.13 — half-dead sockets from the previous
                    // outage cannot survive into the new bot.
                    self.status = 'disconnected';
                    self.destroyDispatcher().catch(function () {
                        // Pool drain failures are non-fatal — proceed with
                        // the new bot construction regardless.
                    });
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

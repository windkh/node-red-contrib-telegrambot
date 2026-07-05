module.exports = function (RED) {
    let net = require('net');

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

        node.isOnline = undefined; // see checkConnection function.

        // Track our own listener references so stop() can remove them
        // explicitly. Without tracking, the historical `telegramBot.off(event)`
        // pattern (no listener arg) crashes on modern Node:
        // `TypeError: The "listener" argument must be of type function`.
        node._getUpdatesStartHandler = null;
        node._getUpdatesEndHandler = null;

        this.start = function () {
            let telegramBot = node.config.getTelegramBot();
            if (telegramBot) {
                node._getUpdatesStartHandler = function (cycle) {
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'polling cycle ' + cycle,
                    });
                };
                node._getUpdatesEndHandler = function (cycle, duration, updates) {
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
                };

                telegramBot.on('getUpdates_start', node._getUpdatesStartHandler);
                telegramBot.on('getUpdates_end', node._getUpdatesEndHandler);

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
            let telegramBot = node.config.getTelegramBot(false);
            if (telegramBot) {
                if (node._getUpdatesStartHandler) {
                    telegramBot.off('getUpdates_start', node._getUpdatesStartHandler);
                    node._getUpdatesStartHandler = null;
                }
                if (node._getUpdatesEndHandler) {
                    telegramBot.off('getUpdates_end', node._getUpdatesEndHandler);
                    node._getUpdatesEndHandler = null;
                }
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
                    if (node.isOnline != true) {
                        node.isOnline = true;
                        let msg = {
                            payload: {
                                isOnline: true,
                            },
                        };
                        node.send([null, msg]);
                    }
                },
                function (err) {
                    if (node.isOnline != false) {
                        node.isOnline = false;
                        let msg = {
                            payload: {
                                isOnline: false,
                                error: err,
                            },
                        };
                        node.send([null, msg]);
                    }
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
            // Do NOT force a status here. The connection status is owned by the config
            // node's 'status' events (-> onStatusChanged -> start()/stop()). Painting
            // "connected" unconditionally on every input lied about the state for no-op
            // commands: e.g. injecting "stop" on an already-stopped bot left the node
            // green because config.stop() short-circuits without emitting 'stopped'.
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
                                node.restartTimer = setTimeout(function () {
                                    node.restartTimer = null;
                                    node.config.start('by control node', function () {
                                        node.send(msg);
                                    });
                                }, delay);
                            } else {
                                node.config.start('by control node', function () {
                                    node.send(msg);
                                });
                            }
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
                    case 'setwebhook': {
                        // Dynamic webhook URL update (issue #410). Useful for ngrok / dynamic-DNS
                        // setups where the public URL changes between restarts. Note: only meaningful
                        // when the bot is in webhook mode — Telegram rejects setWebHook when polling
                        // is active. The user is responsible for configuring the right updatemode.
                        // Pass msg.payload.url = "" to deleteWebHook instead.
                        let url = msg.payload.url;
                        let options = msg.payload.options;
                        node.config.setWebHookDynamically(url, options, function (err, result) {
                            if (err) {
                                msg.error = err.message || String(err);
                                node.send(msg);
                            } else {
                                msg.payload.result = result;
                                node.send(msg);
                            }
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
                clearInterval(node.checkConnectionTimer);
                node.checkConnectionTimer = null;
            }

            // Cancel a pending delayed restart so we don't fire start() against a deleted node.
            if (node.restartTimer) {
                clearTimeout(node.restartTimer);
                node.restartTimer = null;
            }

            node.stop();

            if (node.onStatusChanged) {
                node.config.removeListener('status', node.onStatusChanged);
            }

            node.status({});
            done();
        });
    }

    return TelegramControlNode;
};

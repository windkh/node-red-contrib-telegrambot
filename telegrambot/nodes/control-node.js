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

    return TelegramControlNode;
};

module.exports = function (RED) {
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

    return TelegramCommandNode;
};

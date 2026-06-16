module.exports = function (RED) {
    const path = require('path');
    const { pipeline } = require('stream');
    const fs = require('fs');
    const QueueManager = require('../lib/queue-manager.js');
    const safeStringify = require('../lib/safe-stringify.js');
    const { migrateLegacyOptions } = require('../lib/legacy-options.js');

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
        this.messagesProcessed = 0;
        this.retryDelayError429 = 3; // 3s when too many requests
        this.retryDelayErrorNoConnection = 10; // 10s when not connected to internet

        // Set of deprecation-warn strings that have already been emitted for
        // this node, so each deprecated msg.payload.options form is reported
        // exactly once per node lifetime instead of once per send. Cleared on
        // node close.
        this.deprecationWarnsSeen = new Set();

        // Run the legacy-options shim on the user-supplied options, warning
        // once per deprecated field per node. Tolerates undefined / non-object
        // input (the shim itself short-circuits). Called wherever the node
        // forwards `msg.payload.*` option objects into the bot library.
        this.migrateOptions = function (options) {
            return migrateLegacyOptions(options, function (warnMsg) {
                if (!node.deprecationWarnsSeen.has(warnMsg)) {
                    node.deprecationWarnsSeen.add(warnMsg);
                    node.warn(warnMsg);
                }
            });
        };

        let haserroroutput = config.haserroroutput || false;

        // ------------------------------------------------------------------
        // One queue per chatId to ensure that messages to the same chat are sent in order.
        // Messages to different chats can be sent in parallel.
        this.queueManager = new QueueManager();

        this.enqueueMessage = function (chatId, msg, nodeSend, nodeDone) {
            node.queueManager.enqueue(chatId, function () {
                node.processMessage(chatId, msg, nodeSend, nodeDone);
            });
        };
        // ------------------------------------------------------------------

        // Gate every "dispatch a bot call" branch on `msg.payload.content` being
        // present. Crucially: when content is missing we MUST advance the
        // queue head ourselves — every dispatching branch ends with a
        // `processResult`/`processError` callback that calls `processNext`,
        // but the no-content branch has no dispatch and would otherwise leave
        // `processing` stuck `true` forever, silently swallowing every
        // subsequent message on that chatId (issue #450: bug surfaced with a
        // /foo command whose sender saw type='message' but empty content,
        // reproduced cleanly via a `telegram command` node wired into a
        // `telegram sender`). Pass chatId so we can release the queue head;
        // nodeDone is invoked too so the upstream node's promise chain settles.
        this.hasContent = function (msg, chatId, nodeDone) {
            let result = true;
            if (!msg.payload.content) {
                node.warn('msg.payload.content is empty');
                if (nodeDone) nodeDone();
                if (chatId !== undefined && node.queueManager) {
                    node.queueManager.processNext(chatId);
                }
                result = false;
            }
            return result;
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

        // adds the caption of the message into the options.
        this.addCaptionToMessageOptions = function (msg) {
            let options = msg.payload.options;
            if (options === undefined) {
                options = {};
            }

            if (msg.payload.caption !== undefined) {
                options.caption = msg.payload.caption;
            }

            // Backward-compat shim for the 5 deprecated msg.payload.options
            // fields removed in node-telegram-bot-api v1.0.0. Runs once here
            // (the central preprocessing point for the main send dispatch);
            // forward/copy branches handle their own options separately
            // below.
            node.migrateOptions(options);

            msg.payload.options = options;

            return msg;
        };

        this.processError = function (chatId, exception, msg, nodeSend, nodeDone) {
            let retry = false;
            let retryAfter = 10;
            let retryReason = 'ERROR';
            let error429 = String(exception).includes('Too Many Requests: retry after');
            if (error429) {
                retryReason = 'FLOODING';
                retryAfter = exception.response.body.parameters.retry_after || node.retryDelayError429;
                retry = true;
            } else {
                let errorNotFound = String(exception).includes('ENOTFOUND');
                if (errorNotFound) {
                    retryReason = 'ENOTFOUND';
                    retryAfter = node.retryDelayErrorNoConnection;
                    retry = true;
                } else {
                    let errorConnectionReset = String(exception).includes('ECONNRESET');
                    if (errorConnectionReset) {
                        retryReason = 'ECONNRESET';
                        retryAfter = node.retryDelayErrorNoConnection;
                        retry = true;
                    }
                }
            }

            if (!retry) {
                let errorMessage = 'Caught exception in sender node:\r\n' + exception + '\r\nwhen processing message: \r\n' + safeStringify(msg);

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
                // The non-retry error branch logs the exception and moves on —
                // but the queue head must also advance so subsequent messages
                // on the same chatId can run. Without this, a non-retryable
                // failure (e.g. `ETELEGRAM: 400 Bad Request: can't parse
                // entities` when a Markdown-mode message contains an
                // unescaped `_` / `*` / `[`) wedges the chat's queue
                // permanently, exactly the way the empty-content drop did
                // before V17.4.14 (#450). The retry branch below calls
                // `repeatProcessMessage` which re-runs the head; only the
                // give-up path needs explicit advance.
                node.queueManager.processNext(chatId);
            } else {
                let errorMessage = retryReason + ': retrying in ' + retryAfter + 's';
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: errorMessage,
                });

                node.queueManager.repeatProcessMessage(chatId, retryAfter);
            }
        };

        this.processResult = function (chatId, result, msg, nodeSend, nodeDone) {
            node.messagesProcessed++;
            node.status({
                fill: 'green',
                shape: 'ring',
                text: 'messages sent: ' + node.messagesProcessed,
            });

            if (result !== undefined) {
                msg.payload.content = result;
                msg.payload.sentMessageId = result.message_id;
                nodeSend(msg);
            }

            if (nodeDone) {
                nodeDone();
            }

            node.queueManager.processNext(chatId);
        };

        this.processMessage = function (chatId, msg, nodeSend, nodeDone) {
            let telegramBot = this.config.getTelegramBot();

            if (msg.payload.forward) {
                // the message should be forwarded
                let toChatId = msg.payload.forward.chatId;

                let messageId = msg.payload.messageId;
                node.migrateOptions(msg.payload.forward.options);
                telegramBot
                    .forwardMessage(toChatId, chatId, messageId, msg.payload.forward.options)
                    .catch(function (ex) {
                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                    })
                    .then(function (result) {
                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                    });
            } else if (msg.payload.copy) {
                // the message should be copied
                let toChatId = msg.payload.copy.chatId;

                let messageId = msg.payload.messageId;
                node.migrateOptions(msg.payload.copy.options);
                telegramBot
                    .copyMessage(toChatId, chatId, messageId, msg.payload.copy.options)
                    .catch(function (ex) {
                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                    })
                    .then(function (result) {
                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                    });
            } else if (msg.payload.download) {
                let fileId = msg.payload.download.fileId;
                let filePath = msg.payload.download.filePath;
                let fileName = msg.payload.download.fileName;

                node.downloadFile(fileId, filePath, fileName)
                    .catch(function (ex) {
                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                    })
                    .then(function (result) {
                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                    });
            } else if (msg.payload.getfile) {
                let fileId = msg.payload.getfile.fileId;

                telegramBot
                    .getFile(fileId)
                    .catch(function (ex) {
                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                    })
                    .then(function (result) {
                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                    });
            } else {
                if (msg.payload.type) {
                    let type = msg.payload.type;
                    node.addCaptionToMessageOptions(msg);

                    switch (type) {
                        // --------------------------------------------------------------------
                        case 'message':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                // The maximum message size is 4096, so we must split the message into smaller chunks.
                                // Chunks are sent sequentially (one promise chain) so that:
                                //   - Telegram receives them in order,
                                //   - processResult/nodeDone/processNext fire exactly once for the whole message,
                                //   - a chunk failure aborts the remainder via a single processError call.
                                const chunkSize = 4000;
                                const sendChunks = function (remaining) {
                                    const isLast = remaining.length <= chunkSize;
                                    const chunkText = isLast ? remaining : remaining.substr(0, chunkSize);
                                    const rest = isLast ? '' : remaining.substr(chunkSize);
                                    return telegramBot
                                        .sendMessage(chatId, chunkText, msg.payload.options || {})
                                        .catch(function (err) {
                                            // Markdown parse error? Retry this chunk in plain mode. parse_mode is
                                            // deleted from the shared options object so subsequent chunks also fall back.
                                            // TODO: MarkdownV2 issues "Error: ETELEGRAM: 400 Bad Request: can't parse entities:"
                                            // adapt the following if so that MarkdownV2 also works.
                                            let next;
                                            const isMarkdownParseError =
                                                // eslint-disable-next-line quotes
                                                String(err).includes("can't parse entities in message text:") &&
                                                msg.payload.options &&
                                                msg.payload.options.parse_mode === 'Markdown';
                                            if (isMarkdownParseError) {
                                                delete msg.payload.options.parse_mode;
                                                next = telegramBot.sendMessage(chatId, chunkText, msg.payload.options || {});
                                            } else {
                                                next = Promise.reject(err);
                                            }
                                            return next;
                                        })
                                        .then(function (result) {
                                            return isLast ? result : sendChunks(rest);
                                        });
                                };
                                sendChunks(msg.payload.content)
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    })
                                    .catch(function (err) {
                                        node.processError(chatId, err, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'photo':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendPhoto(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;
                        case 'mediaGroup':
                            if (this.hasContent(msg, chatId, nodeDone)) {
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
                                            node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                        })
                                        .then(function (result) {
                                            node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                        });
                                } else {
                                    node.warn('msg.payload.content for mediaGroup is not an array of mediaItem');
                                    // Drop-and-advance: no dispatch on this path, so the
                                    // queue head would otherwise stay `processing: true`
                                    // forever (#450 audit, sibling of the processError /
                                    // hasContent fixes).
                                    node.queueManager.processNext(chatId);
                                }
                            }
                            break;
                        case 'audio':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendAudio(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'document':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendDocument(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'poll':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                // v1.0.0 expects pollOptions as `InputPollOption[]`
                                // (objects with `text`), not the v0.x bare `string[]`.
                                // Existing V17 flows pass string arrays; wrap them so
                                // they keep working transparently.
                                let pollOptions = msg.payload.options || [];
                                if (Array.isArray(pollOptions)) {
                                    pollOptions = pollOptions.map(function (item) {
                                        return typeof item === 'string' ? { text: item } : item;
                                    });
                                }
                                telegramBot
                                    .sendPoll(chatId, msg.payload.content, pollOptions, msg.payload.optional)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'sticker':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendSticker(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'dice':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendDice(chatId, msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'animation':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendAnimation(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'video':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendVideo(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'video_note':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendVideoNote(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'voice':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendVoice(chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'location':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendLocation(chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'venue':
                            if (this.hasContent(msg, chatId, nodeDone)) {
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
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'contact':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                if (msg.payload.content.last_name) {
                                    if (!msg.payload.options) {
                                        msg.payload.options = {};
                                    }
                                    msg.payload.options.last_name = msg.payload.content.last_name;
                                }
                                telegramBot
                                    .sendContact(chatId, msg.payload.content.phone_number, msg.payload.content.first_name, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;
                        // --------------------------------------------------------------------

                        case 'editMessageLiveLocation':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                node.addChatIdToOptions(chatId, msg.payload.options);
                                telegramBot
                                    .editMessageLiveLocation(msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'stopMessageLiveLocation':
                            // This message requires the options to be set!
                            //if (this.hasContent(msg, chatId, nodeDone)) {
                            node.addChatIdToOptions(chatId, msg.payload.options);
                            telegramBot
                                .stopMessageLiveLocation(msg.payload.options)
                                .catch(function (ex) {
                                    node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(chatId, result, msg, nodeSend, nodeDone);
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
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'inline_query':
                        case 'answerInlineQuery':
                            //if (this.hasContent(msg, chatId, nodeDone)) {
                            // this type requires results to be set: see https://core.telegram.org/bots/api#inlinequeryresult
                            telegramBot
                                .answerInlineQuery(msg.payload.inlineQueryId, msg.payload.results, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        case 'answerWebAppQuery':
                            //if (this.hasContent(msg, chatId, nodeDone)) {
                            // this type requires results to be set: see https://core.telegram.org/bots/api#inlinequeryresult
                            telegramBot
                                .answerWebAppQuery(msg.payload.webAppQueryId, msg.payload.results, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        case 'sendChatAction':
                        case 'action':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot
                                    .sendChatAction(chatId, msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
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
                        case 'getChatMenuButton':
                        case 'closeGeneralForumTopic':
                        case 'reopenGeneralForumTopic':
                        case 'hideGeneralForumTopic':
                        case 'unhideGeneralForumTopic':
                        case 'deleteChatStickerSet':
                            telegramBot[type](chatId, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                });
                            break;

                        // 2 arguments: content, options
                        case 'editMessageCaption':
                        case 'editMessageText':
                        case 'editMessageReplyMarkup':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                node.addChatIdToOptions(chatId, msg.payload.options);
                                telegramBot[type](msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // TODO: https://github.com/windkh/node-red-contrib-telegrambot/issues/178
                        // https://github.com/yagop/node-telegram-bot-api/issues/876
                        case 'editMessageMedia':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                node.editMessageMedia(msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // 2 arguments: chatId, content
                        case 'setChatTitle':
                        case 'setChatPhoto':
                        case 'setChatDescription':
                        case 'setChatMenuButton':
                        case 'setChatStickerSet':
                        case 'unpinChatMessage':
                        case 'deleteMessage':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot[type](chatId, msg.payload.content)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // restrictChatMember became 4-arg in v1.0.0: chatId, userId,
                        // permissions, form. Two V17 shapes need to keep working:
                        //
                        //   (a) Nested form: msg.payload.options = { permissions: { ... } }
                        //   (b) Flat form  : msg.payload.options = { can_send_messages: ..., ... }
                        //
                        // (b) is what the supergroupadmin.json example flow ships, and
                        // is the documented V17 ergonomics — "options IS the permissions
                        // object". Detect either: if `options.permissions` exists, use
                        // that; else lift any known ChatPermissions fields from the
                        // top-level options into a fresh permissions object. Anything
                        // not recognised as a permission field stays on the form arg
                        // (e.g. `use_independent_chat_permissions`, `until_date`).
                        case 'restrictChatMember':
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                const rcmOpts = Object.assign({}, msg.payload.options || {});
                                let rcmPermissions;
                                if (rcmOpts.permissions && typeof rcmOpts.permissions === 'object') {
                                    rcmPermissions = rcmOpts.permissions;
                                    delete rcmOpts.permissions;
                                } else {
                                    rcmPermissions = {};
                                    const permissionFields = [
                                        'can_send_messages',
                                        'can_send_media_messages',
                                        'can_send_audios',
                                        'can_send_documents',
                                        'can_send_photos',
                                        'can_send_videos',
                                        'can_send_video_notes',
                                        'can_send_voice_notes',
                                        'can_send_polls',
                                        'can_send_other_messages',
                                        'can_add_web_page_previews',
                                        'can_change_info',
                                        'can_invite_users',
                                        'can_pin_messages',
                                        'can_manage_topics',
                                    ];
                                    permissionFields.forEach(function (field) {
                                        if (Object.prototype.hasOwnProperty.call(rcmOpts, field)) {
                                            rcmPermissions[field] = rcmOpts[field];
                                            delete rcmOpts[field];
                                        }
                                    });
                                }
                                telegramBot
                                    .restrictChatMember(chatId, msg.payload.content, rcmPermissions, rcmOpts)
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // 3 arguments: chatId, content, options
                        case 'pinChatMessage':
                        case 'unbanChatMember':
                        case 'banChatMember':
                        case 'promoteChatMember':
                        case 'getChatMember':
                        case 'approveChatJoinRequest':
                        case 'declineChatJoinRequest':
                        case 'setChatAdministratorCustomTitle':
                        case 'stopPoll':
                        case 'setMessageReaction':
                            // The userId must be passed in msg.payload.content: note that this is is a number not the username.
                            // Right now there is no way for resolving the user_id by username in the official API.
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot[type](chatId, msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
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
                            if (this.hasContent(msg, chatId, nodeDone)) {
                                telegramBot[type](chatId, msg.payload.content, msg.payload.options || {})
                                    .catch(function (ex) {
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        // --------------------------------------------------------------------

                        // See https://core.telegram.org/bots/payments
                        // See https://core.telegram.org/bots/api#sendinvoice
                        case 'sendInvoice':
                            // sendInvoice reads many fields off msg.payload.content (title, description,
                            // payload, providerToken, currency, prices); without the guard a missing
                            // payload.content crashes at the JS level instead of producing a clear warn.
                            if (this.hasContent(msg, chatId, nodeDone)) {
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
                                        node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                    })
                                    .then(function (result) {
                                        node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                    });
                            }
                            break;

                        case 'shipping_query':
                        case 'answerShippingQuery':
                            //if (this.hasContent(msg, chatId, nodeDone)) {
                            // this type requires ok to be set: see https://core.telegram.org/bots/api#answershippingquery
                            telegramBot
                                .answerShippingQuery(msg.payload.shippingQueryId, msg.payload.ok, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        case 'pre_checkout_query':
                        case 'answerPreCheckoutQuery':
                            //if (this.hasContent(msg, chatId, nodeDone)) {
                            // this type requires ok to be set: see https://core.telegram.org/bots/api#answerprecheckoutquery
                            telegramBot
                                .answerPreCheckoutQuery(msg.payload.preCheckoutQueryId, msg.payload.ok, msg.payload.options || {})
                                .catch(function (ex) {
                                    node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                })
                                .then(function (result) {
                                    node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                });
                            //}
                            break;

                        // TODO:
                        // setChatPermissions
                        // editChatInviteLink, revokeChatInviteLink
                        // getUserProfilePhotos,
                        // getMyCommands
                        // sendGame, setGameScore, getGameHighScores
                        // uploadStickerFile, createNewStickerSet, addStickerToSet, setStickerPositionInSet, deleteStickerFromSet

                        default:
                            // unknown type we try the unthinkable.
                            if (type in telegramBot) {
                                if (this.hasContent(msg, chatId, nodeDone)) {
                                    telegramBot[type](chatId, msg.payload.content, msg.payload.options || {})
                                        .catch(function (ex) {
                                            node.processError(chatId, ex, msg, nodeSend, nodeDone);
                                        })
                                        .then(function (result) {
                                            node.processResult(chatId, result, msg, nodeSend, nodeDone);
                                        });
                                }
                            } else {
                                // type is not supported.
                                node.warn('msg.payload.type is not supported');
                                // Drop-and-advance: no dispatch on this path, so the
                                // queue head would otherwise stay `processing: true`
                                // forever (#450 audit).
                                node.queueManager.processNext(chatId);
                            }
                    }
                } else {
                    node.warn('msg.payload.type is empty');
                    // Drop-and-advance: same wedge shape as the other no-dispatch
                    // branches — without this, a single payload with no `type`
                    // wedges its chatId's queue (#450 audit).
                    node.queueManager.processNext(chatId);
                }
            } // forward
        };

        // Derived from original code but with optional fileName and a hard timeout.
        // Without the timeout, a stalled CDN connection (no 'info' event and no 'error'
        // event) would keep the promise pending forever, leaking the captured nodeDone
        // and stalling Node-RED's in-flight tracking.
        this.downloadFile = function (fileId, downloadDir, fileName) {
            const downloadTimeoutMs = 60 * 1000;
            let resolve;
            let reject;
            const promise = new Promise((a, b) => {
                resolve = a;
                reject = b;
            });

            let form = {};
            let telegramBot = this.config.getTelegramBot();
            const fileStream = telegramBot.getFileStream(fileId, form);
            let settled = false;
            const settleResolve = function (value) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutTimer);
                    resolve(value);
                }
            };
            const settleReject = function (err) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutTimer);
                    fileStream.destroy();
                    reject(err);
                }
            };
            const timeoutTimer = setTimeout(function () {
                settleReject(new Error('Download timed out after ' + downloadTimeoutMs + 'ms (fileId ' + fileId + ')'));
            }, downloadTimeoutMs);
            fileStream.on('info', (info) => {
                if (fileName === undefined) {
                    fileName = info.uri.slice(info.uri.lastIndexOf('/') + 1);
                }

                const filePath = path.join(downloadDir, fileName);
                pipeline(fileStream, fs.createWriteStream(filePath), (error) => {
                    if (!error) {
                        settleResolve(filePath);
                    } else {
                        settleReject(error);
                    }
                });
            });
            fileStream.on('error', (err) => {
                settleReject(err);
            });
            return promise;
        };

        // Delegates to v1.0.0's public `bot.editMessageMedia(media, form)`. The
        // V17 wrapper used to reach into `_request` / `_formatSendData` (private
        // helpers on v0.66) because the public v0.66 method didn't expose the
        // file-options hook. v1.0.0 exposes everything via the InputMedia object
        // (including `fileOptions`), so the wrapper is now a thin pass-through —
        // EXCEPT for one important detail: v1.0.0 only uploads `media.media` as
        // multipart when it matches `attach://<local-path>`. A bare file path
        // (`c:\temp\sample2.png`) is treated as a URL and sent to Telegram as-is,
        // which Telegram then rejects ("invalid file HTTP URL specified: Wrong
        // port number specified in the URL", because `c:` looks like scheme +
        // port). V17 flows pass bare paths; wrap them so the file actually gets
        // uploaded.
        this.editMessageMedia = function (media, form = {}) {
            const payload = Object.assign({}, media);

            if (
                typeof payload.media === 'string' &&
                !/^attach:\/\//.test(payload.media) &&
                !/^https?:\/\//.test(payload.media) &&
                fs.existsSync(payload.media)
            ) {
                payload.media = 'attach://' + payload.media;
            }

            let telegramBot = this.config.getTelegramBot();
            let result;
            try {
                result = telegramBot.editMessageMedia(payload, form);
            } catch (ex) {
                result = Promise.reject(ex);
            }
            return result;
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
                        this.enqueueMessage(msg.payload.chatId, msg, nodeSend, nodeDone);
                    } else {
                        let chatIds = msg.payload.chatId;
                        let length = chatIds.length;
                        for (let i = 0; i < length; i++) {
                            let chatId = chatIds[i];

                            let clonedMsg = RED.util.cloneMessage(msg);
                            clonedMsg.payload.chatId = chatId;
                            this.enqueueMessage(chatId, clonedMsg, nodeSend, nodeDone);
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

            // Reset the dedup set so a redeploy gets a fresh warn cycle.
            node.deprecationWarnsSeen.clear();

            node.status({});
            done();
        });
    }

    return TelegramOutNode;
};

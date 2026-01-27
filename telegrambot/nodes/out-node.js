// safely handles circular references
JSON.safeStringify = (obj, indent = 2) => {
    let cache = [];
    const retVal = JSON.stringify(
        obj,
        (key, value) =>
            typeof value === 'object' && value !== null
                ? cache.includes(value)
                    ? undefined // Duplicate reference found, discard key
                        : cache.push(value) && value // Store value in our collection
                    : value,
        indent
    );
    cache = null;
    return retVal;
};

module.exports = function (RED) {
    const path = require('path');
    const { pipeline } = require('stream');
    const fs = require('fs');

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

        let haserroroutput = config.haserroroutput || false;

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

        // adds the caption of the message into the options.
        this.addCaptionToMessageOptions = function (msg) {
            let options = msg.payload.options;
            if (options === undefined) {
                options = {};
            }

            if (msg.payload.caption !== undefined) {
                options.caption = msg.payload.caption;
            }

            msg.payload.options = options;

            return msg;
        };

        this.processError = function (exception, msg, nodeSend, nodeDone) {
            let errorMessage = 'Caught exception in sender node:\r\n' + exception + '\r\nwhen processing message: \r\n' + JSON.safeStringify(msg);

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
                    node.addCaptionToMessageOptions(msg);

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
                        case 'getChatMenuButton':
                        case 'closeGeneralForumTopic':
                        case 'reopenGeneralForumTopic':
                        case 'hideGeneralForumTopic':
                        case 'unhideGeneralForumTopic':
                        case 'deleteChatStickerSet':
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
                        case 'setChatMenuButton':
                        case 'setChatStickerSet':
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
                        // sendGame, setGameScore, getGameHighScores
                        // uploadStickerFile, createNewStickerSet, addStickerToSet, setStickerPositionInSet, deleteStickerFromSet

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

    return TelegramOutNode;
};

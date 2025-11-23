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

// converts the function by message type.
function convertMessage(type, chatId, botMsg){

    let messageDetails;
    switch (type) {
        // Messages are handled using the receiver node.
        // https://core.telegram.org/bots/api#message
        case 'message':
            messageDetails = getMessageDetails(botMsg);
            break;

        // https://core.telegram.org/bots/api#callbackquery
        case 'callback_query':
            let messageId;
                if (botMsg.message !== undefined) {
                    messageId = botMsg.message.message_id;
                }

            messageDetails = {
                chatId: chatId,
                messageId: messageId,
                inlineMessageId: botMsg.inline_message_id,
                type: type,
                content: botMsg.data,
                callbackQueryId: botMsg.id,
                from: botMsg.from,
            };
            break;

        // https://core.telegram.org/bots/api#inlinequery
        // /setinline must be set before in botfather see https://core.telegram.org/bots/inline
        case 'inline_query':
            messageDetails = {
                chatId: chatid,
                type: type,
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

        // https://core.telegram.org/bots/api#message
        case 'edited_message':
            messageDetails = {
                chatId: chatId,
                messageId: botMsg.message_id,
                type: type,
                content: botMsg.text,
                editDate: botMsg.edit_date,
                date: botMsg.date,
                from: botMsg.from,
                chat: botMsg.chat,
                location: botMsg.location, // for live location updates
            };
            break;

        // the text of an already sent message.
        // not official
        case 'edited_message_text':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                content: botMsg.text,
                editDate: botMsg.edit_date,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // the caption of a document or an image ...
        // not official
        case 'edited_message_caption':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                content: botMsg.caption,
                editDate: botMsg.edit_date,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#message
        case 'channel_post':
            messageDetails = {
                chatId: chatId,
                messageId: botMsg.message_id,
                type: type,
                content: botMsg.text,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#message
        case 'edited_channel_post':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                content: botMsg.text,
                editDate: botMsg.edit_date,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // not official
        case 'edited_channel_post_text':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                content: botMsg.text,
                editDate: botMsg.edit_date,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // not official
        case 'edited_channel_post_caption':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                content: botMsg.caption,
                editDate: botMsg.edit_date,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#businessconnection
        case 'business_connection':
            messageDetails = {
                chatId: chatId,
                type: type,
                id: botMsg.id,
                user: botMsg.user,
                userChatId: botMsg.user_chat_id,
                date: botMsg.date,
                rights: botMsg.rights,
                isEnabled: botMsg.is_enabled,
            };
            break;

        // https://core.telegram.org/bots/api#message
        case 'business_message':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                content: botMsg.text, // TODO: this needs to be checked
                date: botMsg.date,
                chat: botMsg.chat,
                from: botMsg.from,
            };
            break;

        // https://core.telegram.org/bots/api#message
        case 'edited_business_message':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                content: botMsg.text, // TODO: this needs to be checked
                date: botMsg.date,
                chat: botMsg.chat,
                from: botMsg.from,
            };
            break;

        // https://core.telegram.org/bots/api#businessmessagesdeleted
        case 'deleted_business_messages':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageIds: botMsg.message_ids,
                businessConnectionId: botMsg.business_connection_id,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#messagereactionupdated
        case 'message_reaction':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                user: botMsg.user,
                actorChat: botMsg.actor_chat,
                date: botMsg.date,
                oldReaction: botMsg.old_reaction,
                newReaction: botMsg.new_reaction,
            };
            break;

        // https://core.telegram.org/bots/api#messagereactioncountupdated
        case 'message_reaction_count':
            messageDetails = {
                chatId: chatId,
                type: type,
                messageId: botMsg.message_id,
                date: botMsg.date,
                chat: botMsg.chat,
                reactions: botMsg.reactions,
            };
            break;

        // https://core.telegram.org/bots/api#precheckoutquery
        case 'pre_checkout_query':
            messageDetails = {
                preCheckoutQueryId: botMsg.id,
                chatId: chatId,
                type: type,
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

        // https://core.telegram.org/bots/api#shippingquery
        case 'shipping_query':
            messageDetails = {
                shippingQueryId: botMsg.id,
                chatId: chatId,
                type: type,
                from: botMsg.from,
                invoice_payload: botMsg.invoice_payload,
                content: botMsg.invoice_payload,
                shipping_address: botMsg.shipping_address,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#choseninlineresult
        case 'chosen_inline_result':
            messageDetails = {
                result_id: botMsg.result_id,
                chatId: chatId,
                type: type,
                from: botMsg.from,
                location: botMsg.location,
                inline_message_id: botMsg.inline_message_id,
                query: botMsg.query,
                content: botMsg.result_id,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#paidmediapurchased
        case 'purchased_paid_media':
            messageDetails = {
                chatId: chatId,
                type: type,
                from: botMsg.from,
                paidMediaPayload: botMsg.paid_media_payload,
            };
            break;

        // https://core.telegram.org/bots/api#pollanswer
        case 'poll_answer':
            messageDetails = {
                poll_id: botMsg.poll_id,
                chatId: chatId,
                type: type,
                user: botMsg.user,
                option_ids: botMsg.option_ids,
                content: botMsg.user,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#poll
        case 'poll':
            messageDetails = {
                type: type,
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

        // https://core.telegram.org/bots/api#chatmemberupdated
        case 'my_chat_member':
            messageDetails = {
                from: botMsg.from,
                old_chat_member: botMsg.old_chat_member,
                new_chat_member: botMsg.new_chat_member,
                invite_link: botMsg.invite_link,
                chatId: chatId,
                type: type,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        case 'chat_member':
            messageDetails = {
                from: botMsg.from,
                old_chat_member: botMsg.old_chat_member,
                new_chat_member: botMsg.new_chat_member,
                invite_link: botMsg.invite_link,
                chatId: chatId,
                type: type,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#chatjoinrequest
        case 'chat_join_request':
            messageDetails = {
                from: botMsg.from,
                bio: botMsg.bio,
                invite_link: botMsg.invite_link,
                chatId: chatId,
                type: type,
                date: botMsg.date,
                chat: botMsg.chat,
            };
            break;

        // https://core.telegram.org/bots/api#chatboostupdated
        case 'chat_boost':
            messageDetails = {
                chatId: chatId,
                type: type,
                chat: botMsg.chat,
                boost: botMsg.boost,
            };
            break;

        // https://core.telegram.org/bots/api#chatboostremoved
        case 'removed_chat_boost':
            messageDetails = {
                chatId: chatId,
                type: type,
                chat: botMsg.chat,
                boostId: botMsg.boost_id,
                removeDate: botMsg.remove_date,
                source: botMsg.source,
            };
            break;
        default:
    }

    return messageDetails;
}

module.exports = {
    convertMessage,
    getMessageDetails
};
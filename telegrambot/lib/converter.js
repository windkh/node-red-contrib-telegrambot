

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


module.exports = {
    getMessageDetails
};
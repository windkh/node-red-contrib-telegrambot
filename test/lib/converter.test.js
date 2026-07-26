const { describe, it } = require('node:test');
const assert = require('node:assert');
const converter = require('../../telegrambot/lib/converter');
const fx = require('../fixtures/telegram-payloads');

// Assert that `actual` contains every key/value in `expected` (deep) — mirrors
// the chai `.to.deep.include(...)` subset semantics the tests were written for.
function assertIncludes(actual, expected) {
    for (const key of Object.keys(expected)) {
        assert.deepStrictEqual(actual[key], expected[key], 'key: ' + key);
    }
}

// =============================================================================
// getUserInfo
// =============================================================================

describe('lib/converter — getUserInfo', function () {
    it('extracts username, userid and chatid from a normal private chat', function () {
        const info = converter.getUserInfo(fx.textMessage('hi'));
        assert.deepStrictEqual(info, {
            chatid: 123,
            username: 'alice',
            userid: 4242,
            isAnonymous: false,
        });
    });

    it('returns the chat-level username when chat is present', function () {
        // For incoming messages, getUserInfo prefers chat.username for `username`
        // (see converter.js — the `if (botMsg.chat)` branch fires first).
        const msg = fx.baseMessage({ text: 'hi', chat: fx.chat({ username: 'alice-chat-name' }) });
        const info = converter.getUserInfo(msg);
        assert.strictEqual(info.username, 'alice-chat-name');
        assert.strictEqual(info.chatid, 123);
        assert.strictEqual(info.userid, 4242);
        assert.strictEqual(info.isAnonymous, false);
    });

    it('falls back to from-only when chat is absent (event-style update)', function () {
        const update = { from: fx.from(), message: { chat: fx.chat({ id: 999 }) } };
        const info = converter.getUserInfo(update);
        assert.strictEqual(info.username, 'alice');
        assert.strictEqual(info.userid, 4242);
        assert.strictEqual(info.chatid, 999);
    });

    it('marks isAnonymous=true when neither chat nor from is present (poll-style)', function () {
        const info = converter.getUserInfo({});
        assert.strictEqual(info.isAnonymous, true);
        assert.strictEqual(info.username, undefined);
        assert.strictEqual(info.userid, undefined);
    });

    it('marks isAnonymous=true for channel posts (chat present, no from.username)', function () {
        const info = converter.getUserInfo(fx.channelPost());
        // Channel posts have no `from` and chat.username is undefined for a channel.
        assert.strictEqual(info.isAnonymous, true);
        assert.strictEqual(info.chatid, -1001234567890);
    });
});

// =============================================================================
// getMessageDetails — one case per content type
// =============================================================================

describe('lib/converter — getMessageDetails', function () {
    function build(overrides) {
        return fx.baseMessage(overrides);
    }

    it('text message', function () {
        const r = converter.getMessageDetails(build({ text: 'hello' }));
        assertIncludes(r, { chatId: 123, messageId: 7, type: 'message', content: 'hello', date: 1715520000 });
    });

    it('photo — picks the highest-resolution file_id', function () {
        const r = converter.getMessageDetails(build({ photo: fx.photoArray() }));
        assert.strictEqual(r.type, 'photo');
        assert.strictEqual(r.content, 'hi');
        assert.strictEqual(r.blob, true);
        assert.strictEqual((r.photos).length, 2);
    });

    it('photo — passes through caption and media_group_id', function () {
        const r = converter.getMessageDetails(build({ photo: fx.photoArray(), caption: 'cap', media_group_id: 'mg-1' }));
        assert.strictEqual(r.caption, 'cap');
        assert.strictEqual(r.mediaGroupId, 'mg-1');
    });

    it('photo — empty array drops the message rather than crashing', function () {
        // Regression: getPhotoIndexWithHighestResolution used to return 0
        // unconditionally, then botMsg.photo[0].file_id threw TypeError.
        const r = converter.getMessageDetails(build({ photo: [] }));
        assert.strictEqual(r, undefined);
    });

    it('photo — array with missing width/height falls back to index 0', function () {
        // No entry has usable dimensions; behaviour: pick the first item.
        const arr = [{ file_id: 'no-dim' }];
        const r = converter.getMessageDetails(build({ photo: arr }));
        assert.strictEqual(r.type, 'photo');
        assert.strictEqual(r.content, 'no-dim');
    });

    it('audio', function () {
        const r = converter.getMessageDetails(build({ audio: { file_id: 'a-1' }, caption: 'song' }));
        assert.strictEqual(r.type, 'audio');
        assert.strictEqual(r.content, 'a-1');
        assert.strictEqual(r.caption, 'song');
        assert.strictEqual(r.blob, true);
    });

    it('sticker', function () {
        const r = converter.getMessageDetails(build({ sticker: { file_id: 's-1' } }));
        assert.strictEqual(r.type, 'sticker');
        assert.strictEqual(r.content, 's-1');
        assert.strictEqual(r.blob, true);
    });

    it('dice', function () {
        const dice = { emoji: '🎲', value: 5 };
        const r = converter.getMessageDetails(build({ dice: dice }));
        assert.strictEqual(r.type, 'dice');
        assert.deepStrictEqual(r.content, dice);
        assert.strictEqual(r.blob, false);
    });

    it('animation', function () {
        const r = converter.getMessageDetails(build({ animation: { file_id: 'g-1' }, caption: 'gif', media_group_id: 'mg-1' }));
        assert.strictEqual(r.type, 'animation');
        assert.strictEqual(r.content, 'g-1');
        assert.strictEqual(r.caption, 'gif');
        assert.strictEqual(r.mediaGroupId, 'mg-1');
        assert.strictEqual(r.blob, true);
    });

    it('video', function () {
        const r = converter.getMessageDetails(build({ video: { file_id: 'v-1' }, caption: 'vid' }));
        assert.strictEqual(r.type, 'video');
        assert.strictEqual(r.content, 'v-1');
        assert.strictEqual(r.blob, true);
    });

    it('video_note', function () {
        const r = converter.getMessageDetails(build({ video_note: { file_id: 'vn-1' } }));
        assert.strictEqual(r.type, 'video_note');
        assert.strictEqual(r.content, 'vn-1');
        assert.strictEqual(r.blob, true);
    });

    it('voice', function () {
        const r = converter.getMessageDetails(build({ voice: { file_id: 'vo-1' }, caption: 'oh' }));
        assert.strictEqual(r.type, 'voice');
        assert.strictEqual(r.content, 'vo-1');
        assert.strictEqual(r.caption, 'oh');
        assert.strictEqual(r.blob, true);
    });

    it('location', function () {
        const loc = { latitude: 48.137, longitude: 11.575 };
        const r = converter.getMessageDetails(build({ location: loc }));
        assert.strictEqual(r.type, 'location');
        assert.deepStrictEqual(r.content, loc);
    });

    it('venue', function () {
        const venue = { location: { latitude: 1, longitude: 2 }, title: 'X', address: 'Y' };
        const r = converter.getMessageDetails(build({ venue: venue }));
        assert.strictEqual(r.type, 'venue');
        assert.deepStrictEqual(r.content, venue);
    });

    it('contact', function () {
        const contact = { phone_number: '+49 123', first_name: 'Carol' };
        const r = converter.getMessageDetails(build({ contact: contact }));
        assert.strictEqual(r.type, 'contact');
        assert.deepStrictEqual(r.content, contact);
    });

    it('document', function () {
        const r = converter.getMessageDetails(build({ document: { file_id: 'd-1' }, caption: 'pdf' }));
        assert.strictEqual(r.type, 'document');
        assert.strictEqual(r.content, 'd-1');
        assert.strictEqual(r.caption, 'pdf');
        assert.strictEqual(r.blob, true);
    });

    it('poll', function () {
        const poll = { id: 'p-1', question: 'Q?', options: [], total_voter_count: 0 };
        const r = converter.getMessageDetails(build({ poll: poll }));
        assert.strictEqual(r.type, 'poll');
        assert.deepStrictEqual(r.content, poll);
        assert.strictEqual(r.blob, false);
    });

    it('invoice', function () {
        const inv = { title: 'T', description: 'D', start_parameter: 'sp', currency: 'EUR', total_amount: 100 };
        const r = converter.getMessageDetails(build({ invoice: inv }));
        assert.strictEqual(r.type, 'invoice');
        assert.deepStrictEqual(r.content, inv);
    });

    it('successful_payment', function () {
        const pay = { currency: 'EUR', total_amount: 100, invoice_payload: 'p' };
        const r = converter.getMessageDetails(build({ successful_payment: pay }));
        assert.strictEqual(r.type, 'successful_payment');
        assert.deepStrictEqual(r.content, pay);
    });

    // ---- subtypes added in V17.3.0 -----------------------------------------

    it('refunded_payment (V17.3.0)', function () {
        const pay = { currency: 'EUR', total_amount: 100, telegram_payment_charge_id: 'tg-x', provider_payment_charge_id: 'p-x' };
        const r = converter.getMessageDetails(build({ refunded_payment: pay }));
        assert.strictEqual(r.type, 'refunded_payment');
        assert.deepStrictEqual(r.content, pay);
    });

    it('paid_media (V17.3.0) — passes caption through', function () {
        const pm = { star_count: 50, paid_media: [{ type: 'photo' }] };
        const r = converter.getMessageDetails(build({ paid_media: pm, caption: 'paid' }));
        assert.strictEqual(r.type, 'paid_media');
        assert.deepStrictEqual(r.content, pm);
        assert.strictEqual(r.caption, 'paid');
    });

    it('gift (V17.3.0)', function () {
        const gift = { id: 'g-x', sticker: { file_id: 'st' } };
        const r = converter.getMessageDetails(build({ gift: gift }));
        assert.strictEqual(r.type, 'gift');
        assert.deepStrictEqual(r.content, gift);
    });

    // ---- service messages --------------------------------------------------

    it('new_chat_title', function () {
        const r = converter.getMessageDetails(build({ new_chat_title: 'renamed' }));
        assert.strictEqual(r.type, 'new_chat_title');
        assert.strictEqual(r.content, 'renamed');
    });

    it('new_chat_photo — picks the highest-resolution variant', function () {
        const r = converter.getMessageDetails(build({ new_chat_photo: fx.photoArray() }));
        assert.strictEqual(r.type, 'new_chat_photo');
        assert.strictEqual(r.content, 'hi');
        assert.strictEqual(r.blob, true);
    });

    it('new_chat_photo — empty array drops the message', function () {
        const r = converter.getMessageDetails(build({ new_chat_photo: [] }));
        assert.strictEqual(r, undefined);
    });

    it('new_chat_members — user field is populated from the array (V17.3.0 regression test)', function () {
        // Before V17.3.0 this branch referenced the (long-removed) singular
        // botMsg.new_chat_member, so `user` was always undefined.
        const members = [
            { id: 1, first_name: 'X', is_bot: false },
            { id: 2, first_name: 'Y', is_bot: false },
        ];
        const r = converter.getMessageDetails(build({ new_chat_members: members }));
        assert.strictEqual(r.type, 'new_chat_members');
        assert.deepStrictEqual(r.content, members);
        assert.deepStrictEqual(r.user, members[0]);
    });

    it('left_chat_member', function () {
        const member = { id: 1, first_name: 'X', is_bot: false };
        const r = converter.getMessageDetails(build({ left_chat_member: member }));
        assert.strictEqual(r.type, 'left_chat_member');
        assert.deepStrictEqual(r.content, member);
        assert.deepStrictEqual(r.user, member);
    });

    it('delete_chat_photo', function () {
        const r = converter.getMessageDetails(build({ delete_chat_photo: true }));
        assert.strictEqual(r.type, 'delete_chat_photo');
        assert.strictEqual(r.content, true);
    });

    it('channel_chat_created', function () {
        const r = converter.getMessageDetails(build({ channel_chat_created: true }));
        assert.strictEqual(r.type, 'channel_chat_created');
        assert.strictEqual(r.content, true);
    });

    it('group_chat_created', function () {
        const r = converter.getMessageDetails(build({ group_chat_created: true }));
        assert.strictEqual(r.type, 'group_chat_created');
        assert.strictEqual(r.content, true);
    });

    it('supergroup_chat_created', function () {
        const r = converter.getMessageDetails(build({ supergroup_chat_created: true }));
        assert.strictEqual(r.type, 'supergroup_chat_created');
        assert.strictEqual(r.content, true);
    });

    it('pinned_message', function () {
        const inner = fx.baseMessage({ text: 'pinned' });
        const r = converter.getMessageDetails(build({ pinned_message: inner }));
        assert.strictEqual(r.type, 'pinned_message');
        assert.deepStrictEqual(r.content, inner);
    });

    it('migrate_from_chat_id', function () {
        const r = converter.getMessageDetails(build({ migrate_from_chat_id: -1001 }));
        assert.strictEqual(r.type, 'migrate_from_chat_id');
        assert.strictEqual(r.content, -1001);
    });

    it('migrate_to_chat_id', function () {
        const r = converter.getMessageDetails(build({ migrate_to_chat_id: -1002 }));
        assert.strictEqual(r.type, 'migrate_to_chat_id');
        assert.strictEqual(r.content, -1002);
    });

    it('web_app_data', function () {
        const data = { data: '{"a":1}', button_text: 'go' };
        const r = converter.getMessageDetails(build({ web_app_data: data }));
        assert.strictEqual(r.type, 'web_app_data');
        assert.deepStrictEqual(r.content, data);
    });

    it('unknown payload returns undefined (drops to the default branch)', function () {
        const r = converter.getMessageDetails(build({ some_unknown_field: 'x' }));
        assert.strictEqual(r, undefined);
    });
});

// =============================================================================
// convertMessage — one case per event type
// =============================================================================

describe('lib/converter — convertMessage', function () {
    it('"message" delegates to getMessageDetails', function () {
        const msg = fx.textMessage('hi');
        const r = converter.convertMessage('message', 123, msg);
        assertIncludes(r, { chatId: 123, type: 'message', content: 'hi' });
    });

    it('callback_query — projects id, data, inline_message_id, from', function () {
        const cb = fx.callbackQuery({ data: 'choice-A', inline_message_id: 'inline-1' });
        const r = converter.convertMessage('callback_query', 123, cb);
        assert.strictEqual(r.type, 'callback_query');
        assert.strictEqual(r.content, 'choice-A');
        assert.strictEqual(r.callbackQueryId, 'cb-1');
        assert.strictEqual(r.inlineMessageId, 'inline-1');
        assert.strictEqual(r.messageId, cb.message.message_id);
        assert.deepStrictEqual(r.from, cb.from);
    });

    it('callback_query — handles missing inner message (inline-only)', function () {
        const cb = fx.callbackQuery();
        delete cb.message;
        const r = converter.convertMessage('callback_query', 123, cb);
        assert.strictEqual(r.messageId, undefined);
        assert.strictEqual(r.content, 'choice-A');
    });

    it('inline_query — projects id, query, offset, from, location', function () {
        const iq = fx.inlineQuery();
        const r = converter.convertMessage('inline_query', 123, iq);
        assert.strictEqual(r.type, 'inline_query');
        assert.strictEqual(r.content, 'search-term');
        assert.strictEqual(r.inlineQueryId, 'iq-1');
        assert.strictEqual(r.offset, '');
        assert.deepStrictEqual(r.from, iq.from);
    });

    it('edited_message — surfaces editDate alongside the text content', function () {
        const m = fx.baseMessage({ text: 'fixed', edit_date: 1715520500 });
        const r = converter.convertMessage('edited_message', 123, m);
        assert.strictEqual(r.type, 'edited_message');
        assert.strictEqual(r.content, 'fixed');
        assert.strictEqual(r.editDate, 1715520500);
    });

    it('edited_message_text', function () {
        const m = fx.baseMessage({ text: 't', edit_date: 1 });
        const r = converter.convertMessage('edited_message_text', 123, m);
        assert.strictEqual(r.type, 'edited_message_text');
        assert.strictEqual(r.editDate, 1);
        assert.strictEqual(r.content, 't');
    });

    it('edited_message_caption — content is the caption, not the text', function () {
        const m = fx.baseMessage({ caption: 'cap', edit_date: 2 });
        const r = converter.convertMessage('edited_message_caption', 123, m);
        assert.strictEqual(r.content, 'cap');
        assert.strictEqual(r.editDate, 2);
    });

    it('channel_post', function () {
        const m = fx.channelPost();
        const r = converter.convertMessage('channel_post', m.chat.id, m);
        assert.strictEqual(r.type, 'channel_post');
        assert.strictEqual(r.content, 'channel announcement');
        assert.deepStrictEqual(r.chat, m.chat);
    });

    it('edited_channel_post', function () {
        const m = Object.assign(fx.channelPost(), { edit_date: 99 });
        const r = converter.convertMessage('edited_channel_post', m.chat.id, m);
        assert.strictEqual(r.type, 'edited_channel_post');
        assert.strictEqual(r.editDate, 99);
    });

    it('edited_channel_post_text', function () {
        const m = Object.assign(fx.channelPost(), { edit_date: 99 });
        const r = converter.convertMessage('edited_channel_post_text', m.chat.id, m);
        assert.strictEqual(r.content, 'channel announcement');
        assert.strictEqual(r.editDate, 99);
    });

    it('edited_channel_post_caption — content is caption', function () {
        const m = Object.assign(fx.channelPost(), { caption: 'caption-only', edit_date: 99 });
        delete m.text;
        const r = converter.convertMessage('edited_channel_post_caption', m.chat.id, m);
        assert.strictEqual(r.content, 'caption-only');
    });

    it('business_connection', function () {
        const bc = { id: 'bc-1', user: fx.from(), user_chat_id: 123, date: 1, rights: { a: true }, is_enabled: true };
        const r = converter.convertMessage('business_connection', 0, bc);
        assert.strictEqual(r.type, 'business_connection');
        assert.strictEqual(r.id, 'bc-1');
        assert.deepStrictEqual(r.user, bc.user);
        assert.strictEqual(r.userChatId, 123);
        assert.strictEqual(r.isEnabled, true);
    });

    it('business_message', function () {
        const m = fx.baseMessage({ text: 'biz' });
        const r = converter.convertMessage('business_message', 123, m);
        assert.strictEqual(r.type, 'business_message');
        assert.strictEqual(r.content, 'biz');
    });

    it('edited_business_message', function () {
        const m = fx.baseMessage({ text: 'biz-edit' });
        const r = converter.convertMessage('edited_business_message', 123, m);
        assert.strictEqual(r.type, 'edited_business_message');
        assert.strictEqual(r.content, 'biz-edit');
    });

    it('deleted_business_messages — array of ids', function () {
        const m = { message_ids: [1, 2, 3], business_connection_id: 'bc-1', chat: fx.chat() };
        const r = converter.convertMessage('deleted_business_messages', 123, m);
        assert.strictEqual(r.type, 'deleted_business_messages');
        assert.deepStrictEqual(r.messageIds, [1, 2, 3]);
        assert.strictEqual(r.businessConnectionId, 'bc-1');
    });

    it('message_reaction — old/new reactions', function () {
        const m = {
            message_id: 1,
            user: fx.from(),
            actor_chat: null,
            date: 1,
            old_reaction: [],
            new_reaction: [{ type: 'emoji', emoji: '👍' }],
        };
        const r = converter.convertMessage('message_reaction', 123, m);
        assert.strictEqual(r.type, 'message_reaction');
        assert.strictEqual((r.newReaction).length, 1);
    });

    it('message_reaction_count', function () {
        const m = { message_id: 1, date: 1, chat: fx.chat(), reactions: [{ type: { type: 'emoji', emoji: '👍' }, total_count: 5 }] };
        const r = converter.convertMessage('message_reaction_count', 123, m);
        assert.strictEqual(r.type, 'message_reaction_count');
        assert.strictEqual((r.reactions).length, 1);
    });

    it('pre_checkout_query', function () {
        const q = {
            id: 'pcq-1',
            from: fx.from(),
            currency: 'EUR',
            total_amount: 100,
            invoice_payload: 'p',
            shipping_option_id: 's-1',
            order_info: { name: 'Alice' },
        };
        const r = converter.convertMessage('pre_checkout_query', 123, q);
        assert.strictEqual(r.type, 'pre_checkout_query');
        assert.strictEqual(r.preCheckoutQueryId, 'pcq-1');
        assert.strictEqual(r.content, 'p');
        assert.strictEqual(r.currency, 'EUR');
    });

    it('shipping_query', function () {
        const q = { id: 'sq-1', from: fx.from(), invoice_payload: 'p', shipping_address: { country_code: 'DE' } };
        const r = converter.convertMessage('shipping_query', 123, q);
        assert.strictEqual(r.type, 'shipping_query');
        assert.strictEqual(r.shippingQueryId, 'sq-1');
        assert.strictEqual(r.content, 'p');
    });

    it('chosen_inline_result', function () {
        const cir = { result_id: 'r-1', from: fx.from(), query: 'q', inline_message_id: 'im-1' };
        const r = converter.convertMessage('chosen_inline_result', 123, cir);
        assert.strictEqual(r.type, 'chosen_inline_result');
        assert.strictEqual(r.result_id, 'r-1');
        assert.strictEqual(r.content, 'r-1');
    });

    it('purchased_paid_media', function () {
        const p = { from: fx.from(), paid_media_payload: 'p-data' };
        const r = converter.convertMessage('purchased_paid_media', 123, p);
        assert.strictEqual(r.type, 'purchased_paid_media');
        assert.strictEqual(r.paidMediaPayload, 'p-data');
    });

    it('poll_answer', function () {
        const pa = { poll_id: 'p-1', user: fx.from(), option_ids: [0, 2], date: 1, chat: fx.chat() };
        const r = converter.convertMessage('poll_answer', 123, pa);
        assert.strictEqual(r.type, 'poll_answer');
        assert.strictEqual(r.poll_id, 'p-1');
        assert.deepStrictEqual(r.option_ids, [0, 2]);
        assert.deepStrictEqual(r.content, pa.user);
    });

    it('poll', function () {
        const p = { id: 'p-1', question: 'Q', options: [{ text: 'A', voter_count: 1 }], total_voter_count: 1, is_anonymous: true, type: 'regular' };
        const r = converter.convertMessage('poll', 123, p);
        assert.strictEqual(r.type, 'poll');
        assert.strictEqual(r.id, 'p-1');
        assert.strictEqual(r.question, 'Q');
        assert.strictEqual(r.content, 'Q');
        assert.strictEqual(r.pollType, 'regular');
    });

    it('my_chat_member', function () {
        const upd = { from: fx.from(), old_chat_member: {}, new_chat_member: {}, invite_link: null, date: 1, chat: fx.chat() };
        const r = converter.convertMessage('my_chat_member', 123, upd);
        assert.strictEqual(r.type, 'my_chat_member');
        assert.deepStrictEqual(r.from, upd.from);
    });

    it('chat_member', function () {
        const upd = { from: fx.from(), old_chat_member: {}, new_chat_member: {}, date: 1, chat: fx.chat() };
        const r = converter.convertMessage('chat_member', 123, upd);
        assert.strictEqual(r.type, 'chat_member');
    });

    it('chat_join_request', function () {
        const upd = { from: fx.from(), bio: 'hi', invite_link: { invite_link: 'x' }, date: 1, chat: fx.chat() };
        const r = converter.convertMessage('chat_join_request', 123, upd);
        assert.strictEqual(r.type, 'chat_join_request');
        assert.strictEqual(r.bio, 'hi');
    });

    it('chat_boost', function () {
        const upd = { chat: fx.chat(), boost: { source: { source: 'premium' } } };
        const r = converter.convertMessage('chat_boost', 123, upd);
        assert.strictEqual(r.type, 'chat_boost');
        assert.deepStrictEqual(r.boost, upd.boost);
    });

    it('removed_chat_boost', function () {
        const upd = { chat: fx.chat(), boost_id: 'b-1', remove_date: 100, source: { source: 'premium' } };
        const r = converter.convertMessage('removed_chat_boost', 123, upd);
        assert.strictEqual(r.type, 'removed_chat_boost');
        assert.strictEqual(r.boostId, 'b-1');
        assert.strictEqual(r.removeDate, 100);
    });

    it('unknown type returns undefined (falls into the default branch)', function () {
        const r = converter.convertMessage('completely_made_up_event', 123, {});
        assert.strictEqual(r, undefined);
    });
});

// =============================================================================
// chatId propagation — verifies that convertMessage always tags chatId from
// the second arg rather than the underlying botMsg.
// =============================================================================

describe('lib/converter — chatId propagation', function () {
    it('uses the caller-supplied chatId, not botMsg.chat.id, for non-message types', function () {
        const upd = { chat: fx.chat({ id: 999 }), boost: {} };
        const r = converter.convertMessage('chat_boost', 12345, upd);
        assert.strictEqual(r.chatId, 12345); // caller-supplied wins
    });

    it('uses botMsg.chat.id for type "message" (delegates to getMessageDetails)', function () {
        const msg = fx.textMessage('hi');
        const r = converter.convertMessage('message', 999999, msg);
        // getMessageDetails reads botMsg.chat.id directly and ignores the
        // caller's chatId arg — current documented behaviour.
        assert.strictEqual(r.chatId, 123);
    });
});

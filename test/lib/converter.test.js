const { expect } = require('chai');
const converter = require('../../telegrambot/lib/converter');
const fx = require('../fixtures/telegram-payloads');

// =============================================================================
// getUserInfo
// =============================================================================

describe('lib/converter — getUserInfo', function () {
    it('extracts username, userid and chatid from a normal private chat', function () {
        const info = converter.getUserInfo(fx.textMessage('hi'));
        expect(info).to.deep.equal({
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
        expect(info.username).to.equal('alice-chat-name');
        expect(info.chatid).to.equal(123);
        expect(info.userid).to.equal(4242);
        expect(info.isAnonymous).to.equal(false);
    });

    it('falls back to from-only when chat is absent (event-style update)', function () {
        const update = { from: fx.from(), message: { chat: fx.chat({ id: 999 }) } };
        const info = converter.getUserInfo(update);
        expect(info.username).to.equal('alice');
        expect(info.userid).to.equal(4242);
        expect(info.chatid).to.equal(999);
    });

    it('marks isAnonymous=true when neither chat nor from is present (poll-style)', function () {
        const info = converter.getUserInfo({});
        expect(info.isAnonymous).to.equal(true);
        expect(info.username).to.be.undefined;
        expect(info.userid).to.be.undefined;
    });

    it('marks isAnonymous=true for channel posts (chat present, no from.username)', function () {
        const info = converter.getUserInfo(fx.channelPost());
        // Channel posts have no `from` and chat.username is undefined for a channel.
        expect(info.isAnonymous).to.equal(true);
        expect(info.chatid).to.equal(-1001234567890);
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
        expect(r).to.include({ chatId: 123, messageId: 7, type: 'message', content: 'hello', date: 1715520000 });
    });

    it('photo — picks the highest-resolution file_id', function () {
        const r = converter.getMessageDetails(build({ photo: fx.photoArray() }));
        expect(r.type).to.equal('photo');
        expect(r.content).to.equal('hi');
        expect(r.blob).to.equal(true);
        expect(r.photos).to.have.length(2);
    });

    it('photo — passes through caption and media_group_id', function () {
        const r = converter.getMessageDetails(build({ photo: fx.photoArray(), caption: 'cap', media_group_id: 'mg-1' }));
        expect(r.caption).to.equal('cap');
        expect(r.mediaGroupId).to.equal('mg-1');
    });

    it('photo — empty array drops the message rather than crashing', function () {
        // Regression: getPhotoIndexWithHighestResolution used to return 0
        // unconditionally, then botMsg.photo[0].file_id threw TypeError.
        const r = converter.getMessageDetails(build({ photo: [] }));
        expect(r).to.be.undefined;
    });

    it('photo — array with missing width/height falls back to index 0', function () {
        // No entry has usable dimensions; behaviour: pick the first item.
        const arr = [{ file_id: 'no-dim' }];
        const r = converter.getMessageDetails(build({ photo: arr }));
        expect(r.type).to.equal('photo');
        expect(r.content).to.equal('no-dim');
    });

    it('audio', function () {
        const r = converter.getMessageDetails(build({ audio: { file_id: 'a-1' }, caption: 'song' }));
        expect(r.type).to.equal('audio');
        expect(r.content).to.equal('a-1');
        expect(r.caption).to.equal('song');
        expect(r.blob).to.equal(true);
    });

    it('sticker', function () {
        const r = converter.getMessageDetails(build({ sticker: { file_id: 's-1' } }));
        expect(r.type).to.equal('sticker');
        expect(r.content).to.equal('s-1');
        expect(r.blob).to.equal(true);
    });

    it('dice', function () {
        const dice = { emoji: '🎲', value: 5 };
        const r = converter.getMessageDetails(build({ dice: dice }));
        expect(r.type).to.equal('dice');
        expect(r.content).to.deep.equal(dice);
        expect(r.blob).to.equal(false);
    });

    it('animation', function () {
        const r = converter.getMessageDetails(build({ animation: { file_id: 'g-1' }, caption: 'gif', media_group_id: 'mg-1' }));
        expect(r.type).to.equal('animation');
        expect(r.content).to.equal('g-1');
        expect(r.caption).to.equal('gif');
        expect(r.mediaGroupId).to.equal('mg-1');
        expect(r.blob).to.equal(true);
    });

    it('video', function () {
        const r = converter.getMessageDetails(build({ video: { file_id: 'v-1' }, caption: 'vid' }));
        expect(r.type).to.equal('video');
        expect(r.content).to.equal('v-1');
        expect(r.blob).to.equal(true);
    });

    it('video_note', function () {
        const r = converter.getMessageDetails(build({ video_note: { file_id: 'vn-1' } }));
        expect(r.type).to.equal('video_note');
        expect(r.content).to.equal('vn-1');
        expect(r.blob).to.equal(true);
    });

    it('voice', function () {
        const r = converter.getMessageDetails(build({ voice: { file_id: 'vo-1' }, caption: 'oh' }));
        expect(r.type).to.equal('voice');
        expect(r.content).to.equal('vo-1');
        expect(r.caption).to.equal('oh');
        expect(r.blob).to.equal(true);
    });

    it('location', function () {
        const loc = { latitude: 48.137, longitude: 11.575 };
        const r = converter.getMessageDetails(build({ location: loc }));
        expect(r.type).to.equal('location');
        expect(r.content).to.deep.equal(loc);
    });

    it('venue', function () {
        const venue = { location: { latitude: 1, longitude: 2 }, title: 'X', address: 'Y' };
        const r = converter.getMessageDetails(build({ venue: venue }));
        expect(r.type).to.equal('venue');
        expect(r.content).to.deep.equal(venue);
    });

    it('contact', function () {
        const contact = { phone_number: '+49 123', first_name: 'Carol' };
        const r = converter.getMessageDetails(build({ contact: contact }));
        expect(r.type).to.equal('contact');
        expect(r.content).to.deep.equal(contact);
    });

    it('document', function () {
        const r = converter.getMessageDetails(build({ document: { file_id: 'd-1' }, caption: 'pdf' }));
        expect(r.type).to.equal('document');
        expect(r.content).to.equal('d-1');
        expect(r.caption).to.equal('pdf');
        expect(r.blob).to.equal(true);
    });

    it('poll', function () {
        const poll = { id: 'p-1', question: 'Q?', options: [], total_voter_count: 0 };
        const r = converter.getMessageDetails(build({ poll: poll }));
        expect(r.type).to.equal('poll');
        expect(r.content).to.deep.equal(poll);
        expect(r.blob).to.equal(false);
    });

    it('invoice', function () {
        const inv = { title: 'T', description: 'D', start_parameter: 'sp', currency: 'EUR', total_amount: 100 };
        const r = converter.getMessageDetails(build({ invoice: inv }));
        expect(r.type).to.equal('invoice');
        expect(r.content).to.deep.equal(inv);
    });

    it('successful_payment', function () {
        const pay = { currency: 'EUR', total_amount: 100, invoice_payload: 'p' };
        const r = converter.getMessageDetails(build({ successful_payment: pay }));
        expect(r.type).to.equal('successful_payment');
        expect(r.content).to.deep.equal(pay);
    });

    // ---- subtypes added in V17.3.0 -----------------------------------------

    it('refunded_payment (V17.3.0)', function () {
        const pay = { currency: 'EUR', total_amount: 100, telegram_payment_charge_id: 'tg-x', provider_payment_charge_id: 'p-x' };
        const r = converter.getMessageDetails(build({ refunded_payment: pay }));
        expect(r.type).to.equal('refunded_payment');
        expect(r.content).to.deep.equal(pay);
    });

    it('paid_media (V17.3.0) — passes caption through', function () {
        const pm = { star_count: 50, paid_media: [{ type: 'photo' }] };
        const r = converter.getMessageDetails(build({ paid_media: pm, caption: 'paid' }));
        expect(r.type).to.equal('paid_media');
        expect(r.content).to.deep.equal(pm);
        expect(r.caption).to.equal('paid');
    });

    it('gift (V17.3.0)', function () {
        const gift = { id: 'g-x', sticker: { file_id: 'st' } };
        const r = converter.getMessageDetails(build({ gift: gift }));
        expect(r.type).to.equal('gift');
        expect(r.content).to.deep.equal(gift);
    });

    // ---- service messages --------------------------------------------------

    it('new_chat_title', function () {
        const r = converter.getMessageDetails(build({ new_chat_title: 'renamed' }));
        expect(r.type).to.equal('new_chat_title');
        expect(r.content).to.equal('renamed');
    });

    it('new_chat_photo — picks the highest-resolution variant', function () {
        const r = converter.getMessageDetails(build({ new_chat_photo: fx.photoArray() }));
        expect(r.type).to.equal('new_chat_photo');
        expect(r.content).to.equal('hi');
        expect(r.blob).to.equal(true);
    });

    it('new_chat_photo — empty array drops the message', function () {
        const r = converter.getMessageDetails(build({ new_chat_photo: [] }));
        expect(r).to.be.undefined;
    });

    it('new_chat_members — user field is populated from the array (V17.3.0 regression test)', function () {
        // Before V17.3.0 this branch referenced the (long-removed) singular
        // botMsg.new_chat_member, so `user` was always undefined.
        const members = [
            { id: 1, first_name: 'X', is_bot: false },
            { id: 2, first_name: 'Y', is_bot: false },
        ];
        const r = converter.getMessageDetails(build({ new_chat_members: members }));
        expect(r.type).to.equal('new_chat_members');
        expect(r.content).to.deep.equal(members);
        expect(r.user).to.deep.equal(members[0]);
    });

    it('left_chat_member', function () {
        const member = { id: 1, first_name: 'X', is_bot: false };
        const r = converter.getMessageDetails(build({ left_chat_member: member }));
        expect(r.type).to.equal('left_chat_member');
        expect(r.content).to.deep.equal(member);
        expect(r.user).to.deep.equal(member);
    });

    it('delete_chat_photo', function () {
        const r = converter.getMessageDetails(build({ delete_chat_photo: true }));
        expect(r.type).to.equal('delete_chat_photo');
        expect(r.content).to.equal(true);
    });

    it('channel_chat_created', function () {
        const r = converter.getMessageDetails(build({ channel_chat_created: true }));
        expect(r.type).to.equal('channel_chat_created');
        expect(r.content).to.equal(true);
    });

    it('group_chat_created', function () {
        const r = converter.getMessageDetails(build({ group_chat_created: true }));
        expect(r.type).to.equal('group_chat_created');
        expect(r.content).to.equal(true);
    });

    it('supergroup_chat_created', function () {
        const r = converter.getMessageDetails(build({ supergroup_chat_created: true }));
        expect(r.type).to.equal('supergroup_chat_created');
        expect(r.content).to.equal(true);
    });

    it('pinned_message', function () {
        const inner = fx.baseMessage({ text: 'pinned' });
        const r = converter.getMessageDetails(build({ pinned_message: inner }));
        expect(r.type).to.equal('pinned_message');
        expect(r.content).to.deep.equal(inner);
    });

    it('migrate_from_chat_id', function () {
        const r = converter.getMessageDetails(build({ migrate_from_chat_id: -1001 }));
        expect(r.type).to.equal('migrate_from_chat_id');
        expect(r.content).to.equal(-1001);
    });

    it('migrate_to_chat_id', function () {
        const r = converter.getMessageDetails(build({ migrate_to_chat_id: -1002 }));
        expect(r.type).to.equal('migrate_to_chat_id');
        expect(r.content).to.equal(-1002);
    });

    it('web_app_data', function () {
        const data = { data: '{"a":1}', button_text: 'go' };
        const r = converter.getMessageDetails(build({ web_app_data: data }));
        expect(r.type).to.equal('web_app_data');
        expect(r.content).to.deep.equal(data);
    });

    it('unknown payload returns undefined (drops to the default branch)', function () {
        const r = converter.getMessageDetails(build({ some_unknown_field: 'x' }));
        expect(r).to.be.undefined;
    });
});

// =============================================================================
// convertMessage — one case per event type
// =============================================================================

describe('lib/converter — convertMessage', function () {
    it('"message" delegates to getMessageDetails', function () {
        const msg = fx.textMessage('hi');
        const r = converter.convertMessage('message', 123, msg);
        expect(r).to.include({ chatId: 123, type: 'message', content: 'hi' });
    });

    it('callback_query — projects id, data, inline_message_id, from', function () {
        const cb = fx.callbackQuery({ data: 'choice-A', inline_message_id: 'inline-1' });
        const r = converter.convertMessage('callback_query', 123, cb);
        expect(r.type).to.equal('callback_query');
        expect(r.content).to.equal('choice-A');
        expect(r.callbackQueryId).to.equal('cb-1');
        expect(r.inlineMessageId).to.equal('inline-1');
        expect(r.messageId).to.equal(cb.message.message_id);
        expect(r.from).to.deep.equal(cb.from);
    });

    it('callback_query — handles missing inner message (inline-only)', function () {
        const cb = fx.callbackQuery();
        delete cb.message;
        const r = converter.convertMessage('callback_query', 123, cb);
        expect(r.messageId).to.be.undefined;
        expect(r.content).to.equal('choice-A');
    });

    it('inline_query — projects id, query, offset, from, location', function () {
        const iq = fx.inlineQuery();
        const r = converter.convertMessage('inline_query', 123, iq);
        expect(r.type).to.equal('inline_query');
        expect(r.content).to.equal('search-term');
        expect(r.inlineQueryId).to.equal('iq-1');
        expect(r.offset).to.equal('');
        expect(r.from).to.deep.equal(iq.from);
    });

    it('edited_message — surfaces editDate alongside the text content', function () {
        const m = fx.baseMessage({ text: 'fixed', edit_date: 1715520500 });
        const r = converter.convertMessage('edited_message', 123, m);
        expect(r.type).to.equal('edited_message');
        expect(r.content).to.equal('fixed');
        expect(r.editDate).to.equal(1715520500);
    });

    it('edited_message_text', function () {
        const m = fx.baseMessage({ text: 't', edit_date: 1 });
        const r = converter.convertMessage('edited_message_text', 123, m);
        expect(r.type).to.equal('edited_message_text');
        expect(r.editDate).to.equal(1);
        expect(r.content).to.equal('t');
    });

    it('edited_message_caption — content is the caption, not the text', function () {
        const m = fx.baseMessage({ caption: 'cap', edit_date: 2 });
        const r = converter.convertMessage('edited_message_caption', 123, m);
        expect(r.content).to.equal('cap');
        expect(r.editDate).to.equal(2);
    });

    it('channel_post', function () {
        const m = fx.channelPost();
        const r = converter.convertMessage('channel_post', m.chat.id, m);
        expect(r.type).to.equal('channel_post');
        expect(r.content).to.equal('channel announcement');
        expect(r.chat).to.deep.equal(m.chat);
    });

    it('edited_channel_post', function () {
        const m = Object.assign(fx.channelPost(), { edit_date: 99 });
        const r = converter.convertMessage('edited_channel_post', m.chat.id, m);
        expect(r.type).to.equal('edited_channel_post');
        expect(r.editDate).to.equal(99);
    });

    it('edited_channel_post_text', function () {
        const m = Object.assign(fx.channelPost(), { edit_date: 99 });
        const r = converter.convertMessage('edited_channel_post_text', m.chat.id, m);
        expect(r.content).to.equal('channel announcement');
        expect(r.editDate).to.equal(99);
    });

    it('edited_channel_post_caption — content is caption', function () {
        const m = Object.assign(fx.channelPost(), { caption: 'caption-only', edit_date: 99 });
        delete m.text;
        const r = converter.convertMessage('edited_channel_post_caption', m.chat.id, m);
        expect(r.content).to.equal('caption-only');
    });

    it('business_connection', function () {
        const bc = { id: 'bc-1', user: fx.from(), user_chat_id: 123, date: 1, rights: { a: true }, is_enabled: true };
        const r = converter.convertMessage('business_connection', 0, bc);
        expect(r.type).to.equal('business_connection');
        expect(r.id).to.equal('bc-1');
        expect(r.user).to.deep.equal(bc.user);
        expect(r.userChatId).to.equal(123);
        expect(r.isEnabled).to.equal(true);
    });

    it('business_message', function () {
        const m = fx.baseMessage({ text: 'biz' });
        const r = converter.convertMessage('business_message', 123, m);
        expect(r.type).to.equal('business_message');
        expect(r.content).to.equal('biz');
    });

    it('edited_business_message', function () {
        const m = fx.baseMessage({ text: 'biz-edit' });
        const r = converter.convertMessage('edited_business_message', 123, m);
        expect(r.type).to.equal('edited_business_message');
        expect(r.content).to.equal('biz-edit');
    });

    it('deleted_business_messages — array of ids', function () {
        const m = { message_ids: [1, 2, 3], business_connection_id: 'bc-1', chat: fx.chat() };
        const r = converter.convertMessage('deleted_business_messages', 123, m);
        expect(r.type).to.equal('deleted_business_messages');
        expect(r.messageIds).to.deep.equal([1, 2, 3]);
        expect(r.businessConnectionId).to.equal('bc-1');
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
        expect(r.type).to.equal('message_reaction');
        expect(r.newReaction).to.have.length(1);
    });

    it('message_reaction_count', function () {
        const m = { message_id: 1, date: 1, chat: fx.chat(), reactions: [{ type: { type: 'emoji', emoji: '👍' }, total_count: 5 }] };
        const r = converter.convertMessage('message_reaction_count', 123, m);
        expect(r.type).to.equal('message_reaction_count');
        expect(r.reactions).to.have.length(1);
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
        expect(r.type).to.equal('pre_checkout_query');
        expect(r.preCheckoutQueryId).to.equal('pcq-1');
        expect(r.content).to.equal('p');
        expect(r.currency).to.equal('EUR');
    });

    it('shipping_query', function () {
        const q = { id: 'sq-1', from: fx.from(), invoice_payload: 'p', shipping_address: { country_code: 'DE' } };
        const r = converter.convertMessage('shipping_query', 123, q);
        expect(r.type).to.equal('shipping_query');
        expect(r.shippingQueryId).to.equal('sq-1');
        expect(r.content).to.equal('p');
    });

    it('chosen_inline_result', function () {
        const cir = { result_id: 'r-1', from: fx.from(), query: 'q', inline_message_id: 'im-1' };
        const r = converter.convertMessage('chosen_inline_result', 123, cir);
        expect(r.type).to.equal('chosen_inline_result');
        expect(r.result_id).to.equal('r-1');
        expect(r.content).to.equal('r-1');
    });

    it('purchased_paid_media', function () {
        const p = { from: fx.from(), paid_media_payload: 'p-data' };
        const r = converter.convertMessage('purchased_paid_media', 123, p);
        expect(r.type).to.equal('purchased_paid_media');
        expect(r.paidMediaPayload).to.equal('p-data');
    });

    it('poll_answer', function () {
        const pa = { poll_id: 'p-1', user: fx.from(), option_ids: [0, 2], date: 1, chat: fx.chat() };
        const r = converter.convertMessage('poll_answer', 123, pa);
        expect(r.type).to.equal('poll_answer');
        expect(r.poll_id).to.equal('p-1');
        expect(r.option_ids).to.deep.equal([0, 2]);
        expect(r.content).to.deep.equal(pa.user);
    });

    it('poll', function () {
        const p = { id: 'p-1', question: 'Q', options: [{ text: 'A', voter_count: 1 }], total_voter_count: 1, is_anonymous: true, type: 'regular' };
        const r = converter.convertMessage('poll', 123, p);
        expect(r.type).to.equal('poll');
        expect(r.id).to.equal('p-1');
        expect(r.question).to.equal('Q');
        expect(r.content).to.equal('Q');
        expect(r.pollType).to.equal('regular');
    });

    it('my_chat_member', function () {
        const upd = { from: fx.from(), old_chat_member: {}, new_chat_member: {}, invite_link: null, date: 1, chat: fx.chat() };
        const r = converter.convertMessage('my_chat_member', 123, upd);
        expect(r.type).to.equal('my_chat_member');
        expect(r.from).to.deep.equal(upd.from);
    });

    it('chat_member', function () {
        const upd = { from: fx.from(), old_chat_member: {}, new_chat_member: {}, date: 1, chat: fx.chat() };
        const r = converter.convertMessage('chat_member', 123, upd);
        expect(r.type).to.equal('chat_member');
    });

    it('chat_join_request', function () {
        const upd = { from: fx.from(), bio: 'hi', invite_link: { invite_link: 'x' }, date: 1, chat: fx.chat() };
        const r = converter.convertMessage('chat_join_request', 123, upd);
        expect(r.type).to.equal('chat_join_request');
        expect(r.bio).to.equal('hi');
    });

    it('chat_boost', function () {
        const upd = { chat: fx.chat(), boost: { source: { source: 'premium' } } };
        const r = converter.convertMessage('chat_boost', 123, upd);
        expect(r.type).to.equal('chat_boost');
        expect(r.boost).to.deep.equal(upd.boost);
    });

    it('removed_chat_boost', function () {
        const upd = { chat: fx.chat(), boost_id: 'b-1', remove_date: 100, source: { source: 'premium' } };
        const r = converter.convertMessage('removed_chat_boost', 123, upd);
        expect(r.type).to.equal('removed_chat_boost');
        expect(r.boostId).to.equal('b-1');
        expect(r.removeDate).to.equal(100);
    });

    it('unknown type returns undefined (falls into the default branch)', function () {
        const r = converter.convertMessage('completely_made_up_event', 123, {});
        expect(r).to.be.undefined;
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
        expect(r.chatId).to.equal(12345); // caller-supplied wins
    });

    it('uses botMsg.chat.id for type "message" (delegates to getMessageDetails)', function () {
        const msg = fx.textMessage('hi');
        const r = converter.convertMessage('message', 999999, msg);
        // getMessageDetails reads botMsg.chat.id directly and ignores the
        // caller's chatId arg — current documented behaviour.
        expect(r.chatId).to.equal(123);
    });
});

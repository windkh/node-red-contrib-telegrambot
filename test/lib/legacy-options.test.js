const { describe, it } = require('node:test');
const assert = require('node:assert');
const { migrateLegacyOptions } = require('../../telegrambot/lib/legacy-options');

describe('legacy-options — migrateLegacyOptions', function () {
    describe('reply_to_message_id', function () {
        it('rewrites reply_to_message_id into reply_parameters.message_id', function () {
            const warns = [];
            const opts = { reply_to_message_id: 123 };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.strictEqual(opts.reply_to_message_id, undefined);
            assert.deepStrictEqual(opts.reply_parameters, { message_id: 123 });
            assert.strictEqual(warns.length, 1);
            assert.match(warns[0], /reply_to_message_id/);
        });

        it('preserves an existing reply_parameters object', function () {
            const opts = {
                reply_to_message_id: 123,
                reply_parameters: { quote: 'hello' },
            };
            migrateLegacyOptions(opts, () => {});
            assert.deepStrictEqual(opts.reply_parameters, { message_id: 123, quote: 'hello' });
        });

        it('does not overwrite reply_parameters.message_id when caller already set it', function () {
            const opts = {
                reply_to_message_id: 123,
                reply_parameters: { message_id: 999 },
            };
            migrateLegacyOptions(opts, () => {});
            assert.strictEqual(opts.reply_parameters.message_id, 999);
            assert.strictEqual(opts.reply_to_message_id, undefined);
        });
    });

    describe('thumb', function () {
        it('rewrites thumb to thumbnail', function () {
            const warns = [];
            const opts = { thumb: 'file_id_123' };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.strictEqual(opts.thumb, undefined);
            assert.strictEqual(opts.thumbnail, 'file_id_123');
            assert.strictEqual(warns.length, 1);
            assert.match(warns[0], /thumb/);
        });

        it('does not overwrite an existing thumbnail', function () {
            const opts = { thumb: 'old', thumbnail: 'new' };
            migrateLegacyOptions(opts, () => {});
            assert.strictEqual(opts.thumbnail, 'new');
            assert.strictEqual(opts.thumb, undefined);
        });
    });

    describe('disable_web_page_preview', function () {
        it('rewrites disable_web_page_preview: true into link_preview_options', function () {
            const warns = [];
            const opts = { disable_web_page_preview: true };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.strictEqual(opts.disable_web_page_preview, undefined);
            assert.deepStrictEqual(opts.link_preview_options, { is_disabled: true });
            assert.strictEqual(warns.length, 1);
            assert.match(warns[0], /disable_web_page_preview/);
        });

        it('coerces non-boolean truthy values', function () {
            const opts = { disable_web_page_preview: 1 };
            migrateLegacyOptions(opts, () => {});
            assert.deepStrictEqual(opts.link_preview_options, { is_disabled: true });
        });

        it('rewrites the false form too', function () {
            const opts = { disable_web_page_preview: false };
            migrateLegacyOptions(opts, () => {});
            assert.deepStrictEqual(opts.link_preview_options, { is_disabled: false });
        });

        it('does not overwrite an existing link_preview_options object', function () {
            const opts = {
                disable_web_page_preview: true,
                link_preview_options: { is_disabled: false, url: 'https://example.com' },
            };
            migrateLegacyOptions(opts, () => {});
            assert.deepStrictEqual(opts.link_preview_options, {
                is_disabled: false,
                url: 'https://example.com',
            });
            assert.strictEqual(opts.disable_web_page_preview, undefined);
        });
    });

    describe('keyboard string cells', function () {
        it('wraps bare-string cells into { text } objects', function () {
            const warns = [];
            const opts = {
                reply_markup: { keyboard: [['Yes'], ['No', 'Cancel']] },
            };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.deepStrictEqual(opts.reply_markup.keyboard, [
                [{ text: 'Yes' }],
                [{ text: 'No' }, { text: 'Cancel' }],
            ]);
            assert.strictEqual(warns.length, 1);
            assert.match(warns[0], /keyboard/);
        });

        it('leaves already-correct { text } cells alone', function () {
            const opts = {
                reply_markup: { keyboard: [[{ text: 'Yes' }, { text: 'No' }]] },
            };
            const warns = [];
            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.deepStrictEqual(opts.reply_markup.keyboard, [[{ text: 'Yes' }, { text: 'No' }]]);
            // No keyboard warn — nothing was rewritten.
            assert.strictEqual(warns.filter((m) => /keyboard/.test(m)).length, 0);
        });

        it('handles mixed rows (some strings, some objects)', function () {
            const opts = {
                reply_markup: { keyboard: [['Yes', { text: 'Maybe' }, 'No']] },
            };
            migrateLegacyOptions(opts, () => {});
            assert.deepStrictEqual(opts.reply_markup.keyboard, [[{ text: 'Yes' }, { text: 'Maybe' }, { text: 'No' }]]);
        });

        it('does not touch inline_keyboard (always object-shaped historically)', function () {
            const opts = {
                reply_markup: {
                    inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]],
                },
            };
            migrateLegacyOptions(opts, () => {});
            assert.deepStrictEqual(opts.reply_markup.inline_keyboard, [[{ text: 'Open', url: 'https://example.com' }]]);
        });

        it('tolerates missing reply_markup or missing keyboard', function () {
            assert.doesNotThrow(() => migrateLegacyOptions({}, () => {}));
            assert.doesNotThrow(() => migrateLegacyOptions({ reply_markup: {} }, () => {}));
            assert.doesNotThrow(() => migrateLegacyOptions({ reply_markup: { keyboard: null } }, () => {}));
        });
    });

    describe('allow_sending_without_reply', function () {
        it('folds into an existing reply_parameters', function () {
            const warns = [];
            const opts = {
                allow_sending_without_reply: true,
                reply_parameters: { message_id: 5 },
            };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.strictEqual(opts.allow_sending_without_reply, undefined);
            assert.deepStrictEqual(opts.reply_parameters, {
                message_id: 5,
                allow_sending_without_reply: true,
            });
            assert.strictEqual(warns.length, 1);
            assert.match(warns[0], /allow_sending_without_reply/);
        });

        it('folds into a reply_parameters created by the reply_to_message_id shim', function () {
            // Order-of-operations check: reply_to_message_id runs first, creating
            // reply_parameters; allow_sending_without_reply then folds into it.
            const opts = {
                reply_to_message_id: 5,
                allow_sending_without_reply: true,
            };
            migrateLegacyOptions(opts, () => {});
            assert.deepStrictEqual(opts.reply_parameters, {
                message_id: 5,
                allow_sending_without_reply: true,
            });
        });

        it('warns even when no reply_parameters exists (field still removed; would be a no-op anyway)', function () {
            const warns = [];
            const opts = { allow_sending_without_reply: true };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.strictEqual(opts.allow_sending_without_reply, undefined);
            assert.strictEqual(opts.reply_parameters, undefined);
            assert.strictEqual(warns.length, 1);
        });
    });

    describe('combined and edge cases', function () {
        it('applies all five transformations in one call', function () {
            const warns = [];
            const opts = {
                reply_to_message_id: 42,
                thumb: 'thumb-id',
                disable_web_page_preview: true,
                allow_sending_without_reply: true,
                reply_markup: { keyboard: [['Yes'], ['No']] },
            };
            migrateLegacyOptions(opts, (m) => warns.push(m));

            assert.deepStrictEqual(opts, {
                thumbnail: 'thumb-id',
                link_preview_options: { is_disabled: true },
                reply_parameters: { message_id: 42, allow_sending_without_reply: true },
                reply_markup: { keyboard: [[{ text: 'Yes' }], [{ text: 'No' }]] },
            });
            assert.strictEqual(warns.length, 5);
        });

        it('is idempotent — running twice does not re-warn or re-transform', function () {
            const warns = [];
            const opts = { reply_to_message_id: 42, thumb: 'X' };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            const after1 = JSON.parse(JSON.stringify(opts));
            const warns1Count = warns.length;

            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.deepStrictEqual(opts, after1);
            assert.strictEqual(warns.length, warns1Count);
        });

        it('returns the same object reference', function () {
            const opts = {};
            assert.strictEqual(
                migrateLegacyOptions(opts, () => {}),
                opts
            );
        });

        it('is a no-op when no deprecated fields are present', function () {
            const warns = [];
            const opts = {
                parse_mode: 'MarkdownV2',
                reply_parameters: { message_id: 1 },
                link_preview_options: { is_disabled: true },
            };
            const before = JSON.parse(JSON.stringify(opts));
            migrateLegacyOptions(opts, (m) => warns.push(m));
            assert.deepStrictEqual(opts, before);
            assert.deepStrictEqual(warns, []);
        });

        it('tolerates null / undefined / non-object input', function () {
            assert.doesNotThrow(() => migrateLegacyOptions(null, () => {}));
            assert.doesNotThrow(() => migrateLegacyOptions(undefined, () => {}));
            assert.doesNotThrow(() => migrateLegacyOptions('string', () => {}));
            assert.strictEqual(
                migrateLegacyOptions(null, () => {}),
                null
            );
            assert.strictEqual(
                migrateLegacyOptions(undefined, () => {}),
                undefined
            );
        });

        it('tolerates a missing warnFn', function () {
            const opts = { reply_to_message_id: 1 };
            assert.doesNotThrow(() => migrateLegacyOptions(opts));
            assert.deepStrictEqual(opts.reply_parameters, { message_id: 1 });
        });
    });
});

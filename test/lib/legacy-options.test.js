const { expect } = require('chai');
const { migrateLegacyOptions } = require('../../telegrambot/lib/legacy-options');

describe('legacy-options — migrateLegacyOptions', function () {
    describe('reply_to_message_id', function () {
        it('rewrites reply_to_message_id into reply_parameters.message_id', function () {
            const warns = [];
            const opts = { reply_to_message_id: 123 };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            expect(opts.reply_to_message_id).to.equal(undefined);
            expect(opts.reply_parameters).to.deep.equal({ message_id: 123 });
            expect(warns).to.have.length(1);
            expect(warns[0]).to.match(/reply_to_message_id/);
        });

        it('preserves an existing reply_parameters object', function () {
            const opts = {
                reply_to_message_id: 123,
                reply_parameters: { quote: 'hello' },
            };
            migrateLegacyOptions(opts, () => {});
            expect(opts.reply_parameters).to.deep.equal({ message_id: 123, quote: 'hello' });
        });

        it("does not overwrite reply_parameters.message_id when caller already set it", function () {
            const opts = {
                reply_to_message_id: 123,
                reply_parameters: { message_id: 999 },
            };
            migrateLegacyOptions(opts, () => {});
            expect(opts.reply_parameters.message_id).to.equal(999);
            expect(opts.reply_to_message_id).to.equal(undefined);
        });
    });

    describe('thumb', function () {
        it('rewrites thumb to thumbnail', function () {
            const warns = [];
            const opts = { thumb: 'file_id_123' };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            expect(opts.thumb).to.equal(undefined);
            expect(opts.thumbnail).to.equal('file_id_123');
            expect(warns).to.have.length(1);
            expect(warns[0]).to.match(/thumb/);
        });

        it('does not overwrite an existing thumbnail', function () {
            const opts = { thumb: 'old', thumbnail: 'new' };
            migrateLegacyOptions(opts, () => {});
            expect(opts.thumbnail).to.equal('new');
            expect(opts.thumb).to.equal(undefined);
        });
    });

    describe('disable_web_page_preview', function () {
        it('rewrites disable_web_page_preview: true into link_preview_options', function () {
            const warns = [];
            const opts = { disable_web_page_preview: true };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            expect(opts.disable_web_page_preview).to.equal(undefined);
            expect(opts.link_preview_options).to.deep.equal({ is_disabled: true });
            expect(warns).to.have.length(1);
            expect(warns[0]).to.match(/disable_web_page_preview/);
        });

        it('coerces non-boolean truthy values', function () {
            const opts = { disable_web_page_preview: 1 };
            migrateLegacyOptions(opts, () => {});
            expect(opts.link_preview_options).to.deep.equal({ is_disabled: true });
        });

        it('rewrites the false form too', function () {
            const opts = { disable_web_page_preview: false };
            migrateLegacyOptions(opts, () => {});
            expect(opts.link_preview_options).to.deep.equal({ is_disabled: false });
        });

        it('does not overwrite an existing link_preview_options object', function () {
            const opts = {
                disable_web_page_preview: true,
                link_preview_options: { is_disabled: false, url: 'https://example.com' },
            };
            migrateLegacyOptions(opts, () => {});
            expect(opts.link_preview_options).to.deep.equal({
                is_disabled: false,
                url: 'https://example.com',
            });
            expect(opts.disable_web_page_preview).to.equal(undefined);
        });
    });

    describe('keyboard string cells', function () {
        it('wraps bare-string cells into { text } objects', function () {
            const warns = [];
            const opts = {
                reply_markup: { keyboard: [['Yes'], ['No', 'Cancel']] },
            };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            expect(opts.reply_markup.keyboard).to.deep.equal([
                [{ text: 'Yes' }],
                [{ text: 'No' }, { text: 'Cancel' }],
            ]);
            expect(warns).to.have.length(1);
            expect(warns[0]).to.match(/keyboard/);
        });

        it('leaves already-correct { text } cells alone', function () {
            const opts = {
                reply_markup: { keyboard: [[{ text: 'Yes' }, { text: 'No' }]] },
            };
            const warns = [];
            migrateLegacyOptions(opts, (m) => warns.push(m));
            expect(opts.reply_markup.keyboard).to.deep.equal([[{ text: 'Yes' }, { text: 'No' }]]);
            // No keyboard warn — nothing was rewritten.
            expect(warns.filter((m) => /keyboard/.test(m))).to.have.length(0);
        });

        it('handles mixed rows (some strings, some objects)', function () {
            const opts = {
                reply_markup: { keyboard: [['Yes', { text: 'Maybe' }, 'No']] },
            };
            migrateLegacyOptions(opts, () => {});
            expect(opts.reply_markup.keyboard).to.deep.equal([
                [{ text: 'Yes' }, { text: 'Maybe' }, { text: 'No' }],
            ]);
        });

        it('does not touch inline_keyboard (always object-shaped historically)', function () {
            const opts = {
                reply_markup: {
                    inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]],
                },
            };
            migrateLegacyOptions(opts, () => {});
            expect(opts.reply_markup.inline_keyboard).to.deep.equal([
                [{ text: 'Open', url: 'https://example.com' }],
            ]);
        });

        it('tolerates missing reply_markup or missing keyboard', function () {
            expect(() => migrateLegacyOptions({}, () => {})).to.not.throw();
            expect(() => migrateLegacyOptions({ reply_markup: {} }, () => {})).to.not.throw();
            expect(() =>
                migrateLegacyOptions({ reply_markup: { keyboard: null } }, () => {})
            ).to.not.throw();
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
            expect(opts.allow_sending_without_reply).to.equal(undefined);
            expect(opts.reply_parameters).to.deep.equal({
                message_id: 5,
                allow_sending_without_reply: true,
            });
            expect(warns).to.have.length(1);
            expect(warns[0]).to.match(/allow_sending_without_reply/);
        });

        it('folds into a reply_parameters created by the reply_to_message_id shim', function () {
            // Order-of-operations check: reply_to_message_id runs first, creating
            // reply_parameters; allow_sending_without_reply then folds into it.
            const opts = {
                reply_to_message_id: 5,
                allow_sending_without_reply: true,
            };
            migrateLegacyOptions(opts, () => {});
            expect(opts.reply_parameters).to.deep.equal({
                message_id: 5,
                allow_sending_without_reply: true,
            });
        });

        it('warns even when no reply_parameters exists (field still removed; would be a no-op anyway)', function () {
            const warns = [];
            const opts = { allow_sending_without_reply: true };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            expect(opts.allow_sending_without_reply).to.equal(undefined);
            expect(opts.reply_parameters).to.equal(undefined);
            expect(warns).to.have.length(1);
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

            expect(opts).to.deep.equal({
                thumbnail: 'thumb-id',
                link_preview_options: { is_disabled: true },
                reply_parameters: { message_id: 42, allow_sending_without_reply: true },
                reply_markup: { keyboard: [[{ text: 'Yes' }], [{ text: 'No' }]] },
            });
            expect(warns).to.have.length(5);
        });

        it('is idempotent — running twice does not re-warn or re-transform', function () {
            const warns = [];
            const opts = { reply_to_message_id: 42, thumb: 'X' };
            migrateLegacyOptions(opts, (m) => warns.push(m));
            const after1 = JSON.parse(JSON.stringify(opts));
            const warns1Count = warns.length;

            migrateLegacyOptions(opts, (m) => warns.push(m));
            expect(opts).to.deep.equal(after1);
            expect(warns.length).to.equal(warns1Count);
        });

        it('returns the same object reference', function () {
            const opts = {};
            expect(migrateLegacyOptions(opts, () => {})).to.equal(opts);
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
            expect(opts).to.deep.equal(before);
            expect(warns).to.deep.equal([]);
        });

        it('tolerates null / undefined / non-object input', function () {
            expect(() => migrateLegacyOptions(null, () => {})).to.not.throw();
            expect(() => migrateLegacyOptions(undefined, () => {})).to.not.throw();
            expect(() => migrateLegacyOptions('string', () => {})).to.not.throw();
            expect(migrateLegacyOptions(null, () => {})).to.equal(null);
            expect(migrateLegacyOptions(undefined, () => {})).to.equal(undefined);
        });

        it('tolerates a missing warnFn', function () {
            const opts = { reply_to_message_id: 1 };
            expect(() => migrateLegacyOptions(opts)).to.not.throw();
            expect(opts.reply_parameters).to.deep.equal({ message_id: 1 });
        });
    });
});

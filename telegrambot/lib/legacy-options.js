// Backward-compatibility shim for user-supplied `msg.payload.options` fields
// that node-telegram-bot-api removed in v1.0.0. Lets V17.x flows keep working
// on V18.0.0 without rewrites; emits a deprecation warning per transformation
// so users see what to change at their leisure (see MIGRATION.md).
//
// Five deprecated forms covered:
//   1. options.reply_to_message_id          -> reply_parameters: { message_id }
//   2. options.thumb                        -> thumbnail
//   3. options.disable_web_page_preview     -> link_preview_options: { is_disabled }
//   4. options.reply_markup.keyboard cells  -> { text } object instead of bare string
//   5. options.allow_sending_without_reply  -> reply_parameters.allow_sending_without_reply
//
// The mutation is in-place AND the same reference is returned, so callers can
// use either pattern. The function is a no-op when no deprecated fields are
// present, including null/undefined `options`.
//
// `warnFn(message)` is called once per applied transformation. The CALLER is
// responsible for deduplication across calls (e.g. "warn once per node, not
// once per send"); this helper just reports what it changed.

function isString(value) {
    return typeof value === 'string';
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Migrate `options.reply_to_message_id` → `options.reply_parameters.message_id`.
// Preserves any existing `reply_parameters` object; only fills in `message_id`
// when not already set. Returns true if a change was made.
function migrateReplyToMessageId(options) {
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(options, 'reply_to_message_id')) {
        const value = options.reply_to_message_id;
        if (!isPlainObject(options.reply_parameters)) {
            options.reply_parameters = {};
        }
        if (options.reply_parameters.message_id === undefined) {
            options.reply_parameters.message_id = value;
        }
        delete options.reply_to_message_id;
        changed = true;
    }
    return changed;
}

// Migrate `options.thumb` → `options.thumbnail`. Skips if `thumbnail` is
// already set (caller's explicit value wins). Returns true if a change was
// made.
function migrateThumb(options) {
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(options, 'thumb')) {
        if (options.thumbnail === undefined) {
            options.thumbnail = options.thumb;
        }
        delete options.thumb;
        changed = true;
    }
    return changed;
}

// Migrate `options.disable_web_page_preview` → `options.link_preview_options.is_disabled`.
// Coerced to boolean. Skips if `link_preview_options` is already set. Returns
// true if a change was made.
function migrateDisableWebPagePreview(options) {
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(options, 'disable_web_page_preview')) {
        const value = !!options.disable_web_page_preview;
        if (!isPlainObject(options.link_preview_options)) {
            options.link_preview_options = { is_disabled: value };
        }
        delete options.disable_web_page_preview;
        changed = true;
    }
    return changed;
}

// Migrate bare-string keyboard cells under `options.reply_markup.keyboard` to
// `{ text }` objects. Inline keyboards (`inline_keyboard`) are unaffected —
// they were always object-only. Returns true if at least one cell was
// rewritten.
function migrateKeyboardStrings(options) {
    let changed = false;
    const rm = options.reply_markup;
    if (isPlainObject(rm) && Array.isArray(rm.keyboard)) {
        for (let r = 0; r < rm.keyboard.length; r++) {
            const row = rm.keyboard[r];
            if (Array.isArray(row)) {
                for (let c = 0; c < row.length; c++) {
                    if (isString(row[c])) {
                        row[c] = { text: row[c] };
                        changed = true;
                    }
                }
            }
        }
    }
    return changed;
}

// Migrate `options.allow_sending_without_reply` → `reply_parameters.allow_sending_without_reply`.
// Only takes effect if a `reply_parameters` object exists (either pre-existing
// or freshly created by the `reply_to_message_id` migration above). Without a
// reply target the field is a no-op anyway. Returns true if a change was made.
function migrateAllowSendingWithoutReply(options) {
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(options, 'allow_sending_without_reply')) {
        const value = options.allow_sending_without_reply;
        if (isPlainObject(options.reply_parameters) && options.reply_parameters.allow_sending_without_reply === undefined) {
            options.reply_parameters.allow_sending_without_reply = value;
        }
        delete options.allow_sending_without_reply;
        changed = true;
    }
    return changed;
}

// Walk an options object and rewrite every deprecated field in place. Returns
// the same `options` reference for chaining convenience. Callers should pass a
// warn function — typically a once-per-node-per-field wrapper around
// `node.warn` — which is invoked with a deprecation message for each
// transformation that fired.
function migrateLegacyOptions(options, warnFn) {
    let result = options;
    if (isPlainObject(options)) {
        // Order matters: reply_to_message_id must run BEFORE
        // allow_sending_without_reply so the latter can fold into the freshly
        // created reply_parameters object.
        if (migrateReplyToMessageId(options) && warnFn) {
            warnFn('DEPRECATED: msg.payload.options.reply_to_message_id is no longer supported; use reply_parameters: { message_id }. See MIGRATION.md.');
        }
        if (migrateThumb(options) && warnFn) {
            warnFn('DEPRECATED: msg.payload.options.thumb is no longer supported; use thumbnail. See MIGRATION.md.');
        }
        if (migrateDisableWebPagePreview(options) && warnFn) {
            warnFn(
                'DEPRECATED: msg.payload.options.disable_web_page_preview is no longer supported; use link_preview_options: { is_disabled }. See MIGRATION.md.'
            );
        }
        if (migrateKeyboardStrings(options) && warnFn) {
            warnFn('DEPRECATED: reply_markup.keyboard cells must be objects ({ text: ... }), not bare strings. See MIGRATION.md.');
        }
        if (migrateAllowSendingWithoutReply(options) && warnFn) {
            warnFn(
                'DEPRECATED: msg.payload.options.allow_sending_without_reply is no longer supported; fold into reply_parameters.allow_sending_without_reply. See MIGRATION.md.'
            );
        }
    }
    return result;
}

module.exports = { migrateLegacyOptions };

# Migrating to V18.0.0

V18.0.0 swaps the underlying `node-telegram-bot-api` library from v0.66 to v1.0.0. The upstream rewrite drops several legacy field names and a couple of method signatures. This package ships a built-in compatibility shim so **most existing V17 flows keep working unchanged on V18** — but you'll see a one-time deprecation warning per node in the debug pane pointing at this document.

## TL;DR

- **Most flows keep working unchanged.** The shim transparently rewrites five deprecated `msg.payload.options` fields at send time.
- **Watch the Node-RED debug pane on upgrade day.** Each section below shows what to look for and what to change.
- **SOCKS proxy users:** the underlying library switched from `socks-proxy-agent` to `fetch-socks`. Your bot config UI fields are unchanged.
- **Rollback** to V17 anytime: `npm install node-red-contrib-telegrambot@17.4.17` then `node-red-restart`.

## How do I know if I need to change anything?

Look in your Node-RED log on the first deploy after upgrading. Search for either:

- Lines starting with `DEPRECATED:` — the shim ran for you; the flow works but you should migrate the field at your leisure.
- Lines like `ETELEGRAM: 400 Bad Request: ...` on a sender that worked on V17 — you hit one of the **not-shimmable** cases below; the flow stops working until rewritten.

If neither appears after a week of normal traffic, you're done.

## Deprecated forms the shim handles for you

Each row shows the exact deprecation message you'll see in the debug pane, and the rewrite to apply at your leisure.

### 1. `reply_to_message_id` → `reply_parameters: { message_id }`

```
DEPRECATED: msg.payload.options.reply_to_message_id is no longer supported;
use reply_parameters: { message_id }. See MIGRATION.md.
```

**Before:**

```js
msg.payload.options = {
    reply_to_message_id: msg.payload.messageId,
};
```

**After:**

```js
msg.payload.options = {
    reply_parameters: { message_id: msg.payload.messageId },
};
```

Affected examples: `examples/replytomessage.json`, `examples/onreplymessage.json`, `examples/inlinekeyboard.json`, `examples/editinlinekeyboard.json`, `examples/keyboard.json`, `examples/sendkeyboardtochat.json`, `examples/sendinvoice.json`, `examples/sendInvoice2.json`, `examples/simplebot.json`, `examples/supergroupadmin.json`, `examples/webappdata.json` (already updated for you in V18.0.0).

### 2. `thumb` → `thumbnail`

```
DEPRECATED: msg.payload.options.thumb is no longer supported; use thumbnail.
See MIGRATION.md.
```

**Before:** `msg.payload.options = { thumb: 'file_id' };`
**After:** `msg.payload.options = { thumbnail: 'file_id' };`

Applies to `sendAudio`, `sendDocument`, `sendVideo`, `sendAnimation`, `sendVoice`, and the sticker methods.

### 3. `disable_web_page_preview` → `link_preview_options: { is_disabled }`

```
DEPRECATED: msg.payload.options.disable_web_page_preview is no longer
supported; use link_preview_options: { is_disabled }. See MIGRATION.md.
```

**Before:**

```js
msg.payload.options = { disable_web_page_preview: true };
```

**After:**

```js
msg.payload.options = { link_preview_options: { is_disabled: true } };
```

### 4. `keyboard: [["Yes"], ["No"]]` → `keyboard: [[{ text: "Yes" }], [{ text: "No" }]]`

```
DEPRECATED: reply_markup.keyboard cells must be objects ({ text: ... }),
not bare strings. See MIGRATION.md.
```

**Before:**

```js
msg.payload.options = {
    reply_markup: JSON.stringify({
        keyboard: [['Yes'], ['No']],
        resize_keyboard: true,
    }),
};
```

**After:**

```js
msg.payload.options = {
    reply_markup: JSON.stringify({
        keyboard: [[{ text: 'Yes' }], [{ text: 'No' }]],
        resize_keyboard: true,
    }),
};
```

Affected examples (still using string-shorthand at the V18.0.0 release): `basiccustomkeyboard.json`, `basicinlinekeyboard.json`, `editinlinekeyboard.json`, `inlinekeyboard.json`, `keyboard.json`, `sendkeyboardtochat.json`, `simplebot.json`, `webappdata.json`. The shim wraps them at runtime; rewriting silences the warning.

### 5. `allow_sending_without_reply` → fold into `reply_parameters`

```
DEPRECATED: msg.payload.options.allow_sending_without_reply is no longer
supported; fold into reply_parameters.allow_sending_without_reply.
See MIGRATION.md.
```

**Before:**

```js
msg.payload.options = {
    reply_to_message_id: 123,
    allow_sending_without_reply: true,
};
```

**After:**

```js
msg.payload.options = {
    reply_parameters: {
        message_id: 123,
        allow_sending_without_reply: true,
    },
};
```

## Not-shimmable changes (rewrite before upgrading)

These cannot be transparently rewritten because they affect the bot method call shape itself, not a field within `msg.payload.options`.

### `sendPoll` poll choices

V1.0.0 requires `InputPollOption[]` (objects with `text`) instead of `string[]`.

V18 transparently wraps strings into `{ text }` objects so V17 flows keep working. No action needed unless you want to silence the implicit wrapping.

**Before:** `msg.payload.options = ['Yes', 'No', 'Maybe'];`
**After:**  `msg.payload.options = [{ text: 'Yes' }, { text: 'No' }, { text: 'Maybe' }];`

### `restrictChatMember` argument shape

V1.0.0 made `permissions` a positional argument. V18 transparently lifts `msg.payload.options.permissions` to the new slot, so V17 flows keep working unchanged. No action needed.

### `setStickerSetThumb` → `setStickerSetThumbnail`

If your flow uses the `setStickerSetThumb` method type via the sender node, change it to `setStickerSetThumbnail`. The package itself doesn't expose this method type directly; only flows that send a raw method name need this update.

### `answerCallbackQuery` legacy 3-arg form

V1.0.0 removed `answerCallbackQuery(id, text, showAlert)`. Use the options-object form:

**Before:** `bot.answerCallbackQuery(id, 'Got it', true)` (called from a function node)
**After:**  `bot.answerCallbackQuery(id, { text: 'Got it', show_alert: true })`

The package's own call sites already use the options-object form; only flows that call the method directly via function nodes need this update.

## SOCKS proxy users

If your bot config has SOCKS configured, the underlying lib has switched from `socks-proxy-agent` to `fetch-socks`; the config UI fields are unchanged and the dispatcher install path is automatic. Reinstall the package and redeploy as usual.

> **Use V18.0.2 or newer.** V18.0.0 and V18.0.1 had a bug where the SOCKS port (stored as a string by Node-RED) was rejected by the new proxy layer (`Invalid SOCKS proxy details were provided`), so SOCKS bots wouldn't connect. Fixed in V18.0.2 (#472).

## Other behaviour changes worth knowing

- **Native fetch + undici under the hood.** V1.0.0 drops the legacy `request` HTTP library. Your bot's outbound HTTPS traffic now uses Node's built-in fetch via a per-process undici dispatcher (installed automatically). The `keep-alive socket pool` defence from V17.4.5 / V17.4.13 (issue #442) is preserved: `scheduleRestart` destroys and rebuilds the dispatcher to clear any wedged sockets.
- **Automatic 429 retry inside the lib.** V1.0.0's HTTP client retries `429 Too Many Requests` up to twice automatically, honouring the server-side `retry_after`. The sender's own queue-based retry path is still in place for defence-in-depth (issue #450 covers the queue-wedge edge cases).
- **Dual ESM+CJS library.** As of `node-telegram-bot-api` v1.1.2 the library ships both an ESM and a CommonJS build, so this package loads it with a plain synchronous `require()`. (The v1.0.0–1.1.1 ESM-only releases needed an internal dynamic-import bridge; that was removed once CJS was restored.) Users don't see anything different.

## Symptoms of a broken upgrade

| What you see in the debug pane | What it means |
|---|---|
| `DEPRECATED: ...` | The shim ran; rewrite that form at leisure. |
| `Bot ... will restart in Xms (...)` | Sustained network/Telegram failure; auto-restart is engaged. Normal recovery. |
| `auto-restart hit 60s ceiling — sustained failure (...)` | The exponential backoff ramped out; bot keeps retrying every 60 s until network returns. One alert per outage. |
| `ETELEGRAM: 400 Bad Request: can't parse entities` | Markdown parse error; check your text for unescaped `*`, `_`, `[`, `]`. (Unrelated to V18, just worth knowing.) |
| `ETELEGRAM: 400 Bad Request: <other>` on a flow that worked on V17 | Likely a not-shimmable change above. Check the four cases. |
| `Cannot find module 'node-telegram-bot-api'` (or a require error) at Node-RED startup | The library isn't installed correctly (npm install corruption, or Node < 20). Reinstall the package on Node.js >= 20. |

## Rollback

If V18.0.0 breaks your flow and you can't immediately fix it:

```bash
cd ~/.node-red
npm install node-red-contrib-telegrambot@17.4.17
node-red-restart
```

V17.4.17 is the last V17 release and remains installable by exact version. V18 is the current `latest`, so there's no auto-rollback — pin the V17 version explicitly if you need to stay on it.

## Where to ask for help

- GitHub issues: <https://github.com/windkh/node-red-contrib-telegrambot/issues>
- Migration plan: <https://github.com/windkh/node-red-contrib-telegrambot/issues/448>
- Telegram chat: <https://t.me/nodered_telegrambot>

## What changed under the hood (optional reading)

The upstream `node-telegram-bot-api` library was rewritten in TypeScript, switched from CommonJS to ESM, and replaced the legacy `request` HTTP layer with native `fetch`. Several internal patches this package used to maintain are no longer needed — cleaner code on our side, identical surface on yours.

Full technical migration plan and design discussion: see [issue #448](https://github.com/windkh/node-red-contrib-telegrambot/issues/448).

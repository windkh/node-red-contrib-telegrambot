# Recommendations for Refactoring

Ranked by leverage (impact-to-effort ratio). Numbers refer to LOC of the file as it stands today.

## 1. Add a minimal mocha + chai (or vitest) test harness

**Cost:** ~half a day for the harness; another half-day to wire the three pure-helper files.
**Benefit:** highest leverage on the whole codebase. The three `lib/` files are pure functions over plain objects — `converter` has 16 functions × ~30 input shapes each; `queue-manager` is a stateful four-method class with ordering invariants; `safe-stringify` is a one-liner with two interesting inputs. All three are testable without Node-RED, without Telegram, without network.

Suggested starting set:

- `lib/safe-stringify.test.js` — circular ref, nested circular, simple object, primitives. ~30 LOC.
- `lib/queue-manager.test.js` — order preserved per chat, parallelism across chats, sync-throw drains head, `repeatProcessMessage` re-runs after delay. ~100 LOC.
- `lib/converter.test.js` — every branch of `getMessageDetails` and `convertMessage` against representative payloads. The biggest payoff for catching regressions in Telegram API drift. ~300 LOC initially, grows over time.

`bot-node.js`'s pure helpers (`parseStringArgList`, `evalContextExpression`) should also be exported and tested — they were smoke-tested out-of-band during V17.2.0 and V17.3.1 work but never permanently.

## 2. Table-drive the sender's per-type switch

**Cost:** one focused refactor session.
**Benefit:** eliminates the largest single source of drift bugs we've seen (`audio` missing `processResult`, `sendInvoice` missing `hasContent`, the open `default` case).

Current shape (`out-node.js:253-810`):

```js
switch (type) {
    case 'photo':       if (hasContent(msg)) tg.sendPhoto(chatId, content, options, fileOptions).catch(processError).then(processResult); break;
    case 'audio':       if (hasContent(msg)) tg.sendAudio(chatId, content, options, fileOptions).catch(processError).then(processResult); break;
    // ... 48 more cases ...
    default:            if (type in tg)      tg[type](chatId, content, options).catch(processError).then(processResult); break;
}
```

Target shape:

```js
const HANDLERS = {
    photo:    { method: 'sendPhoto',    args: (msg, chatId) => [chatId, msg.payload.content, msg.payload.options || {}, msg.payload.fileOptions], requireContent: true },
    audio:    { method: 'sendAudio',    args: ..., requireContent: true },
    location: { method: 'sendLocation', args: (msg, chatId) => [chatId, msg.payload.content.latitude, msg.payload.content.longitude, msg.payload.options || {}], requireContent: true },
    // ...
    sendInvoice: { method: 'sendInvoice', args: ..., requireContent: true },
    // explicit aliases for 'callback_query' -> 'answerCallbackQuery' etc.
};

function dispatch(type, msg, chatId, ...) {
    const h = HANDLERS[type];
    if (!h) { node.warn('msg.payload.type is not supported: ' + type); return; }
    if (h.requireContent && !hasContent(msg)) return;
    telegramBot[h.method](...h.args(msg, chatId))
        .catch(ex => processError(chatId, ex, msg, ...))
        .then(result => processResult(chatId, result, msg, ...));
}
```

Wins:

- The open `default` case disappears — no more arbitrary-method-invocation risk.
- ~700 lines collapse to ~150 of declarative table + ~30 of dispatch.
- Adding a new Bot API method = one table row.
- Every method consistently calls `processResult` / `processError` exactly once. Drift is impossible.

The `'message'` chunking branch and the four "non-type" paths (`forward`, `copy`, `download`, `getfile`) stay as explicit handlers — they don't fit the simple shape.

## 3. Add a backoff-aware auto-restart helper for fatal bot failures

**Cost:** ~50 lines in `bot-node.js`.
**Benefit:** resolves #442 and #440 root causes.

```js
this.restartCount = 0;
this.restartTimer = null;

function backoffDelay(count) {
    return Math.min(60_000, 3000 * Math.pow(2, count)); // 3s, 6s, 12s, ..., capped at 60s
}

this.scheduleRestart = function (reason) {
    if (self.restartTimer) return;                 // single-flight
    if (self.restartCount > 8) {                   // surrender after ~5 min cumulative
        self.error('Bot ' + self.botname + ' gave up restarting after fatal: ' + reason);
        return;
    }
    let delay = backoffDelay(self.restartCount++);
    self.warn('Bot ' + self.botname + ' will restart in ' + delay + 'ms after fatal: ' + reason);
    self.restartTimer = setTimeout(function () {
        self.restartTimer = null;
        self.abortBot('pre-restart', function () {
            self.telegramBot = null;                // force fresh agent on next getTelegramBot()
            self.status = 'disconnected';
            let bot = self.getTelegramBot();
            if (bot) {
                self.restartCount = 0;              // success — reset counter
            }
        });
    }, delay);
};
```

Wire it into:

- `newTelegramBot.on('error', ...)` — replaces the current direct `abortBot` call.
- The `polling_error` handler — after N consecutive errors in a sliding window, escalate to `scheduleRestart`.
- `this.on('close', ...)` — clear `self.restartTimer` so a redeploy mid-backoff doesn't fire after the node is gone.

This also covers the SOCKS-proxy case in #440: a full `abortBot` + new `createTelegramBot` rebuilds `self.request` and therefore the `SocksProxyAgent` from scratch.

## 4. Split `bot-node.js` along its natural seams

**Cost:** ~one focused session, plus follow-ups.
**Benefit:** the file is 1049 LOC across the token-expression parser, the agent setup, three transport modes, the polling restart logic, the command registry, the status broadcast, and the runtime lifecycle. Each is small individually but the file is hard to navigate.

Suggested seams (one file each, all referenced via `lib/` so the wider codebase doesn't change):

```
lib/
  expression-eval.js     (parseStringArgList + evalContextExpression — ~100 LOC)
  agent.js               (buildRequestOptions(config) -> {agentClass?, agentOptions, ...} — ~50 LOC)
  webhook-mode.js        (createTelegramBotForWebhookMode — ~100 LOC)
  polling-mode.js        (createTelegramBotForPollingMode + restartPolling — ~80 LOC)
  send-only-mode.js      (createTelegramBotForSendOnlyMode — ~20 LOC)
  command-registry.js    (registerCommand / unregisterCommand / setMyCommands / deleteMyCommands — ~150 LOC)
  status-broadcast.js    (setStatus + the four cases — ~50 LOC)
```

`bot-node.js` becomes the orchestrator that wires those pieces together (~250 LOC remaining).

Do this **after** the test harness is in place — moving code across files without tests will leak bugs.

## 5. Use the shared `safeStringify` everywhere

**Cost:** one search-and-replace + a few lint passes.
**Benefit:** removes one whole class of "error handler itself throws on circular `msg`" bugs.

Sites that still use raw `JSON.stringify(msg)`:

- `event-node.processError` — fixed in V17.3.0, already uses `safeStringify`.
- `command-node` — currently uses no JSON stringify. OK as-is.
- `out-node` — uses `safeStringify`. OK.
- Anywhere else added in future error handlers.

Pattern: never call `JSON.stringify(msg)` on a Telegram-derived object; always go through `lib/safe-stringify.js`.

## 6. Replace listener-attach `setMaxListeners(0)` with a real bound

**Cost:** trivial.
**Benefit:** restoring the warning that catches listener leaks if a future regression slips by code review.

`bot-node.js:240` sets `self.setMaxListeners(0)` to suppress Node's "possible EventEmitter memory leak" warning. The original reason (issue #198) was that many runtime nodes attaching listeners to the config node tripped the default 10-listener cap. A more honest fix is `self.setMaxListeners(50)` (or whatever the realistic upper bound is for a flow); the warning then re-engages if something goes badly wrong (e.g., a regression of the listener-tracking work in ADR 0005).

## 7. Document `credentialSecret` for automated deployments

**Cost:** a `README.md` section or wiki page.
**Benefit:** closes the docs half of #432 without code changes.

The token half of #432 ("env.get not resolved from flows.json") is a Node-RED credential-stripping behaviour, not a plugin bug. Document the two working patterns:

1. **Reproducible credential file**: set `credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET` in `settings.js` and commit `flows_cred.json` (encrypted).
2. **Boot-time injection**: write `flows_cred.json` from your secrets store at container start; the plugin reads `{env.get("X")}` from there normally.

## 8. Add the `setwebhook` control command (issue #410)

**Cost:** ~30 lines in `control-node.js` + one passthrough in `bot-node.js`.
**Benefit:** unblocks the ngrok use case without touching the rest of the architecture.

```js
// control-node.js — inside the switch
case 'setwebhook': {
    let url = msg.payload.url;
    let opts = msg.payload.options || {};
    node.config.setWebhookDynamically(url, opts, function (err, result) {
        if (err) { msg.error = err; node.send([null, msg]); }
        else     { msg.payload.result = result; node.send([msg, null]); }
    });
    break;
}
```

`bot-node.js` exposes `setWebhookDynamically(url, opts, cb)` that calls `telegramBot.setWebHook(url, opts)`. Best-effort — if polling mode is active the result is ignored; the user is responsible for choosing modes.

## What I'd explicitly *not* refactor

- **Output key casing in `converter.js`** (`chatId` vs `option_ids`). It's an inconsistent public contract, but renaming would break every downstream flow that depends on the documented shape. Live with it.
- **The `FatalError` monkey-patch.** Upstream still doesn't propagate `error.cause` as of `node-telegram-bot-api@0.66.0`. The patch is small, isolated, and serves a real purpose.
- **`bluebird` cancellation enabled process-wide** at `99-telegrambot.js:6`. Removing it would silently break the bot library's behaviour. The cost of carrying `bluebird` for this is fine.

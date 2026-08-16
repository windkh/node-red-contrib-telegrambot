# ADR 0012 — Moving to `node-telegram-bot-api` v2

## Status

Proposed. Analysis only — no code has changed. Fulfils steps 1 and 2 of the plan in
[#501](https://github.com/windkh/node-red-contrib-telegrambot/issues/501); the port itself is steps 3–7 and
is not authorised by this ADR.

## Context

`node-telegram-bot-api@2.0.0` calls itself "a from-scratch redesign with **no backward compatibility**" with
the v1 `TelegramBot` surface. We are on `^1.2.0`. [ADR 0002](0002-node-telegram-bot-api-transport.md) picked
this library as our transport; this ADR asks whether the v2 rewrite is still a transport we can build on,
and at what cost.

The answers below come from a throwaway spike run against v2.0.0 installed over the tree
(`--no-save`, rolled back), on Node 24.19.0, with a local HTTP server standing in for the Telegram API. They
are observations, not readings of the release notes.

## What the spike established

### 1. CommonJS works — no blocker

Node-RED loads nodes as CJS. v2 ships dual ESM+CJS with a `require` condition:

```
require("node-telegram-bot-api")       -> Bot is a function
require("node-telegram-bot-api/node")  -> fromPath is a function
```

**One sharp edge:** `package.json` is *not* in the `exports` map. `require('node-telegram-bot-api/package.json')`
throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. Anything that reads the library's version that way breaks.

### 2. The per-bot dispatcher survives — this was the blocker, and it clears

v1 took our `undici` `Agent` through `request.fetchOptions`. v2 replaces that with a whole injected fetch:

```ts
interface TransportOptions {
    apiRoot?: string;            // replaces baseApiUrl
    fetch?: typeof fetch;        // "Injected fetch implementation. Default globalThis.fetch."
    timeoutMs?: number;
    maxRetries?: number;
    retryBackoffMs?: number;
    maxRetryAfterMs?: number;
    rateLimit?: RateLimitOptions;
}
interface BotOptions extends TransportOptions {}
```

Verified end to end — `bot.api.sendMessage(...)` reached the mock at `/bot<token>/sendMessage`, and the
instrumented `dispatch()` on our own Agent was called:

```
bot.api.sendMessage(...) response   {"message_id":42,"text":"pong"}
request arrived at mock             true
our own dispatcher used             true
```

So **SOCKS proxy support (`fetch-socks`) and the #442 keep-alive defence survive the port.**

**This also dissolves [ADR 0011](0011-stay-on-undici-7.md).** Injecting `undici`'s *own* `fetch` never crosses
Node's built-in-fetch boundary — precisely the combination ADR 0011 proved works with undici 8. After this
port, the Dependabot ignore on undici majors is liftable, and it does not have to wait for Node to bundle
undici 8. That is a second, independent reason to do the port.

### 3. Middleware is a chain, not a fan-out — this is the real cost

v1's emitter delivered every update to every listener, independently. v2's `on()` appends to a chain, and a
handler that does not call `next()` ends it:

```
two on('message') handlers, first does not call next():   only "1" runs
two on('message') handlers, first calls next():           "1,2" run
```

We attach **one handler per receiver node to a shared bot**, and `test/integration/polling.test.js` asserts
that an update reaches *multiple* receivers. Under v2 that only holds if every handler calls `next()` — which
makes correctness of node A depend on node B's implementation, and lets one node silently swallow another's
traffic.

There is also **no `off()`**. The full instance surface is:

```
catch, command, handleUpdate, hears, isRunning, on, startPolling, stop, use
```

[ADR 0005](0005-listener-handle-tracking.md) — track listener handles, detach on redeploy — has no v2
equivalent. Registration is additive and permanent for the life of a `Bot`.

**Conclusion: do not map receiver nodes onto `bot.on()`.** Register exactly one middleware per bot that hands
the update to our own dispatcher, and keep node attach/detach on our side. That preserves fan-out, keeps
redeploy clean (our registry is mutable, the bot's is not), and confines v2's chain semantics to one place.
The `Context` we would fan out carries `update, api, state, match`.

### 4. Things v2 now does that we do ourselves

Each needs a decision in the port, not a port:

| Ours | v2 offers | Assessment |
| --- | --- | --- |
| [ADR 0003](0003-per-chat-message-queue.md) per-chat queue | `rateLimit: { global, perChat, maxChatBuckets }` — proactive limiting with LRU-bounded per-chat buckets | Strong overlap. Our queue also orders sends, which the limiter may not guarantee — verify before deleting. |
| retry / flood handling | `maxRetries`, `retryBackoffMs`, `maxRetryAfterMs`, 429 honouring `retry_after` with a cap | Likely replaces ours. Note the deliberate design: a `retry_after` above the cap surfaces the error instead of hanging. |
| `lib/error-chain.js` (`EFATAL`, `ETELEGRAM`) | `TelegramBotError` base with `NetworkError`, `TimeoutError`, `ParseError`, `TelegramApiError` | Replaces the taxonomy. **`msg.error` shapes are user-visible** — this is migration-guide material. |
| webhook plumbing | `createWebhookServer`, `startWebhook`, `nodeFrameworkWebhook` under `./node` | Evaluate against our own webhook mode. |
| upload buffering | `fromPath()`, `InputFile`, streaming uploads | Likely replaces buffering. |
| `lib/legacy-options.js` (V18 shim) | — | Rewrite or drop. Dropping is defensible in a major, but only with a `MIGRATION.md` entry. |
| `callApi` escape hatch | uniform `bot.api.*` | Its reason for existing was gaps in v1. Re-scope, and re-scope #459–#462 with it. |

v2 has **zero runtime dependencies** and its core imports no `node:*` at all; Node-only sugar lives under
`./node`.

## Decision

**Recommend proceeding with the port**, planned as steps 3–7 of #501, with these constraints fixed now:

1. **One middleware per bot, fanning out to our own dispatcher.** Do not register per-node handlers on the
   bot. This is the architectural decision the spike forces.
2. **Inject `undici`'s own `fetch`** rather than relying on `globalThis.fetch`, keeping the per-bot dispatcher
   and SOCKS support.
3. **Treat the error taxonomy as a user-visible break** and write it up before touching code.
4. **Supersede ADRs 0003, 0005 and 0011 explicitly** as part of the port, rather than leaving them to
   contradict the new design.

No implementation is authorised by this ADR. Step 3 (isolate the transport behind an internal seam) is the
next action.

## Consequences

- **The blocker feared in #501 did not materialise** — the transport hook survives in a better form, so the
  port is a large job rather than an impossible one.
- **ADR 0011 gets a second exit.** Today it waits on Node bundling undici 8; after this port, an injected
  undici fetch removes the constraint entirely.
- **ADR 0005 cannot be ported and must be replaced**, not adapted — there is no removal API to track handles
  against.
- **`test/integration/polling.test.js`'s multi-receiver assertion is the canary.** If the port is done by
  mapping nodes onto `bot.on()`, that test fails — and it failing is correct.
- **The spike was throwaway and left nothing behind**: v2 was installed with `--no-save` and rolled back;
  `package.json`, `package-lock.json` and the working tree are unchanged, and `node-telegram-bot-api` is back
  at 1.2.0.

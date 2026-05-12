# Structural Design

## Module decomposition

```
                    ┌──────────────────┐
                    │ 99-telegrambot.js│  Node-RED entry; registers 7 node types
                    └────────┬─────────┘
                             │ require
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
  nodes/bot-node.js                          lib/*.js
  (config node)                              (pure helpers)
  ┌──────────────┐                           ┌──────────────┐
  │ token        │                           │ converter    │
  │ agent / req  │  ◄────── used by every    │ queue-mgr    │
  │ telegramBot  │          runtime node     │ safe-string  │
  │ commands map │                           └──────────────┘
  └──────┬───────┘
         │
   emits 'status' / exposes getTelegramBot() / register|unregisterCommand()
         │
  ┌──────┴─────────────────────────────────────────────────┐
  │                                                        │
  ▼                                                        ▼
nodes/in-node.js   nodes/out-node.js   nodes/command-node.js
nodes/event-node.js                    nodes/reply-node.js
nodes/control-node.js

       (runtime nodes — one bot per config, many runtime nodes per bot)
```

## The config node is the only thing that owns state

`bot-node.js` owns the only stateful objects:

- `self.telegramBot` — the live `node-telegram-bot-api` instance (or `null` after `abortBot`).
- `self.request` — the `http.Agent` / `SocksProxyAgent` config; **built once** at config-node construction and reused for every HTTP call (this is load-bearing — see [errors-and-weaknesses.md](errors-and-weaknesses.md)).
- `botsByToken` — *module-level* map preventing two config nodes from registering the same token.
- `self.commandsByNode` / `self.commandsByLanguage` — bot-command registry rebuilt on each `flows:started` and pushed to Telegram via `setMyCommands`.
- `self.pendingCommands` — per-`(username,chatId)` map of commands awaiting a follow-up response.

Runtime nodes hold *only* node-local state (e.g. their own `attachedListeners[]`, `pendingReplyListenerIds`). They never reach into the config node's internals; they call its public methods (`getTelegramBot(createIfMissing)`, `isAuthorized(...)`, `registerCommand(...)`).

## The 7 node types

| Node ID | File | Role | Talks to bot via |
|--------|------|------|------|
| `telegram bot` | `bot-node.js` | Config node — holds token, lifecycle, command registry | (owner) |
| `telegram receiver` | `in-node.js` | Receives `message` and optionally every other update type | `bot.on(event, ...)` |
| `telegram sender` | `out-node.js` | Sends every Bot API call by `msg.payload.type` | `bot.send<Foo>(...)` directly |
| `telegram command` | `command-node.js` | `/command` matcher with optional regex + response capture | `bot.on('message', ...)` |
| `telegram event` | `event-node.js` | Single non-message update (e.g. `callback_query`) | `bot.on(event, ...)` |
| `telegram reply` | `reply-node.js` | Captures one reply to a specific sent message | `bot.onReplyToMessage(...)` |
| `telegram control` | `control-node.js` | `start` / `stop` / `restart` / `command` injection | `cfg.start() / stop() / sendToAllCommandNodes(...)` |

Every runtime node follows the same skeleton:

```js
function TelegramXxxNode(config) {
    RED.nodes.createNode(this, config);
    let node = this;
    this.config = RED.nodes.getNode(this.bot);    // resolve config node
    node.config.addListener('status', onStatusChanged);
    node.start();                                  // attach event listener(s)
    this.on('input',  function (msg) { ... });     // optional outbound path
    this.on('close',  function (removed, done) {   // detach + cleanup
        node.stop(); node.config.removeListener(...); done();
    });
}
```

## Shared libraries

### `lib/converter.js`

A pair of pure functions plus a small `getPhotoIndexWithHighestResolution` helper:

- `getMessageDetails(botMsg)` — branches on which content field is present (`text`, `photo`, `audio`, `document`, ... 30+ branches) and projects the Telegram payload into a flat `msg.payload` shape.
- `convertMessage(type, chatId, botMsg)` — same projection but for non-`message` update types (`callback_query`, `inline_query`, `poll`, `chat_member`, ...).
- `getUserInfo(botMsg)` — single source of truth for `username` / `userid` / `chatid` / `isAnonymous`. Used by `in-node`, `event-node`, and (since 17.3.1) `command-node`.

Pure functions, no side effects, no Node-RED dependency — the obvious first target for unit tests (none today).

### `lib/queue-manager.js`

Per-`chatId` FIFO. Each enqueued function runs only after the previous one has called `processNext(chatId)`. Different chats run in parallel.

- `enqueue(chatId, func)` — append + autostart if idle.
- `processCurrent(chatId)` — invokes the head; sync throws drain the head and defer the next iteration through `setImmediate` (V17.3.0 fix — see ADR 0003).
- `processNext(chatId)` — caller-driven advance after async completion.
- `repeatProcessMessage(chatId, delay)` — schedules a re-attempt for HTTP 429 retries.

The sender node is the only consumer.

### `lib/safe-stringify.js`

15-line wrapper around `JSON.stringify` that emits `"[Circular]"` for duplicate object references instead of dropping the key. Used by both `out-node` and `event-node` for error logging. Telegram payloads can contain circular references via `msg.originalMessage.chat.pinned_message.chat`, so this is genuinely needed.

## External coupling

| What | Why | Consequence |
|------|-----|-------------|
| `node-telegram-bot-api` | The actual Telegram client | One patched class (`FatalError`) is monkey-patched on import (`bot-node.js:13-22`) to attach `cause` propagation. Class internals (`_polling`, `_webHook`) used to be read directly; mostly cleaned up in 17.3.x. |
| `bluebird` | The bot library exposes Bluebird-style promises | `Bluebird.config({ cancellation: true })` is set process-wide at module import. |
| `socks-proxy-agent` | Optional SOCKS proxy | Constructed per config node, reused across the bot's lifetime. |
| `RED.events` | `flows:started` event used to sync bot commands | Single global event bus; we always remove our listener on close. |
| `RED.util.cloneMessage` | Used when fanning out a single `msg` to multiple chat IDs | Standard Node-RED utility. |

## Data flow (incoming)

```
                                            ┌─────────────┐
  Telegram update ───polling───►            │ telegramBot │
  Telegram update ───webhook───► /webhook ──►  (one)      │
                                            └──────┬──────┘
                                                   │ EventEmitter
                                       ┌───────────┼───────────────────┐
                                       ▼           ▼                   ▼
                              in-node          command-node       event-node
                              (message)        (message-filtered) (callback_query etc.)
                                       │           │                   │
                                       ▼           ▼                   ▼
                              converter.convertMessage / getMessageDetails
                                       │           │                   │
                                       ▼           ▼                   ▼
                              node.send(msg)   node.send([msg,null])  node.send(msg)
```

## Data flow (outgoing)

```
                          msg arrives on out-node input
                                       │
                                       ▼
                         enqueueMessage(chatId, msg, ...)
                                       │
                                       ▼
                         QueueManager.enqueue(chatId, func)
                                       │
                                       ▼
                         processMessage(chatId, msg, ...)
                              │
                              ▼ switch on msg.payload.type
                         telegramBot.sendXxx(...)
                              │
                              ▼ .catch / .then
                         processError(...) — retry on 429/ENOTFOUND/ECONNRESET
                         processResult(...)   — emit msg + processNext(chatId)
```

## Boundary expressions

Three config fields are *interpreted* rather than taken literally — token, usernames, chatids. The grammar is a single whitelisted form: `{<scope>(.<sub>)?.<method>(<string-args>)}` where:

- `scope` ∈ `flow` | `global` | `context` | `env`
- `sub` (optional) ∈ `flow` | `global` (only on `context`)
- `method` ∈ `get` | `keys`
- `args` are comma-separated single/double-quoted string literals

Anything else evaluates to `undefined`. The parser is two ~30-line functions at the top of `bot-node.js`; see [ADR 0004](adr/0004-safe-expression-evaluator.md).

## What this layout achieves — and what it doesn't

Achieves:

- Clear ownership: one config node per bot, runtime nodes are stateless w.r.t. transport.
- Plug-in style: adding a new node type is a single file in `nodes/` + a `registerType` line in `99-telegrambot.js`.
- Shared helpers (`converter`, `queue-manager`, `safe-stringify`) are pure / single-purpose and reusable.

Doesn't:

- The sender's per-type switch is monolithic (~50 cases, 984 LOC) — see [recommendations-for-refactoring.md](recommendations-for-refactoring.md).
- The config node is also monolithic (1049 LOC) — token expr evaluator, agent setup, three transport modes, polling restart, command registry, status broadcasting all live in one constructor.
- Module-level state (`botsByToken`) survives flow redeploys, which can cause "token already in use" false positives in rare edit-restart sequences.

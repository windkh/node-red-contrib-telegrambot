# Behavioural Design

This document describes what happens at runtime. It complements the static view in [structural-design.md](structural-design.md).

## Bot lifecycle (config node)

```
                ┌─────────────────┐
                │   constructed   │ — token validated against botsByToken
                └────────┬────────┘
                         │ getTelegramBot() called by first runtime node
                         ▼
                ┌─────────────────┐
                │   connecting    │ — createTelegramBot()
                └────────┬────────┘
                         │ webhook setWebHook resolves | polling start
                         ▼
                ┌─────────────────┐
                │    connected    │ — setStatus('started', ...) broadcast
                └────────┬────────┘
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
 polling_error    fatal 'error'         this.on('close')
       │              event              from Node-RED
       │                 │                 │
       │ restartPolling  │                 │ removed=true → drop
       │   after 3s      │                 │    from botsByToken
       │ (no backoff,    │                 ▼
       │  no guard)      │            disconnecting
       │                 │                 │
       │                 ▼                 ▼
       │           abortBot()        abortBot('closing', done)
       │                 │                 │
       │                 ▼                 ▼
       │           disconnected      disconnected
       │           (no resume)       (done() called)
       └────────────► retry loop
```

Three transport modes are picked at construction by `this.updateMode`:

- `webhook` — opens an `https` listener on `localBotPort`, registers the public URL via `setWebHook`.
- `polling` — creates an `EventEmitter`-driven long-poll loop with `pollInterval` ms gap and `pollTimeout` long-poll seconds.
- `send only` — no listener, no polling; the bot can only push (used when neither mode is fully configured).

Polling errors are caught by `bot.on('polling_error', ...)` and recovered via `stopPolling({cancel:true}).then(restartPolling)`. Fatal errors caught by `bot.on('error', ...)` call `abortBot` and **do not auto-restart** — this is currently the largest single behavioural weakness; see [errors-and-weaknesses.md](errors-and-weaknesses.md).

## Status broadcast and listener attach

Every runtime node subscribes to `config.addListener('status', ...)` at construction. The config node calls `setStatus('started'|'stopped'|'info'|'error', ...)` which `emit`s on itself. Runtime nodes then call their own `start()` / `stop()` in response.

`start()` is the one place where a runtime node attaches its listeners to the bot's EventEmitter. It also pushes each `{event, handler}` pair into `node.attachedListeners[]` so that `stop()` can detach exactly its own handlers, not every listener for the event (see [ADR 0005](adr/0005-listener-handle-tracking.md)).

## Incoming message dispatch

A single Telegram update is fan-out by the bot's EventEmitter to all interested nodes:

1. **`in-node`** subscribes to `'message'` and (optionally) every other update type when `handleAllUpdates` is set. Drops to authorized-output-1 if `isAuthorized`, otherwise to unauthorized-output-2. If the update is a "blob" (photo / audio / document / sticker / video / voice), it resolves a download URL (`getFileLink`) and optionally writes the bytes to `saveDataDir` before emitting.
2. **`command-node`** also subscribes to `'message'` for the same update. It parses the first token, optionally compiles `command` as a `RegExp`, and matches against `commandToken`. On match, output-1 receives the message with `command` stripped from the text; the matched `(username, chatId, command)` triple is then stored in `pendingCommands` so any **following** message from the same user goes out output-2 as the "response" to that command. The pending state is cleared once that response fires.
3. **`event-node`** subscribes to a *single* non-message event (`callback_query`, `poll`, `my_chat_member`, etc.). For `callback_query` with `autoAnswerCallback`, it calls `answerCallbackQuery` before emitting.
4. **`reply-node`** uses `bot.onReplyToMessage(chatId, messageId, cb)` to capture **one** reply to a specific previously sent message. The listener ID is tracked so `close` can remove it (V17.3.0 fix).

The same Telegram update can therefore fan out to multiple node outputs simultaneously.

## Outgoing message flow (sender)

```
on('input', msg)
      │
      ▼
isArray(msg.payload.chatId)? — fan out, clone msg per chatId
      │
      ▼
enqueueMessage(chatId, msg, nodeSend, nodeDone)
      │
      ▼ QueueManager.enqueue
      ▼
processMessage(chatId, msg, ...)
      │
      ▼ switch on msg.payload.type (or msg.payload.forward / .copy / .download / .getfile)
      ▼
telegramBot.sendXxx(args)
      │
      ▼ .catch
      ▼            ┌───────────────────────────┐
processError ─────►│ retry  on 429 / ENOTFOUND │
      │           │ ECONNRESET — queueManager   │
      │           │ .repeatProcessMessage       │
      │           └───────────────────────────┘
      ▼ .then
processResult
      │
      ▼ nodeSend(msg) — payload now contains result + sentMessageId
      ▼ nodeDone()
      ▼ queueManager.processNext(chatId) — release the head, run next
```

Important shapes:

- **Chunking**: `'message'` types longer than 4000 chars are sent as a sequential chain (since V17.3.0 — see [ADR 0008](adr/0008-sequential-chunked-send.md)). Only the *final* chunk's result triggers `processResult`. The previous parallel-send was a critical bug.
- **Markdown fallback**: on a `can't parse entities` error, the chunk retries with `parse_mode` removed and the fallback persists for subsequent chunks of the same message.
- **Fan-out**: `msg.payload.chatId` as an array clones the message via `RED.util.cloneMessage` and enqueues one per chat. Per-chat queues run in parallel.

## Command registration with Telegram

On `RED.events.on('flows:started')`, the config node calls:

1. `deleteMyCommands` for every scope (`default`, `all_private_chats`, `all_group_chats`, `all_chat_administrators`) — clears stale commands.
2. `setMyCommands` for every (`scope`, `language`) combination present in the registry.

This is why `command-node` instances register themselves on `start()` and unregister on `close()` (`registerCommand` / `unregisterCommand` on the config node).

## Token-expression evaluation

The `token`, `usernames` and `chatids` config fields accept a small expression syntax wrapped in `{...}`:

- `{flow.get("key")}` / `{global.get("key")}` / `{context.get("key")}`
- `{context.flow.get("key")}` / `{context.global.get("key")}`
- `{env.get("VAR")}`
- `{flow.keys()}` / `{global.keys()}` / `{context.keys()}`

Resolved lazily at the point of use (each token / username / chatid read). The parser is whitelist-based and rejects anything outside the grammar (see [ADR 0004](adr/0004-safe-expression-evaluator.md)). Since 17.3.1, raw string results from `env.get` are split on commas for `usernames` / `chatids`.

## Authorization

`config.isAuthorized(node, chatid, userid, username)` returns true if:

- both `usernames` and `chatids` config fields are empty (default = open), OR
- the caller's `username` is in `getUserNames()`, OR
- the caller's `chatid` is in `getChatIds()`, OR
- the caller's `userid` is in `getChatIds()` (yes, the same list — historical).

`in-node`, `event-node` and (since 17.3.1) `command-node` short-circuit the check with `isAnonymous || isAuthorized(...)` so channel posts and anonymous-admin commands don't crash on the missing `botMsg.from`.

## Concurrency model

Single-threaded, event-loop driven. The only "concurrency" comes from:

- Multiple outstanding HTTP requests sharing one `http.Agent` (or `SocksProxyAgent`).
- Multiple `setTimeout`s in flight (one per `restartPolling` scheduled — currently unguarded, see [errors-and-weaknesses.md](errors-and-weaknesses.md)).
- Multiple per-chat queues in `QueueManager` advancing independently.

No worker threads. No `Promise.all` fan-outs that could blow memory on large `msg.payload.chatId` arrays — each chat goes through its own queue.

## Shutdown sequence

On `this.on('close', ...)`:

1. Each runtime node calls `node.stop()`, which detaches its tracked listeners and clears its node-local state.
2. The config node:
   - Removes its `flows:started` listener.
   - Drops itself from `botsByToken` (only if `removed === true`).
   - Calls `abortBot('closing', done)` which awaits `stopPolling({cancel:true})` (polling) or `deleteWebHook().then(closeWebHook)` (webhook) before invoking `done`.

If `stopPolling` or `closeWebHook` hangs, `done` never fires and Node-RED's stop sequence stalls until its 15-second close timeout. This is the source of the historical "Error stopping node: Close timed out" messages (see issue #411).

# ADR 0003 — Per-`chatId` FIFO queue for outbound messages

## Status
Accepted. Queue manager class `lib/queue-manager.js`.

## Context

Telegram enforces rate limits per chat (≈20 messages / minute / chat). The Bot API surfaces violations as HTTP 429 with a `retry_after` parameter. If we send messages to the same chat in parallel, three things go wrong:

1. **Order is lost** — Telegram may interleave the responses.
2. **Bursts trigger 429s** — flooding a single chat is cheap to do from a Node-RED `Inject` node attached to a fan-out.
3. **Retry coordination is impossible** — if message A fails with 429 and B has already been dispatched, B may have arrived before A even gets retried.

At the same time, parallelism *across* chats is desirable — there is no global rate limit that we need to enforce serially.

## Decision

Maintain one FIFO per `chatId`:

```js
class QueueManager {
    constructor() {
        this.queues = new Map();      // chatId -> [func, func, ...]
        this.processing = new Map();  // chatId -> boolean
    }
    enqueue(chatId, func)            { /* append + autostart head */ }
    processCurrent(chatId)           { /* invoke head; on sync throw, defer next via setImmediate */ }
    processNext(chatId)              { /* shift head, run next */ }
    repeatProcessMessage(chatId, s)  { /* setTimeout: re-run current after delay (for 429) */ }
}
```

The sender's `enqueueMessage` pushes a thunk that calls `processMessage(chatId, msg, nodeSend, nodeDone)`. `processMessage` invokes the bot method, then `processResult` calls `processNext(chatId)` to release the head. Different chats advance independently.

`processError` recognises three retryable error shapes (429 / `ENOTFOUND` / `ECONNRESET`) and uses `repeatProcessMessage` to schedule a re-run of the head after the API-supplied or default delay.

## Consequences

- **Order is preserved per chat** without serialising all outbound traffic globally.
- **Retry is correct** — the failed message stays at the head until it succeeds (or hits the non-retryable path).
- **Sync-throw resilience** — added in V17.3.0 (`dbb6121`, refined to `setImmediate` in `772c41b`). Without the `try/catch`, a sync exception in `func` would leave `processing=true` and never shift the head, silently stalling every message for that chat.
- **No backpressure across chats** — the queue manager doesn't cap memory; a producer that floods every chat ID would grow unbounded. In practice flows that need that level of fan-out are rare.
- **Single consumer**: only the sender node uses `QueueManager`. Other outbound paths (`reply`, `event` `answerCallbackQuery`, `control` `sendToAllCommandNodes`) bypass it. This is deliberate — those paths don't need rate-limit retries.
- **Bug source**: every place that *opens* a promise chain inside the queue is responsible for closing it with `processNext`. The audio case in 16.x silently skipped this, stalling the audio chat permanently — see V17.3.0 commit `a99c0f9`.

# ADR 0008 — Chunked long-message sends are sequential, single result

## Status
Accepted. Landed in V17.3.0 (commit `e8ea1e7`).

## Context

The Telegram Bot API caps a single `sendMessage` text payload at 4096 characters. The sender node has long supported messages larger than that by splitting them at 4000 chars and emitting each chunk as its own `sendMessage` call.

Until V17.2.x the chunking used a synchronous `do...while` loop:

```js
let done = false;
do {
    let messageToSend = message.length > chunkSize
        ? message.substr(0, chunkSize)
        : (done = true, message);
    message = message.substr(chunkSize);
    telegramBot.sendMessage(chatId, messageToSend, opts)
        .then(result => node.processResult(chatId, result, msg, nodeSend, nodeDone))
        .catch(...);
} while (!done);
```

Every iteration of the loop dispatched a fresh promise chain. The loop body is synchronous, so all chunks are fired back-to-back without awaiting. For an N-chunk message:

- **`processResult` runs N times** → `nodeDone()` is called N times (Node-RED's contract says exactly once), and `messagesProcessed` is incremented N times.
- **`queueManager.processNext(chatId)` is called N times** → the per-chat queue dequeues and starts the next N-1 messages prematurely, while chunks 2..N for the *current* message are still in flight.
- **Chunks send in parallel to Telegram**, which can re-order them in the destination chat.
- **The Markdown→plain `parse_mode` fallback** inside the catch was nested with its own `processResult`/`processError`, multiplying the chaos.

This is the kind of bug that hides easily because most messages aren't long enough to chunk, and the visible artefacts ("queue stuck" / "out-of-order chunks") look like Telegram-side problems.

## Decision

Replace the `do...while` with a single recursive promise chain that sends chunks **sequentially** and only emits `processResult` / `processError` **once per original message**:

```js
const sendChunks = function (remaining) {
    const isLast = remaining.length <= chunkSize;
    const chunkText = isLast ? remaining : remaining.substr(0, chunkSize);
    const rest = isLast ? '' : remaining.substr(chunkSize);
    return telegramBot
        .sendMessage(chatId, chunkText, msg.payload.options || {})
        .catch(function (err) {
            // Markdown -> plain fallback for this chunk; propagates to outer catch otherwise.
            let next;
            const isMarkdownParseError = String(err).includes("can't parse entities in message text:") &&
                                         msg.payload.options &&
                                         msg.payload.options.parse_mode === 'Markdown';
            if (isMarkdownParseError) {
                delete msg.payload.options.parse_mode;
                next = telegramBot.sendMessage(chatId, chunkText, msg.payload.options || {});
            } else {
                next = Promise.reject(err);
            }
            return next;
        })
        .then(function (result) {
            return isLast ? result : sendChunks(rest);
        });
};
sendChunks(msg.payload.content)
    .then(function (result) { node.processResult(chatId, result, msg, nodeSend, nodeDone); })
    .catch(function (err)   { node.processError(chatId, err, msg, nodeSend, nodeDone); });
```

The Markdown→plain fallback mutates `msg.payload.options.parse_mode` *once*, so subsequent chunks inherit the fallback rather than each independently triggering the same retry.

## Consequences

- **Telegram receives chunks in order.**
- **Node-RED contract honoured**: `nodeDone()` is called exactly once, `messagesProcessed` increments by one, `processNext(chatId)` releases the per-chat queue exactly once.
- **Errors abort the rest of the message** (`Promise.reject(err)` from the inner catch propagates out, the outer `processError` fires once).
- **Recursion depth equals number of chunks** — a 100 KB message produces 25 recursive `.then` frames. Stack depth is bounded and fine.
- **Markdown fallback semantics changed slightly**: previously each chunk retried independently; now once we fall back to plain mode, we stay there for the rest of the message. This is more predictable and matches user expectation.
- **Pattern applies to other "loop a Telegram method" cases** if any are ever added — the same recursive-`.then` shape is the canonical answer for "send a list of N requests in order, with single result".

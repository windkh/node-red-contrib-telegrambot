# ADR 0005 — Track each node's own listener references

## Status
Accepted. Landed in V17.3.0 (commit `f419a59`).

## Context

`node-telegram-bot-api` uses `eventemitter3` under the hood, not Node.js's built-in `EventEmitter`. The two libraries differ on one important detail:

| Library | `emitter.off(eventName)` (no handler) |
|--------|------------------------------------|
| Node `EventEmitter` | Throws `TypeError: listener must be a function` |
| `eventemitter3` | Removes **every** listener registered for that event |

The previous code in `in-node` / `event-node` / `command-node` used the no-handler form:

```js
this.stop = function () {
    let telegramBot = this.config.getTelegramBot(false);
    if (telegramBot) {
        telegramBot.off('message');     // removes EVERY 'message' listener
    }
    ...
};
```

Because the bot's `EventEmitter` is shared via the config node, every receiver / event / command node attached to the same bot subscribes to the same emitter. Stopping one of them silently deafened all the others. This is the root cause of issue #411 ("Command node stops responding after period of time") — any redeploy or restart of a sibling node took the surviving ones with it.

## Decision

Each runtime node tracks the *handler reference* it registered, and detaches by reference:

```js
// in-node tracks an array (one listener per event type it cares about)
node.attachedListeners = [];

// command-node and event-node track a single handler each
node.messageHandler = null;
node.eventHandler = null;
```

`start()` pushes each `{event, handler}` pair (or assigns the single handler); `stop()` iterates and calls `telegramBot.off(event, handler)` — removing only this node's own subscription.

`reply-node` follows the same pattern with the listener IDs returned from `onReplyToMessage`, captured into `pendingReplyListenerIds: Set` and removed via `removeReplyListener(id)` on close.

## Consequences

- **Cross-node correctness**: stopping or redeploying one node no longer deafens its siblings.
- **No more leaks on redeploy**: each redeploy cleanly detaches its own listeners, regardless of how many other nodes share the bot.
- **The `update` listener leak is plugged**: `in-node`'s optional `handleProcessUpdates` branch used to register `bot.on('update', ...)` but the original `stop()` only detached `'message'` and the optional `events[]` list, leaving `update` accumulating forever.
- **Each call to `start()` must be balanced by exactly one `stop()`** — otherwise `attachedListeners[]` accumulates duplicates. Today the call sites guarantee this; any future refactor that calls `start()` twice without an intervening `stop()` will need to add an "already started" guard.

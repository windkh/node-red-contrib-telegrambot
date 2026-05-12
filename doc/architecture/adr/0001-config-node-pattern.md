# ADR 0001 — Config-node-plus-runtime-node split

## Status
Accepted. In place since the very first version of the project (2016).

## Context

A Telegram bot is identified by a single secret token. The Bot API allows only one active connection per token (one polling client *or* one webhook URL). At the same time, a Node-RED user typically wants several flow nodes per bot — one for receiving messages, several for sending messages to different chats, command handlers, etc.

The Node-RED programming model offers two kinds of nodes:
- **Config nodes**, which are singleton-ish, configured once in a dialog, and referenced by many runtime nodes by ID.
- **Runtime nodes**, which appear on the flow canvas and have inputs / outputs.

## Decision

Model one bot as **one config node** (`telegram bot`) plus **N runtime nodes** that reference it. The config node:

- Owns the only `node-telegram-bot-api` instance.
- Owns the `http.Agent` (or `SocksProxyAgent`).
- Owns the command registry pushed to Telegram via `setMyCommands`.
- Owns the `botsByToken` registration entry that prevents two config nodes from competing for the same token.
- Emits a `'status'` event that runtime nodes listen on for `started` / `stopped` / `info` / `error` transitions.

Runtime nodes (`receiver`, `sender`, `command`, `event`, `reply`, `control`) hold *only* node-local state and reach the bot via `this.config.getTelegramBot()`.

## Consequences

- **Correct by construction**: a single token → single polling/webhook connection. No two runtime nodes can accidentally fight for the connection.
- **Listener fan-out is cheap**: the bot is an `EventEmitter`; multiple runtime nodes can subscribe to `'message'` without HTTP cost.
- **Shared state is centralized**: all transport / auth / queue state lives in one file, easier to reason about (and to fix — see ADRs 0005, 0007, 0008).
- **The config node becomes large**: ~1050 LOC today. Splitting further would help readability but would also fragment the lifecycle code — deferred.
- **Cross-runtime-node coordination is via the config node's emitter, not directly**: runtime nodes never reach into each other. This is intentional and worth preserving in any future refactor.

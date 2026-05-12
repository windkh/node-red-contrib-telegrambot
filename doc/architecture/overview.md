# Overview

## What this is

`node-red-contrib-telegrambot` is a Node-RED plugin that exposes the Telegram Bot API as a set of flow-graph nodes. It lets Node-RED users build chat-driven automations (incoming messages, commands, callback queries, polls, payments, etc.) without writing JavaScript against the underlying HTTP API.

The project has been in continuous development since January 2016 (583 commits as of this snapshot). The current release is **V17.3.1**.

## Runtime model

The plugin runs **inside a single Node-RED process** as one of many installed contrib packages. It has no daemon, no separate worker, no IPC. Everything happens in the Node-RED event loop:

- A **config node** (`telegram bot`) holds the bot token, transport choice (polling / webhook / send-only), proxy settings, and an `http.Agent` (or `SocksProxyAgent`).
- Each runtime node (`receiver`, `sender`, `command`, `event`, `reply`, `control`) attaches to one config node and either subscribes to bot events or invokes bot methods.
- Telegram updates are pulled via long-poll **or** pushed to a built-in `https` listener (webhook mode).
- Outbound traffic is funnelled through a per-chat queue so messages to the same chat preserve order, while different chats run in parallel.

## Technology stack

| Layer | Choice | Notes |
|------|--------|------|
| Runtime | Node.js `>=14` | engines floor matches `socks-proxy-agent@8`'s requirement |
| Host platform | Node-RED `>=1.3.7` | declared in `package.json` |
| Telegram client | `node-telegram-bot-api@^0.66.0` | uses legacy `request@2.88.2` + `@cypress/request` transitively |
| Proxying | `socks-proxy-agent@^8.0.3` | optional; SOCKS4 / SOCKS4a / SOCKS5 |
| Promise extras | `bluebird@^3.7.2` | cancellation support enabled by `99-telegrambot.js` |
| Lint / format | ESLint 8, Prettier 2 | `quotes: warn` / `prettier: error` |

3 runtime dependencies, 5 dev dependencies; **218 packages** in the resolved `node_modules` tree.

## Package layout

```
telegrambot/
  99-telegrambot.js          (40 LOC)    entry — registers node types with Node-RED
  lib/
    converter.js             (756 LOC)   Telegram update -> node msg.payload mapping
    queue-manager.js         (80 LOC)    per-chatId FIFO with retry support
    safe-stringify.js        (15 LOC)    JSON.stringify with [Circular] tolerance
  nodes/
    bot-node.js              (1049 LOC)  config node, lifecycle, polling / webhook
    in-node.js               (311 LOC)   receiver, blob download, external-webhook input
    out-node.js              (984 LOC)   sender, per-type switch (~50 cases), queue
    command-node.js          (280 LOC)   /command routing + response capture
    event-node.js            (233 LOC)   non-message updates (callback_query, polls...)
    reply-node.js            (148 LOC)   onReplyToMessage capture
    control-node.js          (260 LOC)   start / stop / restart of the bot
examples/                                49 sample flows shipped with the package
doc/architecture/                        this documentation set
```

Total **4,156 LOC** of plugin code (excluding `node_modules`).

## Trust model

Two relevant boundaries:

1. **Editor-trusted**: anyone who can edit flows in Node-RED is implicitly trusted with bot config (token, allowlists, command regexes, etc.). Several config fields evaluate small expressions (`{flow.get(...)}`, `{env.get(...)}`) — the parser is whitelist-based (see ADR 0004).
2. **Telegram-untrusted**: incoming bot messages are treated as untrusted input. They are mapped into `msg.payload` by `converter.js` but never `eval`'d, never passed to `RegExp` constructors, never used as filesystem paths or method names on the bot instance.

## Distribution

Published to npm as `node-red-contrib-telegrambot`. Installed via Node-RED's palette manager. Releases are tagged `V<MAJOR>.<MINOR>.<PATCH>` on GitHub.

## Out of scope

- No tests are shipped — see [statistics.md](statistics.md). Test infrastructure is one of the highest-leverage future improvements ([recommendations-for-refactoring.md](recommendations-for-refactoring.md)).
- No TypeScript types are exposed.
- No separate worker process for downloads / heavy I/O — everything runs in the Node-RED main loop.

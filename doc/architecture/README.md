# Architecture documentation

This folder holds the architecture-level analysis of `node-red-contrib-telegrambot`. Code-level documentation lives in JSDoc comments inside the source.

## Chapters

| File | Purpose |
|------|--------|
| [overview.md](overview.md) | What this is, runtime model, technology stack, package layout |
| [structural-design.md](structural-design.md) | Module decomposition, the 7 node types, shared libraries, data flow |
| [behavioural-design.md](behavioural-design.md) | Bot lifecycle, incoming dispatch, outgoing queue, concurrency model |
| [architecture-decisions.md](architecture-decisions.md) | Index of all ADRs and the format used |
| [errors-and-weaknesses.md](errors-and-weaknesses.md) | Outstanding and resolved weaknesses with commit references |
| [recommendations-for-refactoring.md](recommendations-for-refactoring.md) | Ranked backlog of refactors with effort + benefit notes |
| [future-improvements.md](future-improvements.md) | Larger feature / rearchitecture directions |
| [statistics.md](statistics.md) | LOC, complexity proxy, test coverage, dependencies, activity |

## ADRs

One markdown file per Architecture Decision Record in [`adr/`](adr/):

| ID | Title |
|----|------|
| [0001](adr/0001-config-node-pattern.md) | Config-node-plus-runtime-node split |
| [0002](adr/0002-node-telegram-bot-api-transport.md) | Use `node-telegram-bot-api` as the transport |
| [0003](adr/0003-per-chat-message-queue.md) | Per-`chatId` FIFO queue for outbound messages |
| [0004](adr/0004-safe-expression-evaluator.md) | Whitelist parser replaces `eval()` |
| [0005](adr/0005-listener-handle-tracking.md) | Track each node's own listener references |
| [0006](adr/0006-tough-cookie-override.md) | npm `overrides` to force safe `tough-cookie` transitively |
| [0007](adr/0007-no-credential-leakage-in-logs.md) | Bot token must never reach logs or status text |
| [0008](adr/0008-sequential-chunked-send.md) | Chunked long-message sends are sequential, single result |
| [0009](adr/0009-single-return-style.md) | New functions use a single `return` at the end |

## How to keep this up to date

- When you add a non-trivial design decision, write an ADR alongside the code change.
- When you fix something listed in [errors-and-weaknesses.md](errors-and-weaknesses.md), move it from "Outstanding" to "Resolved" with the commit ref.
- When you finish an item from [recommendations-for-refactoring.md](recommendations-for-refactoring.md), drop it from the list.
- [statistics.md](statistics.md) is a snapshot, not auto-generated — refresh it on each minor release.

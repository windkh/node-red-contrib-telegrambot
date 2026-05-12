# Architecture Decisions

This file is the index. Each decision is recorded as a separate ADR in [`adr/`](adr/), one Markdown file per decision, using a lightweight Michael-Nygard-inspired format:

- **Title** — short noun phrase.
- **Status** — `Accepted`, `Superseded by ADR-XXXX`, `Deprecated`.
- **Context** — what made the decision necessary; what alternatives were considered.
- **Decision** — what was actually decided.
- **Consequences** — what follows from the decision (good, bad, otherwise).

## Index

| ID | Title | Status |
|----|------|--------|
| [0001](adr/0001-config-node-pattern.md) | Config-node-plus-runtime-node split | Accepted |
| [0002](adr/0002-node-telegram-bot-api-transport.md) | Use `node-telegram-bot-api` as the transport | Accepted |
| [0003](adr/0003-per-chat-message-queue.md) | Per-`chatId` FIFO queue for outbound messages | Accepted |
| [0004](adr/0004-safe-expression-evaluator.md) | Whitelist parser replaces `eval()` for token / usernames / chatids | Accepted (V17.2.0) |
| [0005](adr/0005-listener-handle-tracking.md) | Track each node's own listener references | Accepted (V17.3.0) |
| [0006](adr/0006-tough-cookie-override.md) | npm `overrides` to force safe `tough-cookie` transitively | Accepted (V17.3.1) |
| [0007](adr/0007-no-credential-leakage-in-logs.md) | Bot token must never reach logs or status text | Accepted (V17.2.0 onwards) |
| [0008](adr/0008-sequential-chunked-send.md) | Chunked long-message sends are sequential, single result | Accepted (V17.3.0) |
| [0009](adr/0009-single-return-style.md) | New functions use a single `return` at the end | Accepted |

## How to add a new ADR

1. Copy the most recent ADR file in `adr/` as the template.
2. Number it sequentially (`NNNN-short-slug.md`).
3. Update this index table.
4. Commit the ADR alongside the code that implements (or supersedes) the decision.

## Why ADRs, not a single design doc

The project has grown over ~10 years and 583 commits. The "current" design is partly the result of decisions that are no longer obviously visible in the code (e.g., why `safeStringify` exists, why a whitelist parser instead of a sandboxed `eval`, why `tough-cookie` is pinned via npm `overrides`). Each ADR captures one such decision in isolation so a future reader can reconstruct *why* without having to read the issue tracker.

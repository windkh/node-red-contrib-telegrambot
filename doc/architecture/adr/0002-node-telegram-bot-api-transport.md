# ADR 0002 — Use `node-telegram-bot-api` as the transport

## Status
Accepted. In place since project inception.

## Context

The Telegram Bot API is a JSON-over-HTTPS protocol. We need a client library that:

- Implements all (or substantially all) Bot API methods.
- Supports both polling (`getUpdates`) and webhooks.
- Handles long-poll, multipart file uploads, and large response payloads.
- Provides an `EventEmitter`-style dispatch for incoming updates.

Available options at the time the project started:
- `node-telegram-bot-api` (Yago Pérez) — full coverage, active community, EventEmitter-based.
- Hand-rolled HTTP — full control, large maintenance cost.

## Decision

Adopt `node-telegram-bot-api` as the sole transport. Track it via a `^0.66.0` caret range so we pick up upstream fixes within the same minor.

A few small monkey-patches are applied at import time in `bot-node.js`:

- A subclass of `tgbe.BaseError` named `FatalError` is installed in place of the upstream one. Its sole purpose is to attach `this.cause = error` so the underlying cause survives serialization (upstream still loses it as of 0.66.0). The error code is `'SLIGHTLYBETTEREFATAL'` to make patched errors recognisable in logs.
- A subclass `telegramBotEx` extends `TelegramBot` to emit `'getUpdates_start'` / `'getUpdates_end'` events for the control node's polling-cycle dashboard.
- A subclass `telegramBotWebHookEx` extends `TelegramBotWebHook` to log the listening host/port via `RED.log.info`.

## Consequences

- **Comprehensive coverage** of the Bot API without us shipping the surface ourselves.
- **Carries the legacy `request` stack transitively**: `node-telegram-bot-api → @cypress/request-promise → request-promise-core` peer-depends on `request@^2.34`, which pulls in deprecated `request@2.88.2` and historically pinned a vulnerable `tough-cookie@~2.5.0`. See [ADR 0006](0006-tough-cookie-override.md) for the workaround.
- **Subclassing internal classes is brittle** — references to `_polling` and `_webHook` privates have caused upgrade churn (see commits `df46aa0`, `b3362a8`). 17.3.0 cleaned most of these out.
- **No first-class TypeScript types**. We type-document via JSDoc-style comments only.
- **Migration cost** if we ever switch transports would be substantial — the entire sender's per-type switch and most error-handling assumes `node-telegram-bot-api`'s method names and error shapes.

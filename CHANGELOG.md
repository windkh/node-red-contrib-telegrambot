# Changelog
All notable changes to this project will be documented in this file.

# [17.4.13] - 2026-06-11
### Two related fixes for #442 that address the same wedge from different angles. petermeter69's 29 May log paste flipped the diagnosis: every entry during his 15-minute wedge was a `polling_error` event (3-line pattern: leaf message, RequestError dump, "Polling error --> Trying again."); zero `Bot error:` lines, zero `will restart in Xms` lines, zero `gave up restarting` lines. `scheduleRestart` — and with it the V17.4.5 per-bot agent-pool rebuild that was supposed to be the root-cause fix for this issue — was never called during the outage because the bot's `'error'` event listener doesn't fire on polling failures, only on a handful of webhook/event paths. The polling_error handler's recovery path (`stopPolling+restartPolling` on the same `_polling` instance) keeps the HTTP keep-alive agent pool intact, so a wedged pool with zombie sockets is never rebuilt, and many rapid overlapping stop/start cycles can wedge the lib's polling state machine on top of that.

### (1) Polling-burst circuit breaker — modelled on the existing 409-Conflict breaker. `POLLING_ERROR_THRESHOLD=5` polling errors within `POLLING_ERROR_WINDOW_MS=60000` trips an escalation from the cheap `restartPolling` to a full `scheduleRestart`, which abortBots the bot, `destroyRequestPool`s the agent pool, and constructs a fresh bot via `createTelegramBot`. The pool gets genuinely rebuilt on the polling code path for the first time. Transient single-event blips (petermeter69's first event on 27 May was 3 errors in 28 s — below threshold) stay on the cheap path; only sustained bursts escalate. `pollingErrorTimes` resets in `scheduleRestart`'s success path so the new bot starts with a clean window.

### (2) Remove the give-up cap on `scheduleRestart` — prerequisite for #1 to retry indefinitely under a sustained outage, and a fix in its own right. V17.4.12 and earlier capped at 8 attempts (~4.5 min) and then logged "Bot ... gave up restarting after fatal: ..." and returned permanently — leaving the operator with the same recourse as not retrying at all (manual redeploy) while removing every chance of automatic recovery when the network eventually came back. The helper now keeps retrying at the 60 s backoff ceiling forever; one `node.error` fires the first time the ceiling is reached (~90 s into a sustained outage, after the exponential ramp `3+6+12+24+48 ≈ 90s` is consumed) so the operator still gets one actionable alert without being spammed every minute. `restartCeilingAnnounced` clears in the stable-window callback so a future outage can re-raise the alert.

### Tests: 8 new mocha cases (3 for the give-up removal: init, no-permanent-give-up past attempt 8, exactly-one ceiling alert; 5 for the polling-burst breaker: init, threshold, reset, window pruning, in-window-only counting). 239 passing.

# [17.4.12] - 2026-05-23
### Drop Node 18 from the CI matrix and declare `engines: { node: ">=20.0.0" }`. The V17.4.11 uuid override pulled in `uuid@14.0.0`, which is ESM-only (the package shipped pure-ESM starting from uuid 12). Loading it from CommonJS requires Node's `require(esm)` feature, which is available unflagged on Node 20.17+ / Node 22+ but throws `ERR_REQUIRE_ESM` on Node 18 — the load failure inside `@cypress/request/lib/auth.js`'s `require('uuid')` cascades into `@cypress/request-promise`'s misleading "request library is not installed" banner and breaks every test that constructs a bot (76 failures on the Node 18 CI leg of the V17.4.11 commit). Node 18 reached EOL 2025-04-30; the cleanest fix is to formalise dropping it. CI matrix now `[20.x, 22.x]`. Coverage job already targets Node 20. No code changes; downstream impact on users is limited to those who haven't yet migrated from Node 18.

# [17.4.11] - 2026-05-23
### Override uuid to ^14.0.0 to clear the latest uuid security advisory. Same shape as V17.4.10 / V17.4.9 / V17.3.1: two competing transitive pins (`@cypress/request@3.0.1` requires `uuid@^8.3.2`; the legacy phantom `request@2.88.2` requires `uuid@^3.3.2`) can't reach the patched 14.x line via normal semver resolution. Verified safe before applying: the only runtime caller is `@cypress/request` which uses the modern `require('uuid').v4` named-export form (works in uuid 7-14+); the legacy `request@2.88.2` uses `require('uuid/v4')` (removed in uuid 9.0.0) but is never `require()`'d at runtime — `@cypress/request-promise/lib/rp.js:11` redirects every promise call into `@cypress/request` instead. 232 tests pass including the integration suite that exercises the live polling/sending/webhook transports against a mocked Telegram API.

# [17.4.10] - 2026-05-23
### Override serialize-javascript to ^7.0.5 to clear the latest serialize-javascript security advisory. Same shape as V17.4.9's qs override and V17.3.1's tough-cookie override: mocha@10.8.2 (and even mocha@11.7.6, the latest stable) pin `serialize-javascript@^6.0.2` via caret, which cannot reach the patched 7.0.5 line. Dependabot logged `security_update_not_possible`. Forcing one version via `overrides` resolves it; 232 tests still pass with serialize-javascript 7.0.5 under mocha 10.8.2 (mocha uses it only for parallel-test-reporter result serialisation, a stable API surface across the 6→7 jump). Also publishes through the npm publish path repaired after the token refresh on 2026-05-23, restoring the `latest` dist-tag to the newest version (17.4.8 had taken it as a side-effect of the V17.4.7/V17.4.8 backfill reruns happening after V17.4.9 had already published).

# [17.4.9] - 2026-05-23
### Override qs to ^6.15.2 to clear the latest qs security advisories. Same shape as V17.3.1's tough-cookie override (GHSA-72xf-g2v4-qvf3): the vulnerable copy is pinned transitively (`@cypress/request@3.0.1` exact-pins `qs@6.10.4`), Dependabot can't resolve a single version that satisfies every constraint AND the security fix (6.15.2 is below several `~6.14.0` constraints from body-parser/express AND above @cypress/request's exact pin). Forcing one version via `overrides` cuts through the conflict. All six transitive paths now resolve to qs@6.15.2; 232 tests still pass.

# [17.4.8] - 2026-05-18
### Polling teardown actually halts the recursive _polling loop (#440, root-causes #441/#442/#411 too). Earlier versions of abortBot used stopPolling({cancel:true}), which the lib implements as `lastRequest.cancel(); return Promise.resolve()` — it cancels the HTTP request locally but does NOT set the polling instance's `_abort` flag. The polling loop inside node-telegram-bot-api is a recursive setTimeout chain inside `_polling()`'s `.finally()` block, and the ONLY thing that stops that chain is `_abort=true`, which only stopPolling({cancel:false}) sets. Result: every previous "stop polling" call left the old polling loop running in the background, racing with whatever the next bot construction set up. V17.4.4's `_polling = null` hack didn't help — the old instance was held alive by its own .finally() closure and kept making getUpdates against Telegram, which is exactly what triggered the persistent 409 Conflicts AtieshStaff reported on #440 after upgrading.

### abortBot and restartPolling both rewritten: cancel the in-flight `_lastRequest` directly (so the local socket closes immediately instead of waiting up to 10 s for Telegram's long-poll), then stopPolling({cancel:false}) to set _abort=true and wait for the loop to honour it. After that point the old polling is genuinely stopped and a new bot / new startPolling can begin without racing the previous one. Removes the V17.4.4 `_polling = null` reach into private API.

### Tests: 4 new mocha cases verifying abortBot calls `_lastRequest.cancel('abortBot')`, calls `stopPolling({cancel:false})`, completes the done callback even when stopPolling rejects, and tolerates missing/non-function .cancel on _lastRequest. 232 passing.

# [17.4.7] - 2026-05-18
### 409 Conflict circuit breaker on the polling path (#441). The V17.4.4 fix (skip our restart on 409 and let the library retry naturally) is correct for the *transient* same-process race where the conflict clears within seconds — but it loops forever when a *separate* bot instance (second Node-RED, forgotten Docker container, accidentally registered webhook) is actively polling the same token. chapapagit's logs from #441 captured exactly this shape: thousands of repeated 409s with no path back to working. New record409Conflict helper tracks 409 occurrences in a 30-second sliding window; if 10 fire within the window, the breaker trips, abortBot stops polling, and a single node.error logs an actionable message pointing the operator at getWebhookInfo + the likely causes. No auto-recovery — operator must fix the duplicate poller and redeploy. 5 new mocha cases cover threshold, reset, window pruning, and in-window-only counting.

# [17.4.6] - 2026-05-17
### Fix verbose-logging checkbox being silently ignored when the saved value is a string (#411 retest). bot-node.js stored `this.verbose = n.verboselogging` with no coercion; if flows.json carried the value as the *string* 'false' (which happens after some imports / hand edits / certain older Node-RED versions), it was truthy in JavaScript and every verbose-gated `self.warn` fired regardless of the UI checkbox state. New coerce `this.verbose = !!n.verboselogging && n.verboselogging !== 'false'` strictly distinguishes the unchecked / "false" / empty cases from the checked / "true" / "on" cases. 7 input cases now covered in tests.

# [17.4.5] - 2026-05-15
### Auto-restart now actually rebuilds the HTTP keep-alive socket pool (#442 root cause). Previously bot-node.js initialised this.request once at config-node construction with no `pool` field, which silently routed all bot traffic through @cypress/request's process-global agent pool. That meant scheduleRestart's abortBot+create cycle reused the same agent instance and the same half-dead keep-alive sockets, which matches petermeter69's reported "bot says polling, nothing flows, only manual redeploy recovers" symptom — the network was fine, the agent pool was wedged. Two changes: (a) this.request is now built from a new buildRequestOptions() that returns a fresh `pool: {}` per call and tracks it on this.requestPool. (b) scheduleRestart's success path destroys every agent in the previous pool via destroyRequestPool() and rebuilds this.request before re-creating the bot, so the new bot starts with a genuinely empty socket pool. Same treatment on node close so a redeploy doesn't leak sockets either. Comment at the rebuild site that previously claimed "a successful create rebuilds the http.Agent so a stale keep-alive pool is replaced" — aspirational, not actually true — corrected.

# [17.4.4] - 2026-05-15
### Fix 409 Conflict loop on redeploy/restart after a polling failure (#442). Two changes: (a) the polling_error handler now detects "ETELEGRAM: 409 Conflict" specifically and skips the stop+restartPolling chain, since calling our own restart on top of the library's natural retry actively perpetuates the conflict. (b) restartPolling resets self.telegramBot._polling to null before startPolling({restart:true}) so the library treats the next poll as a fresh boot — without this (since V17.3.0's df46aa0) the library kept enough internal state across restarts that the new getUpdates raced the previous one server-side. Reaches into the library's private API on purpose; the documented soft-restart wasn't sufficient.

# [17.4.3] - 2026-05-14
### "Bot error: ..." log line now surfaces leaf-level error messages instead of intermediate wrapper labels (#442 retest). Previously a TCP-level failure to Telegram's API showed as the unhelpful `Bot error: AggregateError`; the actual `connect ETIMEDOUT 149.154.166.110:443` (and the IPv6-side leaf too, if dual-stack failed) is now in the headline log line. New formatErrorChain helper walks the error.cause chain and any AggregateError.errors arrays down to the leaf messages, deduplicates, and joins with semicolons. Same handler change applied to the verbose polling_error log.

# [17.4.2] - 2026-05-14
### Auto-restart now requires 60 s of stability before declaring a restart "successful" and resetting the backoff counter (#442 retest). Previously restartCount was zeroed immediately on createTelegramBot returning a non-null bot — for persistent network problems (errors every few seconds) the helper oscillated at the minimum 3 s delay forever and never let the exponential curve escalate. A new error inside the stable window keeps the count climbing, so the bot now backs off properly through 6 s -> 12 s -> 24 s -> ... -> 60 s for sustained outages.

# [17.4.1] - 2026-05-13
### Suppress duplicate "Bot error: ..." warn lines during outage bursts (#411 retest): the bot library can emit 'error' many times in rapid succession during a network outage; the V17.4.0 auto-restart's single-flight collapsed the restart attempts but the warn line above it was logged unconditionally. Gate the warn on `!self.restartTimer` so the first error of a burst still logs and the rest stay silent until recovery. No behaviour change, just log volume.

# [17.4.0] - 2026-05-13
### Auto-restart on fatal bot 'error' event with exponential backoff (3 s, 6 s, ..., capped 60 s; surrender after 8 attempts). Resolves the long-standing "bot dies on fatal error, manual redeploy needed" pattern in #442 and the proxy-interruption recovery half of #440. The restart abortBot+create cycle rebuilds the http.Agent so stale keep-alive sockets are flushed.
### Single-flight guard on the polling-restart 3 s setTimeout. Burst polling_error events now queue at most one restart instead of stacking N parallel ones (the underlying cause of #442's "12 cycles in 3 minutes" pattern).
### Control node "setwebhook" command: msg.payload.command="setwebhook" with msg.payload.url forwards to bot.setWebHook for dynamic URL updates (issue #410). An empty url calls deleteWebHook. msg.payload.result on success, msg.error on failure.
### bot-node setMaxListeners cap bumped from 0 (unlimited, hides leaks) to 50 (covers realistic per-bot listener counts, still catches future regressions).
### New DEPLOYMENT.md documenting the credentialSecret pattern for automated / git-managed deployments — closes the docs half of #432.
### Architecture documentation set added under doc/architecture/ with 9 ADRs covering the major design decisions.
### Test infrastructure: full mocha + chai + c8 + node-red-node-test-helper harness via npm test. 204 tests, 70.6 % overall statement coverage. CI workflow runs lint + test on Node 18 / 20 / 22 on every push and PR.

# [17.3.1] - 2026-05-12
### Fix #432 (partial): getUserNames / getChatIds now split env.get / flow.get / global.get string results on commas, so a process env var like CHATIDS="123,456" resolves to [123, 456] instead of the raw string
### Override tough-cookie to ^4.1.3 to clear GHSA-72xf-g2v4-qvf3 (prototype pollution); the vulnerable copy comes in transitively via legacy request@2.88.2, pinned by node-telegram-bot-api -> @cypress/request-promise -> request-promise-core's peer dependency on request@^2.34. Dependabot could not auto-resolve this without an explicit override

# [17.3.0] - 2026-05-11
### Security: bot token no longer leaked in duplicate-token abort, polling 401 hint, or polling_error verbose util.inspect dump (token redacted before logging)
### Sender: long-message chunked sends now serialised through a single promise chain - earlier code dispatched every chunk in parallel and called nodeDone/processNext N times, corrupting the queue manager
### Sender: audio send now goes through processResult so the per-chat queue advances and messagesProcessed updates
### Sender: downloadFile gets a 60s hard timeout so a stalled CDN stream cannot leak the captured nodeDone
### Sender: sendInvoice guards against missing msg.payload.content (previously crashed at the JS level instead of warning)
### Receiver / event / command: each node now detaches only its own listener (eventemitter3 quirk where off(name) without a handler removed every listener for the event) and the 'update' listener leak in the receiver is plugged
### Reply: outstanding onReplyToMessage listeners are cleaned up on close; nodeDone is always called so Node-RED's in-flight tracking does not stall
### Control: restart command no longer double-sends the input msg; the pending restart timeout is cancellable on node close, supervisor uses clearInterval
### Command: botMsg.from is now resolved via the shared converter helper so anonymous-admin and channel-post commands no longer crash with "Cannot read properties of undefined"
### Converter: new_chat_members `user` field is now populated from the array (the singular new_chat_member field has been gone from Telegram for years); refunded_payment, paid_media and gift message subtypes are now surfaced; empty/missing photo arrays no longer crash the converter
### Bot: start() now also handles the never-started case so a control-node "start" on a fresh deploy actually creates the bot
### Bot: abortBot awaits deleteWebHook before closeWebHook so a redeploy with a different URL takes effect immediately; uses stopPolling({cancel:true}) instead of reaching into _polling._lastRequest; restartPolling drops its delete+null poke on _polling
### Bot: clearer error when webhook configuration is incomplete (lists which fields are missing and warns that the bot will not receive messages)
### Bot: webhook setWebHook success now broadcasts the started status so receiver / event / command nodes attach their listeners
### Bot: addressFamily only sets agent family for valid IPv4 / IPv6 values (4 or 6) instead of defaulting to 0
### Queue manager: synchronous throws no longer strand the chat (head is drained, advance is deferred via setImmediate to avoid stack growth on repeated throws)
### Refactor: safeStringify lifted into lib/safe-stringify.js and used by both sender and event nodes; the event-node previously called raw JSON.stringify and would throw on circular msg payloads
### Internal: stale upstream-patch notes refreshed against node-telegram-bot-api@0.66.0; obsolete NTBA_FIX_319 assignment removed (no longer consulted upstream)
### Thanks to @gtalusan for #435 (catch unhandled promise rejections) and #439 (fix infinite loop/resource exhaustion on disconnect)

# [17.2.0] - 2026-05-11
### Removed eval() from token/usernames/chatids fields - expressions are now parsed safely and only the documented context lookups (flow.get, global.get, context.get, context.flow.get, context.global.get, env.get, plus .keys()) are accepted
### Bumped engines.node from >=12.0.0 to >=14.0.0 to match socks-proxy-agent

# [17.1.3] - 2026-03-26
### receiver node can output raw updates now - [#433](https://github.com/windkh/node-red-contrib-telegrambot/discussions/433)

# [17.1.2] - 2026-03-15
### Improved control node and example - [#391](https://github.com/windkh/node-red-contrib-telegrambot/issues/391)

# [17.1.1] - 2026-03-14
### handling circular references - [#425](https://github.com/windkh/node-red-contrib-telegrambot/pull/425) 

# [17.1.0] - 2026-03-07
### Error 429 is handled using a retry now - [#413](https://github.com/windkh/node-red-contrib-telegrambot/issues/413)
### Message will be sent when connection is back - [#300](https://github.com/windkh/node-red-contrib-telegrambot/issues/300)
 
# [17.0.6] - 2026-03-04
### added setChatmemberTag - [#428](https://github.com/windkh/node-red-contrib-telegrambot/pull/428) 

# [17.0.5] - 2026-01-11
### fix typo - [#423](https://github.com/windkh/node-red-contrib-telegrambot/discussions/423) 

# [17.0.4] - 2026-01-11
### lint - [#422](https://github.com/windkh/node-red-contrib-telegrambot/discussions/422) 

# [17.0.3] - 2025-11-23
### fixed receiving events - [#416](https://github.com/windkh/node-red-contrib-telegrambot/discussions/416) 

# [17.0.2] - 2025-11-23
### added events to receiver node - [#420](https://github.com/windkh/node-red-contrib-telegrambot/discussions/420) 

# [17.0.1] - 2025-11-23
### added external input to receiver node - [#421](https://github.com/windkh/node-red-contrib-telegrambot/discussions/421) 

# [17.0.0] - 2025-11-22
### moved nodes to separate files in order to be able to refactor.

# [16.4.0] - 2025-10-26
### added new events to event node - [Dicsussion #401](https://github.com/windkh/node-red-contrib-telegrambot/discussions/401) 

# [16.3.3] - 2025-10-02
### added further commands - [#412](https://github.com/windkh/node-red-contrib-telegrambot/issues/412) 

# [16.3.2] - 2025-06-15
### replaced the pump module with the newer stream pipe to support newer nodejs versions natively

# [16.3.1] - 2025-03-30
### added setMessageReaction - [#407](https://github.com/windkh/node-red-contrib-telegrambot/issues/407) 

# [16.3.0] - 2025-03-05
### added setMessageReaction - [#404](https://github.com/windkh/node-red-contrib-telegrambot/issues/404) 

# [16.2.0] - 2025-02-08
### fixed previous commit - [#402](https://github.com/windkh/node-red-contrib-telegrambot/issues/402) 

# [16.1.3] - 2025-01-08
### webhook local listening host is now configurable - [#396](https://github.com/windkh/node-red-contrib-telegrambot/issues/396) 

# [16.1.2] - 2025-01-08
### webhook url parsing improved - [#398](https://github.com/windkh/node-red-contrib-telegrambot/issues/398) 

# [16.1.1] - 2024-09-29
### IP address family any is 0 now - [#343](https://github.com/windkh/node-red-contrib-telegrambot/issues/343) 

# [16.1.0] - 2024-09-15
### IP address family can be configured now - [#343](https://github.com/windkh/node-red-contrib-telegrambot/issues/343) 

# [16.0.2] - 2024-07-02
### tried to fix unhandled exception in sender node - [#377](https://github.com/windkh/node-red-contrib-telegrambot/issues/377) 

# [16.0.1] - 2024-06-22
### fixed getFile typo - [#381](https://github.com/windkh/node-red-contrib-telegrambot/issues/381) 

# [16.0.0] - 2024-06-21
### updated to 0.66.0, removed dependencies to deprecated request, updated sock agent

# [15.1.11] - 2024-06-20
### added option for enabling test environment - [#380](https://github.com/windkh/node-red-contrib-telegrambot/issues/380) 

# [15.1.9] - 2024-01-30
### Added full weblink in response message of getfile. 
- see also - [#357](https://github.com/windkh/node-red-contrib-telegrambot/pull/357) 

# [15.1.8] - 2024-01-14
### added setChatAdministratorCustomTitle - [#351](https://github.com/windkh/node-red-contrib-telegrambot/issues/351) 

# [15.1.7] - 2023-08-29
### answerCallbackQuery text is now optional - [#339](https://github.com/windkh/node-red-contrib-telegrambot/issues/339) 

# [15.1.6] - 2023-08-29
### stopPoll added - [#331](https://github.com/windkh/node-red-contrib-telegrambot/issues/331) 

# [15.1.5] - 2023-08-29
### fixed dark theme - [#332](https://github.com/windkh/node-red-contrib-telegrambot/issues/332) 

# [15.1.4] - 2023-06-20
### control node can execute commands - [#315](https://github.com/windkh/node-red-contrib-telegrambot/issues/315) 

# [15.1.3] - 2023-06-13
### added chat_id in options - [#306](https://github.com/windkh/node-red-contrib-telegrambot/issues/306) 

# [15.1.2] - 2023-06-12
### fixed unauthorized calls in event node - [#314](https://github.com/windkh/node-red-contrib-telegrambot/issues/314) 

# [15.1.1] - 2023-04-29
### fixed port conflict in webhook mode - [#303](https://github.com/windkh/node-red-contrib-telegrambot/issues/303) 

# [15.1.0] - 2023-04-15
### fixed sendInvoice: startParameter removed - [#302](https://github.com/windkh/node-red-contrib-telegrambot/issues/302) 

# [15.0.1] - 2023-01-24
### improved doc - [#289](https://github.com/windkh/node-red-contrib-telegrambot/issues/289) 
### improved doc - [#290](https://github.com/windkh/node-red-contrib-telegrambot/issues/290) 

# [14.9.1] - 2022-11-13
### updated to 0.60.0 - [#281](https://github.com/windkh/node-red-contrib-telegrambot/issues/281) 

# [14.8.7] - 2022-10-23
### fixed config of control node - [#253](https://github.com/windkh/node-red-contrib-telegrambot/issues/253) 

# [14.8.6] - 2022-10-19
### reworked offline detection in control node - [#253](https://github.com/windkh/node-red-contrib-telegrambot/issues/253) 

# [14.8.5] - 2022-10-19
### added getfile - [#252](https://github.com/windkh/node-red-contrib-telegrambot/issues/252) 

# [14.8.4] - 2022-10-19
### fixed answerCallbackQuery - [#278](https://github.com/windkh/node-red-contrib-telegrambot/issues/278) 

# [14.8.3] - 2022-10-19
### fixed editmessagemedia - [#277](https://github.com/windkh/node-red-contrib-telegrambot/issues/277) 

# [14.8.1] - 2022-10-18
### replaced performance.now - [#276](https://github.com/windkh/node-red-contrib-telegrambot/issues/276) 

# [14.8.0] - 2022-10-17
### control node has second output now

# [14.7.0] - 2022-10-16
### control node sends a msg on every poll cycle

# [14.6.0] - 2022-10-15
### fixed: when changing socks5 hostname you had to redeploy - [#265](https://github.com/windkh/node-red-contrib-telegrambot/issues/265) 

# [14.5.0] - 2022-10-15
### added control node - [#228](https://github.com/windkh/node-red-contrib-telegrambot/issues/228) 

# [14.4.0] - 2022-10-14
### fileName can be specified when downloading file - [#275](https://github.com/windkh/node-red-contrib-telegrambot/issues/275) 

# [14.3.0] - 2022-09-20
### improved deuplicate token usage detection - [#272](https://github.com/windkh/node-red-contrib-telegrambot/issues/272) 

# [14.2.0] - 2022-09-19
### Made node more robust when initialization is aborted due to duplicate token usage - [#272](https://github.com/windkh/node-red-contrib-telegrambot/issues/272) 

# [14.1.0] - 2022-09-01
### Added web app data support - [#264](https://github.com/windkh/node-red-contrib-telegrambot/issues/264) 

# [14.0.0] - 2022-08-29
### fixed version 12.0.0 where SOCKS was broken - [#263](https://github.com/windkh/node-red-contrib-telegrambot/issues/263) 

# [13.2.0] - 2022-08-28
### Tried to improved error handling when network disconnects. 

# [13.1.0] - 2022-08-28
### added check during startup to avoid that the token is used twice.

# [13.0.0] - 2022-08-28
### breaking change in answerCallbackQuery: options is now an object - [#266](https://github.com/windkh/node-red-contrib-telegrambot/issues/266) 

# [12.0.0] - 2022-07-17
### upgraded socks-proxy-agent to 7.0 - [#260](https://github.com/windkh/node-red-contrib-telegrambot/issues/260) 

# [11.8.0] - 2022-07-17
### fixed - [#242](https://github.com/windkh/node-red-contrib-telegrambot/issues/242) 

# [11.7.0] - 2022-07-17
### fixed - [#258](https://github.com/windkh/node-red-contrib-telegrambot/issues/258) 
### fixed - [#258](https://github.com/windkh/node-red-contrib-telegrambot/issues/259) 

# [11.6.0] - 2022-06-28
### added download file by fileId feature - [#252](https://github.com/windkh/node-red-contrib-telegrambot/issues/252) 

# [11.5.0] - 2022-06-28
### upgraded to node-telegram-bot-api to 0.58.0, added explicit dependency to request: see [#247](https://github.com/windkh/node-red-contrib-telegrambot/issues/247)
### fixed [#249](https://github.com/windkh/node-red-contrib-telegrambot/issues249) 
### fixed [#250](https://github.com/windkh/node-red-contrib-telegrambot/issues/250) 

# [11.4.0] - 2022-05-16
### added added approveChatJoinRequest, declineChatJoinRequest - [#245](https://github.com/windkh/node-red-contrib-telegrambot/issues/245) 

# [11.3.0] - 2022-04-07
### sendDice added - [#238](https://github.com/windkh/node-red-contrib-telegrambot/issues/238) 

# [11.2.4] - 2022-02-13
### removed version properties from package.json - [#235](https://github.com/windkh/node-red-contrib-telegrambot/issues/235)

# [11.2.3] - 2022-02-03
### allowed node-red 1.3.7 and nodejs 12.0.0

# [11.2.2] - 2022-02-03
### allowed node-red 1.0 and nodejs 10.0

# [11.2.1] - 2022-02-01
### added missing node red tags
 
# [11.2.0] - 2022-01-04
### fixed socks5 support - [#229](https://github.com/windkh/node-red-contrib-telegrambot/issues/229) 
replaced socks5-https-client with socks-proxy-agent 

# [11.1.0] - 2022-01-02
### fixed status of nodes - [#230](https://github.com/windkh/node-red-contrib-telegrambot/issues/230) 

# [11.0.1] - 2021-12-29
### minor internal refactorings

# [11.0.0] - 2021-12-19
### updated dependancies and node-telegram-bot-api to 0.56.0

# [10.4.1] - 2021-12-19
### Added full example for sendInvoice payments. 
- see also - [#225](https://github.com/windkh/node-red-contrib-telegrambot/pull/225) 

# [10.4.0] - 2021-12-19
### Fixed payment functions 
- see also - [#224](https://github.com/windkh/node-red-contrib-telegrambot/pull/224) 

# [10.3.0] - 2021-12-18
### added ne events My Chat Member and Chat Join Request

# [10.2.1] - 2021-12-18
### Extended example supergroupadmin.json

# [10.2.0] - 2021-12-12
### Added example flow for super group administration.
- added missing function banChatMember

# [10.1.0] - 2021-12-05
### Added webhook readme.
- Fixed timeout on redeploy when node is not in polling nor in webhook mode - [#220](https://github.com/windkh/node-red-contrib-telegrambot/issues/220)

# [10.0.9] - 2021-10-03
### Added webhook readme.
- see also - [#207](https://github.com/windkh/node-red-contrib-telegrambot/issues/209)

# [10.0.8] - 2021-10-03
### Added new example fro sending photos as buffer.

# [10.0.7] - 2021-08-28
### Tried to fix race crash
- try to fix - [#207](https://github.com/windkh/node-red-contrib-telegrambot/issues/207)

# [10.0.6] - 2021-08-22
### Minor improvements.
- improved - [#198](https://github.com/windkh/node-red-contrib-telegrambot/issues/198)

# [10.0.5] - 2021-08-02
### Internal fixed when internally registering command nodes at the config node.
- improved - [#197](https://github.com/windkh/node-red-contrib-telegrambot/issues/197)

# [10.0.4] - 2021-08-01
### Added bot command scopes (see setMyCommands).
- new - [#193](https://github.com/windkh/node-red-contrib-telegrambot/issues/193)

# [10.0.3] - 2021-07-31
### Bot is restarted on polling error.
- next try to fix - [#172](https://github.com/windkh/node-red-contrib-telegrambot/issues/172)

# [10.0.2] - 2021-07-25
### bot can run in send only mode which is neither polling nor webhook.
- merged - [#151](https://github.com/windkh/node-red-contrib-telegrambot/issues/151)

# [10.0.1] - 2021-07-25
### answerInlineQuery supports options now
- merged - [#194](https://github.com/windkh/node-red-contrib-telegrambot/pull/194)

# [10.0.0] - 2021-07-24
### upgrade to node-telegram-bot-api 0.54.0
- update - [#190](https://github.com/windkh/node-red-contrib-telegrambot/issues/190)

# [9.6.2] - 2021-07-24
### fixed callback_query bug
- fix - [#191](https://github.com/windkh/node-red-contrib-telegrambot/issues/191)

# [9.6.1] - 2021-07-24
### fixed setMyCommands
- fix - [#192](https://github.com/windkh/node-red-contrib-telegrambot/issues/192)

# [9.6.0] - 2021-07-21
### you can choose a language for your command registration now.
- new - [#189](https://github.com/windkh/node-red-contrib-telegrambot/issues/189)

# [9.5.0] - 2021-07-04
### commands can be registered automatically at the server (see /secommands or /setMyCommands).
- new - [#187](https://github.com/windkh/node-red-contrib-telegrambot/issues/187)

# [9.4.3] - 2021-05-24
### added optional argument for creating polls.
- fixed - [#181](https://github.com/windkh/node-red-contrib-telegrambot/issues/181)

# [9.4.2] - 2021-05-13
### added workaround for editMessageMedia support as sending local files does not work
- workaround for - [#178](https://github.com/windkh/node-red-contrib-telegrambot/issues/178)
- created issue - https://github.com/yagop/node-telegram-bot-api/issues/876

# [9.4.1] - 2021-05-06
### added editMessageMedia support

# [9.4.0] - 2021-05-02
### fix of last changes: chat is is taken from message in events if available.
- fixed - [#175](https://github.com/windkh/node-red-contrib-telegrambot/issues/175)

# [9.3.1] - 2021-05-02
### rebuild

# [9.3.0] - 2021-05-02
### fixed chat id exceptions in event nodes.
- fixed - [#175](https://github.com/windkh/node-red-contrib-telegrambot/issues/175)

# [9.2.1] - 2021-04-07
### exception in event node.
- fixed - [#168](https://github.com/windkh/node-red-contrib-telegrambot/issues/168)

# [9.1.2] - 2021-04-07
### refactored status events

# [9.0.0] - 2021-04-03
### upgrade underlying library to version 0.52.0 
- fixed - [#166](https://github.com/windkh/node-red-contrib-telegrambot/issues/166)

# [8.12.0] - 2021-04-02
### added ESLint, Prettier for maintinaing consistency in code style
- fixed - [#158](https://github.com/windkh/node-red-contrib-telegrambot/issues/158)

# [8.11.1] - 2021-04-01
### Readme updated for MarkdownV2
 
# [8.11.0] - 2021-04-01
### callback_query authorization adapted so that only group chat id needs to be configured.
- fixed - [#165](https://github.com/windkh/node-red-contrib-telegrambot/issues/165)
 
# [8.10.0] - 2021-03-08
### Added argument fileOptions in sendDocument, sendVoice, sendAudio, sendSticker, sendAnimation, sendVideo, ...
- fixed - [#161](https://github.com/windkh/node-red-contrib-telegrambot/issues/161)
 
# [8.9.7] - 2021-02-07
### Fixed bug in error handling of sender node.
 
# [8.9.6] - 2020-12-03
### Extended webhook mode (options and help)
 - merged  - [#147](https://github.com/windkh/node-red-contrib-telegrambot/issues/147)
 
# [8.9.5] - 2020-12-01
### Extended webhook mode (options and help)
 - fixed  - [#146](https://github.com/windkh/node-red-contrib-telegrambot/issues/146)
 
# [8.9.4] - 2020-12-01
### Added bluebird dependency
 - fixed  - [#145](https://github.com/windkh/node-red-contrib-telegrambot/issues/145)
 
# [8.9.3] - 2020-11-30
### Added flag in command node to remove the first match when using regular expressions.
 - extended  - [#122](https://github.com/windkh/node-red-contrib-telegrambot/issues/122)
 
# [8.9.2] - 2020-11-30
### Updated Readme.md
 
# [8.9.1] - 2020-11-29
### Added second output to sender node for handling errors.
 - fixed  - [#142](https://github.com/windkh/node-red-contrib-telegrambot/issues/142)
 
# [8.9.0] - 2020-11-29
### Refactored error handling for sender and event node.
 - fixed  - [#142](https://github.com/windkh/node-red-contrib-telegrambot/issues/142)
 
# [8.8.2] - 2020-11-29
### Fixed bug for action or sendChatAction
 - fixed  - [#144](https://github.com/windkh/node-red-contrib-telegrambot/issues/144)
 
# [8.8.1] - 2020-11-22
### Minor changes in readme and help
 
# [8.8.0] - 2020-11-08
### Adapted to new bot api V5: unpinAllChatMessages, pinChatMessage,...
 - fixed  - [#141](https://github.com/windkh/node-red-contrib-telegrambot/issues/141)
 - fixed  - [#140](https://github.com/windkh/node-red-contrib-telegrambot/issues/140)
 - fixed  - [#138](https://github.com/windkh/node-red-contrib-telegrambot/issues/138)
 
# [8.7.2] - 2020-11-04
### Fixed bug in callback_query message id. 
 - see Payload.messageId information when using -Event node- with -Callback Query- parameter  - [#136](https://github.com/windkh/node-red-contrib-telegrambot/issues/136)
 
 # [8.7.1] - 2020-10-03
### Fixed bug in callback_query auto answer. 
 - see Callback Query Trigger does not work - [#134](https://github.com/windkh/node-red-contrib-telegrambot/issues/134)
 
## [8.7.0] - 2020-10-03
### Added regular expression support to command node. 
 - see Allow command regex - [#122](https://github.com/windkh/node-red-contrib-telegrambot/issues/122)
 - added copyright limitation for commercial products
 
## [8.6.5] - 2020-09-30
### Keyboard types (custom keyboard and inline keyboard) description added.

## [8.6.4] - 2020-09-10
### Added example flow for creating a poll.

## [8.6.3] - 2020-09-10
### Added pre_checkout_query for sendInvoice feature.
 - added events to event node: pre_checkout_query, shipping_query, chosen_inline_result, poll, poll_answer
 - added poll support (preview)
 - see SendInvoice - [#119](https://github.com/windkh/node-red-contrib-telegrambot/issues/119)

## [8.6.2] - 2020-09-07
### README.md display problem
 - Display problem fixed when using the <details> tags: Added additional blank line behind.

## [8.6.1] - 2020-09-06
### When bot is stopped it won't restore to "polling" state

## [8.6.0] - 2020-09-06
### Token can be read from env variable
 - Change Token ID. - [#124](https://github.com/windkh/node-red-contrib-telegrambot/issues/124)

## [8.5.0] - 2020-09-03
### Docu rework
### Typo in .html
- Ouput -> Output

### Minor bugfix in .js
- date field added at text message

## [8.4.0] - 2020-08-14
### Updated to node-telegram-bot-api 0.50.0

## [8.3.3] - 2020-07-26
### Polling Error status is reset after 80% poll interval
 - Reset error status after a period when polling. - [#97](https://github.com/windkh/node-red-contrib-telegrambot/issues/97)

## [8.3.2] - 2020-07-26
### Alpha feature sendInvoice
 - Added sendInvoice, answerShippingQuery, answerPreCheckoutQuery for testing - [#119](https://github.com/windkh/node-red-contrib-telegrambot/issues/119)

## [8.3.1] - 2020-07-26
### Fixed
 - Fixed has response behavior - [#115](https://github.com/windkh/node-red-contrib-telegrambot/issues/115)

## [8.3.0] - 2020-07-26
### Fixed
 - Fixed typo in event node (callback_query) - [#114](https://github.com/windkh/node-red-contrib-telegrambot/issues/114)

## [8.2.0] - 2020-06-14
### Fixed
 - Fixed wrong chat id when sending to many chats - [#111](https://github.com/windkh/node-red-contrib-telegrambot/issues/111)

## [8.1.0] - 2020-05-02
### Added
 - Reordered html properties
 - New option in `Telegram reciever node` to automatically filter configured `command nodes` - [#108](https://github.com/windkh/node-red-contrib-telegrambot/pull/108)
 - New `CHANGELOG` file to remove the info from the `README` - [#107](https://github.com/windkh/node-red-contrib-telegrambot/pull/107)

### Changed
 - New updated icons to - [#106](https://github.com/windkh/node-red-contrib-telegrambot/issues/106)

## [8.0.0] - 2020-04-13
### Added
 - Command nodes will only send the response to the second output if a command is pending - [#103](https://github.com/windkh/node-red-contrib-telegrambot/issues/103)

## [7.2.1] - 2020-04-13
### Added
 - Second output of command node can be disabled now - [#103](https://github.com/windkh/node-red-contrib-telegrambot/issues/103)

## [7.2.0] - 2020-03-29
### Added
 - Dynamic authorization - [#99](https://github.com/windkh/node-red-contrib-telegrambot/issues/99)

## [7.1.5] - 2020-03-22
### Added
 - Option to send the same message to many different chats

## [7.1.4] - 2020-03-21
### Fixed
 - Bot polling is not stopped when socks5 error (e.g. when network is down) - [#97](https://github.com/windkh/node-red-contrib-telegrambot/issues/97)

## [7.1.3] - 2020-03-21
### Added
 - Sending and receiving animations - [#95](https://github.com/windkh/node-red-contrib-telegrambot/issues/95)

## [7.1.2] - 2020-03-21
### Added
 - Function `forwardMessage` - [#101](https://github.com/windkh/node-red-contrib-telegrambot/issues/101)

## [7.0.0] - 2019-11-24
### Changed
 - Updated dependancy npm module [node-telegram-bot-api](https://www.npmjs.com/package/node-telegram-bot-api) to latest release `v0.40.0`

## [6.0.1] - 2019-11-24
### Removed
 - Warning when nodes register twice at the configuration node - [#87](https://github.com/windkh/node-red-contrib-telegrambot/issues/87)

## [6.0.0] - 2019-10-28
### Changes
 - Modified nodes to support `Node-RED 1.0+` (async) - [#85](https://github.com/windkh/node-red-contrib-telegrambot/issues/85)

## [5.5.0] - 2019-04-15
### Fixed
 - Functions: `restrictChatMember`, `kickChatMember`, `promoteChatMember`, `unbanChatMember` - [#71](https://github.com/windkh/node-red-contrib-telegrambot/issues/71)

## [5.4.0] - 2019-04-02
### Added
 -  Function `sendMediaGroup` - [#68](https://github.com/windkh/node-red-contrib-telegrambot/issues/68)

## [5.3.0] - 2019-02-16
### Added
 - Support for custom and non custom certificates in webhook mode - [#66](https://github.com/windkh/node-red-contrib-telegrambot/issues/66)

### Changed
 - Improved configuration node: grouped properties.

## [5.2.1] - 2019-02-02
### Added
 - SOCKS5 support - [#43](https://github.com/windkh/node-red-contrib-telegrambot/issues/43)

## [5.0.0] - 2018-12-29
### Added
 - Webhooks supported

### Changes
 - Configuration node was changed so that the required properties for webhook can be configured

## [4.8.0] - 2018-12-27
### Changes
 - Results returned by the sender node were changed for direct commands like for example  editMessageLiveLocation, stopMessageLiveLocation, editMessageCaption, ... in a way that the `msg.payload.content` now contains the full object returned by the request instead of the `msg.payload.sentMessageId` property. All flows that did not make any use of those special functions should not be affected.

## [4.x.x]
### Changes
 - Replaced the former callback query node with the generic event node (breaking change). You can replace the former callback query node in your existing flows with the event node. Please configure this event node to receive the callback query event.

**Note:** The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

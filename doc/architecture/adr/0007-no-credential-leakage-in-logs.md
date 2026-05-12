# ADR 0007 — Bot token must never reach logs, status text or error events

## Status
Accepted. Landed across V17.2.0 (`e30114a`) and V17.3.0 (`6cf718d`, `8d50eea`).

## Context

A Telegram bot token is a long-lived bearer credential. Anyone holding it can impersonate the bot — read incoming messages, send outgoing messages, change webhook URLs, etc. There is no per-request signing or scope; the token *is* the bot.

Node-RED's `node.error` / `node.warn` writes show up in:
- The Node-RED **flow log file**.
- The Node-RED **editor's debug pane** (visible to anyone with editor access).
- The **flow node's status text**, broadcast via the `'status'` event to other nodes and shown on the canvas.
- Any **external log sinks** the operator has wired up (syslog, Loki, CloudWatch, etc.).

Until V17.1.x the codebase had three concrete leaks of `self.token`:

1. **Duplicate-token abort** (`bot-node.js:230`):
   ```js
   self.error('Aborting: Token of ' + n.botname + ' is already in use by ' + cfg.botname + ': ' + self.token);
   ```

2. **Polling 401 hint** (`bot-node.js:542`):
   ```js
   hint = 'Please check if the bot token is valid: ' + self.credentials.token;
   ```

3. **Webhook setup error** (`bot-node.js:476, 482`): the `setWebHook` URL includes the token (`https://example.com/bot<TOKEN>`); on failure it was concatenated into the `abortBot` hint, which then became part of the broadcast status text.

There is also an implicit leak path:

4. **Verbose polling-error util.inspect** (`bot-node.js:536`): `util.inspect(error, { depth: 5 })` walks into the underlying error object, which can carry the request URL one or two levels deep (and the URL contains the token).

## Decision

The token is treated as a strict secret with three rules:

1. **Never concatenate `self.token` / `self.credentials.token` / `botUrl` into a log/error/status string**, even when the operator presumably knows their own token. Operators may forward logs to third parties; status text appears in screenshots posted to GitHub issues; etc.
2. **Redact known token substrings from any dump that *could* contain them** — specifically, the verbose `util.inspect(error, { depth: 5 })` line uses `inspected.split(self.token).join('<token>')` before logging.
3. **Avoid token-bearing URLs in error messages.** Webhook setup error paths now log the host, not the full URL.

In code:

```js
// bot-node.js:230 — duplicate-token abort
self.error('Aborting: Token of ' + n.botname + ' is already in use by ' + conflictingConfigNode.botname);

// bot-node.js:542 — polling 401 hint
hint = 'Please check if the bot token is valid.';

// bot-node.js:560-564 — polling_error inspect dump
let inspected = require('node:util').inspect(error, { depth: 5 });
if (self.token) {
    inspected = inspected.split(self.token).join('<token>');
}
self.warn(inspected);

// bot-node.js — webhook errors no longer concatenate botUrl
self.abortBot('Failed to set webhook', function () { ... });
```

The 17.3.0 release also added a clearer "webhook configuration is incomplete" error that lists which fields are missing without ever quoting the token.

## Consequences

- **Operators can safely share Node-RED logs** when reporting bugs without exposing the bot to takeover.
- **`<token>` placeholders in inspect dumps** are obvious in screenshots, both for the operator (they know what was redacted) and for incident response.
- **Adding any new error-handling code that touches the bot URL / token requires a conscious redaction step.** This ADR is the policy; the recommended pattern is `inspected.split(self.token).join('<token>')` before logging, applied as close to the log call as possible.
- **Future risk areas** — anywhere we serialize `error.response.request` (axios-style), `error.options`, or `error.config`: those structures commonly hold the token-bearing URL. The current verbose dump is the only such site; future additions need the same redaction.

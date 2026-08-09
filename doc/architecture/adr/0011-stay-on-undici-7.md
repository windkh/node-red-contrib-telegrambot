# ADR 0011 — Stay on `undici@^7` until Node bundles undici 8

## Status

Accepted. [#496](https://github.com/windkh/node-red-contrib-telegrambot/pull/496) closed unmerged.

## Context

Dependabot #496 bumps `undici` 7.29.0 → 8.10.0. It failed on Node 20 for a version reason, which is what
prompted [ADR 0010](0010-drop-node-20.md). After Node 20 was dropped and the PR rebased onto the new
`[22.x, 24.x]` matrix, **it still failed — on both legs**, and this time for a reason no Node version fixes:

| Test file | Symptom |
| --- | --- |
| `test/integration/polling.test.js` | `test timed out after 30000ms` |
| `test/integration/sending.test.js` | `test timed out after 30000ms` |
| `test/integration/setwebhook.test.js` | `EFATAL: fetch failed` (3 subtests) |
| `test/integration/webhook.test.js` | `waitFor timed out` |

Every failure is a request that goes out and never comes back. The unit test in
`test/lib/undici-pool.test.js` that asserts global `fetch(url, { dispatcher })` **reaches** our dispatcher
kept passing — it only checks that `dispatch()` is invoked and deliberately swallows network errors, so it
cannot see a response that never arrives.

The mechanism is how this package wires its transport (`telegrambot/lib/undici-pool.js`):

1. We build `new Agent(...)` from the **standalone** `undici` package, per bot instance.
2. `node-telegram-bot-api` spreads `request.fetchOptions` into a call to Node's **built-in** `fetch`.
3. That built-in fetch comes from Node's **own bundled** undici, not from ours.

undici v8.0.0's release notes list **"Remove legacy handler wrappers"** (and "Enable h2 by default"). Node's
bundled undici still drives a dispatcher through the legacy handler callbacks. A v8 dispatcher is therefore
accepted by `fetch` — the object passes whatever check it makes, which is why `dispatch()` is still reached —
but the response is never delivered back through callbacks that no longer exist. Hence `fetch failed` on the
short paths and 30-second timeouts on the polling ones.

This is not a Node-version problem and not a test problem. **Two undici majors cannot be mixed across the
built-in-fetch boundary**, and we are on the wrong side of it until Node ships a bundled undici 8.

Alternatives considered:

- **Adopt undici 8 and stop using Node's built-in fetch** — have `node-telegram-bot-api` call undici 8's own
  `fetch`. Depends on the library exposing a transport hook we do not control, and would replace a supported
  path with a bespoke one. Rejected as disproportionate to a dependency bump.
- **Adopt undici 8 and drop the per-instance dispatcher.** That would surrender SOCKS proxy support
  (`fetch-socks`) and the #442 keep-alive-pool defence, both of which are features. Rejected.
- **Merge #496 and accept red CI.** Not a real option.

## Decision

Keep `undici` at `^7`, close #496 unmerged, and tell Dependabot to stop proposing undici majors:

```yaml
ignore:
    - dependency-name: undici
      update-types: [version-update:semver-major]
```

Minor and patch updates to undici 7 continue to flow, so security fixes are not blocked — only the major.

## Consequences

- **The transport keeps working**, with per-bot pools, SOCKS support and the restart defence intact.
- **undici 7 security releases still arrive** via minor/patch bumps. If undici 7 ever stops receiving them,
  this ADR has to be revisited urgently — that is the real risk being carried.
- **The ignore rule hides a real upgrade.** It must be lifted, not forgotten, once a Node release bundles
  undici 8. `process.versions.undici` on the minimum supported Node is the thing to check.
- **`test/lib/undici-pool.test.js` overstates its guarantee.** Its end-to-end test is named for catching
  "Node's bundled undici doesn't accept our dispatcher" regressions, but it passed through exactly such a
  regression because it asserts only that `dispatch()` was reached. Making it assert a completed response
  against the local mock would have caught this in the unit layer instead of four integration files.
- **Node 20 stays dropped.** ADR 0010 does not depend on this one.

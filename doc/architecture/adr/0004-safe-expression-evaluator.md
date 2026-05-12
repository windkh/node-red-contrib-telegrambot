# ADR 0004 — Whitelist parser replaces `eval()` for token / usernames / chatids

## Status
Accepted. Landed in V17.2.0 (commit `17d7154`).

## Context

The `token`, `usernames`, and `chatids` config fields each accept a small expression syntax wrapped in `{...}`:

- `{flow.get("key")}` / `{global.get("key")}` / `{context.get("key")}`
- `{context.flow.get("key")}` / `{context.global.get("key")}`
- `{env.get("VAR")}`
- `{flow.keys()}` and the other `.keys()` variants

Until V17.1.x this was implemented via:

```js
let code = 'sandbox.' + expression + ';';
try { result = eval(code); } catch (e) { result = undefined; }
```

The `sandbox` was an object exposing `flow`/`global`/`context`/`env` getters. The intent was to constrain the expression to those scopes — but `eval` has no scope guarantees. Anyone with editor access to a flow could write `process.exit(1)`, `require('child_process').execSync(...)`, or worse into the token field and that code would execute in the Node-RED process.

Trust boundary: editor users *are* trusted (they configure the bot), so this isn't a remote-execution vector. But it is a sharp edge — accidentally pasted JS would run, and audit / static-analysis tools flag `eval` on any input regardless of trust level.

Alternatives considered:
- **`vm.runInNewContext`** — sandboxed-ish but still executes arbitrary JS in a constructed context. Mitigates some classes of attack but not all (prototype-walking, well-known escapes), and unnecessary given the small grammar we actually want.
- **A real expression evaluator library** (e.g. `expr-eval`, `safe-eval`) — overkill for a four-form grammar and adds a dependency surface.
- **A small whitelist parser** — exactly what the grammar needs and trivial to test.

## Decision

Replace `eval` with two small functions in `bot-node.js`:

- `parseStringArgList(input)` — tokenises a comma-separated list of single- or double-quoted string literals with `\n` / `\t` / `\r` escape handling. Returns `null` on any input outside the grammar.
- `evalContextExpression(node, expression)` — matches the input against a single regex:

```
^(flow|global|context|env)(?:\.(flow|global))?\.(get|keys)\s*\(([\s\S]*)\)\s*$
```

  and dispatches to the appropriate Node-RED API. Anything that fails to match — including statements, property access not via `.get`/`.keys`, multiple expressions, anything with no `(` `)` — evaluates to `undefined`.

The sandbox object is gone entirely.

## Consequences

- **No code injection** via the token / usernames / chatids fields. Pasted `process.exit(1)` → `undefined`.
- **Stricter grammar** — a few obscure forms that worked under `eval` (e.g. `context.global.someKey` as a direct property access on the Node-RED context store) no longer resolve. Documented usages still work.
- **Testable in isolation** — both helpers are pure; the smoke test in V17.2.0 covered ~13 cases including hostile inputs.
- **Adapter for raw string env vars** — in V17.3.1, `getUserNames` and `getChatIds` were updated to split a string result from `env.get`/`flow.get`/`global.get` on commas (partial fix for issue #432). The parser itself stayed unchanged.
- **Maintenance**: new grammar additions are a regex change plus a dispatch case in `evalContextExpression`. The cost of adding `{msg.X}` access or `flow.set(...)` would be small but is explicitly out of scope for this ADR — config-time resolution should be *read-only*.

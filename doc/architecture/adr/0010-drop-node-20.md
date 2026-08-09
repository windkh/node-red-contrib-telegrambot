# ADR 0010 — Drop Node 20, require Node >= 22.19

## Status

Accepted. Lands in V19.0.0.

## Context

Dependabot [#496](https://github.com/windkh/node-red-contrib-telegrambot/pull/496) bumps `undici`
7.29.0 → 8.10.0. undici 8 raises its own floor:

| | `engines.node` |
| --- | --- |
| undici 7.29.0 | `>=20.18.1` |
| undici 8.10.0 | `>=22.19.0` |

On the Node 20 CI leg the suite dies with 108 failures, every one of them the same `TypeError`:

```
webidl.util.markAsUncloneable is not a function
```

`markAsUncloneable` comes from `node:worker_threads` and does not exist on Node 20. undici 8 calls it
while building its `webidl` layer, so the failure happens at require time and takes down every test that
constructs a bot. This is not a flake and not something a shim can bridge — the function is simply absent
from the runtime.

The `build (22.x)` leg of that run was **cancelled by `fail-fast` after 20.x went red**, not failed on its
own; it had already logged passing tests before it was killed. So undici 8 is fine on Node 22. The whole
problem is the Node 20 support promise.

Three things make dropping Node 20 the honest resolution rather than a convenience:

1. **Node-RED 5 already requires Node >= 22.9.** `node-red@5.0.1` declares `engines: { node: ">=22.9" }`.
   A user on a supported Node-RED 5 install is necessarily already on Node 22.9+. Our `>=20.0.0` described
   a configuration that the host runtime rules out.
2. **Node 20 reached end of life on 2026-04-30.** It receives no further security fixes.
3. **The alternative freezes a security-relevant dependency.** undici is the HTTP stack; pinning it at
   `^7` to protect a Node version nobody can realistically be running means declining its future security
   releases too.

Alternatives considered:

- **Pin `undici` to `^7` and tell Dependabot to ignore major bumps.** Keeps the `>=20` promise honest, at
  the price of freezing the HTTP client. Rejected: the promise protects nobody (see 1), and the cost is
  real.
- **Keep `>=20` in `engines` but stop testing it.** Rejected outright — that is a claim we know to be
  false, and npm would install a broken package for anyone who believed it.
- **Ship undici 8 with a runtime feature check.** There is nothing to fall back *to*; the missing function
  is a Node primitive, not a policy.

## Decision

Drop Node 20 and require Node >= 22.19, matching undici 8's own floor exactly rather than rounding to
`>=22.0.0` — a Node 22.0 install would still fail on `markAsUncloneable`.

- `engines.node` → `>=22.19.0`
- CI matrix `[20.x, 22.x]` → `[22.x, 24.x]`, following the precedent set when Node 18 was dropped
  (current LTS plus the next one) and adding real coverage of Node 24
- `npm-publish.yml` build and publish jobs → Node 22
- Major version bump to **19.0.0**: raising the runtime floor is breaking, whatever the realistic
  install footprint

`undici` itself stays at `^7` in this change. #496 is what moves it to `^8`, once rebased onto this.

## Consequences

- **Users on Node 20 stay on 18.1.1.** npm refuses the install with `EBADENGINE` rather than producing a
  package that throws at require time, which is the point of declaring it.
- **Anyone on Node-RED 5 is unaffected** — they already satisfy `>=22.9`, and `>=22.19` is a small step
  beyond it. Users on Node-RED 4 with Node 20 are the group that has to move, and their upgrade path is
  Node first, then this package.
- **Node 24 is now covered by CI** for the first time. If it surfaces failures, they are real and were
  previously invisible.
- **The shared `AGENTS.md` still says "Target Node.js >= 20."** That line is inside the managed block
  synced from `node-red-standards` and must not be edited here. The standard needs the same decision, or
  this package will keep contradicting it on every sync.
- **Reversible** while it matters: restoring `>=20.0.0`, the old matrix and `undici@^7` puts it back, at
  the cost of a major version to undo a major version.

# ADR 0010 — Drop Node 20, require Node >= 22.19

## Status

Accepted. Lands in V19.0.0.

> This decision was **triggered** by the undici 8 bump in
> [#496](https://github.com/windkh/node-red-contrib-telegrambot/pull/496), but it does not depend on it.
> undici 8 was ultimately **not** adopted — see [ADR 0011](0011-stay-on-undici-7.md). The reasons to drop
> Node 20 stand on their own and are listed below.

## Context

Dependabot #496 bumped `undici` 7.29.0 → 8.10.0, and its Node 20 CI leg died with 108 identical
`TypeError`s: `webidl.util.markAsUncloneable is not a function`, a `node:worker_threads` primitive absent
from Node 20. Investigating what to do about that surfaced the real problem, which has nothing to do with
undici:

**We promised a Node version our own host runtime rules out.**

| | `engines.node` |
| --- | --- |
| `node-red@5.0.1` | `>=22.9` |
| this package (before) | `>=20.0.0` |

Anyone running a supported Node-RED 5 install is necessarily on Node 22.9 or newer. The `>=20.0.0` claim
described a configuration that cannot exist for our actual users — while obliging us to keep testing it and
to weigh it in every dependency decision. On top of that, **Node 20 reached end of life on 2026-04-30** and
receives no further security fixes.

Alternatives considered:

- **Keep `>=20` and keep testing it.** Rejected: it costs a CI leg and a veto over dependency upgrades to
  protect a combination (Node-RED 5 on Node 20) that npm already refuses to install.
- **Keep `>=20` in `engines` but stop testing it.** Rejected outright — a claim we know to be untested is
  worse than no claim.
- **Wait for a user to complain.** Rejected: EOL means the complaint would arrive as a security report.

## Decision

Drop Node 20 and require **Node >= 22.19**.

- `engines.node` → `>=22.19.0`
- CI matrix `[20.x, 22.x]` → `[22.x, 24.x]`, following the precedent set when Node 18 was dropped
  (current LTS plus the next) and adding real coverage of Node 24
- `npm-publish.yml` build and publish jobs → Node 22
- Major version bump to **19.0.0**: raising the runtime floor is breaking, whatever the realistic install
  footprint

The floor is `>=22.19.0` rather than `>=22.9` (which is all Node-RED 5 demands) so that the next attempt at
undici 8 does not need another major bump. It is the one number that satisfies both Node-RED 5 today and
undici 8 whenever it becomes usable.

## Consequences

- **Users on Node 20 stay on 18.1.1.** npm refuses the install with `EBADENGINE` rather than producing a
  package that fails at runtime, which is the point of declaring it.
- **Anyone on Node-RED 5 is unaffected** — they already satisfy `>=22.9`. The group that has to act is
  Node-RED 4 on Node 20, and their upgrade path is Node first, then this package.
- **Node 24 is covered by CI** for the first time. The first run on `master` was green.
- **This does not unblock undici 8.** That bump fails for an unrelated reason on every Node version; see
  [ADR 0011](0011-stay-on-undici-7.md).
- **The shared `AGENTS.md` still says "Target Node.js >= 20."** That line is inside the managed block
  synced from `node-red-standards` and must not be edited here. The standard needs the same decision, or
  this package will keep contradicting it on every sync.
- **Reversible** while it matters: restoring `>=20.0.0` and the old matrix puts it back, at the cost of a
  major version to undo a major version.

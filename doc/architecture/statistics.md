# Statistics

Snapshot at V17.3.1 (master, 2026-05-12).

## Lines of code

Production JavaScript only — excludes `node_modules`, `examples`, `*.html` definitions, `*.json` config.

| File | LOC | % of total |
|------|-----|-----------|
| `telegrambot/nodes/bot-node.js` | 1049 | 25.2 % |
| `telegrambot/nodes/out-node.js` | 984 | 23.7 % |
| `telegrambot/lib/converter.js` | 756 | 18.2 % |
| `telegrambot/nodes/in-node.js` | 311 | 7.5 % |
| `telegrambot/nodes/command-node.js` | 280 | 6.7 % |
| `telegrambot/nodes/control-node.js` | 260 | 6.3 % |
| `telegrambot/nodes/event-node.js` | 233 | 5.6 % |
| `telegrambot/nodes/reply-node.js` | 148 | 3.6 % |
| `telegrambot/lib/queue-manager.js` | 80 | 1.9 % |
| `telegrambot/99-telegrambot.js` | 40 | 1.0 % |
| `telegrambot/lib/safe-stringify.js` | 15 | 0.4 % |
| **Total** | **4156** | **100 %** |

Two files (`bot-node.js` + `out-node.js`) account for **48.9 %** of the codebase — both flagged as refactor candidates in [recommendations-for-refactoring.md](recommendations-for-refactoring.md).

## Function count

Rough — counted via grep on `function` / `this.X = function` / method-shorthand patterns. May over-count anonymous callbacks.

| File | Functions (rough) |
|------|------------------|
| `nodes/bot-node.js` | 142 |
| `nodes/out-node.js` | 76 |
| `nodes/in-node.js` | 25 |
| `nodes/command-node.js` | 26 |
| `nodes/control-node.js` | 24 |
| `lib/converter.js` | 16 |
| `nodes/event-node.js` | 16 |
| `nodes/reply-node.js` | 15 |
| `lib/queue-manager.js` | 12 |
| `lib/safe-stringify.js` | 1 |
| `99-telegrambot.js` | 0 |

Most of `bot-node.js`'s 142 are short closures wired into the bot's `EventEmitter` (per-event handlers), not standalone functions. The same is true for `out-node.js`'s 76 — each `case` in the type switch has its own `.catch` + `.then` arrow.

## Branch-keyword density (rough cyclomatic complexity proxy)

Count of `if`, `else`, `switch`, `case`, `for`, `while`, `catch`, ternary `? ` per file. Treat as a directional indicator only.

| File | Branches | Branches / 100 LOC |
|------|----------|-------------------|
| `nodes/out-node.js` | 219 | 22.3 |
| `nodes/bot-node.js` | 176 | 16.8 |
| `lib/converter.js` | 78 | 10.3 |
| `nodes/in-node.js` | 47 | 15.1 |
| `nodes/command-node.js` | 41 | 14.6 |
| `nodes/control-node.js` | 28 | 10.8 |
| `nodes/reply-node.js` | 24 | 16.2 |
| `nodes/event-node.js` | 19 | 8.2 |
| `lib/queue-manager.js` | 9 | 11.3 |
| `99-telegrambot.js` | 1 | 2.5 |
| `lib/safe-stringify.js` | 0 | 0 |

`out-node.js` and `bot-node.js` are the densest. `safe-stringify.js` is the leanest. The pure-helper `converter.js` sits in the middle, dominated by the 30+ `else if` branches in `getMessageDetails` — declarative shape, low intrinsic complexity.

## Test coverage

**Zero.** There is no `test/` directory, no `__tests__/`, no `*.test.js`, no `scripts.test` in `package.json`, no testing dependencies in `devDependencies`. ESLint (with the `prettier` plugin) is the only automated quality gate.

| Metric | Value |
|--------|------|
| Test files | 0 |
| Test framework | none |
| Coverage tooling | none |
| Lint coverage | 100 % of `telegrambot/**/*.js` |

Adding a test harness is the single highest-leverage improvement available; see [recommendations-for-refactoring.md](recommendations-for-refactoring.md) §1.

## Dependencies

| Bucket | Count |
|--------|------|
| Runtime (`dependencies`) | 3 (`bluebird`, `node-telegram-bot-api`, `socks-proxy-agent`) |
| Dev (`devDependencies`) | 5 (eslint, eslint-config-prettier, eslint-plugin-prettier, husky, prettier) |
| Overrides | 1 (`tough-cookie ^4.1.3`) |
| Transitive (full `npm ls --all` count) | 218 |

Open Dependabot advisories on the default branch: **5** (after the V17.3.1 `tough-cookie` override cleared one). All transit through the deprecated `request` stack pulled in by `node-telegram-bot-api`.

## Repository activity

| Metric | Value |
|--------|------|
| First commit | 2016-01-09 |
| Total commits | 583 |
| Active branch | `master` |
| Releases on GitHub | up to and including V17.3.1 |
| Top contributors | windka (185), Karl-Heinz Wind (174), windkh (126 — same author, different identities), StephanStS (30), Marcus K (9), dependabot[bot] (9), Vladimir Dronnikov (8) |
| Recent release pace | V17.1.x → V17.2.0 → V17.3.0 → V17.3.1 in ~6 weeks (Mar — May 2026) |

Including the recent V17.2 / V17.3 batch, ~80 commits in the last two months — mostly reliability / security / refactor work documented in the ADR set.

## Examples shipped

49 example flow files in `examples/`, covering keyboards, commands, polls, payments, file download, dynamic auth, external receivers, and live location.

## Quality index (composite)

A handwave aggregate over: lint cleanliness (1.0), test coverage (0.0), open security advisories (0.55 → 5/9 fixed), open issue freshness (0.7), refactor backlog size (0.6). Roughly **0.55 / 1.00** today.

The same composite a month ago — before the V17.2 / V17.3 work — would have been around **0.3 / 1.00** (most known issues unfixed; eval; multiple silent leaks; token in logs; tough-cookie open). Most of the recent uplift comes from the bug-fix backlog being worked down, not from added tooling — which is why "add tests" remains the single biggest next move.

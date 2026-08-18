# AGENTS.md — node-red-contrib-telegrambot

<!-- BEGIN node-red-standards:managed (do not edit — run `nrstd sync`) -->

> These shared rules are maintained centrally in **node-red-standards** and refreshed here by
> `nrstd sync`. Do not edit between the managed markers — change the standard instead. Everything
> below the managed block (the "Project-specific rules" section) is yours and is never overwritten.

## Shared: Architecture

- Node packages are modular: `lib/` holds framework-independent, unit-testable core logic;
  `nodes/` holds one file per Node-RED node; `icons/` holds node icons.
- The registered entry file (`<pkg>/99-<name>.js`) is a thin delegator that only `require`s and
  registers the modules in `nodes/`. Keep runtime glue thin.
- Record non-trivial design decisions as an ADR in `doc/architecture/adr/`.

## Shared: Code style

- Lint: ESLint flat config (`eslint.config.js`), ESLint >= 10. Run the lint script before committing.
  `eslint` and `@eslint/js` must stay on the same major: `@eslint/js@10` peers on `eslint@^10`, and
  pairing `eslint@10` with `@eslint/js@9` silently keeps the v9 recommended rule set.
- ESLint 10's recommended set adds `no-unassigned-vars` and `no-useless-assignment`. Both are errors:
  don't declare a binding only to pass `undefined` around, and don't assign a value no later
  statement reads.
- Format: Prettier (`.prettierrc.json`) — 4-space indent, single quotes, es5 trailing commas.
- Target Node.js >= 20.
- Avoid `var` — use `const`, or `let` only when the binding is reassigned (enforced by `no-var` / `prefer-const`).
- One statement per line — don't pack multiple instructions onto a single line; keep lines simple to read (enforced by `max-statements-per-line`).
- Keep functions short, with a single exit:
    - **One exit per function.** A function leaves in exactly one place: its last statement. This
      includes guard clauses — an early `return` in a precondition check is still a second exit and is
      not allowed. Assign to a single result and return it as the last statement. `throw` is the one
      permitted exception, because it is not a return and a `finally` still runs.
    - **Validate by nesting, not by leaving.** State the precondition as the condition that must hold
      and put the work inside it, with the error path in the `else`. Where the caller is code, `throw`
      instead; where the caller is a Node-RED flow, the `else` calls the error path.
    - **Keep functions short enough that the nesting does not matter.** The objection to nesting is
      really an objection to long functions — at a readable length, one or two levels of indentation
      cost nothing. If the nesting starts to hurt, extract a function; never add a second exit.
    - **Most likely case first within each branch**, so a reader meets what the function normally does
      before the exceptions.
    - **If every path must do trailing work, put that work in `finally`** rather than repeating it
      before each exit — combined with the single exit this makes the epilogue unskippable.
- No defensive programming. Do not check for states that cannot occur, and do not guard against
  hypothetical future changes to code you control. Validate input at the boundary and then trust it.

## Shared: Tests

- Node's built-in test runner (`node --test`) + `node-red-node-test-helper`. Tests live in `test/` as `*.test.js`.
  Import `{ describe, it }` from `node:test` and assert with `node:assert`. Coverage via `c8`.
- Node's default discovery runs **every** `.js` under `test/`, whatever it is named, so shared helpers and
  fixtures belong outside that directory (e.g. `test-helpers/`). The test script deliberately takes no path
  arguments: a `'test/**/*.test.js'` glob would need Node >= 21 and fails on Node 20, which is still supported.
- The test script deliberately has **no `--test-force-exit`**. It calls `process.exit()` as soon as the last
  test finishes, racing libuv's teardown of undici keep-alive sockets and mock HTTP servers — on Windows that
  aborts the process _after_ the results are in, so the runner marks a whole file failed while every test in
  it passed (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`). A suite that exits on its own has
  also _proved_ it leaks no handles, which the flag hides. If the suite ever stops exiting, find the open
  handle — don't reinstate the flag.
- `test-helpers/fake-red.js` is a minimal Node-RED stand-in shipped by the standard. A node file exports
  `function (RED) {…}`, so without a RED object its contents cannot run at all — which is why node files
  tend to sit at 0% coverage while the logic extracted from them is well covered. Use it to instantiate a
  node and drive its input handler, with `nock` intercepting the requests it makes, so the assertion is
  about what actually went to the device rather than what a parser intended.

## Shared: Documentation

- `README.md` is user-facing. Architecture docs live under `doc/architecture/`
  (`overview.md`, `structural-design.md`, `behavioural-design.md`, `adr/`).
- Update `CHANGELOG.md` (Keep a Changelog style) for every user-visible change; bump the
  patch version in `package.json` in the same commit.

## Shared: Workflow

- CI (`.github/workflows/node.js.yml`) must pass: lint, format:check, test, coverage. The coverage
  report is uploaded as a build artifact, so a threshold failure can be inspected from the run.
- Releases go through `.github/workflows/npm-publish.yml`. It re-runs lint, format:check and test in a
  `build` job and publishes only on `needs: build` — a release is cut from a tag, and nothing guarantees
  that tag points at a commit CI ever saw. `npm publish` is irreversible, so the gate is not optional.
- `.github/workflows/standards-check.yml` runs `nrstd audit` and fails the build on drift from the standard.
- Never bump the major version without an ADR explaining the breaking change.

## Shared: package.json scripts

`lint`, `lint:fix`, `format`, `format:check`, `test` (`node --test` with `--test-timeout=30000 --test-concurrency=1`, no path args), `coverage` / `coverage:check` (c8 over `npm test`).

<!-- END node-red-standards:managed -->

## Project-specific rules

<!-- Repo-specific rules go here. `nrstd sync` never touches this section. -->

### CI matrix: Node 22/24, not the standard's 20/22

`.github/workflows/node.js.yml` is a synced template, so `nrstd sync --force` would put
`node-version: [20.x, 22.x]` back. This package dropped Node 20 in V19 ([ADR 0010](doc/architecture/adr/0010-drop-node-20.md))
and declares `engines.node >= 22.19`, so a 20.x leg fails `npm ci` with `EBADENGINE`. Keep
`[22.x, 24.x]`; the standard's own baseline is still >=20, which is why the template differs.

Everything else in the workflows now matches the standard — the `--test-force-exit` removal, the
release gate, the pre-release `--tag beta` routing and the Git-resolved `nrstd audit` invocation all
live in the standard as of node-red-standards 0.4.1, so they are no longer deviations to track here.

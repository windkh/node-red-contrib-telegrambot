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
- Lint: ESLint flat config (`eslint.config.js`), ESLint >= 9. Run the lint script before committing.
- Format: Prettier (`.prettierrc.json`) — 4-space indent, single quotes, es5 trailing commas.
- Target Node.js >= 20.
- Avoid `var` — use `const`, or `let` only when the binding is reassigned (enforced by `no-var` / `prefer-const`).
- One statement per line — don't pack multiple instructions onto a single line; keep lines simple to read (enforced by `max-statements-per-line`).
- Single exit — each function has exactly one `return`, placed as its final statement; avoid early or multiple returns.

## Shared: Tests
- Node's built-in test runner (`node --test`) + `node-red-node-test-helper`. Tests live in `test/` as `*.test.js`.
  Import `{ describe, it }` from `node:test` and assert with `node:assert`. Coverage via `c8`.

## Shared: Documentation
- `README.md` is user-facing. Architecture docs live under `doc/architecture/`
  (`overview.md`, `structural-design.md`, `behavioural-design.md`, `adr/`).
- Update `CHANGELOG.md` (Keep a Changelog style) for every user-visible change; bump the
  patch version in `package.json` in the same commit.

## Shared: Workflow
- CI (`.github/workflows/node.js.yml`) must pass: lint, format:check, test, coverage.
- Releases go through `.github/workflows/npm-publish.yml`.
- Never bump the major version without an ADR explaining the breaking change.

## Shared: package.json scripts
`lint`, `lint:fix`, `format`, `format:check`, `test` (`node --test`), `coverage` (`c8 node --test`), `coverage:check`.

<!-- END node-red-standards:managed -->

## Project-specific rules

<!-- Repo-specific rules go here. `nrstd sync` never touches this section. -->

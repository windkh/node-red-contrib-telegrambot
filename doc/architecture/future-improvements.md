# Future Improvements

Beyond the refactoring backlog ([recommendations-for-refactoring.md](recommendations-for-refactoring.md)), these are larger directions worth thinking about. They are features or rearchitectures, not bug fixes.

## Transport modernization

### Move off the deprecated `request` stack

**Why.** `node-telegram-bot-api → @cypress/request-promise → request-promise-core` peer-depends on the legacy `request@2.88.2` package, which is the single source of all the open transitive Dependabot advisories on the repo (`@cypress/request`, `qs`, `ip`, `socks`, `brace-expansion`, `cross-spawn`, `form-data`). Pinning `tough-cookie` via npm overrides clears one of them ([ADR 0006](adr/0006-tough-cookie-override.md)); the rest need the underlying stack replaced.

**Three viable paths**, in order of effort:

1. **Wait for upstream `node-telegram-bot-api`** to switch off `request`. Has not happened in years. Not a plan, but should be tracked.
2. **Fork `node-telegram-bot-api`** as `@windkh/node-telegram-bot-api` and modernise its HTTP client to `undici` or `node-fetch`. Substantial maintenance commitment.
3. **Build a thin internal Telegram client** that covers the methods this plugin actually uses (the sender's switch ≈ 60 unique methods) and drop `node-telegram-bot-api` entirely. Most ambitious but gives complete control.

Path 3 is probably the right long-term answer: the Bot API surface is fully documented, the request shapes are stable, and we already wrap most call sites uniformly through `processResult` / `processError`. The hard parts are file upload (multipart) and the polling loop — both well-understood.

### Better connection-failure recovery

Covered as a near-term refactor in [recommendations-for-refactoring.md](recommendations-for-refactoring.md) §3 (backoff-aware auto-restart). The future-improvement angle is **observability**: emit a Node-RED status event when the bot enters backoff and another when it recovers, so users can wire alerts. The control node would be a natural place to surface these as messages.

## Feature additions

### Dynamic webhook URL update (#410)

Sketched in [recommendations-for-refactoring.md](recommendations-for-refactoring.md) §8. Useful for ngrok / cloudflare tunnel / dynamic DNS scenarios where the public URL changes across restarts.

### Bot-to-bot routing

The current model is one config node = one bot. Several users have asked for a way to route an incoming message to a different bot's outbound flow without manually wiring chat IDs. A `route` node that reads the bot identity from the message and selects an outbound config could be a clean abstraction — but it implies bot-to-bot security questions worth thinking through first.

### First-class typed payloads

`converter.js`'s `convertMessage` projects Telegram updates into a flat `msg.payload` shape that has grown organically. A TypeScript declaration file (`telegrambot.d.ts`) shipped with the package would give flow authors IntelliSense in VS Code's Node-RED extension. The shapes already exist informally; this is purely a "write them down once" exercise.

### Long-poll / webhook hybrid

Some operators want webhook for low-latency receipt of common events and polling as a fallback for reliability. This isn't a Telegram capability — only one of (`getUpdates`, `setWebHook`) is active at a time — but the *node* could switch modes automatically based on health (webhook → polling if `setWebHook` keeps failing). Substantial change to the config node lifecycle; weigh against simpler "rebuild on fatal" recovery.

## Architecture: optional separation of concerns

### Worker thread for blob downloads

`in-node.js`'s blob path (photo / audio / document / etc.) calls `bot.getFileLink` and then `bot.downloadFile`, both of which can stream large bytes. Today this happens on the Node-RED main event loop. Pushing the download to `worker_threads` would isolate it from message processing — useful for users with large media flows and modest hardware (RPi-class).

Pre-requisite: agree on the boundary so the worker doesn't end up needing its own `node-telegram-bot-api` instance.

### Pluggable storage for `pendingCommands` / `commandsByLanguage`

Both are in-memory maps on the config node. They reset on Node-RED restart. For long-running command flows this means a pending command "asked the user to send a value" can be lost if the user takes too long. A small persistence layer (LevelDB / SQLite) keyed on `(token, chat, user)` would survive restarts.

### Test fixture: a stubbed Telegram server

For the test harness in [recommendations-for-refactoring.md](recommendations-for-refactoring.md) §1, a small `express`-based mock of the Bot API endpoints we use would let integration tests cover the bot lifecycle end-to-end without hitting the real API. The mock is small (~200 lines), the leverage is enormous.

## Governance / process

- **CI**: there is no CI configuration in the repo today (no `.github/workflows/`). Once tests exist, add a workflow that runs lint + tests on every PR. Trivial in scope, big jump in confidence.
- **Release automation**: the version bump + tag + GitHub release is done manually today. A `release.yml` triggered by pushing a `V*` tag (or by a manual workflow_dispatch) would standardise the release notes format.
- **CHANGELOG generation**: currently hand-written. Once commits follow the conventional-commit shape consistently (most recent ones do), `git-cliff` or `conventional-changelog` can produce the changelog automatically.

## Long-term: rewrite candidates

These are intentionally speculative:

- **TypeScript**. The codebase is small enough (~4 KLOC) to migrate incrementally. Largest payoff would be on `converter.js`'s shape contracts.
- **A separate `node-red-contrib-telegrambot-core` package** that holds the transport + converter, with multiple thin "feature" packages (`-payments`, `-stickers`, etc.) on top. Lets users pick what they install. Probably not worth the packaging overhead at current scale.
- **Replacing Node-RED node registration with a generator** that walks a declarative spec of node types. Heavily debated within the Node-RED community; would not be a project-local decision.

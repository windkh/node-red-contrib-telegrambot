# ADR 0006 — npm `overrides` to force safe `tough-cookie` transitively

## Status
Accepted. Landed in V17.3.1 (commit `6d4f2bb`).

## Context

GHSA-72xf-g2v4-qvf3 is a prototype-pollution advisory affecting `tough-cookie@<4.1.3`. Our actual dependency chain is:

```
node-telegram-bot-api 0.66.0
  @cypress/request-promise 5.0.0
    request-promise-core 1.1.3              (peerDependency: request ^2.34)
      request 2.88.2                        (deprecated)
        tough-cookie ~2.5.0                 (vulnerable)
```

`request-promise-core`'s peer dependency pins the legacy `request@2.88.2` package, which itself pins `tough-cookie@~2.5.0`. Dependabot opened a PR but could not auto-resolve it: the constraints leave no satisfying version. The upstream chain has been frozen for years and there is no realistic path to a deprecation-aware upgrade unless `node-telegram-bot-api` drops `request-promise-core` altogether — which it hasn't, even in 0.67.0.

Alternatives considered:

- **Wait for upstream.** Indefinite — the deprecated `request` stack has been in this state for years.
- **Fork `node-telegram-bot-api`.** Too heavy for one transitive CVE.
- **`npm audit fix --force`.** Would propose downgrading `node-telegram-bot-api` to `0.63.0` (breaking).
- **npm `overrides`** (the recommended modern remediation for exactly this scenario).

## Decision

Add an `overrides` block to `package.json`:

```json
"overrides": {
    "tough-cookie": "^4.1.3"
}
```

npm ≥ 8.3 applies the override transitively, so *every* `tough-cookie` resolution in the tree (including the nested one under legacy `request`) hops to `4.1.4`. Confirmed via `npm ls tough-cookie`:

```
node-red-contrib-telegrambot
└─ node-telegram-bot-api
   ├─ @cypress/request-promise
   │  ├─ request-promise-core
   │  │  └─ request
   │  │     └─ tough-cookie 4.1.4 deduped
   │  └─ tough-cookie 4.1.4
   └─ @cypress/request
      └─ tough-cookie 4.1.4 deduped
```

`npm audit` no longer reports the advisory.

## Consequences

- **Dependabot is unblocked** for this advisory.
- **Compatibility risk** is small: `request@2.88.2` uses `tough-cookie`'s `CookieJar`, `getCookieString`, `setCookie` interfaces, all stable from 2.x → 4.x. For Telegram bot calls (stateless outbound HTTPS, cookies essentially never executed) this is effectively a no-op.
- **The override is engine-gated**: users installing on npm < 8.3 won't see it applied. Realistic install footprint (Node 14+ ships npm 6/7; Node 16+ ships npm 8+) means most fresh installs honour it. Older installs are no worse off than before.
- **Other transitive advisories remain** (`@cypress/request`, `qs`, `ip`, `brace-expansion`, ...). The durable cure is still an upstream refresh of `node-telegram-bot-api` off the deprecated `request` stack — not something this project can drive alone.
- **Easy to revert** if a real incompatibility surfaces: delete the override block, run `npm install`.

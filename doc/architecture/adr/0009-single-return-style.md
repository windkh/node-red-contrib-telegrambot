# ADR 0009 — New functions use a single `return` at the end

## Status
Accepted. Project convention; not enforced by ESLint.

## Context

The existing codebase consistently writes functions in a single-exit-point style:

```js
this.getBotToken = function (botToken) {
    botToken = this.credentials.token;
    if (botToken !== undefined) {
        botToken = botToken.trim();
        if (botToken.startsWith('{') && botToken.endsWith('}')) {
            let expression = botToken.substr(1, botToken.length - 2);
            botToken = evalContextExpression(self, expression);
        }
    }
    return botToken;   // <-- the only return
};
```

This is not a hard mechanical rule — early `return`s exist in a few places, notably `processCurrent` in the queue manager and the early-abort branches in the config-node constructor. But for **newly added** helper functions, the project prefers single-exit. The pattern matters most for non-trivial functions with multiple branches; a guard-clause return is fine when there's nothing else to do.

This was made explicit during the V17.2.0 / V17.3.0 work after a few iterations of new helpers (`parseStringArgList`, `evalContextExpression`, `sendChunks`) that originally used guard-clause returns.

## Decision

For functions *added* to this codebase:

1. Declare a result variable at the top.
2. Branch with `if` / `else if` / `else` chains that assign to the variable.
3. Return the variable once at the end.

Throws (re-throwing inside a `catch` to propagate an exception) are not counted as returns and remain allowed. Early `return` is allowed only in trivial guard-clause cases where the function body is one line after the guard.

In code:

```js
// Preferred for non-trivial helpers
function evalContextExpression(node, expression) {
    let result;
    const trimmed = String(expression).trim();
    const match = trimmed.match(EXPR_REGEX);
    if (match) {
        // ... assigns to result ...
    }
    return result;
}

// Trivial guard, acceptable
function hasContent(msg) {
    if (!msg.payload.content) {
        node.warn('msg.payload.content is empty');
        return false;
    }
    return true;
}
```

## Consequences

- **Readability** — for branched logic, the reader can scan top-to-bottom and see exactly one exit. No "did I miss a return three branches up?" moment.
- **Stepwise debugging** — a single breakpoint at the return inspects the final result regardless of branch taken.
- **Slightly more verbose** than guard-clauses; that's accepted.
- **ESLint not configured to enforce it** — the rule (`consistent-return`, or `max-statements` style) doesn't cleanly express "guard clauses ok, branched returns not". Enforcement is by code review.
- **Existing functions are not rewritten** retroactively unless touched for other reasons.

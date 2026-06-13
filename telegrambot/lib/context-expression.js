// Parses a comma-separated list of single- or double-quoted string literals.
// Returns the array of decoded strings, or null if the input is not a valid list of string literals.
// Exposed so it can be unit-tested directly without a RED runtime.
function parseStringArgList(input) {
    const args = [];
    let ok = true;
    let i = 0;
    const skipWs = function () {
        while (i < input.length && /\s/.test(input[i])) i++;
    };
    skipWs();
    while (ok && i < input.length) {
        const quote = input[i];
        if (quote !== '"' && quote !== "'") {
            ok = false;
        } else {
            i++;
            let val = '';
            while (i < input.length && input[i] !== quote) {
                if (input[i] === '\\' && i + 1 < input.length) {
                    const next = input[i + 1];
                    val += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
                    i += 2;
                } else {
                    val += input[i++];
                }
            }
            if (input[i] !== quote) {
                ok = false;
            } else {
                i++;
                args.push(val);
                skipWs();
                if (i < input.length) {
                    if (input[i] !== ',') {
                        ok = false;
                    } else {
                        i++;
                        skipWs();
                    }
                }
            }
        }
    }
    return ok ? args : null;
}

// Safely evaluates the small subset of expressions allowed in token / usernames / chatids fields.
// Supported forms (see README):
//   flow.get("key"[, "store"])     flow.keys()
//   global.get("key"[, "store"])   global.keys()
//   context.get("key"[, "store"])  context.keys()
//   context.flow.get(...)          context.global.get(...)
//   env.get("VAR")
// Anything else evaluates to undefined.
// Exposed so it can be unit-tested directly without a RED runtime.
function evalContextExpression(node, expression) {
    let result;
    const trimmed = String(expression).trim();
    const match = trimmed.match(/^(flow|global|context|env)(?:\.(flow|global))?\.(get|keys)\s*\(([\s\S]*)\)\s*$/);
    if (match) {
        const [, scope, subScope, method, argsRaw] = match;
        const args = parseStringArgList(argsRaw);
        if (args !== null) {
            if (scope === 'env') {
                if (!subScope && method === 'get' && args.length === 1) {
                    try {
                        result = node._flow.getSetting(args[0]);
                    } catch (e) {
                        // ignore — result stays undefined
                    }
                }
            } else {
                let target;
                const ctx = node.context();
                if (scope === 'context') {
                    target = subScope ? ctx[subScope] : ctx;
                } else if (!subScope) {
                    target = ctx[scope];
                }
                if (target && typeof target[method] === 'function') {
                    try {
                        result = target[method](...args);
                    } catch (e) {
                        // ignore — result stays undefined
                    }
                }
            }
        }
    }
    return result;
}

module.exports = { evalContextExpression, parseStringArgList };

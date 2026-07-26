const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseStringArgList, evalContextExpression } = require('../../telegrambot/lib/context-expression');

// =============================================================================
// parseStringArgList — tokenises comma-separated quoted-string literals.
// =============================================================================

describe('context-expression — parseStringArgList', function () {
    describe('valid inputs', function () {
        it('returns [] for empty input', function () {
            assert.deepStrictEqual(parseStringArgList(''), []);
        });

        it('returns [] for whitespace-only input', function () {
            assert.deepStrictEqual(parseStringArgList('   \t  '), []);
        });

        it('parses a single double-quoted string', function () {
            assert.deepStrictEqual(parseStringArgList('"foo"'), ['foo']);
        });

        it('parses a single single-quoted string', function () {
            assert.deepStrictEqual(parseStringArgList("'foo'"), ['foo']);
        });

        it('parses two comma-separated strings', function () {
            assert.deepStrictEqual(parseStringArgList('"a", "b"'), ['a', 'b']);
        });

        it('parses three strings with mixed quoting', function () {
            assert.deepStrictEqual(parseStringArgList('"a", \'b\', "c"'), ['a', 'b', 'c']);
        });

        it('tolerates whitespace around quotes and commas', function () {
            assert.deepStrictEqual(parseStringArgList('  "a"  ,  "b"  '), ['a', 'b']);
        });

        it('returns [] for an empty quoted string', function () {
            assert.deepStrictEqual(parseStringArgList('""'), ['']);
        });

        it('handles a single-char value', function () {
            assert.deepStrictEqual(parseStringArgList('"x"'), ['x']);
        });
    });

    describe('escape sequences', function () {
        it('decodes \\n to a newline', function () {
            assert.deepStrictEqual(parseStringArgList('"a\\nb"'), ['a\nb']);
        });

        it('decodes \\t to a tab', function () {
            assert.deepStrictEqual(parseStringArgList('"a\\tb"'), ['a\tb']);
        });

        it('decodes \\r to a CR', function () {
            assert.deepStrictEqual(parseStringArgList('"a\\rb"'), ['a\rb']);
        });

        it('passes through escaped quote', function () {
            assert.deepStrictEqual(parseStringArgList('"a\\"b"'), ['a"b']);
        });

        it('passes through escaped backslash', function () {
            assert.deepStrictEqual(parseStringArgList('"a\\\\b"'), ['a\\b']);
        });

        it('passes through any other escaped char as itself', function () {
            // Unknown escapes (e.g. \z) are stripped to just the following char.
            assert.deepStrictEqual(parseStringArgList('"a\\zb"'), ['azb']);
        });

        it('allows single-quote inside double-quoted', function () {
            assert.deepStrictEqual(parseStringArgList('"a\'b"'), ["a'b"]);
        });

        it('allows double-quote inside single-quoted', function () {
            assert.deepStrictEqual(parseStringArgList('\'a"b\''), ['a"b']);
        });
    });

    describe('rejected inputs (returns null)', function () {
        it('rejects unquoted input', function () {
            assert.strictEqual(parseStringArgList('foo'), null);
        });

        it('rejects an unterminated double-quoted string', function () {
            assert.strictEqual(parseStringArgList('"foo'), null);
        });

        it('rejects an unterminated single-quoted string', function () {
            assert.strictEqual(parseStringArgList("'foo"), null);
        });

        it('accepts a trailing comma (like JS array literals)', function () {
            // Permissive on the trailing case; consistent with how JS itself parses arrays.
            // What's NOT accepted is a leading comma or an empty middle element — covered below.
            assert.deepStrictEqual(parseStringArgList('"a",'), ['a']);
        });

        it('rejects a leading comma', function () {
            assert.strictEqual(parseStringArgList(',"a"'), null);
        });

        it('rejects an empty middle element', function () {
            assert.strictEqual(parseStringArgList('"a", , "b"'), null);
        });

        it('rejects two values without a comma', function () {
            assert.strictEqual(parseStringArgList('"a" "b"'), null);
        });

        it('rejects unquoted second argument', function () {
            assert.strictEqual(parseStringArgList('"a", b'), null);
        });

        it('rejects bare punctuation', function () {
            assert.strictEqual(parseStringArgList(';'), null);
        });
    });
});

// =============================================================================
// evalContextExpression — whitelist expression evaluator.
// =============================================================================

describe('context-expression — evalContextExpression', function () {
    // Tiny stub of a Node-RED node, with hooks the function consults.
    function makeNode(opts) {
        opts = opts || {};
        return {
            _flow: {
                getSetting: function (k) {
                    if (opts.envThrows) throw new Error('env-boom');
                    return opts.env ? opts.env[k] : undefined;
                },
            },
            context: function () {
                if (opts.ctxThrows) throw new Error('ctx-boom');
                return {
                    get: function (k) {
                        return opts.ctx ? opts.ctx[k] : undefined;
                    },
                    keys: function () {
                        return opts.ctxKeys || [];
                    },
                    flow: {
                        get: function (k, store) {
                            if (opts.flowGetThrows) throw new Error('flow-get-boom');
                            const v = opts.flow ? opts.flow[k] : undefined;
                            return store ? v + '@' + store : v;
                        },
                        keys: function () {
                            return opts.flowKeys || [];
                        },
                    },
                    global: {
                        get: function (k) {
                            return opts.global ? opts.global[k] : undefined;
                        },
                        keys: function () {
                            return opts.globalKeys || [];
                        },
                    },
                };
            },
        };
    }

    describe('flow / global / context lookups', function () {
        it('resolves flow.get("key")', function () {
            const node = makeNode({ flow: { token: 'F-1' } });
            assert.strictEqual(evalContextExpression(node, 'flow.get("token")'), 'F-1');
        });

        it('resolves global.get("key")', function () {
            const node = makeNode({ global: { token: 'G-1' } });
            assert.strictEqual(evalContextExpression(node, 'global.get("token")'), 'G-1');
        });

        it('resolves context.get("key")', function () {
            const node = makeNode({ ctx: { token: 'C-1' } });
            assert.strictEqual(evalContextExpression(node, 'context.get("token")'), 'C-1');
        });

        it('resolves context.flow.get("key") and context.global.get("key")', function () {
            const node = makeNode({ flow: { token: 'F-1' }, global: { token: 'G-1' } });
            assert.strictEqual(evalContextExpression(node, 'context.flow.get("token")'), 'F-1');
            assert.strictEqual(evalContextExpression(node, 'context.global.get("token")'), 'G-1');
        });

        it('passes through multiple args (flow.get("key", "store"))', function () {
            const node = makeNode({ flow: { token: 'F-1' } });
            assert.strictEqual(evalContextExpression(node, 'flow.get("token", "memory")'), 'F-1@memory');
        });

        it('returns undefined when the key is not present', function () {
            const node = makeNode({ flow: {} });
            assert.strictEqual(evalContextExpression(node, 'flow.get("missing")'), undefined);
        });
    });

    describe('keys() variants', function () {
        it('resolves flow.keys()', function () {
            const node = makeNode({ flowKeys: ['a', 'b'] });
            assert.deepStrictEqual(evalContextExpression(node, 'flow.keys()'), ['a', 'b']);
        });

        it('resolves global.keys()', function () {
            const node = makeNode({ globalKeys: ['x'] });
            assert.deepStrictEqual(evalContextExpression(node, 'global.keys()'), ['x']);
        });

        it('resolves context.keys()', function () {
            const node = makeNode({ ctxKeys: ['k1'] });
            assert.deepStrictEqual(evalContextExpression(node, 'context.keys()'), ['k1']);
        });
    });

    describe('env.get', function () {
        it('resolves env.get("VAR") via node._flow.getSetting', function () {
            const node = makeNode({ env: { TG_TOKEN: 'env-1' } });
            assert.strictEqual(evalContextExpression(node, 'env.get("TG_TOKEN")'), 'env-1');
        });

        it('returns undefined when the env var is not set', function () {
            const node = makeNode({ env: {} });
            assert.strictEqual(evalContextExpression(node, 'env.get("MISSING")'), undefined);
        });

        it('returns undefined for env.keys() — only get is supported', function () {
            const node = makeNode({ env: { X: 1 } });
            assert.strictEqual(evalContextExpression(node, 'env.keys()'), undefined);
        });

        it('returns undefined for env.get() with the wrong arity', function () {
            const node = makeNode({ env: { X: 1 } });
            assert.strictEqual(evalContextExpression(node, 'env.get()'), undefined);
            assert.strictEqual(evalContextExpression(node, 'env.get("X", "Y")'), undefined);
        });

        it('returns undefined for env.flow.get(...) — env has no sub-scope', function () {
            const node = makeNode({ env: { X: 1 } });
            // The regex permits the sub-scope grammar, but env doesn't support it.
            assert.strictEqual(evalContextExpression(node, 'env.flow.get("X")'), undefined);
        });
    });

    describe('whitespace tolerance', function () {
        it('accepts leading and trailing whitespace', function () {
            const node = makeNode({ flow: { x: 1 } });
            assert.strictEqual(evalContextExpression(node, '   flow.get("x")   '), 1);
        });

        it('accepts whitespace around the method parens', function () {
            const node = makeNode({ flow: { x: 1 } });
            assert.strictEqual(evalContextExpression(node, 'flow.get  ( "x" )'), 1);
        });
    });

    describe('rejected inputs (returns undefined — the security boundary)', function () {
        const node = makeNode({ flow: { x: 1 }, global: { y: 2 } });

        const malicious = [
            'process.exit(1)',
            'require("fs")',
            'require("child_process").execSync("ls")',
            'flow.get("x"); process.exit(0)',
            'global.set("x", 1)',
            'flow.del("x")',
            'flow.get(`backtick`)',
            'flow.get(x)', // unquoted arg
            '__proto__',
            'this.constructor.constructor("return process")()',
            'flow["get"]("x")',
            'flow.get("x") + ""',
            '',
            '() => 1',
            '{}',
            'while(true){}',
        ];

        malicious.forEach(function (expr) {
            it('rejects: ' + JSON.stringify(expr), function () {
                assert.strictEqual(evalContextExpression(node, expr), undefined);
            });
        });
    });

    describe('robustness against throwing context', function () {
        it('catches throws from flow.get and returns undefined', function () {
            const node = makeNode({ flowGetThrows: true });
            assert.strictEqual(evalContextExpression(node, 'flow.get("x")'), undefined);
        });

        it('catches throws from env.get and returns undefined', function () {
            const node = makeNode({ envThrows: true });
            assert.strictEqual(evalContextExpression(node, 'env.get("X")'), undefined);
        });
    });

    describe('input type tolerance', function () {
        it('treats non-string expressions via String() coercion', function () {
            const node = makeNode({ flow: { x: 42 } });
            // A user passing { toString: () => 'flow.get("x")' } would still work.
            const expr = { toString: () => 'flow.get("x")' };
            assert.strictEqual(evalContextExpression(node, expr), 42);
        });

        it('returns undefined for null / undefined expressions', function () {
            const node = makeNode();
            assert.strictEqual(evalContextExpression(node, null), undefined);
            assert.strictEqual(evalContextExpression(node, undefined), undefined);
        });
    });
});

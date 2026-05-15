const { expect } = require('chai');
const { parseStringArgList, evalContextExpression, formatErrorChain } = require('../../telegrambot/nodes/bot-node').__test;

// =============================================================================
// parseStringArgList — tokenises comma-separated quoted-string literals.
// =============================================================================

describe('bot-node — parseStringArgList', function () {
    describe('valid inputs', function () {
        it('returns [] for empty input', function () {
            expect(parseStringArgList('')).to.deep.equal([]);
        });

        it('returns [] for whitespace-only input', function () {
            expect(parseStringArgList('   \t  ')).to.deep.equal([]);
        });

        it('parses a single double-quoted string', function () {
            expect(parseStringArgList('"foo"')).to.deep.equal(['foo']);
        });

        it('parses a single single-quoted string', function () {
            expect(parseStringArgList("'foo'")).to.deep.equal(['foo']);
        });

        it('parses two comma-separated strings', function () {
            expect(parseStringArgList('"a", "b"')).to.deep.equal(['a', 'b']);
        });

        it('parses three strings with mixed quoting', function () {
            expect(parseStringArgList('"a", \'b\', "c"')).to.deep.equal(['a', 'b', 'c']);
        });

        it('tolerates whitespace around quotes and commas', function () {
            expect(parseStringArgList('  "a"  ,  "b"  ')).to.deep.equal(['a', 'b']);
        });

        it('returns [] for an empty quoted string', function () {
            expect(parseStringArgList('""')).to.deep.equal(['']);
        });

        it('handles a single-char value', function () {
            expect(parseStringArgList('"x"')).to.deep.equal(['x']);
        });
    });

    describe('escape sequences', function () {
        it('decodes \\n to a newline', function () {
            expect(parseStringArgList('"a\\nb"')).to.deep.equal(['a\nb']);
        });

        it('decodes \\t to a tab', function () {
            expect(parseStringArgList('"a\\tb"')).to.deep.equal(['a\tb']);
        });

        it('decodes \\r to a CR', function () {
            expect(parseStringArgList('"a\\rb"')).to.deep.equal(['a\rb']);
        });

        it('passes through escaped quote', function () {
            expect(parseStringArgList('"a\\"b"')).to.deep.equal(['a"b']);
        });

        it('passes through escaped backslash', function () {
            expect(parseStringArgList('"a\\\\b"')).to.deep.equal(['a\\b']);
        });

        it('passes through any other escaped char as itself', function () {
            // Unknown escapes (e.g. \z) are stripped to just the following char.
            expect(parseStringArgList('"a\\zb"')).to.deep.equal(['azb']);
        });

        it('allows single-quote inside double-quoted', function () {
            expect(parseStringArgList('"a\'b"')).to.deep.equal(["a'b"]);
        });

        it('allows double-quote inside single-quoted', function () {
            expect(parseStringArgList('\'a"b\'')).to.deep.equal(['a"b']);
        });
    });

    describe('rejected inputs (returns null)', function () {
        it('rejects unquoted input', function () {
            expect(parseStringArgList('foo')).to.equal(null);
        });

        it('rejects an unterminated double-quoted string', function () {
            expect(parseStringArgList('"foo')).to.equal(null);
        });

        it('rejects an unterminated single-quoted string', function () {
            expect(parseStringArgList("'foo")).to.equal(null);
        });

        it('accepts a trailing comma (like JS array literals)', function () {
            // Permissive on the trailing case; consistent with how JS itself parses arrays.
            // What's NOT accepted is a leading comma or an empty middle element — covered below.
            expect(parseStringArgList('"a",')).to.deep.equal(['a']);
        });

        it('rejects a leading comma', function () {
            expect(parseStringArgList(',"a"')).to.equal(null);
        });

        it('rejects an empty middle element', function () {
            expect(parseStringArgList('"a", , "b"')).to.equal(null);
        });

        it('rejects two values without a comma', function () {
            expect(parseStringArgList('"a" "b"')).to.equal(null);
        });

        it('rejects unquoted second argument', function () {
            expect(parseStringArgList('"a", b')).to.equal(null);
        });

        it('rejects bare punctuation', function () {
            expect(parseStringArgList(';')).to.equal(null);
        });
    });
});

// =============================================================================
// evalContextExpression — whitelist expression evaluator.
// =============================================================================

describe('bot-node — evalContextExpression', function () {
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
            expect(evalContextExpression(node, 'flow.get("token")')).to.equal('F-1');
        });

        it('resolves global.get("key")', function () {
            const node = makeNode({ global: { token: 'G-1' } });
            expect(evalContextExpression(node, 'global.get("token")')).to.equal('G-1');
        });

        it('resolves context.get("key")', function () {
            const node = makeNode({ ctx: { token: 'C-1' } });
            expect(evalContextExpression(node, 'context.get("token")')).to.equal('C-1');
        });

        it('resolves context.flow.get("key") and context.global.get("key")', function () {
            const node = makeNode({ flow: { token: 'F-1' }, global: { token: 'G-1' } });
            expect(evalContextExpression(node, 'context.flow.get("token")')).to.equal('F-1');
            expect(evalContextExpression(node, 'context.global.get("token")')).to.equal('G-1');
        });

        it('passes through multiple args (flow.get("key", "store"))', function () {
            const node = makeNode({ flow: { token: 'F-1' } });
            expect(evalContextExpression(node, 'flow.get("token", "memory")')).to.equal('F-1@memory');
        });

        it('returns undefined when the key is not present', function () {
            const node = makeNode({ flow: {} });
            expect(evalContextExpression(node, 'flow.get("missing")')).to.be.undefined;
        });
    });

    describe('keys() variants', function () {
        it('resolves flow.keys()', function () {
            const node = makeNode({ flowKeys: ['a', 'b'] });
            expect(evalContextExpression(node, 'flow.keys()')).to.deep.equal(['a', 'b']);
        });

        it('resolves global.keys()', function () {
            const node = makeNode({ globalKeys: ['x'] });
            expect(evalContextExpression(node, 'global.keys()')).to.deep.equal(['x']);
        });

        it('resolves context.keys()', function () {
            const node = makeNode({ ctxKeys: ['k1'] });
            expect(evalContextExpression(node, 'context.keys()')).to.deep.equal(['k1']);
        });
    });

    describe('env.get', function () {
        it('resolves env.get("VAR") via node._flow.getSetting', function () {
            const node = makeNode({ env: { TG_TOKEN: 'env-1' } });
            expect(evalContextExpression(node, 'env.get("TG_TOKEN")')).to.equal('env-1');
        });

        it('returns undefined when the env var is not set', function () {
            const node = makeNode({ env: {} });
            expect(evalContextExpression(node, 'env.get("MISSING")')).to.be.undefined;
        });

        it('returns undefined for env.keys() — only get is supported', function () {
            const node = makeNode({ env: { X: 1 } });
            expect(evalContextExpression(node, 'env.keys()')).to.be.undefined;
        });

        it('returns undefined for env.get() with the wrong arity', function () {
            const node = makeNode({ env: { X: 1 } });
            expect(evalContextExpression(node, 'env.get()')).to.be.undefined;
            expect(evalContextExpression(node, 'env.get("X", "Y")')).to.be.undefined;
        });

        it('returns undefined for env.flow.get(...) — env has no sub-scope', function () {
            const node = makeNode({ env: { X: 1 } });
            // The regex permits the sub-scope grammar, but env doesn't support it.
            expect(evalContextExpression(node, 'env.flow.get("X")')).to.be.undefined;
        });
    });

    describe('whitespace tolerance', function () {
        it('accepts leading and trailing whitespace', function () {
            const node = makeNode({ flow: { x: 1 } });
            expect(evalContextExpression(node, '   flow.get("x")   ')).to.equal(1);
        });

        it('accepts whitespace around the method parens', function () {
            const node = makeNode({ flow: { x: 1 } });
            expect(evalContextExpression(node, 'flow.get  ( "x" )')).to.equal(1);
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
                expect(evalContextExpression(node, expr)).to.be.undefined;
            });
        });
    });

    describe('robustness against throwing context', function () {
        it('catches throws from flow.get and returns undefined', function () {
            const node = makeNode({ flowGetThrows: true });
            expect(evalContextExpression(node, 'flow.get("x")')).to.be.undefined;
        });

        it('catches throws from env.get and returns undefined', function () {
            const node = makeNode({ envThrows: true });
            expect(evalContextExpression(node, 'env.get("X")')).to.be.undefined;
        });
    });

    describe('input type tolerance', function () {
        it('treats non-string expressions via String() coercion', function () {
            const node = makeNode({ flow: { x: 42 } });
            // A user passing { toString: () => 'flow.get("x")' } would still work.
            const expr = { toString: () => 'flow.get("x")' };
            expect(evalContextExpression(node, expr)).to.equal(42);
        });

        it('returns undefined for null / undefined expressions', function () {
            const node = makeNode();
            expect(evalContextExpression(node, null)).to.be.undefined;
            expect(evalContextExpression(node, undefined)).to.be.undefined;
        });
    });
});

// =============================================================================
// formatErrorChain — leaf-message extraction for Bot error: log lines (#442 retest)
// =============================================================================

describe('bot-node — formatErrorChain', function () {
    it('returns the message for a plain Error', function () {
        expect(formatErrorChain(new Error('boom'))).to.equal('boom');
    });

    it('follows error.cause and returns the leaf message', function () {
        const leaf = new Error('connect ETIMEDOUT 149.154.166.110:443');
        const mid = new Error('RequestError');
        mid.cause = leaf;
        const top = new Error('AggregateError');
        top.cause = mid;
        expect(formatErrorChain(top)).to.equal('connect ETIMEDOUT 149.154.166.110:443');
    });

    it('expands AggregateError.errors and joins multiple leaf messages', function () {
        // Shape that Node emits when dual-stack connect fails on both v4 and v6 paths
        // — the exact case behind issue #442's "AggregateError" reports.
        const ipv4 = new Error('connect ETIMEDOUT 149.154.166.110:443');
        const ipv6 = new Error('connect ETIMEDOUT 2001:b28:f23d:f001::a:443');
        const agg = new Error('AggregateError');
        agg.errors = [ipv4, ipv6];
        const wrapped = new Error('RequestError');
        wrapped.cause = agg;
        const fatal = new Error('AggregateError');
        fatal.cause = wrapped;
        // Expected output covers both leaves; uses semicolon separator.
        const out = formatErrorChain(fatal);
        expect(out).to.include('149.154.166.110:443');
        expect(out).to.include('2001:b28:f23d:f001::a:443');
        expect(out).to.include('; ');
    });

    it('drops the FatalError/RequestError wrapper labels in favour of the leaves', function () {
        // Real-world #442 shape: FatalError("AggregateError") -> RequestError("AggregateError")
        // -> AggregateError [ETIMEDOUT] -> Error("connect ETIMEDOUT ...")
        const leaf = new Error('connect ETIMEDOUT 149.154.166.110:443');
        leaf.code = 'ETIMEDOUT';
        const agg = new Error('AggregateError [ETIMEDOUT]');
        agg.code = 'ETIMEDOUT';
        agg.errors = [leaf];
        const req = new Error('AggregateError');
        req.cause = agg;
        const fatal = new Error('AggregateError');
        fatal.code = 'SLIGHTLYBETTEREFATAL';
        fatal.cause = req;
        const out = formatErrorChain(fatal);
        // Should contain the actionable leaf, not the wrapper labels.
        expect(out).to.equal('connect ETIMEDOUT 149.154.166.110:443');
        expect(out).to.not.include('AggregateError');
        expect(out).to.not.include('RequestError');
        expect(out).to.not.include('SLIGHTLYBETTEREFATAL');
    });

    it('deduplicates identical leaf messages', function () {
        const leaf1 = new Error('socket hang up');
        const leaf2 = new Error('socket hang up');
        const agg = new Error('AggregateError');
        agg.errors = [leaf1, leaf2];
        expect(formatErrorChain(agg)).to.equal('socket hang up');
    });

    it('handles a cycle without infinite-looping', function () {
        const a = new Error('a');
        const b = new Error('b');
        a.cause = b;
        b.cause = a; // cycle
        // Should terminate and produce a usable string (depth limit + seen set guard it).
        const out = formatErrorChain(a);
        expect(out.length).to.be.greaterThan(0);
    });

    it('caps depth at 10 even if a malformed cause chain is very long', function () {
        // Build an 100-deep linear chain
        let cur = new Error('leaf-final');
        for (let i = 0; i < 100; i++) {
            const wrapper = new Error('wrapper-' + i);
            wrapper.cause = cur;
            cur = wrapper;
        }
        const out = formatErrorChain(cur);
        // We stop at depth 10; the leaf at the bottom isn't reachable but a
        // mid-chain message is the surviving "leaf" of our truncated walk.
        expect(out.length).to.be.greaterThan(0);
        expect(out).to.not.include('leaf-final'); // depth limit kicked in
    });

    it('falls back to a sensible string for empty / odd input', function () {
        expect(formatErrorChain(null)).to.equal('');
        expect(formatErrorChain(undefined)).to.equal('');
        expect(formatErrorChain({})).to.equal(''); // no message, no String(.) value
        // A plain error-shaped object (no Error prototype) still works.
        expect(formatErrorChain({ message: 'manual' })).to.equal('manual');
    });
});

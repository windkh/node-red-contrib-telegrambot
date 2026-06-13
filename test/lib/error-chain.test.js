const { expect } = require('chai');
const { formatErrorChain } = require('../../telegrambot/lib/error-chain');

// formatErrorChain — leaf-message extraction for Bot error: log lines (#442 retest)

describe('error-chain — formatErrorChain', function () {
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

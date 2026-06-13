// Walks an Error's .cause chain (Node 16+ standard) and any nested .errors arrays
// (AggregateError) to collect the leaf error messages — i.e. the ones that actually
// carry the useful diagnostic (typically the syscall-level message like
// "connect ETIMEDOUT 149.154.166.110:443" rather than the intermediate library
// wrappers' generic "AggregateError" / "RequestError" labels).
//
// The whole point is to get a one-line warn that tells an operator what to actually
// fix (IPv4 vs IPv6, DNS, blocked port, ...) without needing to enable verbose
// logging and read a 5-deep util.inspect dump.
//
// Returns a string formatted as: "<message1>; <message2>; ..." with consecutive
// duplicates removed. Empty input -> empty string.
function formatErrorChain(error) {
    const seen = new Set();
    const leaves = [];
    function walk(e, depth) {
        if (!e || typeof e !== 'object' || seen.has(e) || depth > 10) return;
        seen.add(e);
        const isAgg = Array.isArray(e.errors) && e.errors.length > 0;
        const hasCause = e.cause && typeof e.cause === 'object';
        if (isAgg) {
            e.errors.forEach(function (inner) {
                walk(inner, depth + 1);
            });
        }
        if (hasCause) {
            walk(e.cause, depth + 1);
        }
        if (!isAgg && !hasCause) {
            // Prefer e.message; for plain string inputs, the string itself; else nothing.
            // Avoid String(e) so a shape-less object doesn't show up as "[object Object]".
            const msg = e.message || (typeof e === 'string' ? e : '');
            if (msg) leaves.push(msg);
        }
    }
    walk(error, 0);
    // De-duplicate while preserving order.
    const dedup = [];
    leaves.forEach(function (m) {
        if (dedup.indexOf(m) === -1) dedup.push(m);
    });
    if (dedup.length === 0) {
        // Avoid the JS default "[object Object]" for shape-less inputs — fall back to
        // the message if present, the raw string itself if the caller passed a string,
        // else empty.
        if (!error) return '';
        if (typeof error === 'string') return error;
        return error.message || '';
    }
    return dedup.join('; ');
}

module.exports = { formatErrorChain };

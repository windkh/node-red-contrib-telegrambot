// JSON.stringify wrapper that tolerates circular references.
// When the same object reference is seen twice during serialisation, the literal
// string "[Circular]" is emitted in place of the duplicate. This preserves the
// shape of the object in error logs instead of dropping the key.
function safeStringify(obj, indent = 4) {
    let cache = [];
    const retVal = JSON.stringify(
        obj,
        (key, value) => (typeof value === 'object' && value !== null ? (cache.includes(value) ? '[Circular]' : cache.push(value) && value) : value),
        indent
    );
    return retVal;
}

module.exports = safeStringify;

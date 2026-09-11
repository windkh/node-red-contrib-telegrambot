// Decides whether an error thrown by a Bot API call is a transient network
// failure — one where the request never reached Telegram, or its answer never
// came back — as opposed to a request Telegram received and actively rejected.
// Repeating the first kind is the only way the message is ever delivered;
// repeating the second would just fail again.
//
// The decision has to walk the cause chain. node-telegram-bot-api v1.x reports
// every transport failure as `FatalError: EFATAL: fetch failed`, and Node's
// fetch in turn wraps the real failure as `TypeError: fetch failed`, so the code
// that says what actually happened sits two levels down in `.cause`:
//
//     FatalError  EFATAL: fetch failed          code = EFATAL
//       └ TypeError  fetch failed               code = undefined
//           └ Error  read ECONNRESET            code = ECONNRESET
//
// Matching against the stringified top-level error therefore never sees the
// code. A host that resolves to both an A and an AAAA record fails as an
// AggregateError instead, with one entry per address, so `.errors` is walked as
// well as `.cause`.

// Depth bound for the walk, mirroring lib/error-chain.js. Real chains are three
// or four deep; the bound keeps the walk total over whatever a library hands us.
const MAX_DEPTH = 10;

// Codes that mean "the connection failed, try again": Node's syscall and DNS
// codes, plus undici's own for a socket that closed under the request or a peer
// that stopped answering.
//
// UND_ERR_CLOSED and UND_ERR_DESTROYED are deliberately absent. They mean the
// dispatcher was closed by us — a redeploy, a node close, or scheduleRestart —
// where a retry would fight the shutdown it is reacting to.
const TRANSIENT_CODES = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'EHOSTDOWN',
    'EHOSTUNREACH',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ETIMEDOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
]);

// Returns the first transient code found anywhere in the error's cause chain, or
// null when the error is not a transient network failure. The returned code is
// what the caller reports to the user, so it names the actual fault
// (`ECONNRESET`) rather than the wrapper it arrived in (`EFATAL`).
function findTransientErrorCode(error) {
    const seen = new Set();
    const pending = [{ error: error, depth: 0 }];
    let found = null;
    while (pending.length > 0 && found === null) {
        const current = pending.shift();
        const candidate = current.error;
        const walkable = candidate && typeof candidate === 'object' && !seen.has(candidate);
        if (walkable && current.depth <= MAX_DEPTH) {
            seen.add(candidate);
            if (typeof candidate.code === 'string' && TRANSIENT_CODES.has(candidate.code)) {
                found = candidate.code;
            } else {
                if (Array.isArray(candidate.errors)) {
                    candidate.errors.forEach(function (inner) {
                        pending.push({ error: inner, depth: current.depth + 1 });
                    });
                }
                if (candidate.cause) {
                    pending.push({ error: candidate.cause, depth: current.depth + 1 });
                }
            }
        }
    }
    return found;
}

module.exports = { findTransientErrorCode, TRANSIENT_CODES };

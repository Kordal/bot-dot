// What input and the clipboard use while there is no transport (between connections: Reconnecting…, Turned off, the wait
// before a retry): every call does nothing, so a tap, a key, a paste or a typed text then neither throws nor leaves
// anything half done.
const NONE = new Proxy({}, { get: () => () => {} });

// `current()` is the live transport or null; what comes back is always something to call.
export const guarded = (current) => () => current() ?? NONE;

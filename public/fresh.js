// A page left open across an update loads the new version by itself: an installed app's window, or a tab, is rarely
// loaded again by hand, and kept running the scripts it opened with. GET /api/version says `web`, a word for the
// page's files as the server sends them now: once it differs from the one this page was loaded with, the page loads
// itself again as soon as nothing would be lost (no dialog open, nothing being typed, no unsent text), and says
// nothing: What's new tells what changed (whats-new.js).
// A plain <script>, as window.Fresh; the tests load it the same way.

(function (root) {

const EVERY = 60_000; // how often an open page asks, at most
const RETRY = 5_000; // how often a page waiting for a quiet moment looks again

// Nothing would be lost: no dialog, no text field in use, no text left typed and not sent.
function quiet(doc) {
  if (doc.querySelector('dialog[open]')) return false;
  const a = doc.activeElement;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || ''))) return false;
  return ![...doc.querySelectorAll('textarea')].some((t) => String(t.value || '').trim());
}

// ask: () => Promise of GET /api/version. Returns { seen(version), check() }: seen() with every answer the page gets,
// check() whenever the page refreshes (it asks at most once a minute).
function keeper(win, ask, { every = EVERY, retry = RETRY } = {}) {
  let loaded = null, stale = false, askedAt = 0, timer = null;
  const reload = () => {
    if (!quiet(win.document)) return false;
    clearInterval(timer);
    win.location.reload();
    return true;
  };
  const seen = (v) => {
    const now = v && typeof v.web === 'string' && v.web ? v.web : null;
    if (!now || stale) return;
    askedAt = Date.now();
    if (loaded === null) { loaded = now; return; }
    if (now === loaded) return;
    stale = true;
    if (!reload()) timer = setInterval(reload, retry);
  };
  const check = () => {
    if (stale || Date.now() - askedAt < every) return Promise.resolve();
    askedAt = Date.now();
    return Promise.resolve().then(ask).then(seen, () => {}); // botdot away or restarting: asked again later
  };
  return { seen, check, stale: () => stale };
}

const api = { quiet, keeper, EVERY };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Fresh = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

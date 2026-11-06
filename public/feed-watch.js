// A live feed that knows when it is dead (#1078). After a laptop sleeps, Wi-Fi changes or a NAT forgets the
// connection, the feed's socket can stay half-open: the browser still says it is open, and nothing arrives. botdot
// sends a `ping` event every 20 s (docs/api.md, "The live feed"), so a feed that has said nothing for longer than
// QUIET_MS is opened again, from the last event it had: nothing is missed, and the page reads everything again.
// A plain <script>, as window.FeedWatch; the tests load it the same way.

(function (root) {

const QUIET_MS = 45_000; // two pings missed, and some
const EVERY_MS = 10_000; // how often an open page looks

// open(since, heard): opens the feed after the event `since` (null: from now), and calls heard(event) with each
// event it gets. Returns { start(), check(), heard(e), lastId() }: start() opens it (again, closing the one before),
// check() opens it again if it has been quiet too long and says whether it did.
function keeper(open, { quiet = QUIET_MS, now = () => Date.now() } = {}) {
  let es = null, heardAt = 0, lastId = null;
  const heard = (e) => {
    heardAt = now();
    if (e && typeof e.lastEventId === 'string' && e.lastEventId) lastId = e.lastEventId;
  };
  const start = () => {
    if (es) { try { es.close(); } catch { /* gone already */ } }
    heardAt = now();
    es = open(lastId, heard);
    return es;
  };
  const check = () => {
    if (!es || now() - heardAt <= quiet) return false;
    start();
    return true;
  };
  return { start, check, heard, lastId: () => lastId };
}

// The feed's address, after the event `since`.
const url = (since) => `/api/events?guarded=1${since ? `&since=${encodeURIComponent(since)}` : ''}`;

const api = { keeper, url, QUIET_MS, EVERY_MS };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.FeedWatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

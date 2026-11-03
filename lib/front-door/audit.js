// @ts-check
// The admin page's audit log (#911, ADR 141): what the admin did on it, and the front door's security events (an
// account made, a passkey added from a sign-in link, a client starting to be slowed down, a sign-up a full machine
// refused, #912, an address a block or the daily limit refused, #913). An entry is
// { at, actor, action, account?, detail? }: actor is the admin's account or 'front-door'; detail is a few words the
// front door writes itself, never a key, a session, a link or a passkey. One line of JSON an entry, appended to
// audit.jsonl beside front-door.json (mode 600); entries older than 13 months are dropped, an account's entries stay
// after it is deleted. Nothing leaves the machine.
const fs = require('fs');
const path = require('path');

const KEEP_MONTHS = 13;
const PAGE = 50;
const MAX_PAGE = 200;
const DETAIL_MAX = 200;
const ACCOUNT = /^[a-z][a-z0-9-]{1,23}$/;
const ACTOR = /^(front-door|[a-z][a-z0-9-]{1,23})$/;
// Every action an entry may name, in the order the admin page lists them.
const ACTIONS = [
  'account-made', 'passkey-added', 'slowed-down', 'sign-up-refused', 'sign-up-limited', 'blocked',
  'link-made', 'link-revoked', 'sign-in-link', 'max-accounts', 'sign-up-limit', 'block-added', 'block-removed',
  'suspend', 'resume', 'sign-out', 'delete', 'share', 'default-share',
  'update', 'update-days', 'update-now',
  'rooms', 'decision-model', 'replays', 'boat-key-set', 'boat-key-removed',
];

/** @param {string} dir the front door's data folder @param {{ now?: () => number }} [options] */
function open(dir, { now = () => Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, 'audit.jsonl');
  /** @type {{ at: string, actor: string, action: string, account?: string, detail?: string }[]} oldest first */
  let entries = [];
  try {
    for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (e && typeof e.at === 'string' && ACTIONS.includes(e.action)) entries.push(e); } catch { /* a cut line */ }
    }
  } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') console.error(`[front door] audit.jsonl: ${/** @type {any} */ (e).message}`);
  }
  const cutoff = () => { const d = new Date(now()); d.setUTCMonth(d.getUTCMonth() - KEEP_MONTHS); return d.toISOString(); };

  // Drops what is older than 13 months, rewriting the file only then.
  function prune() {
    const oldest = cutoff();
    const kept = entries.filter((e) => e.at >= oldest);
    if (kept.length === entries.length) return 0;
    const dropped = entries.length - kept.length;
    entries = kept;
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, entries.map((e) => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
    return dropped;
  }
  prune();
  const timer = setInterval(() => { try { prune(); } catch (e) { console.error(`[front door] couldn't drop old audit entries: ${/** @type {any} */ (e).message}`); } }, 6 * 3600_000);
  timer.unref();

  // One entry, appended. Its `at` is later than the one before, by a millisecond if need be, so that `before` pages
  // without losing one. A wrong actor, action or account throws: the front door's own code names them.
  /** @param {{ actor: string, action: string, account?: string | null, detail?: string | null }} e */
  function record({ actor, action, account, detail }) {
    if (!ACTOR.test(String(actor)) || !ACTIONS.includes(action) || (account != null && !ACCOUNT.test(String(account)))) {
      throw new Error(`not an audit entry: ${actor} ${action} ${account}`);
    }
    let t = now();
    const last = entries[entries.length - 1];
    if (last && Date.parse(last.at) >= t) t = Date.parse(last.at) + 1;
    /** @type {{ at: string, actor: string, action: string, account?: string, detail?: string }} */
    const entry = { at: new Date(t).toISOString(), actor, action };
    if (account) entry.account = account;
    if (detail) entry.detail = String(detail).replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX);
    fs.appendFileSync(FILE, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    entries.push(entry);
    return entry;
  }

  // Newest first: `limit` entries (50 unless said, at most 200) older than `before` (an entry's `at`), of `account`
  // and of `action` when given. more: whether older ones are left. accounts: every account an entry names.
  /** @param {{ account?: string, action?: string, before?: string, limit?: number }} [q] */
  function list({ account, action, before, limit } = {}) {
    const n = Number.isInteger(limit) && /** @type {number} */ (limit) > 0 ? Math.min(/** @type {number} */ (limit), MAX_PAGE) : PAGE;
    const out = [];
    let more = false;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (before && e.at >= before) continue;
      if (account && e.account !== account) continue;
      if (action && e.action !== action) continue;
      if (out.length === n) { more = true; break; }
      out.push(e);
    }
    const accounts = [...new Set(entries.map((e) => e.account).filter(Boolean))].sort();
    return { entries: out, more, accounts, actions: ACTIONS };
  }

  return { record, list, prune };
}

module.exports = { open, ACTIONS, KEEP_MONTHS };

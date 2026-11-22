// @ts-check
// Feedback to the developers (ADR 259, #1566): the machine's answer (on, off, or never asked), the install token the
// Feedback relay issued, and the requests to the relay. Kept in feedback-relay.json in the front door's data (mode
// 600), apart from the reports. The relay's protocol is in docs/api.md, "The Feedback relay".
const fs = require('fs');
const path = require('path');

// The developers' relay: an install changes it with FRONT_DOOR_FEEDBACK_RELAY.
const DEFAULT_URL = 'https://feedback.botdot.app';
const TOKEN = /^[A-Za-z0-9_-]{16,200}$/;
const RELAY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WAIT_MS = 10_000;

// The relay's address from the environment: https, or http on this computer alone (the tests'). Else the default.
/** @param {string | undefined} value @param {(line: string) => void} [say] */
function addressOf(value, say = () => {}) {
  if (!value) return DEFAULT_URL;
  try {
    const u = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin;
  } catch { /* said below */ }
  say(`[front door] FRONT_DOOR_FEEDBACK_RELAY must be an https address: Feedback goes to ${DEFAULT_URL}`);
  return DEFAULT_URL;
}

// A name in a report's text, found as a whole word and not inside another word.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text with the account's own names and its bots' names replaced by neutral words, so that a report can't be traced
// to the owner: [account], [bot]. A name of one character is left: it would be most of the text.
/** @param {string} text @param {{ account: string[], bots: string[] }} names */
function neutral(text, names) {
  // The names as written, longest first, the account's before a bot's of the same name: a name is matched ignoring case
  // by the regular expression itself, not by lowercasing (which changes the length of some letters).
  /** @type {{ name: string, word: string, whole?: RegExp }[]} */
  const found = [];
  for (const n of names.account) if (typeof n === 'string' && n.trim().length >= 2) found.push({ name: n.trim(), word: '[account]' });
  for (const n of names.bots) if (typeof n === 'string' && n.trim().length >= 2) found.push({ name: n.trim(), word: '[bot]' });
  if (!found.length) return text;
  found.sort((x, y) => y.name.length - x.name.length);
  for (const f of found) f.whole = new RegExp(`^${escape(f.name)}$`, 'iu');
  const any = found.map((f) => escape(f.name)).join('|');
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${any})(?![\\p{L}\\p{N}_])`, 'giu'), (m) => found.find((f) => f.whole?.test(m))?.word || '[bot]');
}

// A report's status as the relay or a managed machine's agent says it (#1568, docs/api.md "The Feedback relay"): { status,
// fixedIn?, issue?, note? }. status is one of STATUSES, else nothing is kept; each other field is kept only in the shape
// it must have and dropped otherwise (the sender is outside the machine: nothing else is drawn, stored or forwarded).
const STATUSES = ['sent', 'seen', 'fixed', 'wontfix'];
const CLOSED = ['fixed', 'wontfix'];
const NOTE_ID = /^\d{4}-\d{2}-\d{2}(?:-[A-Za-z0-9][A-Za-z0-9-]{0,80})?$/;
// The repository moved from Kordal to ladrok: the relay answers the new link, and a report that was kept with the old one keeps it.
const ISSUE = /^https:\/\/github\.com\/(?:Kordal|ladrok)\/bot-dot\/issues\/[1-9]\d{0,8}$/;
const NOTE_MAX = 200;
/** @param {any} s @returns {{ status: string, fixedIn?: string, issue?: string, note?: string } | null} */
function cleanStatus(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || !STATUSES.includes(s.status)) return null;
  const out = { status: s.status };
  if (typeof s.fixedIn === 'string' && NOTE_ID.test(s.fixedIn)) out.fixedIn = s.fixedIn;
  if (typeof s.issue === 'string' && ISSUE.test(s.issue)) out.issue = s.issue;
  if (typeof s.note === 'string' && s.note.trim() && s.note.trim().length <= NOTE_MAX) out.note = s.note.trim();
  return out;
}

/** @param {string} dir @param {{ initial?: boolean | null, url?: string }} [options] initial: the install's answer, taken only while there is none */
function open(dir, { initial = null, url = DEFAULT_URL } = {}) {
  const FILE = path.join(dir, 'feedback-relay.json');
  const read = () => {
    try {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return {
        on: typeof j.on === 'boolean' ? j.on : null,
        token: typeof j.token === 'string' && TOKEN.test(j.token) ? j.token : null,
        // The relay said the token is revoked (#1570): nothing is sent until it takes the token again.
        revoked: j.revoked === true,
        // The relay ids of deleted accounts' reports the relay has not yet been asked to delete (#1570).
        deleting: Array.isArray(j.deleting) ? j.deleting.filter((id) => typeof id === 'string' && RELAY_ID.test(id)) : [],
      };
    } catch { return { on: null, token: null, revoked: false, deleting: [] }; }
  };
  const write = (state) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...state, revoked: state.revoked || undefined, deleting: state.deleting?.length ? state.deleting : undefined }), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };
  if (typeof initial === 'boolean' && read().on === null) write({ ...read(), on: initial });

  let registering = null;
  // One request to the relay: { status, data }, status 0 when it could not be reached in time.
  async function call(method, to, body, token) {
    try {
      const res = await fetch(url + to, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(WAIT_MS),
        redirect: 'error',
      });
      let data = null;
      try { data = await res.json(); } catch { /* not JSON */ }
      // The token the relay revoked (403 with { revoked: true }, every route): kept, so nothing is sent until it is taken again.
      if (token) {
        const now = read();
        if (res.status === 403 && data?.revoked === true && !now.revoked) write({ ...now, revoked: true });
        else if (res.status >= 200 && res.status <= 299 && now.revoked) write({ ...now, revoked: false });
      }
      return { status: res.status, data };
    } catch { return { status: 0, data: null }; }
  }

  const api = {
    url,
    // true, false, or null while never asked.
    on: () => read().on,
    set(on) { write({ ...read(), on: !!on }); },
    token: () => read().token,
    // Whether the relay revoked this machine's token (#1570).
    revoked: () => read().revoked,
    // Deleted accounts' reports (#1570): their relay ids are kept in the data until the relay has been asked to delete them.
    queueDelete(ids) {
      const now = read();
      const add = ids.filter((id) => typeof id === 'string' && RELAY_ID.test(id) && !now.deleting.includes(id));
      if (add.length) write({ ...now, deleting: [...now.deleting, ...add] });
    },
    deleting: () => read().deleting.length,
    // POST /v1/delete with { ids } (at most 100 at a time) and the token, whatever the switch says: true once the relay took
    // them all (or there were none); false when it did not and they are kept to ask again. Without a token no report was taken.
    async flushDeletes() {
      for (;;) {
        const now = read();
        if (!now.deleting.length) return true;
        if (!now.token) { write({ ...now, deleting: [] }); return true; }
        const ids = now.deleting.slice(0, 100);
        const r = await call('POST', '/v1/delete', { ids }, now.token);
        if (r.status < 200 || r.status > 299) return false;
        const after = read();
        write({ ...after, deleting: after.deleting.filter((id) => !ids.includes(id)) });
      }
    },
    // The install token: the first time the switch is turned on the relay issues one, and it is kept for good (turning the
    // switch off keeps it). Throws in plain words when the relay gives none.
    async register() {
      const have = read().token;
      if (have) return have;
      registering ||= (async () => {
        const r = await call('POST', '/v1/register', {});
        const token = r.data?.token;
        if (r.status < 200 || r.status > 299 || typeof token !== 'string' || !TOKEN.test(token)) throw new Error("botdot's Feedback relay gave no token. Try again later.");
        write({ ...read(), token });
        return token;
      })().finally(() => { registering = null; });
      return registering;
    },
    // One report: PUT /v1/reports/<the front door's id> with { kind, text, app, version, screenshots } and the token alone.
    // The relay treats the id as idempotent. { relayId } when taken; { retry: true } when it may be sent again later;
    // { retry: false } when the relay refused it for good.
    async send(id, report) {
      let token;
      try { token = await api.register(); } catch { return { retry: true }; }
      const r = await call('PUT', `/v1/reports/${id}`, report, token);
      if (r.status >= 200 && r.status <= 299 && typeof r.data?.id === 'string' && RELAY_ID.test(r.data.id)) return { relayId: r.data.id };
      // A token the relay doesn't take (401, 403, a revoked one) is not a report's fault: it waits (#1571 handles it).
      const retry = [0, 401, 403, 408, 429].includes(r.status) || r.status >= 500 || (r.status >= 200 && r.status <= 299);
      return { retry };
    },
    // The statuses of reports (#1568): POST /v1/statuses with { ids } (at most 100) and the token. { statuses } is an
    // object keyed by those of `ids` the relay knows, each only as far as cleanStatus keeps it; null when the relay could
    // not be asked (no token yet, no answer, a refusal): the ids are asked again later. Asked with the switch off too.
    async statuses(ids) {
      const state = read();
      const token = state.token;
      // An empty list is asked only while the token is revoked (#1570): a probe, so that a relay that takes the token again is
      // noticed on a machine that holds no open report. Otherwise nothing to ask.
      if (!token || (!ids.length && !state.revoked)) return null;
      const r = await call('POST', '/v1/statuses', { ids }, token);
      const got = r.data?.statuses;
      if (r.status < 200 || r.status > 299 || !got || typeof got !== 'object' || Array.isArray(got)) return null;
      /** @type {Record<string, { status: string, fixedIn?: string, issue?: string, note?: string }>} */
      const statuses = {};
      for (const id of ids) {
        if (!Object.hasOwn(got, id)) continue;
        const s = cleanStatus(got[id]);
        if (s) statuses[id] = s;
      }
      return { statuses };
    },
  };
  return api;
}

module.exports = { open, neutral, addressOf, cleanStatus, CLOSED, DEFAULT_URL };

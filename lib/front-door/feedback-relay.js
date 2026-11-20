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
  const words = new Map();
  for (const n of names.bots) if (typeof n === 'string' && n.trim().length >= 2) words.set(n.trim().toLowerCase(), '[bot]');
  for (const n of names.account) if (typeof n === 'string' && n.trim().length >= 2) words.set(n.trim().toLowerCase(), '[account]');
  if (!words.size) return text;
  const found = [...words.keys()].sort((a, b) => b.length - a.length).map(escape).join('|');
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${found})(?![\\p{L}\\p{N}_])`, 'giu'), (m) => words.get(m.toLowerCase()) || '[bot]');
}

/** @param {string} dir @param {{ initial?: boolean | null, url?: string }} [options] initial: the install's answer, taken only while there is none */
function open(dir, { initial = null, url = DEFAULT_URL } = {}) {
  const FILE = path.join(dir, 'feedback-relay.json');
  const read = () => {
    try {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return { on: typeof j.on === 'boolean' ? j.on : null, token: typeof j.token === 'string' && TOKEN.test(j.token) ? j.token : null };
    } catch { return { on: null, token: null }; }
  };
  const write = (state) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
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
      return { status: res.status, data };
    } catch { return { status: 0, data: null }; }
  }

  const api = {
    url,
    // true, false, or null while never asked.
    on: () => read().on,
    set(on) { write({ ...read(), on: !!on }); },
    token: () => read().token,
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
  };
  return api;
}

module.exports = { open, neutral, addressOf, DEFAULT_URL };

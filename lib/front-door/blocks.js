// @ts-check
// Blocked addresses and the daily limit of new accounts per address (#913). A block is { id, cidr, level, until?,
// note?, added }: `cidr` an IPv4 or IPv6 address or range (a bare address is one address), `level` 'sign-up' (no new
// account from there) or 'access' (no sign-in, no session, no call reaches the front door from there; it refuses
// sign-ups too); without `until` it lasts until the admin removes it. The address checked is the one limits.clientOf
// reads, never one the client wrote. The limit counts accounts made from one address in the last 24 hours; an IPv6
// address counts as its /64, which one home or one server holds whole, so that a script can't take a new address for
// each account.
const crypto = require('crypto');

const LEVELS = ['sign-up', 'access'];
const LIMIT = 3;
const LIMIT_RANGE = [1, 1000];
const LIMIT_RULE = 'The limit is a whole number of accounts a day, 1 to 1000.';
const NOTE_MAX = 200;
const MAX_BLOCKS = 1000;
const DAY = 24 * 3600_000;
const fail = (/** @type {string} */ message, status = 400) => Object.assign(new Error(message), { status });
const CIDR_RULE = 'An address or a range is an IPv4 or IPv6 address, with /bits for a range: 203.0.113.0/24, 2001:db8::/32.';

/** @typedef {{ family: 4 | 6, n: bigint, mapped?: boolean }} Address */

// An IPv4 or IPv6 address as a number, or null for anything else.
/** @param {string} text @returns {Address | null} */
function parse(text) {
  const s = String(text).trim().toLowerCase();
  const v4 = (/** @type {string} */ t) => {
    const parts = t.split('.');
    if (parts.length !== 4 || !parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)) return null;
    return parts.reduce((n, p) => (n << 8n) | BigInt(p), 0n);
  };
  if (!s.includes(':')) { const n = v4(s); return n === null ? null : { family: 4, n }; }
  if (!/^[0-9a-f:.]+$/.test(s) || (s.match(/::/g) || []).length > 1) return null;
  // An IPv4 address at its end (::ffff:203.0.113.7) is its last two groups.
  let body = s;
  const dot = s.lastIndexOf(':');
  if (s.slice(dot + 1).includes('.')) {
    const n = v4(s.slice(dot + 1));
    if (n === null) return null;
    body = `${s.slice(0, dot + 1)}${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const group = (/** @type {string} */ g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN);
  let groups;
  if (body.includes('::')) {
    const [head, rest] = body.split('::');
    const a = head ? head.split(':').map(group) : [];
    const b = rest ? rest.split(':').map(group) : [];
    const missing = 8 - a.length - b.length;
    if (missing < 1) return null;
    groups = [...a, ...Array(missing).fill(0), ...b];
  } else {
    groups = body.split(':').map(group);
  }
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g))) return null;
  const n = groups.reduce((x, g) => (x << 16n) | BigInt(g), 0n);
  // An IPv4 address written as IPv6 (::ffff:203.0.113.7) is that IPv4 address, as clientOf reads it.
  if (n >> 32n === 0xffffn) return { family: 4, n: n & 0xffffffffn, mapped: true };
  return { family: 6, n };
}

const bitsOf = (/** @type {4 | 6} */ family) => (family === 4 ? 32 : 128);

// A number back to its address, IPv6 in its short form (RFC 5952).
/** @param {Address} a @returns {string} */
function format({ family, n }) {
  if (family === 4) return [24n, 16n, 8n, 0n].map((s) => String((n >> s) & 0xffn)).join('.');
  const groups = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - 16 * i)) & 0xffffn));
  let best = -1, bestLen = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best < 0) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}

// The first address of a range of `prefix` bits.
const network = (/** @type {Address} */ a, /** @type {number} */ prefix) => {
  const host = BigInt(bitsOf(a.family) - prefix);
  return { family: a.family, n: (a.n >> host) << host };
};

// An address or a range from the admin, checked: '203.0.113.0/24', '2001:db8::/32', its first address and its bits
// (a bare address is /32 or /128). Throws with the status 400 for anything else.
/** @param {unknown} text @returns {string} */
function checkCidr(text) {
  const [addr, bits, ...more] = String(text ?? '').trim().split('/');
  const a = typeof text === 'string' && !more.length ? parse(addr) : null;
  if (!a) throw fail(CIDR_RULE);
  const max = bitsOf(a.family);
  const prefix = bits === undefined ? max : /^\d{1,3}$/.test(bits) ? Number(bits) - (a.mapped ? 96 : 0) : NaN;
  if (!(prefix >= 0 && prefix <= max)) throw fail(CIDR_RULE);
  return `${format(network(a, prefix))}/${prefix}`;
}

// Whether `address` (as clientOf read it) is in `cidr` (as checkCidr wrote it).
/** @param {string} cidr @param {string} address */
function covers(cidr, address) {
  const [addr, bits] = cidr.split('/');
  const range = parse(addr);
  const a = parse(address);
  if (!range || !a || range.family !== a.family) return false;
  return network(a, Number(bits)).n === range.n;
}

// Whether an address is this machine's own (127.0.0.0/8, ::1): a sign-up from the machine itself (the install, a test,
// npm start), never one from outside, which Caddy or Tailscale Serve name. The daily limit doesn't count it.
const local = (/** @type {string} */ address) => covers('127.0.0.0/8', address) || covers('::1/128', address);

// What the daily limit counts an address as: an IPv4 address itself, an IPv6 address its /64.
/** @param {string} address */
function limitKey(address) {
  const a = parse(address);
  if (!a) return String(address);
  return a.family === 4 ? format(a) : `${format(network(a, 64))}/64`;
}

// A block from the admin, checked and made: { id, cidr, level, until?, note?, added }. `until` is a time to come (an
// ISO time, or milliseconds), or null or left out for until removed. Throws with the status 400.
/** @param {any} body @param {number} [now] */
function checkBlock(body, now = Date.now()) {
  const b = body && typeof body === 'object' ? body : {};
  const cidr = checkCidr(b.cidr);
  if (!LEVELS.includes(b.level)) throw fail("A block's level is sign-up or access.");
  /** @type {{ id: string, cidr: string, level: string, added: string, until?: string, note?: string }} */
  const block = { id: crypto.randomBytes(8).toString('hex'), cidr, level: b.level, added: new Date(now).toISOString() };
  if (b.until != null && b.until !== '') {
    const t = typeof b.until === 'number' ? b.until : typeof b.until === 'string' ? Date.parse(b.until) : NaN;
    if (!Number.isFinite(t) || t <= now) throw fail("A block's end is a time to come, or none.");
    block.until = new Date(t).toISOString();
  }
  if (b.note != null && b.note !== '') {
    if (typeof b.note !== 'string') throw fail("A block's note is text.");
    const note = b.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    if (note) block.note = note;
  }
  return block;
}

// A daily limit from the admin, checked: a whole number, or throws with the status 400.
/** @param {unknown} limit @returns {number} */
function checkLimit(limit) {
  if (Number.isInteger(limit) && /** @type {number} */ (limit) >= LIMIT_RANGE[0] && /** @type {number} */ (limit) <= LIMIT_RANGE[1]) return /** @type {number} */ (limit);
  throw fail(LIMIT_RULE);
}

const live = (/** @type {{ until?: string }} */ b, now = Date.now()) => !b.until || Date.parse(b.until) > now;

// The live block that stops `address` at `level`: an access block stops sign-ups too. Null for none.
/** @param {{ cidr: string, level: string, until?: string }[]} blocks @param {string} address @param {'sign-up' | 'access'} level */
function blocking(blocks, address, level, now = Date.now()) {
  return blocks.find((b) => live(b, now) && (b.level === 'access' || level === 'sign-up') && covers(b.cidr, address)) || null;
}

module.exports = { local, parse, format, checkCidr, covers, limitKey, checkBlock, checkLimit, blocking, live, LEVELS, LIMIT, LIMIT_RULE, CIDR_RULE, MAX_BLOCKS, DAY };

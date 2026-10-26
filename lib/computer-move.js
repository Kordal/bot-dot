// @ts-check
// A bot's files copied when its computer moves (#556, ADR 091): between the account's computer ('linux'), the account's
// machine on boat.dev ('boat', #568, ADR 096) and a machine of its own there ('boat-own'), when the owner chose "Copy
// files", and from a bot's own machine made before #568 to the account's. Its folder only: /workspace/<bot> on the
// account's computer, /home/user/workspace/<bot> on the account's machine on boat.dev, /home/user on its own. It is a copy: the old side keeps its files, and on the new side a file of the same name is replaced.
//
// Each side packs the folder into one gzipped tar of its own, hands it out in pieces, takes pieces of the other's in
// order and unpacks it (lib/computers.js moveFiles through the Docker helper, lib/boat.js moveFiles through boat.dev's
// API). The bytes go through botdot, never from one machine straight to the other: neither may reach the other.
//
// What runs and what failed is kept in computer-moves.json, so a copy botdot's restart cut short says so after it.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const MAX_BYTES = 2 * 1024 ** 3; // the packed folder
const KINDS = ['linux', 'boat', 'boat-own'];
const WHERE = { linux: 'this machine', boat: 'boat.dev', 'boat-own': 'its machine on boat.dev' };
const RESTARTED = 'botdot started again during the copy';
const ALL_PARTS = ['files', 'profile'];
const PARTS = ALL_PARTS;
const PART_WORDS = { files: 'its files', profile: "its browser's profile" };
// What a browser's profile leaves out (#565): what Firefox makes again by itself, and the locks of a browser that ran.
const PROFILE_LEFT_OUT = ['cache2', 'startupCache', 'thumbnails', 'shader-cache', 'safebrowsing', 'crashes', 'minidumps',
  'datareporting', 'saved-telemetry-pings', 'storage/temporary', 'lock', '.parentlock', 'parent.lock']
  .map((f) => `--exclude=./${f}`).join(' ');
// The most bytes each side hands out and takes in one piece: the Docker helper takes at most 1 MB a call (base64 in
// JSON), boat.dev's file API 5 MB.
const BOAT_PIECES = { readMax: 3 * 1024 * 1024, writeMax: 3 * 1024 * 1024 };
const PIECES = { linux: { readMax: 3 * 1024 * 1024, writeMax: 600 * 1024 }, boat: BOAT_PIECES, 'boat-own': BOAT_PIECES };

// A move between the two computers, or false.
const isMove = (from, to) => KINDS.includes(from) && KINDS.includes(to) && from !== to;

// sides: { linux, boat, 'boat-own' }, each { moveFiles(botId, { op, part, offset?, length?, data? }) } resolving
// { code, size?, data?, stderr?, error? }; a profile's pack resolves size 0 when there is none. pieces: PIECES, smaller
// in a test.
// onChange(botId): a move's state changed (botdot's feed tells the apps). after(botId, from, to): a copy succeeded.
function create(dataDir, { sides, pieces = PIECES, onChange = () => {}, after = async () => {}, every = 5000, now = Date.now } = {}) {
  const file = path.join(dataDir, 'computer-moves.json');
  /** @type {Record<string, { from: string, to: string, state: 'copying' | 'failed', done: number, total: number, error?: string, at: number }>} */
  const moves = readJson(file, {});
  for (const m of Object.values(moves)) {
    if (m.state === 'copying') Object.assign(m, { state: 'failed', error: RESTARTED });
    // A copy kept from before #568: its 'boat' was the bot's own machine.
    if (!m.v) Object.assign(m, { v: 2, from: m.from === 'boat' ? 'boat-own' : m.from, to: m.to === 'boat' ? 'boat-own' : m.to });
  }
  const save = () => writeJson(file, moves);
  save();
  const running = new Map(); // botId -> Promise

  const said = (r, what) => {
    if (r && r.code === 0) return r;
    const why = String(r?.error || r?.stderr || 'no answer').trim().split('\n').pop()?.slice(0, 200);
    throw new Error(`${what}: ${why}`);
  };

  const drop = async (side, botId) => { for (const part of PARTS) await side.moveFiles(botId, { op: 'drop', part }).catch(() => {}); };
  async function copy(botId, from, to) {
    // The account's machine on boat.dev has one browser for its bots (ADR 096): no bot's profile goes to or from it.
    const PARTS = [from, to].includes('boat') ? ['files'] : ALL_PARTS;
    const src = { ...pieces[from], ...sides[from] };
    const dst = { ...pieces[to], ...sides[to] };
    const m = moves[botId];
    let told = 0;
    const tell = (force = false) => { if (force || now() - told >= every) { told = now(); save(); onChange(botId); } };
    try {
      // Both parts packed first, so the bytes done only grow: the folder must have some, a profile may have none.
      const sizes = {};
      for (const part of PARTS) {
        const packed = said(await src.moveFiles(botId, { op: 'pack', part }), `couldn't pack ${PART_WORDS[part]} on ${WHERE[from]}`);
        sizes[part] = Number(packed.size) || 0;
      }
      if (!sizes.files) throw new Error(`${WHERE[from]} packed nothing`);
      const total = sizes.files + sizes.profile;
      if (total > MAX_BYTES) throw new Error(`its folder on ${WHERE[from]} is over ${MAX_BYTES / 1024 ** 3} GB packed`);
      m.total = total;
      tell(true);
      let before = 0;
      for (const part of PARTS) {
        const size = sizes[part];
        if (!size) continue;
        const what = PART_WORDS[part];
        for (let offset = 0; offset < size;) {
          const piece = said(await src.moveFiles(botId, { op: 'read', part, offset, length: Math.min(src.readMax, size - offset) }), `couldn't read ${what} on ${WHERE[from]}`);
          const bytes = Buffer.from(String(piece.data || ''), 'base64');
          if (!bytes.length) throw new Error(`${WHERE[from]} handed out nothing at ${offset} of ${size} bytes`);
          for (let at = 0; at < bytes.length; at += dst.writeMax) {
            said(await dst.moveFiles(botId, { op: 'write', part, offset: offset + at, data: bytes.subarray(at, at + dst.writeMax).toString('base64') }), `couldn't write ${what} on ${WHERE[to]}`);
          }
          offset += bytes.length;
          m.done = before + offset;
          tell();
        }
        before += size;
      }
      // Unpacked once every part is there: a part that failed on the way leaves the new side as it was.
      for (const part of PARTS) if (sizes[part]) said(await dst.moveFiles(botId, { op: 'unpack', part }), `couldn't unpack ${PART_WORDS[part]} on ${WHERE[to]}`);
      delete moves[botId];
      save();
      await after(botId, from, to);
    } catch (e) {
      // What it left on either side goes before it says it failed, so a "Try again" never meets this one still ending.
      await drop(dst, botId);
      await drop(src, botId);
      Object.assign(m, { state: 'failed', error: e.message });
      save();
      console.warn(`[computer move] ${botId}: ${e.message}`);
      running.delete(botId);
      onChange(botId);
      return;
    }
    await drop(src, botId);
    running.delete(botId);
    onChange(botId);
  }

  // The bot's files, copied from its old computer to its new one, in the background. A copy that runs already is it.
  function start(botId, from, to) {
    if (!isMove(from, to)) throw new Error('Files are copied only between this machine and boat.dev.');
    if (running.has(botId)) return running.get(botId);
    moves[botId] = { v: 2, from, to, state: 'copying', done: 0, total: 0, at: now() };
    save();
    onChange(botId);
    const p = copy(botId, from, to);
    running.set(botId, p);
    return p;
  }
  // Its failed copy again, the same way. null when there is none.
  function retry(botId) {
    const m = moves[botId];
    if (!m || m.state !== 'failed') return null;
    return start(botId, m.from, m.to);
  }
  // A failed copy no longer counts: the bot's computer changed again, or it was deleted.
  function clear(botId) {
    if (running.has(botId) || !moves[botId]) return;
    delete moves[botId];
    save();
    onChange(botId);
  }
  // What the apps are shown: { from, to, state, done, total, error? }, or null. Both of boat.dev's sides are 'boat'
  // there, as the bot's computer is.
  const shown = (kind) => (kind === 'boat-own' ? 'boat' : kind);
  function of(botId) {
    const m = moves[botId];
    return m ? { from: shown(m.from), to: shown(m.to), state: m.state, done: m.done, total: m.total, ...(m.error ? { error: m.error } : {}) } : null;
  }
  // The copy as kept, with its own kinds: { from, to, state, error? }, or null.
  const raw = (botId) => (moves[botId] ? { ...moves[botId] } : null);
  const copying = (botId) => running.has(botId);
  // The bot has files on its own machine on boat.dev it still needs: a copy from there that runs or failed.
  const holdsBoat = (botId) => moves[botId]?.from === 'boat-own';
  return { start, retry, clear, of, raw, copying, holdsBoat };
}

// What a bot's computer tools answer while its files are copied.
const BUSY = 'Your files are being copied to your new computer. Try again in a minute.';

module.exports = { create, isMove, BUSY, MAX_BYTES, RESTARTED, PIECES, PARTS, PROFILE_LEFT_OUT };

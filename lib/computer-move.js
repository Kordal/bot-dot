// @ts-check
// A bot's files copied when its computer moves (#556, ADR 091): from the account's computer ('linux') to its machine on
// boat.dev ('boat'), or back, when the owner chose "Copy files". Its folder only: /workspace/<bot> there, /home/user on
// boat.dev. It is a copy: the old side keeps its files, and on the new side a file of the same name is replaced.
//
// Each side packs the folder into one gzipped tar of its own, hands it out in pieces, takes pieces of the other's in
// order and unpacks it (lib/computers.js moveFiles through the Docker helper, lib/boat.js moveFiles through boat.dev's
// API). The bytes go through botdot, never from one machine straight to the other: neither may reach the other.
//
// What runs and what failed is kept in computer-moves.json, so a copy botdot's restart cut short says so after it.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const MAX_BYTES = 2 * 1024 ** 3; // the packed folder
const KINDS = ['linux', 'boat'];
const WHERE = { linux: 'this machine', boat: 'boat.dev' };
const RESTARTED = 'botdot started again during the copy';
// The most bytes each side hands out and takes in one piece: the Docker helper takes at most 1 MB a call (base64 in
// JSON), boat.dev's file API 5 MB.
const PIECES = { linux: { readMax: 3 * 1024 * 1024, writeMax: 600 * 1024 }, boat: { readMax: 3 * 1024 * 1024, writeMax: 3 * 1024 * 1024 } };

// A move between the two computers, or false.
const isMove = (from, to) => KINDS.includes(from) && KINDS.includes(to) && from !== to;

// sides: { linux, boat }, each { moveFiles(botId, { op, offset?, length?, data? }) } resolving { code, size?, data?,
// stderr?, error? }. pieces: PIECES, smaller in a test.
// onChange(botId): a move's state changed (botdot's feed tells the apps). after(botId, from, to): a copy succeeded.
function create(dataDir, { sides, pieces = PIECES, onChange = () => {}, after = async () => {}, every = 5000, now = Date.now } = {}) {
  const file = path.join(dataDir, 'computer-moves.json');
  /** @type {Record<string, { from: string, to: string, state: 'copying' | 'failed', done: number, total: number, error?: string, at: number }>} */
  const moves = readJson(file, {});
  for (const m of Object.values(moves)) if (m.state === 'copying') Object.assign(m, { state: 'failed', error: RESTARTED });
  const save = () => writeJson(file, moves);
  save();
  const running = new Map(); // botId -> Promise

  const said = (r, what) => {
    if (r && r.code === 0) return r;
    const why = String(r?.error || r?.stderr || 'no answer').trim().split('\n').pop()?.slice(0, 200);
    throw new Error(`${what}: ${why}`);
  };

  async function copy(botId, from, to) {
    const src = { ...pieces[from], ...sides[from] };
    const dst = { ...pieces[to], ...sides[to] };
    const m = moves[botId];
    let told = 0;
    const tell = (force = false) => { if (force || now() - told >= every) { told = now(); save(); onChange(botId); } };
    try {
      const packed = said(await src.moveFiles(botId, { op: 'pack' }), `couldn't pack its files on ${WHERE[from]}`);
      const total = Number(packed.size) || 0;
      if (!total) throw new Error(`${WHERE[from]} packed nothing`);
      if (total > MAX_BYTES) throw new Error(`its folder on ${WHERE[from]} is over ${MAX_BYTES / 1024 ** 3} GB packed`);
      m.total = total;
      tell(true);
      for (let offset = 0; offset < total;) {
        const piece = said(await src.moveFiles(botId, { op: 'read', offset, length: Math.min(src.readMax, total - offset) }), `couldn't read its files on ${WHERE[from]}`);
        const bytes = Buffer.from(String(piece.data || ''), 'base64');
        if (!bytes.length) throw new Error(`${WHERE[from]} handed out nothing at ${offset} of ${total} bytes`);
        for (let at = 0; at < bytes.length; at += dst.writeMax) {
          said(await dst.moveFiles(botId, { op: 'write', offset: offset + at, data: bytes.subarray(at, at + dst.writeMax).toString('base64') }), `couldn't write its files on ${WHERE[to]}`);
        }
        offset += bytes.length;
        m.done = offset;
        tell();
      }
      said(await dst.moveFiles(botId, { op: 'unpack' }), `couldn't unpack its files on ${WHERE[to]}`);
      delete moves[botId];
      save();
      await after(botId, from, to);
    } catch (e) {
      // What it left on either side goes before it says it failed, so a "Try again" never meets this one still ending.
      await dst.moveFiles(botId, { op: 'drop' }).catch(() => {});
      await src.moveFiles(botId, { op: 'drop' }).catch(() => {});
      Object.assign(m, { state: 'failed', error: e.message });
      save();
      console.warn(`[computer move] ${botId}: ${e.message}`);
      running.delete(botId);
      onChange(botId);
      return;
    }
    await src.moveFiles(botId, { op: 'drop' }).catch(() => {});
    running.delete(botId);
    onChange(botId);
  }

  // The bot's files, copied from its old computer to its new one, in the background. A copy that runs already is it.
  function start(botId, from, to) {
    if (!isMove(from, to)) throw new Error('Files are copied only between this machine and boat.dev.');
    if (running.has(botId)) return running.get(botId);
    moves[botId] = { from, to, state: 'copying', done: 0, total: 0, at: now() };
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
  // What the apps are shown: { from, to, state, done, total, error? }, or null.
  function of(botId) {
    const m = moves[botId];
    return m ? { from: m.from, to: m.to, state: m.state, done: m.done, total: m.total, ...(m.error ? { error: m.error } : {}) } : null;
  }
  const copying = (botId) => running.has(botId);
  // The bot has files on boat.dev it still needs: a copy from there that runs or failed.
  const holdsBoat = (botId) => moves[botId]?.from === 'boat';
  return { start, retry, clear, of, copying, holdsBoat };
}

// What a bot's computer tools answer while its files are copied.
const BUSY = 'Your files are being copied to your new computer. Try again in a minute.';

module.exports = { create, isMove, BUSY, MAX_BYTES, RESTARTED, PIECES };

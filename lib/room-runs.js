// What a bot does in a shared room beyond a talk-only turn (ADR 062, amending ADR 060), on its own account's side:
//   - its owner's mention in a room starts a run in the bot's own chat, with its tools, and every tool that run uses
//     waits for the owner's yes on a card (kind 'room-tool'), inside the run;
//   - what goes to a room from this account (that run's reply, or what a bot writes with post_to_room) waits for
//     the owner's yes on a card (kind 'room-post'), and only then lies in the outbox;
//   - the front door collects the outbox (POST /api/room-sync): an account never calls the front door, it is asked.
// The cards are in Needs you, the owner's only: nothing of them reaches the room. No yes here is ever kept for a
// later call: no "Always allow", no grant, no saved permission.
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { readJson, writeJson } = require('./jsonfile');

const TEXT_MAX = 4000; // characters of what goes to a room (the front door keeps no more)
const NAME_MAX = 60;
const OUTBOX_MAX = 200; // approved posts the front door has not collected yet
const ROOMS_MAX = 50;
const FRESH_MS = 2 * 60_000; // rooms the front door told of longer ago than this are none: Shared rooms may be off now
// How long one tool of a room run waits for the owner's answer inside the run. A test sets it short.
const WAIT_MS = Number(process.env.BOT_DOT_ROOM_TOOL_WAIT_MS) || 10 * 60_000;
const SLICE_MS = 25_000; // one request of the hook (lib/room-tool-hook.js)
const INPUT_MAX = 50_000; // characters of a tool's input a card shows

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const oneLine = (s, max = NAME_MAX) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const plain = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
const fail = (status, message) => Object.assign(new Error(message), { status });
// A reply as a room takes it: plain text, cut to TEXT_MAX, never half of a sign written with two. '' when empty.
function postText(text) {
  const t = plain(text);
  const chars = [...t];
  return chars.length > TEXT_MAX ? chars.slice(0, TEXT_MAX - 1).join('') + '…' : t;
}

// What the bot is told when a tool of its room run is not let through: the hook relays these words.
const DECLINED = "The owner declined this tool call, so it was not done. Don't try it another way in this run. Say in your reply that the owner declined it.";
const UNANSWERED = "The owner has not answered in time, so this tool call was not done and its card is gone. Don't call it again in this run. Say in your reply what you could not do.";
const ENDED = 'This run has ended.';

// The rooms the front door says this account's bots are in, as POST /api/room-sync sends them: [{ id, name, bots }],
// or throws 400.
function checkRooms(rooms) {
  if (!Array.isArray(rooms) || rooms.length > ROOMS_MAX) throw fail(400, `rooms is a list of at most ${ROOMS_MAX} rooms.`);
  return rooms.map((r) => {
    if (!r || typeof r !== 'object' || !ID.test(String(r.id)) || typeof r.name !== 'string' || !oneLine(r.name)) throw fail(400, 'Each room has an id and a name.');
    if (!Array.isArray(r.bots) || r.bots.some((b) => !ID.test(String(b)))) throw fail(400, 'Each room lists its bots of this account by id.');
    return { id: r.id, name: oneLine(r.name), bots: [...new Set(r.bots)].slice(0, 30) };
  });
}

// asks: lib/asks.js. bot(id): the bot or null. mayPost(bot): whether its room settings let it into rooms
// (allowRooms). runMeta(runId): the record of that run while it is going on, or null. going(runId): whether that run
// is going on or waits its turn.
function create(dataDir, { asks, bot: botOf, mayPost, runMeta, going = (id) => !!runMeta(id), now = () => Date.now() }) {
  const outboxFile = path.join(dataDir, 'room-outbox.json');
  const outbox = () => readJson(outboxFile, []);
  let known = { at: 0, rooms: [] }; // what the front door last said
  // No run waits for a tool's card that was left when botdot stopped: those cards go now.
  asks.drop((a) => a.kind === 'room-tool');
  const fresh = () => now() - known.at < FRESH_MS;

  // The rooms a bot is in, while the front door's word on it is fresh: [{ id, name }].
  const roomsOf = (botId) => (fresh() ? known.rooms.filter((r) => r.bots.includes(botId)).map(({ id, name }) => ({ id, name })) : []);
  // The room a bot names, by its id or its name (any case), or null.
  function findRoom(botId, word) {
    const w = oneLine(word).toLowerCase();
    const mine = roomsOf(botId);
    return mine.find((r) => r.id === word) || mine.find((r) => r.name.toLowerCase() === w) || null;
  }

  // ---------- posts ----------

  // What goes to a room waits for the owner's yes on a card. from: 'mention' (the reply of a run its owner's mention
  // started) or 'tool' (post_to_room). The room must be one the bot is in now.
  function askPost({ botId, runId = null, room, text, from }) {
    const b = botOf(botId);
    if (!b || !mayPost(b)) throw fail(403, 'You are kept out of shared rooms. Your owner lets you in in your settings.');
    const t = postText(text);
    if (!t) throw fail(400, 'Write something to post.');
    return asks.add({ kind: 'room-post', botId, ...(runId ? { runId } : {}), room: { id: room.id, name: oneLine(room.name) }, text: t, from });
  }
  // post_to_room: a room the bot names, by its name or id.
  function postFromTool(session, { room, text }) {
    const found = findRoom(session.botId, room);
    if (!found) {
      const mine = roomsOf(session.botId);
      throw fail(404, mine.length ? `You are in no room called "${oneLine(room)}". Your rooms: ${mine.map((r) => `"${r.name}"`).join(', ')}.` : 'You are in no shared room now.');
    }
    askPost({ botId: session.botId, runId: session.runId, room: found, text, from: 'tool' });
    return { ok: true, room: found.name };
  }
  // The owner's answer on a room-post card: a yes puts it in the outbox, for the front door to collect.
  function postAnswered(a, yes) {
    if (!yes) { asks.take(a.id, { declined: true }); return { ok: true, declined: true }; }
    const list = outbox();
    if (list.length >= OUTBOX_MAX) throw fail(409, 'Too many posts wait for the shared rooms. Try again in a minute.');
    asks.take(a.id);
    writeJson(outboxFile, [...list, { id: crypto.randomBytes(8).toString('hex'), room: a.room, bot: a.botId, text: a.text, at: new Date(now()).toISOString() }]);
    return { ok: true, posted: true };
  }

  // ---------- the run an owner's mention starts ----------

  // The runs a mention started that have not ended: "<bot>/<room>" -> their ids. Their reply waits on a card after.
  const pending = new Map();
  const started = (botId, roomId, runId) => {
    const k = `${botId}/${roomId}`;
    if (!pending.has(k)) pending.set(k, new Set());
    pending.get(k).add(runId);
  };
  // A run ended: the cards of its tools go. A room run's reply waits for the owner's OK to go to the room. A run that
  // stopped for an ask and carries on later (ADR 009) is a room run again, and its reply gets a card of its own.
  function runEnded(meta) {
    for (const [id, w] of waits) if (w.runId === meta.id) { settle(id, 'stopped', ENDED); waits.delete(id); }
    asks.drop((a) => a.kind === 'room-tool' && a.runId === meta.id);
    if (!meta.room) return;
    const k = `${meta.botId}/${meta.room.id}`;
    pending.get(k)?.delete(meta.id);
    if (!pending.get(k)?.size) pending.delete(k);
    // A run that stopped for the owner's answer on a card carries on after it (ADR 009): that run has the reply.
    const carriesOn = asks.list().some((a) => (a.runs || []).some((r) => r.id === meta.id));
    const text = meta.status === 'success' && !meta.passed && !carriesOn ? postText(meta.result) : '';
    if (!text) return;
    try { askPost({ botId: meta.botId, runId: meta.id, room: meta.room, text, from: 'mention' }); } catch (e) { console.error(`[rooms] ${meta.id}: ${e.message}`); }
  }

  // ---------- each tool of such a run ----------

  // ask id -> { runId, status: 'waiting' | 'allowed' | 'declined' | 'stopped', text, timer }
  const waits = new Map();
  const answered = new EventEmitter();
  answered.setMaxListeners(100);
  function settle(id, status, text = null) {
    const w = waits.get(id);
    if (!w || w.status !== 'waiting') return;
    clearTimeout(w.timer);
    Object.assign(w, { status, text, timer: null });
    answered.emit(id);
  }
  // A tool's input as its card keeps it: an object. One too long to show is its start, marked `cut`: its card can only
  // be declined, since a yes would approve what it does not show.
  function inputOf(input) {
    const o = input && typeof input === 'object' && !Array.isArray(input) ? input : { input };
    const s = JSON.stringify(o) || '{}';
    return s.length > INPUT_MAX ? { start: `${s.slice(0, 2000)}…`, cut: true } : o;
  }
  // The hook asks for a tool call of a room run (session: the run). A call that is no room run's goes through: the
  // hook is only on room runs. Returns { status, id?, text? } after at most `ms`.
  async function tool(session, { tool: name, input, id = null }, ms = SLICE_MS) {
    const meta = runMeta(session.runId);
    if (!meta) return { status: 'stopped', text: ENDED };
    if (!meta.room) return { status: 'allowed' };
    // post_to_room waits on a card of its own (a room-post): one card is enough for it.
    if (name === 'mcp__self__post_to_room') return { status: 'allowed' };
    let askId = typeof id === 'string' && waits.get(id)?.runId === session.runId ? id : null;
    if (!askId) {
      const a = asks.add({ kind: 'room-tool', botId: session.botId, runId: session.runId, room: meta.room, tool: oneLine(name, 120) || 'a tool', input: inputOf(input), call: crypto.randomBytes(6).toString('hex') });
      askId = a.id;
      waits.set(askId, { runId: session.runId, status: 'waiting', text: null, timer: setTimeout(() => { asks.drop((x) => x.id === askId); settle(askId, 'stopped', UNANSWERED); }, WAIT_MS).unref() });
    }
    const w = waits.get(askId);
    if (w.status === 'waiting') {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(t); answered.off(askId, done); resolve(); };
        const t = setTimeout(done, ms);
        answered.once(askId, done);
      });
    }
    const out = { status: w.status, id: askId, ...(w.text ? { text: w.text } : {}) };
    if (w.status !== 'waiting') waits.delete(askId);
    return out;
  }
  // The owner's answer on a room-tool card. A yes lets that one call go on to the bot's own rules; it is kept nowhere.
  function toolAnswered(a, yes) {
    asks.take(a.id);
    if (yes) settle(a.id, 'allowed');
    else settle(a.id, 'declined', DECLINED);
    return { ok: true, ...(yes ? {} : { declined: true }) };
  }

  // ---------- the front door collects ----------

  // POST /api/room-sync: { rooms, taken }. rooms: the rooms the account's bots are in now. taken: the ids of posts
  // the front door put in their rooms since it last asked. Answers the posts that wait, and the bots whose answer
  // in a room is on its way (a run, or its reply waiting for the owner's OK): { posts, pending }.
  function sync(body) {
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const rooms = checkRooms(b.rooms ?? []);
    known = { at: now(), rooms };
    const taken = new Set(Array.isArray(b.taken) ? b.taken.filter((x) => typeof x === 'string') : []);
    let list = outbox();
    if (taken.size) { list = list.filter((p) => !taken.has(p.id)); writeJson(outboxFile, list); }
    const inRoom = new Set(rooms.flatMap((r) => r.bots.map((bot) => `${bot}/${r.id}`)));
    // A post for a room its bot is no longer in, or of a bot that is gone, goes.
    const kept = list.filter((p) => inRoom.has(`${p.bot}/${p.room.id}`) && botOf(p.bot));
    if (kept.length !== list.length) writeJson(outboxFile, kept);
    // A run that waited its turn and never started (taken back, its bot gone) is no longer on its way.
    for (const [k, ids] of pending) { for (const id of ids) if (!going(id)) ids.delete(id); if (!ids.size) pending.delete(k); }
    const waiting = asks.list().filter((a) => a.kind === 'room-post' && a.from === 'mention').map((a) => `${a.botId}/${a.room.id}`);
    const on = [...new Set([...pending.keys(), ...waiting])];
    return {
      posts: kept.map((p) => ({ id: p.id, room: p.room.id, bot: p.bot, text: p.text, at: p.at })),
      pending: on.map((k) => { const [bot, room] = k.split('/'); return { room, bot }; }),
    };
  }

  return { sync, roomsOf, findRoom, askPost, postFromTool, postAnswered, started, runEnded, tool, toolAnswered };
}

module.exports = { create, postText, checkRooms, TEXT_MAX, DECLINED, UNANSWERED };

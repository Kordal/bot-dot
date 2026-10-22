// @ts-check
// Turns in a shared room (ADR 060): the front door gives each bot a message names one turn, one after another in
// each room, by asking the bot's own account for it (POST /api/room-turn, #315), and keeps the reply in the room. A
// reply that names another bot of the room hands on to it (ADR 019), until 12 bot replies came without a person's
// message. Before a turn the front door asks the bot's account for its room settings (GET /api/room-bots, #316): a
// bot kept out of rooms, or one only its owner may mention asked by someone else, gets no turn, and the room says so.
// The account checks again on its own: it is the last word on its own bot.
//
// What goes to the account is the room's last messages as plain text, each labelled by the front door (the account
// of a person, the name and account of a bot), and which bot is asked. What comes back is the reply's text only.
//
// The bot's owner's own mention is no turn here (ADR 062): the account starts the bot's run in its own chat and
// answers 202. Its reply, and what a bot writes with post_to_room, reaches the room later, after the owner's OK on a
// card in that account: the front door collects each account's approved posts (POST /api/room-sync), every few
// seconds while Shared rooms are on, and tells it the rooms its bots are in. No account ever calls the front door.
const { replyText } = require('./rooms');

const LIMIT = 12; // bot replies in a row without a person's message (ADR 019)
const TRANSCRIPT = 30; // messages a turn reads
const TURN_MS = 4 * 60_000; // the account's turn gives up at 3 minutes (#315)
const BUSY_WAIT_MS = 5000; // a bot busy with another room's turn is asked once more after this
const ERROR_MAX = 200; // characters of an account's refusal shown in the room
const COLLECT_MS = 5000; // how often the accounts' approved posts are collected

const label = (b) => `${b.name} · ${b.account}`;
const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX);

// rooms: lib/front-door/rooms.js's store.
// ask(account, method, path, body, timeoutMs): the account's botdot server's answer, { status, data }; status 0 when
//   it could not be reached.
// changed(room): a room's working bots changed. said(room, message): a message the turns added (a reply or a notice).
// wait(ms): a pause (tests make it short). isOn(): whether Shared rooms are on (the admin's switch).
function create({ rooms, ask, changed = (/** @type {any} */ _room) => {}, said = (/** @type {any} */ _room, /** @type {any} */ _message) => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)), limit = LIMIT, busyWaitMs = BUSY_WAIT_MS, isOn = () => rooms.isOn() }) {
  // The bots whose answer is on its way from their own account (a run its owner's mention started, or its reply that
  // waits for the owner's OK), as each account last said: room id -> Set of "<account>/<bot>".
  const away = new Map();
  // Per room: { queue: [{ bot, asker, upTo }], busy, replies, working: Set }.
  const lines = new Map();
  const lineOf = (id) => {
    if (!lines.has(id)) lines.set(id, { queue: [], busy: false, replies: 0, working: new Set(), epoch: 0 });
    return lines.get(id);
  };
  const working = (id) => [...new Set([...(lines.get(id)?.working || []), ...(away.get(id) || [])])].map((k) => { const [account, bot] = k.split('/'); return { account, bot }; });

  const tell = (roomId, text) => { const out = rooms.say(roomId, text); if (out) said(out.room, out.message); };

  // A person's message: every bot it names gets a turn, and the count of bot replies starts again.
  function person(room, message, named) {
    const line = lineOf(room.id);
    line.replies = 0;
    give(room.id, named, { account: message.account, bot: null }, message.id);
  }
  // A bot's reply that names others: they get the next turns, while the line has replies left.
  function handOn(room, message, named, by) {
    const line = lineOf(room.id);
    if (!named.length) return;
    if (line.replies >= limit) { tell(room.id, `The bots stopped after ${limit} replies without a person. Write to them to go on.`); return; }
    give(room.id, named, { account: by.account, bot: { id: by.id, name: by.name } }, message.id);
  }
  function give(roomId, named, asker, upTo) {
    const line = lineOf(roomId);
    for (const b of named) {
      if (line.queue.some((t) => t.bot.account === b.account && t.bot.id === b.id)) continue;
      line.queue.push({ bot: { account: b.account, id: b.id, name: b.name }, asker, upTo });
    }
    run(roomId);
  }
  // Stop: the waiting turns go; one that runs ends by itself and its reply is still kept.
  function stop(roomId) {
    const line = lines.get(roomId);
    if (!line) return;
    line.queue = [];
    line.epoch += 1;
  }
  function forget(roomId) { stop(roomId); lines.delete(roomId); }

  async function run(roomId) {
    const line = lineOf(roomId);
    if (line.busy) return;
    line.busy = true;
    try {
      while (line.queue.length) {
        const turn = line.queue.shift();
        await take(roomId, line, turn);
      }
    } finally { line.busy = false; }
  }

  async function take(roomId, line, { bot, asker, upTo }) {
    const room = rooms.get(roomId);
    if (!room || !room.bots.some((b) => b.account === bot.account && b.id === bot.id)) return;
    const epoch = line.epoch;
    // Its settings, from its own account.
    const settings = await ask(bot.account, 'GET', '/api/room-bots', null, 15_000).catch(() => ({ status: 0, data: null }));
    const own = settings.status === 200 && Array.isArray(settings.data?.bots) ? settings.data.bots.find((b) => b?.id === bot.id) : null;
    // The account lists only the bots with rooms on (#316): one it leaves out was taken out of rooms by its owner.
    if (settings.status !== 200 || !Array.isArray(settings.data?.bots)) { tell(roomId, `${label(bot)} could not answer.`); return; }
    if (!own || own.rooms?.allowRooms !== true) { tell(roomId, `${label(bot)} is kept out of rooms by its owner.`); return; }
    if (own.rooms?.whoMayMention !== 'anyone' && asker.account !== bot.account) { tell(roomId, `${label(bot)} answers only ${bot.account} here.`); return; }
    if (line.epoch !== epoch) return;

    const key = `${bot.account}/${bot.id}`;
    line.working.add(key);
    changed(rooms.get(roomId));
    let answer;
    try {
      const body = { bot: bot.id, room: { id: room.id, name: room.name }, messages: transcript(room, upTo) };
      answer = await ask(bot.account, 'POST', '/api/room-turn', body, TURN_MS).catch(() => ({ status: 0, data: null }));
      if (answer.status === 409) {
        await wait(busyWaitMs);
        answer = await ask(bot.account, 'POST', '/api/room-turn', body, TURN_MS).catch(() => ({ status: 0, data: null }));
      }
    } finally {
      line.working.delete(key);
      const now = rooms.get(roomId);
      if (now) changed(now);
    }
    // The owner's own mention: the bot works in its own chat, and its reply comes when the owner OKs it (collect).
    if (answer.status === 202 && answer.data?.started === true) {
      if (!away.has(roomId)) away.set(roomId, new Set());
      away.get(roomId).add(key);
      const now = rooms.get(roomId);
      if (now) changed(now);
      return;
    }
    if (answer.status === 200 && replyText(answer.data?.reply)) {
      const out = rooms.reply(roomId, bot, answer.data.reply);
      if (!out) return;
      said(out.room, out.message);
      line.replies += 1;
      if (line.epoch === epoch) handOn(out.room, out.message, out.named, bot);
      return;
    }
    if (answer.status === 403) tell(roomId, oneLine(answer.data?.error) || `${label(bot)} answers only ${bot.account} here.`);
    else if (answer.status === 409) tell(roomId, `${label(bot)} is busy. Ask again in a moment.`);
    else tell(roomId, `${label(bot)} could not answer.`);
  }

  // The room's last messages up to the one that asks, as the account reads them (#315): people and bots, no notices,
  // each labelled by the front door.
  function transcript(room, upTo) {
    const end = room.messages.findIndex((m) => m.id === upTo);
    const upto = end < 0 ? room.messages : room.messages.slice(0, end + 1);
    return upto.filter((m) => m.kind !== 'notice').slice(-TRANSCRIPT).map((m) => ({
      account: m.account,
      name: m.bot ? m.bot.name : m.account,
      bot: !!m.bot,
      text: m.text,
      at: m.at,
    }));
  }

  // ---------- what the accounts send to rooms (ADR 062) ----------

  const taken = new Map(); // account -> ids of its posts put in rooms since it was last asked
  const told = new Set(); // accounts told of rooms: one whose bots left every room is told once more, of none
  // Each account with bots in rooms, or told of some before, is asked once: the rooms its bots are in, and the posts
  // its owner OKed. Each post goes into its room as its bot's message, once, and hands on as a reply does.
  let collecting = false;
  async function collect() {
    if (collecting || !isOn()) return;
    collecting = true;
    try {
      const byAccount = new Map();
      for (const room of rooms.all()) {
        for (const b of room.bots) {
          if (!byAccount.has(b.account)) byAccount.set(b.account, new Map());
          const mine = byAccount.get(b.account);
          if (!mine.has(room.id)) mine.set(room.id, { id: room.id, name: room.name, bots: [] });
          mine.get(room.id).bots.push(b.id);
        }
      }
      for (const account of told) if (!byAccount.has(account)) byAccount.set(account, new Map());
      // All at once: one account slow to answer holds up no other's posts.
      await Promise.allSettled([...byAccount].map(([account, mine]) => collectFrom(account, [...mine.values()])));
    } finally { collecting = false; }
  }
  async function collectFrom(account, mine) {
    const ids = [...(taken.get(account) || [])];
    const answer = await ask(account, 'POST', '/api/room-sync', { rooms: mine, taken: ids }, 15_000).catch(() => ({ status: 0, data: null }));
    if (answer.status !== 200 || !answer.data) return;
    taken.delete(account);
    if (mine.length) told.add(account); else told.delete(account);
    // Who of it is at work in a room now.
    const on = new Set((Array.isArray(answer.data.pending) ? answer.data.pending : []).map((p) => `${p?.room}/${account}/${p?.bot}`));
    for (const room of rooms.all()) {
      const before = away.get(room.id) || new Set();
      const now = new Set([...before].filter((k) => !k.startsWith(`${account}/`)));
      for (const b of room.bots) if (b.account === account && on.has(`${room.id}/${account}/${b.id}`)) now.add(`${account}/${b.id}`);
      const same = before.size === now.size && [...before].every((k) => now.has(k));
      if (now.size) away.set(room.id, now); else away.delete(room.id);
      if (!same) changed(room);
    }
    const done = [];
    for (const p of Array.isArray(answer.data.posts) ? answer.data.posts.slice(0, 50) : []) {
      if (typeof p?.id !== 'string' || p.id.length > 64) continue;
      done.push(p.id);
      const room = rooms.get(p.room);
      const bot = room?.bots.find((b) => b.account === account && b.id === p.bot);
      if (!bot || !replyText(p.text)) continue;
      const out = rooms.reply(room.id, bot, p.text, Date.now(), { post: `${account}/${p.id}` });
      if (!out || out.again) continue;
      said(out.room, out.message);
      const line = lineOf(room.id);
      line.replies += 1;
      handOn(out.room, out.message, out.named, bot);
    }
    if (done.length) taken.set(account, done);
  }
  // Collecting every few seconds, until stopped (the front door's close).
  function startCollecting(ms = COLLECT_MS) {
    const t = setInterval(() => { collect().catch((e) => console.error(`[rooms] collecting: ${e.message}`)); }, ms);
    t.unref?.();
    return () => clearInterval(t);
  }

  return { person, stop, forget, working, transcript, collect, startCollecting };
}

module.exports = { create, LIMIT, TRANSCRIPT, COLLECT_MS };

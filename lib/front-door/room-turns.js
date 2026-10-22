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
const { replyText } = require('./rooms');

const LIMIT = 12; // bot replies in a row without a person's message (ADR 019)
const TRANSCRIPT = 30; // messages a turn reads
const TURN_MS = 4 * 60_000; // the account's turn gives up at 3 minutes (#315)
const BUSY_WAIT_MS = 5000; // a bot busy with another room's turn is asked once more after this
const ERROR_MAX = 200; // characters of an account's refusal shown in the room

const label = (b) => `${b.name} · ${b.account}`;
const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX);

// rooms: lib/front-door/rooms.js's store.
// ask(account, method, path, body, timeoutMs): the account's botdot server's answer, { status, data }; status 0 when
//   it could not be reached.
// changed(room): a room's working bots changed. said(room, message): a message the turns added (a reply or a notice).
// wait(ms): a pause (tests make it short).
function create({ rooms, ask, changed = (/** @type {any} */ _room) => {}, said = (/** @type {any} */ _room, /** @type {any} */ _message) => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)), limit = LIMIT, busyWaitMs = BUSY_WAIT_MS }) {
  // Per room: { queue: [{ bot, asker, upTo }], busy, replies, working: Set }.
  const lines = new Map();
  const lineOf = (id) => {
    if (!lines.has(id)) lines.set(id, { queue: [], busy: false, replies: 0, working: new Set(), epoch: 0 });
    return lines.get(id);
  };
  const working = (id) => [...(lines.get(id)?.working || [])].map((k) => { const [account, bot] = k.split('/'); return { account, bot }; });

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

  return { person, stop, forget, working, transcript };
}

module.exports = { create, LIMIT, TRANSCRIPT };

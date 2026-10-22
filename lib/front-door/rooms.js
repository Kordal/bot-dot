// @ts-check
// Shared rooms (ADR 060): what the front door keeps of them, in rooms.json beside front-door.json. A room has people
// (accounts) and their bots, the accounts invited and not yet in, and its messages. Whether rooms are on at all is the
// admin's switch, kept here too: off, nothing of a room is served and no turn is given, and the data stays.
//
// Every name of an account here is the front door's own (a session's account, or one the admin made): never one a
// person or a bot typed into a message. A bot is named by its account and its id in that account, and its name is
// the one its own account answered when its owner added it. Nothing here trusts a message's text: it is kept and
// handed out as plain text, and read only for mentions.
//
// One process (the front door) writes the file: it is kept in memory and written whole on each change.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { shortName } = require('../../public/mentions.js');

const NAME_MAX = 60; // characters of a room's name
const TEXT_MAX = 4000; // characters of a message
const ROOMS_PER_ACCOUNT = 50; // rooms an account is in or invited to
const PEOPLE_MAX = 20; // members and invited, together
const BOTS_MAX = 30;
const KEPT = 1000; // messages a room keeps: past that, the oldest goes
const KEYS_KEPT = 200; // resend keys a room remembers
const LINK_DAYS = 7; // an invite link works this long, unless its room's maker takes it back or makes another
const LINK = /^[A-Za-z0-9_-]{32}$/; // an invite link's token: 24 random bytes, base64url
const ID = /^[0-9a-f]{32}$/;
const BOT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
const newId = () => crypto.randomBytes(16).toString('hex');
const iso = (now) => new Date(now).toISOString();
// Plain text, one line for a name: control characters out (a newline in a name, too), trimmed.
const oneLine = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const plain = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
const short = (v, max) => (typeof v === 'string' && v ? oneLine(v).slice(0, max) : undefined);
const COLOR = /^#[0-9a-fA-F]{6}$/;

// A room's name as it is kept, or throws with the status 400 in plain words.
function checkName(name) {
  const n = typeof name === 'string' ? oneLine(name) : '';
  if (!n) throw fail(400, 'Give the room a name.');
  if ([...n].length > NAME_MAX) throw fail(400, `A room's name is at most ${NAME_MAX} characters.`);
  return n;
}
// A message's text as it is kept, or throws with the status 400.
function checkText(text) {
  const t = typeof text === 'string' ? plain(text) : '';
  if (!t) throw fail(400, 'Write something first.');
  if ([...t].length > TEXT_MAX) throw fail(400, `A message is at most ${TEXT_MAX} characters.`);
  return t;
}
// A bot's reply as a room keeps it: plain text, cut at TEXT_MAX. Empty: null.
function replyText(text) {
  const t = typeof text === 'string' ? plain(text) : '';
  if (!t) return null;
  const chars = [...t];
  return chars.length > TEXT_MAX ? `${chars.slice(0, TEXT_MAX - 1).join('')}…` : t;
}

// The text a mention reads: what the apps draw as text, so a name inside code names nobody (as in a group, ADR 019).
const withoutCode = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/```\w*\n[\s\S]*?```/g, ' ').replace(/`(?:[^`\n]|\n(?!\s*\n))+`/g, ' ');
const MENTION = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/gu;

// The bots of `room` a text names, in the order it names them, each once: "@" and a bot's mention name
// (public/mentions.js shortName), without case. Every bot of the room that answers to that name is named: two
// accounts' bots of one name both are, and each one's own account then decides whether it answers the asker.
function namedIn(room, text) {
  const out = [];
  for (const m of withoutCode(text).matchAll(MENTION)) {
    const word = m[1].toLowerCase();
    for (const b of room.bots) {
      if (shortName(b.name).toLowerCase() === word && !out.some((o) => o.account === b.account && o.id === b.id)) out.push(b);
    }
  }
  return out;
}

// dir: the front door's data folder.
function open(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const FILE = path.join(dir, 'rooms.json');
  /** @type {{ on: boolean, rooms: Record<string, any> }} */
  let data;
  try { data = { on: false, rooms: {}, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) {
    if (/** @type {any} */ (e).code !== 'ENOENT') throw e;
    data = { on: false, rooms: {} };
  }
  function save() {
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }

  const isOn = () => data.on === true;
  function setOn(on) {
    if (typeof on !== 'boolean') throw fail(400, 'Say on: true or false.');
    data.on = on;
    save();
    return on;
  }

  const isMember = (room, account) => room.members.some((m) => m.account === account);
  const isInvited = (room, account) => room.invites.some((i) => i.account === account);
  const roomsOf = (account) => Object.values(data.rooms).filter((r) => isMember(r, account) || isInvited(r, account));
  // The room `id` as `account` may see it: a member's. Anyone else, and a room that isn't, is 404 alike.
  function memberRoom(id, account) {
    const room = ID.test(String(id)) ? data.rooms[id] : null;
    if (!room || !isMember(room, account)) throw fail(404, 'There is no such room.');
    return room;
  }
  // The room an invite link opens, while it works: none for a token that isn't one, was taken back or has ended.
  function linkRoom(token, now = Date.now()) {
    const t = String(token ?? '');
    if (!LINK.test(t)) return null;
    const want = Buffer.from(t);
    for (const room of Object.values(data.rooms)) {
      const l = room.link;
      if (l && Date.parse(l.expires) > now && l.token.length === t.length && crypto.timingSafeEqual(Buffer.from(l.token), want)) return room;
    }
    return null;
  }
  function invitedRoom(id, account) {
    const room = ID.test(String(id)) ? data.rooms[id] : null;
    if (!room || !isInvited(room, account)) throw fail(404, 'There is no such invitation.');
    return room;
  }

  // A room as the apps get it. working: the bots of it that have a turn now ([{ account, bot }]).
  const botShown = (b) => ({ account: b.account, id: b.id, name: b.name, ...(b.emoji ? { emoji: b.emoji } : {}), ...(b.color ? { color: b.color } : {}) });
  const shown = (room, working = []) => ({
    id: room.id, name: room.name, created: room.created, by: room.by,
    members: room.members.map((m) => ({ account: m.account, joined: m.joined })),
    bots: room.bots.map(botShown),
    invites: room.invites.map((i) => ({ account: i.account, by: i.by, at: i.at })),
    last: room.messages.at(-1) || null,
    working,
  });
  const inviteShown = (room, account) => {
    const i = room.invites.find((x) => x.account === account);
    return { room: { id: room.id, name: room.name, by: room.by }, by: i.by, at: i.at };
  };

  // A line of the front door's own in the room: joined, left, a bot added or removed, a turn refused or failed.
  function notice(room, text, now = Date.now()) {
    const m = { id: newId(), at: iso(now), account: null, bot: null, text: oneLine(text).slice(0, TEXT_MAX), mentions: [], kind: 'notice' };
    push(room, m);
    return m;
  }
  function push(room, m) {
    room.messages.push(m);
    if (room.messages.length > KEPT) room.messages.splice(0, room.messages.length - KEPT);
  }

  function create(account, name, now = Date.now()) {
    const n = checkName(name);
    if (roomsOf(account).length >= ROOMS_PER_ACCOUNT) throw fail(409, `You are in ${ROOMS_PER_ACCOUNT} rooms already. Leave one first.`);
    const room = { id: newId(), name: n, created: iso(now), by: account, members: [{ account, joined: iso(now) }], invites: [], bots: [], messages: [], keys: {} };
    data.rooms[room.id] = room;
    save();
    return room;
  }
  function rename(id, account, name) {
    const room = memberRoom(id, account);
    room.name = checkName(name);
    save();
    return room;
  }
  // accountExists(name): whether the machine has that account.
  function invite(id, account, whom, accountExists) {
    const room = memberRoom(id, account);
    const who = typeof whom === 'string' ? whom.trim().toLowerCase() : '';
    if (!who || !accountExists(who)) throw fail(404, `There is no account ${oneLine(String(whom ?? '')).slice(0, 40)} on this machine.`);
    if (isMember(room, who)) throw fail(409, `${who} is in this room already.`);
    if (isInvited(room, who)) throw fail(409, `${who} is invited already.`);
    if (room.members.length + room.invites.length >= PEOPLE_MAX) throw fail(409, `A room has at most ${PEOPLE_MAX} people.`);
    if (roomsOf(who).length >= ROOMS_PER_ACCOUNT) throw fail(409, `${who} is in ${ROOMS_PER_ACCOUNT} rooms already.`);
    room.invites.push({ account: who, by: account, at: iso(Date.now()) });
    save();
    return room;
  }
  // The room's invite link (ADR 067): only its maker makes, sees and takes it back. One per room, for anyone with an
  // account on this machine who opens it, until it is taken back, another is made, or LINK_DAYS pass. It names no
  // account: what it opens is the room's name and who made it, to a signed-in session only.
  function makerRoom(id, account) {
    const room = memberRoom(id, account);
    if (room.by !== account) throw fail(403, `Only ${room.by}, who made this room, makes its invite link.`);
    return room;
  }
  const linkShown = (room, now = Date.now()) => (room.link && Date.parse(room.link.expires) > now ? { token: room.link.token, expires: room.link.expires } : null);
  function link(id, account, now = Date.now()) { return linkShown(makerRoom(id, account), now); }
  function makeLink(id, account, now = Date.now()) {
    const room = makerRoom(id, account);
    room.link = { token: crypto.randomBytes(24).toString('base64url'), at: iso(now), expires: iso(now + LINK_DAYS * 86_400_000) };
    save();
    return linkShown(room, now);
  }
  function dropLink(id, account) {
    const room = makerRoom(id, account);
    delete room.link;
    save();
    return null;
  }
  // What an invite link shows before joining: { room: { id, name, by }, member }. A link that doesn't work is 404.
  function linkPreview(token, account, now = Date.now()) {
    const room = linkRoom(token, now);
    if (!room) throw fail(404, 'This invite link was taken back or has ended. Ask for a new one.');
    return { room: { id: room.id, name: room.name, by: room.by }, member: isMember(room, account) };
  }
  // `account` joins with the link: the limits of an invitation hold. In already: the room, unchanged. Returns { room, joined }.
  function joinByLink(token, account, now = Date.now()) {
    const room = linkRoom(token, now);
    if (!room) throw fail(404, 'This invite link was taken back or has ended. Ask for a new one.');
    if (isMember(room, account)) return { room, joined: false };
    const invited = isInvited(room, account);
    if (!invited && room.members.length + room.invites.length >= PEOPLE_MAX) throw fail(409, `A room has at most ${PEOPLE_MAX} people.`);
    if (!invited && roomsOf(account).length >= ROOMS_PER_ACCOUNT) throw fail(409, `You are in ${ROOMS_PER_ACCOUNT} rooms already. Leave one first.`);
    room.invites = room.invites.filter((i) => i.account !== account);
    room.members.push({ account, joined: iso(now) });
    notice(room, `${account} joined the room with its invite link.`, now);
    save();
    return { room, joined: true };
  }
  function accept(id, account, now = Date.now()) {
    const room = invitedRoom(id, account);
    room.invites = room.invites.filter((i) => i.account !== account);
    room.members.push({ account, joined: iso(now) });
    notice(room, `${account} joined the room.`, now);
    save();
    return room;
  }
  function decline(id, account) {
    const room = invitedRoom(id, account);
    room.invites = room.invites.filter((i) => i.account !== account);
    save();
    return room;
  }
  // `account` leaves, with its bots. Returns { room, gone, bots }: gone when it was the last member, and the room with it.
  function leave(id, account, now = Date.now()) {
    const room = memberRoom(id, account);
    return leaving(room, account, now);
  }
  function leaving(room, account, now = Date.now()) {
    const bots = room.bots.filter((b) => b.account === account);
    room.members = room.members.filter((m) => m.account !== account);
    room.bots = room.bots.filter((b) => b.account !== account);
    room.invites = room.invites.filter((i) => i.account !== account && i.by !== account);
    if (room.by === account) delete room.link; // nobody is left who could take it back
    let gone = false;
    if (!room.members.length) { delete data.rooms[room.id]; gone = true; } else notice(room, `${account} left the room${bots.length ? `, with ${bots.map((b) => b.name).join(', ')}` : ''}.`, now);
    save();
    return { room, gone, bots };
  }
  function remove(id, account) {
    const room = memberRoom(id, account);
    if (room.by !== account) throw fail(403, `Only ${room.by}, who made this room, can delete it.`);
    delete data.rooms[room.id];
    save();
    return room;
  }
  // An account the admin deleted leaves every room it was in, and its invitations go. Returns the rooms it changed
  // ([{ room, gone }]).
  function dropAccount(account) {
    const out = [];
    for (const room of Object.values(data.rooms)) {
      if (isMember(room, account)) out.push(leaving(room, account));
      else if (isInvited(room, account) || room.invites.some((i) => i.by === account)) {
        room.invites = room.invites.filter((i) => i.account !== account && i.by !== account);
        out.push({ room, gone: false, bots: [] });
      }
    }
    save();
    return out;
  }

  // `account` adds its own bot: `bot` as its own account answered for it ({ id, name, emoji?, color? }).
  function addBot(id, account, bot, now = Date.now()) {
    const room = memberRoom(id, account);
    if (!BOT_ID.test(String(bot?.id))) throw fail(404, 'You have no such bot.');
    if (room.bots.some((b) => b.account === account && b.id === bot.id)) throw fail(409, `${bot.name} is in this room already.`);
    if (room.bots.length >= BOTS_MAX) throw fail(409, `A room has at most ${BOTS_MAX} bots.`);
    const name = short(bot.name, 60) || bot.id;
    room.bots.push({ account, id: bot.id, name, ...(short(bot.emoji, 16) ? { emoji: short(bot.emoji, 16) } : {}), ...(COLOR.test(String(bot.color)) ? { color: bot.color } : {}), added: iso(now) });
    notice(room, `${account} added ${name}.`, now);
    save();
    return room;
  }
  // Only the bot's owner takes it out.
  function removeBot(id, account, botId, now = Date.now()) {
    const room = memberRoom(id, account);
    const b = room.bots.find((x) => x.account === account && x.id === botId);
    if (!b) throw fail(404, 'You have no such bot in this room.');
    room.bots = room.bots.filter((x) => x !== b);
    notice(room, `${account} took ${b.name} out of the room.`, now);
    save();
    return room;
  }

  // A person's message: { message, again } (again: a resend of `key`, answered with the first). mentions: the app's
  // picks, [{ account, bot }], added to the names in the text; one that is no bot of the room is left out.
  function post(id, account, { text, mentions, key } = /** @type {any} */ ({}), now = Date.now()) {
    const room = memberRoom(id, account);
    const k = typeof key === 'string' && KEY.test(key) ? `${account} ${key}` : null;
    if (k && room.keys[k]) {
      const first = room.messages.find((m) => m.id === room.keys[k]);
      if (first) return { room, message: first, again: true };
    }
    const t = checkText(text);
    const named = namedIn(room, t);
    for (const p of Array.isArray(mentions) ? mentions.slice(0, BOTS_MAX) : []) {
      const b = room.bots.find((x) => x.account === p?.account && x.id === p?.bot);
      if (b && !named.includes(b)) named.push(b);
    }
    const message = { id: newId(), at: iso(now), account, bot: null, text: t, mentions: named.map((b) => ({ account: b.account, bot: b.id, name: b.name })), kind: 'text' };
    push(room, message);
    if (k) {
      room.keys[k] = message.id;
      const ks = Object.keys(room.keys);
      if (ks.length > KEYS_KEPT) for (const old of ks.slice(0, ks.length - KEYS_KEPT)) delete room.keys[old];
    }
    save();
    return { room, message, named, again: false };
  }
  // A bot's reply, kept as plain text; the bots of the room it names (it hands on to them). Null when the room or the
  // bot is gone meanwhile (it left), or the reply is empty.
  // post: what an account sent from its outbox ("<account>/<id>", ADR 066): one already in the room is not kept again,
  // and the answer says `again`.
  function reply(id, bot, text, now = Date.now(), { post = null } = {}) {
    const room = data.rooms[id];
    const b = room?.bots.find((x) => x.account === bot.account && x.id === bot.id);
    const t = replyText(text);
    if (!b || !t) return null;
    if (post && room.messages.some((m) => m.post === post)) return { room, message: null, named: [], again: true };
    const named = namedIn(room, t).filter((x) => x !== b);
    const message = { id: newId(), at: iso(now), account: b.account, bot: { id: b.id, name: b.name }, text: t, mentions: named.map((x) => ({ account: x.account, bot: x.id, name: x.name })), kind: 'text', ...(post ? { post } : {}) };
    push(room, message);
    save();
    return { room, message, named };
  }
  function say(id, text, now = Date.now()) {
    const room = data.rooms[id];
    if (!room) return null;
    const message = notice(room, text, now);
    save();
    return { room, message };
  }

  // A member's page of messages, oldest first: the `limit` before `before` (a message's id), or the newest.
  function messages(id, account, { before = null, limit = 50 } = {}) {
    const room = memberRoom(id, account);
    const n = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50));
    let end = room.messages.length;
    if (before) {
      const i = room.messages.findIndex((m) => m.id === before);
      if (i < 0) throw fail(404, 'There is no such message.');
      end = i;
    }
    const start = Math.max(0, end - n);
    return { messages: room.messages.slice(start, end), more: start > 0 };
  }

  const get = (id) => (ID.test(String(id)) ? data.rooms[id] || null : null);
  const all = () => Object.values(data.rooms);

  return {
    isOn, setOn, create, rename, invite, link, makeLink, dropLink, linkPreview, joinByLink, accept, decline, leave, remove, dropAccount, addBot, removeBot, post, reply, say,
    messages, memberRoom, get, all, roomsOf, isMember, isInvited, shown, inviteShown, botShown,
  };
}

module.exports = { open, namedIn, withoutCode, checkText, replyText, LINK_DAYS, NAME_MAX, TEXT_MAX, ROOMS_PER_ACCOUNT, PEOPLE_MAX, BOTS_MAX, KEPT };

// The owner's OK for what a bot does in a connected app (ADR 010, docs/archive/security-issue-90.md). A read goes
// through. A write, and an action botdot has no description of, needs a grant:
//   - a lasting one, "Always allow this action": this bot, this exact action, any arguments, until it is revoked;
//   - a one-use one, "Allow once": one run, this action and these exact arguments, used by one call and gone with
//     its run, used or not.
// Without a grant the call makes an ask and its run waits for the owner's answer, inside the run, for ten minutes.
// While it waits a yes binds the grant to that run. After it stopped waiting a yes starts the bot again (ADR 009),
// and the grant is bound to the run that yes starts, in the step that makes that run: until then it is kept with
// the queued work (lib/bots.js) and nowhere else.
// The Chief is a caller too (ADR 047): a Chief turn the owner started has a session of its own here, a token made
// as the turn starts and forgotten as it ends, which names the turn (`turnId`) where a bot's run names its run.
// Its grants are the Chief's alone: "Always allow" is kept under CHIEF, which no bot id can be, and "Allow once" is
// bound to the turn. A late yes on its card starts a Chief turn in that chat, not a bot.
const crypto = require('node:crypto');
const path = require('node:path');
const EventEmitter = require('node:events');
const feed = require('./events');
const { actionPhrase } = require('./asks');
const { readJson, writeJson } = require('./jsonfile');

const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
const fingerprint = (args) => crypto.createHash('sha256').update(JSON.stringify(ordered(args))).digest('hex');

// The key the Chief's lasting grants are kept under in connector-actions.json: a bot's id is eight hex characters.
const CHIEF = 'chief';
// A late yes on the Chief's card starts its turn only within a day of the ask, as a bot's does (ADR 009).
const CHIEF_LATE_MS = 24 * 3600e3;

// How long a call waits for the owner's answer inside its run: the one constant. A test sets it short.
const WAIT_MS = Number(process.env.BOT_DOT_CONNECTOR_WAIT_MS) || 10 * 60_000;
const SLICE_MS = 25_000; // one long poll of the bot's tools server (lib/connectors-mcp.js), as for a missing login
const LOOK_MS = 60_000; // how often the cards nobody waits for are looked at

// What the bot is told when its call is not let through: the tools server relays these words as they are.
const DECLINED = "The owner declined this action, so it was not done. Don't try it another way: no other action, app or tool for the same thing. Say in your reply that the owner declined it.";
const STAYS = "The owner has not answered yet, so this action was not done. Its card stays in Needs you: if the owner allows it later, botdot starts you again by itself to do it then. Don't call it again in this run and don't try it another way. Say in your reply that it is not done yet and waits for the owner's OK.";
const GONE = "The owner has not answered, so this action was not done, and its card is gone. Don't call it again in this run and don't try it another way. Say in your reply that it is not done; the owner can ask you for it again.";

// asks: the asks (lib/asks.js). active(runId): whether that run is going on. bot(id): the bot, or nothing.
// whatCarriesOn, carryOn: what a yes would start, and starting it (lib/bots.js, ADR 009). appName(slug): an app's name.
// groupOfRun(runId): the group that run is a turn in, or null.
// The Chief's side (ADR 047): chiefApps(): the apps connected now, as last known (lib/connectors.js knownApps).
// chiefFits(ask): whether a late yes on the Chief's ask may still start its turn: its chat is there, and the owner has
// not written in it since. chiefCarryOn(ask, grant): start that turn with the grant, 'started' or 'queued' (behind a
// reply that is going), or null when it could not. chiefName(): the Chief's name.
function create(dataDir, { asks, active, bot, whatCarriesOn = () => [], carryOn = () => 'full', appName = undefined, groupOfRun = () => null, chiefApps = () => [], chiefFits = () => false, chiefCarryOn = () => null, chiefName = () => 'The Chief of Staff' }) {
  const file = path.join(dataDir, 'connector-actions.json');
  const load = () => readJson(file, {});
  // One-use grants that a run can use now: "<run>:<app>:<action>:<fingerprint of the arguments>" -> the run.
  // In memory only: none outlives its run, and no run outlives botdot.
  const once = new Map();
  const key = (a) => `${a.runId}:${a.app}:${a.action}:${a.fingerprint}`;
  const allowed = (id, app, action) => (load()[id] || []).includes(`${app}:${action}`);
  const mine = (a) => a.kind === 'connector-action';
  // Whose grants an ask or a session asks for: a bot's, or the Chief's.
  const whose = (x) => (x.chief ? CHIEF : x.botId);
  const mayUse = (x, app) => (x.chief ? (chiefApps() || []) : (bot(x.botId)?.connectors || [])).includes(app);
  const hasApp = (ask) => mayUse(ask, ask.app);
  // Who waits for the ask, as the owner is told: the bot by its name, or the Chief.
  const who = (ask) => (ask.chief ? chiefName() : bot(ask.botId)?.name || 'The bot');

  // The Chief's turns that may use connected apps now: token -> { chief: true, chatId, turnId, runId: turnId }.
  // In memory only, as a bot's run token is: none outlives its turn, and no turn outlives botdot.
  const turns = new Map();
  const turnOf = (runId) => [...turns.values()].find((s) => s.turnId === runId) || null;
  // A run or a Chief turn that is going on.
  const live = (runId) => !!turnOf(runId) || active(runId);

  // Who waits: ask id -> { runId, botId, key, status: 'waiting' | 'allowed' | 'declined' | 'stopped', text, timer }.
  // key: the call it waits for, as a one-use grant names it. An entry stays until its run ends, so the tools
  // server can fetch the answer, and so the same call again in that run, after a no or a wait in vain, is answered
  // at once with the same words. A restart loses it, which start() makes up for.
  const waits = new Map();
  const answered = new EventEmitter();
  answered.setMaxListeners(100);
  const waitsFor = (runId) => [...waits.values()].some((w) => w.runId === runId && w.status === 'waiting');
  // The feed says when a run begins to wait and when its last wait ends, the way it says a run's opening line.
  // A turn in a group says it as an event of that group (events.js emitRun, ADR 018). A Chief turn says nothing
  // here: its reply is pending, with its working line, for as long as it waits.
  const announce = (w, on) => { if (w.botId) feed.emitRun('run_waits', groupOfRun(w.runId), { chat: `bot:${w.botId}`, botId: w.botId, runId: w.runId, ...(on ? { waitingFor: 'ok' } : {}) }); };

  // The run that a yes on this ask would start the bot again from, by the rules of ADR 009 asked for the one run
  // that waited (an entry of whatCarriesOn), or null: its yes can start nothing. botdot starts the bot itself,
  // also from a run the Chief started (`startsBot`).
  // The Chief's ask: its turn, while the day after the ask lasts, its chat is there and the owner has not written in it
  // since (ADR 047). A turn the owner stopped took its asks with it.
  const lateRun = (ask) => (ask.chief
    ? (Date.now() - Date.parse(ask.at) < CHIEF_LATE_MS && chiefFits(ask) ? { chief: true, chatId: ask.chatId } : null)
    : whatCarriesOn({ botId: ask.botId, at: ask.at, runs: [{ id: ask.runId, at: ask.at }], startsBot: true })[0] || null);
  // A card nobody waits for stays only while its yes would start the bot again. Returns the cards that went.
  const look = (match = () => true) => asks.drop((a) => mine(a) && !!a.stoppedAt && match(a) && !lateRun(a));

  // A wait is over: with the owner's answer, or without one ('stopped').
  function settle(id, status, text = null) {
    const w = waits.get(id);
    if (!w || w.status !== 'waiting') return;
    clearTimeout(w.timer);
    Object.assign(w, { status, text, timer: null });
    answered.emit(id);
    if (live(w.runId) && !waitsFor(w.runId)) announce(w, false);
  }
  // Ten minutes without an answer: the ask says since when nobody waits for it, and stays if a yes can still start the bot.
  function giveUp(id) {
    if (waits.get(id)?.status !== 'waiting') return;
    asks.mark((a) => a.id === id, { stoppedAt: new Date().toISOString() });
    const went = look((a) => a.id === id).length > 0;
    settle(id, 'stopped', went ? GONE : STAYS);
  }

  // Called for every action a run wants to run, with the action as Composio describes it. Returns when it may
  // run now. Otherwise it throws: with `requestId` and `waits` when the run is to wait for the owner's answer on
  // that ask (wait()), and then call again with the same arguments.
  // session: a bot's run ({ runId, botId }) or a Chief turn ({ chief: true, chatId, turnId, runId: turnId }).
  function authorize(session, app, tool, args) {
    if (!live(session.runId) || !mayUse(session, app)) throw new Error('The run or connector permission has ended.');
    // Tags are fetched from Composio, never supplied by the model. Missing/conflicting metadata waits.
    const tags = Array.isArray(tool.tags) ? tool.tags : [];
    if (tags.includes('readOnlyHint') && !tags.some((tag) => ['createHint', 'updateHint', 'destructiveHint'].includes(tag))) return;
    if (allowed(whose(session), app, tool.slug)) return;
    for (const [k, runId] of once) if (!live(runId)) once.delete(k);
    const proposal = { kind: 'connector-action', botId: session.chief ? null : session.botId, ...(session.chief ? { chief: true, chatId: session.chatId } : {}), runId: session.runId, app, action: tool.slug, arguments: args, fingerprint: fingerprint(args) };
    if (once.delete(key(proposal))) return; // used up by this call
    const needs = (id) => Object.assign(new Error("This action waits for the owner's OK in Needs you."), { requestId: id, waits: true });
    // This run was told no for this very call, or waited for the answer in vain: it is not held a second time,
    // whether the card is still there or not. wait() answers at once with the words it was told then.
    const told = [...waits].find(([, w]) => w.key === key(proposal) && (w.status === 'declined' || w.status === 'stopped'));
    if (told) throw needs(told[0]);
    // The same call of the same run, made again while the first still waits, joins its ask.
    const ask = asks.add(proposal);
    if (!waits.has(ask.id)) {
      const w = { runId: session.runId, botId: proposal.botId, key: key(proposal), status: 'waiting', text: null, timer: setTimeout(() => giveUp(ask.id), WAIT_MS).unref() };
      const first = !waitsFor(w.runId);
      waits.set(ask.id, w);
      if (first) announce(w, true);
    }
    throw needs(ask.id);
  }

  // One slice of a run's wait for the answer on its ask `id`: resolves when the wait is over, or after `ms` while
  // it still goes on. { status: 'waiting' | 'allowed' | 'declined' | 'stopped', text }, text being what the bot is
  // told when the action was not let through. null for an ask that is not this run's.
  async function wait(session, id, ms = SLICE_MS) {
    id = String(id ?? '');
    const w = waits.get(id);
    if (!w || w.runId !== session.runId) return null;
    if (w.status === 'waiting') {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(t); answered.off(id, done); resolve(); };
        const t = setTimeout(done, ms);
        answered.once(id, done);
      });
    }
    return { status: w.status, text: w.text };
  }

  // The owner's yes on `ask`. While its run waits, that run's call goes through: with "Allow once" by a grant
  // bound to that run, which the call uses up; with `always` by the lasting grant. After the run stopped waiting
  // the bot is started again and handed the stored arguments, and the one-use grant travels with that work until
  // its run starts (runStarted()). Returns { held } for a run that waited, or { carries: 'started' | 'queued' |
  // 'already_queued' } for work that was started or queued, or {} when "Always allow" changed the setting only.
  // Throws, and changes nothing but a card that went, when the yes cannot be given.
  // The Chief's ask after its wait: a yes starts a Chief turn in its chat (chiefCarryOn), with the grant bound to it.
  function approve(ask, always) {
    if (!hasApp(ask)) throw new Error(ask.chief ? 'That app is no longer connected, so nothing was done.' : 'The bot no longer has this connector.');
    const held = !ask.stoppedAt && waits.get(ask.id)?.status === 'waiting' && live(ask.runId);
    const grant = { app: ask.app, action: ask.action, arguments: ask.arguments, always: !!always };
    // "Allow once" has nothing left to apply to: the card goes, and the owner is told that nothing was done.
    const nothing = () => {
      asks.drop((a) => a.id === ask.id);
      return Object.assign(new Error(`${who(ask)} no longer waits for this, so nothing was done. Ask it again.`), { status: 409 });
    };
    let carries = null;
    if (!held) {
      const found = lateRun(ask);
      if (found && ask.chief) {
        carries = chiefCarryOn(ask, grant);
        if (!carries && !always) throw nothing();
      } else if (found) {
        carries = carryOn(found, { allowed: [actionPhrase(ask, appName)], grants: [grant] });
        if (carries === 'full') throw Object.assign(new Error(`${bot(ask.botId).name} already has too much waiting to take this up. Try again once it has caught up.`), { status: 429 });
      } else if (!always) throw nothing();
    }
    if (always) saveAlways(ask);
    else if (held) once.set(key(ask), ask.runId);
    asks.drop((a) => a.id === ask.id); // answered; the run this yes started may have taken the card along already
    settle(ask.id, 'allowed');
    return held ? { held: true } : carries ? { carries, ...(ask.chief ? { chief: true } : {}) } : {};
  }
  function saveAlways(ask) {
    const grants = load();
    const id = whose(ask);
    grants[id] = [...new Set([...(grants[id] || []), `${ask.app}:${ask.action}`])];
    writeJson(file, grants, { mode: 0o600 });
  }

  // The owner's no, after the ask was taken: a run that waits for it is told. One that waited in vain and is still
  // going is told so if it calls again.
  function declined(ask) {
    settle(ask.id, 'declined', DECLINED);
    const w = waits.get(ask.id);
    if (w?.status === 'stopped') Object.assign(w, { status: 'declined', text: DECLINED });
  }

  // A run starts. grants: what its queued work carried, [{ app, action, arguments, always }] (lib/bots.js): each
  // one-use grant is bound to this run now, for this action and these exact arguments. And a run of a bot is when
  // its cards that nobody waits for can lose what their yes would start: the owner wrote to it, or it carried on.
  function runStarted(meta, { grants = [] } = {}) {
    for (const g of grants) {
      if (!g || g.always || !(bot(meta.botId)?.connectors || []).includes(g.app)) continue;
      once.set(key({ runId: meta.id, app: g.app, action: g.action, fingerprint: fingerprint(g.arguments) }), meta.id);
    }
    look((a) => a.botId === meta.botId);
  }

  // A run ended: its one-use grants go, used or not, and nobody waits for its asks any more. The asks of a run
  // the owner stopped go; of any other run they stay for a late yes, if one can still start the bot.
  function runEnded(meta) {
    for (const [k, runId] of once) if (runId === meta.id) once.delete(k);
    for (const [id, w] of waits) {
      if (w.runId !== meta.id) continue;
      clearTimeout(w.timer);
      if (w.status === 'waiting') Object.assign(w, { status: 'stopped', text: GONE });
      waits.delete(id);
      answered.emit(id);
    }
    const its = (a) => mine(a) && a.runId === meta.id;
    if (meta.status === 'stopped') return void asks.drop(its);
    asks.mark((a) => its(a) && !a.stoppedAt, { stoppedAt: new Date().toISOString() });
    look(its);
  }

  // A Chief turn starts with connected apps (ADR 047): its session, by a token of its own. grants: what a late yes
  // gave the turn ([{ app, action, arguments, always }]): each one-use grant is bound to this turn now, before its
  // Claude Code starts. And the owner's new message in a chat is when the Chief's cards there that nobody waits for
  // lose what their yes would do. Returns { token, turnId }.
  function openChief({ chatId, grants = [] }) {
    const token = crypto.randomBytes(24).toString('hex');
    const turnId = `chief-turn-${crypto.randomUUID()}`;
    turns.set(token, { chief: true, chatId, turnId, runId: turnId, botId: null });
    for (const g of grants) {
      if (!g || g.always) continue;
      once.set(key({ runId: turnId, app: g.app, action: g.action, fingerprint: fingerprint(g.arguments) }), turnId);
    }
    look((a) => a.chief && a.chatId === chatId);
    return { token, turnId };
  }
  // That turn ended: its token goes, and the rest as for a run's end. stopped: the owner stopped it, and its cards go.
  function closeChief(turnId, { stopped = false } = {}) {
    for (const [token, s] of turns) if (s.turnId === turnId) turns.delete(token);
    runEnded({ id: turnId, status: stopped ? 'stopped' : 'ended' });
  }
  // The session of a Chief turn, by its token, or null.
  const chiefSession = (token) => (typeof token === 'string' && turns.get(token)) || null;
  // A chat is deleted: the Chief's cards there go.
  const chatGone = (chatId) => { asks.drop((a) => mine(a) && a.chief && a.chatId === chatId); };

  // botdot has started: no run of before is going on, so nobody waits for an ask that was held when it stopped.
  // From then on the cards nobody waits for are looked at every minute (a day has passed, the job was switched off).
  function start() {
    asks.mark((a) => mine(a) && !a.stoppedAt, { stoppedAt: new Date().toISOString() });
    look();
    setInterval(() => { try { look(); } catch (e) { console.error(`[connectors] ${e.message}`); } }, LOOK_MS).unref();
  }

  function revoke(id, action) {
    const grants = load();
    grants[id] = (grants[id] || []).filter((value) => value !== action);
    writeJson(file, grants, { mode: 0o600 });
  }
  return {
    authorize, wait, approve, declined, runStarted, runEnded, start, revoke, list: (id) => load()[id] || [],
    openChief, closeChief, chiefSession, chatGone, CHIEF,
    // The cards nobody waits for, looked at now: those whose yes could start nothing any more go.
    look: () => { look(); },
    // Whether one of this run's actions waits for the owner now: the run's `waitingFor: "ok"`.
    waitsFor,
    // Whether a yes on this ask, which its run no longer waits for, would start the bot again: its card's `then`.
    startsAgain: (ask) => !!ask.stoppedAt && !!lateRun(ask),
  };
}
module.exports = { create };

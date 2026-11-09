// A connected app a bot's run or the Chief needs and that has no working connection (ADR 168): one card, kind
// 'connect-app' (lib/asks.js), whose Connect opens the app's sign-in page. Once Composio says the connection is
// ACTIVE, the card settles: the bot gets the app, by the owner's own press on a card that names it, and what waited
// for it carries on (lib/routes/shared.js carryOnAfter, ADR 009 and 166). Only the owner signs in; nothing here
// opens a sign-in page by itself.
const { CONNECT_MODES } = require('./asks');

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// An app as a bot or the Chief names it: "Google Calendar", "google_calendar" and "googlecalendar" are one slug.
const slugOf = (app) => String(app || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

// How often a card whose sign-in page is open asks Composio whether the connection works, until that page expires;
// without an expiry, for as long as the Connectors page waits for one (public/connectors.js).
const POLL_MS = 5000;
const POLL_FOR_MS = 10 * 60_000;

// asks: lib/asks.js. bots: B.bots. connectors: B.connectors (lib/connectors.js). appName(slug): an app's name.
// carryOnAfter(ask, yes): lib/routes/shared.js. botOfRun(id): whose run it is, or null. asked(runId): that run made
// or joined a card for the owner (B.noteAskedOwner: the ledger's needs_you). every, now: the watcher's pace and
// clock, for tests.
function create({ asks, bots, connectors, appName, carryOnAfter, botOfRun = () => null, asked = () => {}, every = POLL_MS, now = () => Date.now() }) {
  // What follows the Chief's own card once it is connected: a turn in its chat with the app (chief.connectedTurn,
  // ADR 168, ADR 047), set by server.js. Unset (a test), the Chief is told as of any answer on what it asked for in a chat.
  let chiefConnected = null;
  const onChiefConnected = (fn) => { chiefConnected = fn; };
  const cards = () => asks.list().filter((a) => a.kind === 'connect-app');
  const waiting = (id) => cards().find((a) => a.id === id) || null;
  // Nothing to sign in to without a Composio key that works: the card asks for the key instead.
  const noKey = () => !connectors.status().configured || connectors.status().keyRejected;

  // The card for this app and bot (botId null: the Chief), made or joined: { ask, joined } or { held: true } when the
  // owner said Not now to it within the day, and no card is made. mode: as the caller knows it (lib/asks.js
  // CONNECT_MODES), else 'setup' without a key, 'reconnect' for an app connected before a switch to another
  // Composio account (#409), else 'connect'. runId: the bot's run that waits for it; chatId: the Chief chat it was asked in.
  // replaces: the connection a Reconnect makes again (a bot set to that account, ADR 174): the bots set to it move to
  // the new one.
  function offer({ botId = null, app, reason = '', runId = null, chatId = null, mode = null, error = null, replaces = null }) {
    const slug = slugOf(app);
    if (!SLUG_RE.test(slug)) throw new Error('Name one app, e.g. "googlecalendar" or "slack".');
    const bot = botId ? bots.get(botId) : null;
    if (botId && !bot) throw new Error(`No bot with id ${botId}.`);
    if (mode && !CONNECT_MODES.includes(mode)) throw new Error(`mode is one of ${CONNECT_MODES.join(', ')}.`);
    if (asks.connectDeclined(botId, slug)) return { held: true, name: appName(slug) };
    const key = !mode && noKey();
    const kind = mode || (key ? 'setup' : (connectors.reconnect() || []).includes(slug) ? 'reconnect' : 'connect');
    const joined = cards().some((a) => a.botId === botId && a.app === slug);
    const run = runId && botId && botOfRun(runId) === botId ? runId : null; // a run of another bot waits for nothing here
    if (run) asked(run);
    const ask = asks.add({ kind: 'connect-app', botId, app: slug, name: appName(slug), mode: kind, ...(key || (mode === 'setup' && !error) ? { key: true } : {}), ...(error ? { error } : {}), reason, ...(chatId ? { chatId } : {}), ...(replaces && kind === 'reconnect' ? { replaces } : {}) }, { runId: run });
    return { ask, joined };
  }

  // An app that is connected already and that the bot lacks: the card of a changed bot that asks for it (`asked: 'app'`,
  // lib/asks.js SETTING_ASKS), whose yes is the same update the bot's settings make, and which every app draws. The
  // card or { held: true } after a no to it within the week.
  function giveApp({ bot, app, reason = '', runId = null }) {
    const slug = slugOf(app);
    if (!SLUG_RE.test(slug)) throw new Error('Name one app, e.g. "googlecalendar" or "slack".');
    if ((bot.connectors || []).includes(slug)) throw new Error(`${appName(slug)} is already yours: use it with connector_actions and connector_run.`);
    if (asks.declinedRecently(bot.id, `app:${slug}`)) return { held: true, name: appName(slug) };
    if (runId) asked(runId);
    const ask = asks.add({ kind: 'bot-change', botId: bot.id, by: 'bot', asked: 'app', app: slug, name: appName(slug), reason, ...(runId ? { runId } : {}), changes: { connectors: [...(bot.connectors || []), slug] }, before: { connectors: bot.connectors || [] } }, { runId, bot });
    return { ask };
  }

  // What Composio's own list says of an app: { active: true } with a working connection; else the card's mode, a
  // Reconnect for one Composio keeps a connection of that no longer works or one of the Composio account before a
  // switch (#409), any other a Connect, and null without a key that works (offer: the card for the key). An app
  // Composio doesn't know is refused.
  async function lookUp(slug) {
    if (noKey()) return { mode: null };
    try {
      await connectors.toolkit(slug);
      const mine = (await connectors.connections()).filter((c) => c.toolkit === slug);
      if (mine.some((c) => c.status === 'ACTIVE')) return { active: true };
      return { mode: mine.length || (connectors.reconnect() || []).includes(slug) ? 'reconnect' : 'connect' };
    } catch (e) {
      if (e.composio && [400, 404].includes(e.status)) throw new Error(`No app called "${slug}". Name it as Composio does, e.g. "googlecalendar", "gmail", "slack".`);
      // A key refused meanwhile is the card for the key (offer, with no mode); Composio out of reach, a Connect.
      return { mode: e.status === 401 ? null : (connectors.reconnect() || []).includes(slug) ? 'reconnect' : 'connect' };
    }
  }

  // What a bot's missing app needs: the bot is given an app that has a working connection (giveApp), any other is
  // the card to connect it (offer). Returns what offer or giveApp return, giveApp's with `given`.
  async function need({ bot, app, reason = '', runId = null }) {
    const slug = slugOf(app);
    if (!SLUG_RE.test(slug)) throw new Error('Name one app, e.g. "googlecalendar" or "slack".');
    const found = await lookUp(slug);
    if (found.active) return { given: true, ...giveApp({ bot, app: slug, reason, runId }) };
    return offer({ botId: bot.id, app: slug, reason, runId, mode: found.mode });
  }

  // The Chief's Connect card, in its chat (offer_connect_app, or its own action in an app that isn't connected), for
  // itself or for a bot (botId): what offer returns, or { connected: true, name } for an app that works already,
  // which the Chief uses itself or gives with update_bot, and which gets no card.
  // another: one more account of an app that has one already (ADR 174), whose card keeps the first.
  async function chiefNeed({ botId = null, app, reason = '', runId = null, chatId = null, another = false }) {
    const slug = slugOf(app);
    if (!SLUG_RE.test(slug)) throw new Error('Name one app, e.g. "googlecalendar" or "slack".');
    const found = await lookUp(slug);
    if (found.active && another) return offer({ botId, app: slug, reason, runId, chatId, mode: 'another' });
    if (found.active) return { connected: true, name: appName(slug) };
    return offer({ botId, app: slug, reason, runId, chatId, mode: found.mode });
  }

  // Nothing to sign in to yet: the card says so and opens Connectors. key: it is the Composio key; error: Composio's words.
  const toSetup = (a, { key = false, error = null } = {}) => asks.mark((x) => x.id === a.id, { mode: 'setup', key: key || undefined, error: error || undefined, connectionId: undefined, expiresAt: undefined })[0] || a;

  // The owner pressed Connect (or Reconnect): the app's sign-in page, as the Connectors page opens it. The card keeps the
  // connection it makes and until when, never the page's address, which expires. An app that needs no sign-in is
  // connected already: the card settles now. Without a working key the card turns to setup, and this throws with
  // `setup: true`; Composio's refusal comes back as it came, for the caller to put in plain words (toSetup).
  async function connect(a, callbackUrl) {
    if (a.mode === 'another' && !noKey()) await keepAccounts(a.app);
    if (noKey()) {
      toSetup(a, { key: true });
      throw Object.assign(new Error(connectors.status().keyRejected ? connectors.rejectedError().message : 'Connectors need a Composio key. Add yours on the Connectors page.'), { status: 409, setup: true });
    }
    const r = await connectors.connect(a.app, callbackUrl);
    if (r.noAuth) return { noAuth: true, ...settle(a) };
    asks.mark((x) => x.id === a.id, { connectionId: r.connectionId, expiresAt: r.expiresAt || null });
    watch(a.id);
    return { redirectUrl: r.redirectUrl, connectionId: r.connectionId, expiresAt: r.expiresAt || null };
  }

  // Whether the connection its Connect made works now: { status }, Composio's (ACTIVE, INITIATED, FAILED, EXPIRED…),
  // and the card settled when it is ACTIVE. A card that has opened no sign-in page yet is { status: null }.
  async function check(a) {
    if (!a.connectionId) return { status: null };
    const c = await connectors.connection(a.connectionId);
    if (c.status === 'ACTIVE' && waiting(a.id)) return { status: c.status, ...settle(a, a.connectionId) };
    return { status: c.status };
  }

  // The app is connected: the card goes, the bot gets the app (by the owner, whose press named it, as a yes on a
  // changed bot does: its history keeps it), and what waited for it carries on. Settled twice, the second finds no
  // card and does nothing. Returns what the answer of a yes returns: { ok, settled, carriesOn? }.
  // connectionId: the connection that settled it, when known. Another account (ADR 174) is the card's bot's from now
  // on; a Reconnect of an account bots are set to moves them to the connection made again.
  function settle(a, connectionId = null) {
    if (!waiting(a.id)) return { ok: true, settled: false };
    if (watches.has(a.id)) { clearInterval(watches.get(a.id)); watches.delete(a.id); }
    const taken = asks.take(a.id);
    if (taken.replaces && connectionId && connectionId !== taken.replaces) {
      for (const b of bots.list()) if (b.accounts?.[taken.app] === taken.replaces) bots.update(b.id, { accounts: { ...b.accounts, [taken.app]: connectionId } }, { by: 'you' });
    }
    const bot = taken.botId ? bots.get(taken.botId) : null;
    const pin = taken.mode === 'another' && connectionId ? { accounts: { ...(bot?.accounts || {}), [taken.app]: connectionId } } : {};
    if (bot && (!(bot.connectors || []).includes(taken.app) || pin.accounts)) bots.update(bot.id, { connectors: [...new Set([...(bot.connectors || []), taken.app])], ...pin }, { by: 'you', reason: taken.reason });
    console.log(`[connectors] ${taken.app} is connected, from its card for ${bot ? bot.id : 'the Chief'}`);
    if (!taken.botId && chiefConnected) return { ok: true, settled: true, ...(chiefConnected(taken) || {}) };
    return { ok: true, settled: true, ...carryOnAfter(taken, true) };
  }

  // A card whose Connect opened a sign-in page asks Composio every few seconds whether the connection works, so the
  // work carries on also when no app asks (a phone that went to the sign-in page and never came back to its card):
  // until the page expires, the card is gone or settled, or the key is refused. One watch per card; a second
  // Connect on it moves the end to its page's. Timers never keep botdot running.
  const watches = new Map(); // card id -> timer
  function watch(id) {
    if (watches.has(id)) return;
    const from = now();
    let busy = false;
    const stop = () => { clearInterval(watches.get(id)); watches.delete(id); };
    const t = setInterval(async () => {
      if (busy) return;
      const a = waiting(id);
      const until = Date.parse(a?.expiresAt || '') || from + POLL_FOR_MS;
      if (!a?.connectionId || now() > until || noKey()) return stop();
      busy = true;
      try { if ((await check(a)).settled) stop(); } catch (e) {
        if (e.status === 401 || e.code === 'not-yours' || e.status === 404) stop();
        else console.error(`[connectors] couldn't ask Composio about ${a.app}: ${e.message}`);
      } finally { busy = false; }
    }, every);
    t.unref?.();
    watches.set(id, t);
  }
  // After a restart, the cards whose sign-in page is still open are watched again.
  function start() { for (const a of cards()) if (a.connectionId && Date.parse(a.expiresAt || '') > now()) watch(a.id); }
  const stopAll = () => { for (const id of [...watches.keys()]) { clearInterval(watches.get(id)); watches.delete(id); } };

  // Every list of the connections (lib/connectors.js onConnections: each action, the Connectors page, botdot's start)
  // settles the cards whose app now works: the connection their Connect made, one made after the card, or an app
  // that was not connected the time before (signed in on the Connectors page, or on another device). A Reconnect for
  // a connection that lacks a permission is not settled by the old connection that is still ACTIVE.
  // Another account, or the Reconnect of one account, settles only by a connection made for it: the app worked before.
  function listed(list, was) {
    for (const a of cards()) {
      const works = list.filter((c) => c.toolkit === a.app && c.status === 'ACTIVE');
      if (!works.length) continue;
      const made = works.find((c) => c.id === a.connectionId) || works.filter((c) => Date.parse(c.createdAt || '') > Date.parse(a.at)).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0];
      if (!made && (a.mode === 'another' || a.replaces || (was || []).includes(a.app))) continue;
      try { settle(a, made?.id || null); } catch (e) { console.error(`[connectors] the card for ${a.app} did not settle: ${e.message}`); }
    }
  }

  // Before one more account of an app is connected (ADR 174): every bot that has the app and no account of it set is
  // set to the one it uses now, so the new account changes nothing for it.
  async function keepAccounts(slug) {
    const list = await connectors.connections().catch(() => null);
    const now = list && connectors.accountFor(list, slug);
    if (!now) return;
    for (const b of bots.list()) if ((b.connectors || []).includes(slug) && !b.accounts?.[slug]) bots.update(b.id, { accounts: { ...(b.accounts || {}), [slug]: now.id } }, { by: 'you' });
  }

  return { offer, need, chiefNeed, keepAccounts, giveApp, connect, check, settle, toSetup, onChiefConnected, listed, watch, start, stopAll, slugOf };
}

module.exports = { create, slugOf };

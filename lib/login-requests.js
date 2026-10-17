// Requests the owner answers in a pop-up: "please add a login" (from bots or the Chief; the owner
// types the password there, so it goes straight into the vault and never through the AI), and
// "may I use this card here?" (kind 'card', every time a bot wants to pay).
const crypto = require('crypto');
const EventEmitter = require('events');
const { itemType } = require('./vault');

const requests = new Map(); // id -> request
const events = new EventEmitter();
events.setMaxListeners(100);

const TTL_MS = 15 * 60_000;

function create({ botId, runId = null, site, name, username = '', reason = '', from, kind = 'login', type, card = null, amount = '' }) {
  // One open request per bot, kind and site is enough.
  for (const r of requests.values()) {
    if (r.status === 'pending' && r.botId === botId && r.site === site && r.kind === kind) return r;
  }
  const r = {
    id: crypto.randomUUID().slice(0, 8),
    botId, runId, site,
    name: String(name || site).slice(0, 60),
    username: String(username || '').slice(0, 200),
    reason: String(reason || '').slice(0, 300),
    from, // 'bot' | 'chief'
    kind, // 'login' | 'card'
    // for 'login': what is asked for, 'login' | 'api-token' | 'other' (a login when none or an unknown one is
    // named). The pop-up's fields start from it, and the owner can change it there.
    ...(kind === 'login' ? { type: itemType(type) } : {}),
    card, // for 'card': { id, name, brand, last4 } (never the number)
    amount: String(amount || '').slice(0, 60),
    status: 'pending', // -> saved | allowed | declined | expired
    loginName: null,
    createdAt: new Date().toISOString(),
  };
  requests.set(r.id, r);
  setTimeout(() => settle(r.id, 'expired'), TTL_MS).unref();
  events.emit('changed');
  return r;
}

function settle(id, status, loginName = null) {
  const r = requests.get(id);
  if (!r || r.status !== 'pending') return r || null;
  r.status = status;
  r.loginName = loginName;
  events.emit(id, r);
  events.emit('changed');
  setTimeout(() => requests.delete(id), 60_000).unref();
  return r;
}

// Resolve when the request is answered, or after `ms` with the still-pending request.
function wait(id, ms = 25_000) {
  const r = requests.get(id);
  if (!r || r.status !== 'pending') return Promise.resolve(r || null);
  return new Promise((resolve) => {
    const done = (x) => { clearTimeout(t); resolve(x); };
    const t = setTimeout(() => { events.off(id, done); resolve(requests.get(id) || null); }, ms);
    events.once(id, done);
  });
}

// The saved logins a request can be answered with, as the store's public views. existing: those of the
// request's site. others, for a login request only: every other login a bot can use, saved for another
// website; picking one adds the request's site to its additional hosts (server.js, the allow action).
function logins(store, r) {
  const existing = store.findBySite(r.site);
  if (r.kind === 'card') return { existing };
  const ofSite = new Set(existing.map((e) => e.id));
  return { existing, others: store.list().filter((e) => (e.kind || 'login') === 'login' && !e.reprompt && !ofSite.has(e.id)) };
}

const pending = () => [...requests.values()].filter((r) => r.status === 'pending');
const get = (id) => requests.get(id) || null;

// A run ended: nobody is waiting for its requests any more.
function cancelForRun(runId) {
  for (const r of pending()) if (r.runId === runId) settle(r.id, 'expired');
}

// Called whenever a request opens or closes.
const onChange = (fn) => events.on('changed', fn);

module.exports = { create, settle, wait, pending, get, logins, cancelForRun, onChange };

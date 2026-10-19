// Web Push for the web page (issue #87, docs/api.md "Notifications on this device"): the account's VAPID keys, the
// browsers that subscribed, and what of the feed becomes a notification for them.
//
// The Android app makes its notifications itself from the feed it keeps open. A browser keeps nothing open, so here
// the botdot server follows the same feed and sends each browser what the phone would show, with the same rules:
//   - a reply of a bot or the Chief, only when its event says `new`. The server already leaves out a reply whose chat
//     is on screen in any app, a quiet run and one held for the morning (it is sent, new, when it is delivered);
//   - a question in a group, only with `notify: true`;
//   - what waits for the owner (a login, a job, a tile, a memory change, an ask, a plan of a bot): once each, and not
//     while the web page is in use, where it shows already (`webActive`);
//   - that Claude is signed out: once per sign-out, also while the web page is in use.
// What rang is kept in the file, so a restart does not ring it again; it is forgotten once it is answered.
//
// The file (push.json in the data folder) holds the keys, made on first use, and the subscriptions. A push service
// that answers 404 or 410 has dropped its subscription, and botdot drops it too.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');
const webPush = require('./web-push');

const MAX_SUBSCRIPTIONS = 20; // the browsers of one account: an old one goes when a new one comes past this
const BODY_MAX = 300;
const ID = /^[\w.-]{1,80}$/;
const SIGNED_OUT = "Claude is signed out: bots can't work."; // the words of the apps' own line

// ---------- what a notification says ----------

const clip = (t, n = BODY_MAX) => { t = String(t ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Replies are Markdown; a notification shows plain text ("## This week" -> "This week"), as the phone's does.
function plain(md) {
  return str(md).split('\n').map((line) => line.trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '• ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/(?<![*\w])\*([^*]+)\*(?!\w)/g, '$1')
    .replace(/`/g, ''))
    .filter((l) => l && l !== '---' && !l.startsWith('|---')).join('\n');
}

// A finished run: its reply, or why it didn't finish, under its job's name (Android runText).
function runText(d) {
  const body = d.status === 'success' ? str(d.result).trim() || 'Done.' : str(d.problem).trim() || `Didn't finish: ${str(d.error).trim() || str(d.status)}`;
  return (d.jobName ? `${d.jobName}\n` : '') + body;
}

// A Chief reply: the reply, or, when it failed, the problem and not the half-written text (Android chiefReplyText).
function chiefText(d) {
  const text = str(d.text).trim();
  const error = str(d.error).trim();
  return (d.status === 'error' ? error || text : text || error) || 'Replied.';
}

// Whom a card names, and what a tap opens: a card asked in a group names its bot and the group and opens the group;
// any other names its bot and opens Needs you (Android cardPlace).
function place(o, bot) {
  const group = ID.test(str(o.groupId)) ? o.groupId : null;
  return group ? { title: `${bot} in ${str(o.groupName) || 'a group'}`, target: `group:${group}` } : { title: bot, target: 'needs' };
}

const notice = (title, body, target, tag, urgency) => ({ title: clip(title, 80) || 'botdot', body: clip(plain(body)), target, tag: tag || target, urgency });
const chatTarget = (kind, id) => (ID.test(str(id)) ? `${kind}:${id}` : null);

// What waits for the owner, from the lists the feed sends whole: [{ key, title, body, target }].
function waiting(type, d, chiefName) {
  const bot = (o, fallback = 'A bot') => str(o.botName).trim() || fallback;
  const need = (key, o, body, fallback) => { const p = place(o, bot(o, fallback)); return { key, ...p, body }; };
  if (type === 'approvals') {
    return [
      ...(Array.isArray(d.jobs) ? d.jobs : []).map((o) => need(`job:${o.botId}/${o.jobId}`, o, str(o.text) || `Waiting for your OK: ${str(o.jobName)}`)),
      ...(Array.isArray(d.tiles) ? d.tiles : []).map((o) => need(`tile:${o.tileId}`, o, str(o.text) || `Waiting for your OK: “${str(o.title)}” on your Board`, chiefName)),
      ...(Array.isArray(d.memoryChanges) ? d.memoryChanges : []).map((o) => need(`memory:${o.id}`, o, str(o.title) || 'A change to the shared memory waits for your OK')),
    ];
  }
  if (type === 'asks') return (Array.isArray(d.list) ? d.list : []).map((o) => need(`ask:${o.id}`, o, str(o.text) || 'Needs your OK', chiefName));
  return [];
}

const PREFIXES = { approvals: ['job:', 'tile:', 'memory:'], asks: ['ask:'] };

// Follows the feed's events and says which notifications they make. `rung`: the keys of what rang (a Set, kept by
// the caller), `onScreen(chat)`: whether an app shows that chat now, `chiefName()`: what the Chief is called.
// take(ev) returns [{ title, body, target, tag, urgency }] and whether `rung` changed.
function follower({ rung, onScreen = () => false, chiefName = () => 'Chief of Staff' }) {
  let changed = false;
  const ring = (key) => { if (rung.has(key)) return false; rung.add(key); changed = true; return true; };
  const forget = (match) => { for (const k of [...rung]) if (match(k)) { rung.delete(k); changed = true; } };

  function notices(ev) {
    const d = ev.data || {};
    switch (ev.type) {
      case 'run_finished': {
        const target = chatTarget('bot', d.botId);
        if (d.new !== true || !target) return [];
        const name = str(d.botName).trim() || 'A bot';
        if (d.asks === true) return [notice(str(d.title).trim() || `${name} asks`, str(d.question).trim() || str(d.result), target)];
        return [notice(name, runText(d), target)];
      }
      case 'group_run_finished': {
        const target = chatTarget('group', d.groupId);
        if (d.notify !== true || !target) return [];
        const name = str(d.botName).trim() || 'A bot';
        return [notice(str(d.title).trim() || `${name} asks`, str(d.question).trim() || str(d.result), target)];
      }
      case 'chief_reply': {
        const target = chatTarget('chief', d.chatId);
        if (d.new !== true || !target) return [];
        const from = d.from && typeof d.from === 'object' ? str(d.from.name).trim() || 'A bot' : chiefName();
        return [notice(from, chiefText(d), target)];
      }
      case 'chief_suggestion': {
        const target = chatTarget('chief', d.chatId);
        if (!target || onScreen(target) || !ring(`plan:${d.chatId}`)) return [];
        return [notice(str(d.from?.name).trim() || 'A bot', `A plan for the Chief: ${str(d.title)}`, target, `plan:${d.chatId}`, 'high')];
      }
      case 'plan_closed': forget((k) => k === `plan:${d.chatId}`); return [];
      case 'login_request': {
        if (!ID.test(str(d.id)) || !ring(`login:${d.id}`) || ev.webActive) return [];
        const site = str(d.site);
        const text = d.kind === 'card' ? `Wants to pay on ${site}${d.amount ? ` (${str(d.amount)})` : ''}` : `Asks for the ${site} login`;
        const p = place(d, str(d.botName).trim() || 'A bot');
        return [notice(p.title, text, p.target, `login:${d.id}`, 'high')];
      }
      case 'login_request_closed': forget((k) => k === `login:${d.id}`); return [];
      case 'approvals':
      case 'asks': {
        if (ev.type === 'asks' && !Array.isArray(d.list)) return []; // a bot's open question: its run notifies
        const open = waiting(ev.type, d, chiefName());
        const keys = new Set(open.map((n) => n.key));
        forget((k) => PREFIXES[ev.type].some((p) => k.startsWith(p)) && !keys.has(k));
        const fresh = open.filter((n) => ring(n.key));
        return ev.webActive ? [] : fresh.map((n) => notice(n.title, n.body, n.target, n.key, 'high'));
      }
      case 'claude': {
        if (d.loggedIn === true) { forget((k) => k === 'claude'); return []; }
        if (d.loggedIn !== false || !ring('claude')) return [];
        return [notice('botdot', SIGNED_OUT, 'app', 'claude', 'high')];
      }
      default: return [];
    }
  }
  return {
    take(ev) {
      changed = false;
      const out = notices(ev);
      return { notices: out, changed };
    },
  };
}

// ---------- the keys, the subscriptions and the sending ----------

// A subscription as a browser sends it: { endpoint, keys: { p256dh, auth } }. http endpoints only for the tests.
function checkSubscription(sub, { allowHttp = false } = {}) {
  let url;
  try { url = new URL(str(sub?.endpoint)); } catch { throw Object.assign(new Error('A subscription needs its endpoint, an https address.'), { status: 400 }); }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) throw Object.assign(new Error('A subscription needs its endpoint, an https address.'), { status: 400 });
  if (str(sub.endpoint).length > 2000) throw Object.assign(new Error('That endpoint is too long.'), { status: 400 });
  if (!webPush.validKeys(sub.keys)) throw Object.assign(new Error('A subscription needs its keys, p256dh and auth, as the browser gave them.'), { status: 400 });
  return { endpoint: url.href, keys: { p256dh: str(sub.keys.p256dh), auth: str(sub.keys.auth) } };
}

function create(dataDir, { fetchImpl = (...a) => fetch(...a), allowHttp = false, log = console } = {}) {
  const file = path.join(dataDir, 'push.json');
  const stored = readJson(file, null);
  const store = {
    vapid: stored?.vapid?.publicKey && stored?.vapid?.privateKey ? stored.vapid : null,
    subscriptions: Array.isArray(stored?.subscriptions) ? stored.subscriptions.filter((s) => s && typeof s.endpoint === 'string' && s.keys) : [],
    rung: Array.isArray(stored?.rung) ? stored.rung.filter((k) => typeof k === 'string') : [],
  };
  const rung = new Set(store.rung);
  const save = () => { store.rung = [...rung]; writeJson(file, store, { mode: 0o600 }); }; // it holds the private key

  // The account's keys, made the first time a browser asks for them.
  function vapid() {
    if (!store.vapid) { store.vapid = webPush.vapidKeys(); save(); }
    return store.vapid;
  }

  // Keeps a browser's subscription (the same endpoint again replaces it). `subject`: botdot's https address, as the
  // browser reached it, for the push service. `device`: a few words the page says of itself.
  function add(sub, { subject, device } = {}) {
    const s = checkSubscription(sub, { allowHttp });
    const kept = { ...s, device: clip(device, 80) || null, subject: /^https:\/\/[^\s/]+$/.test(str(subject)) ? subject : null, at: new Date().toISOString() };
    store.subscriptions = [...store.subscriptions.filter((x) => x.endpoint !== s.endpoint), kept].slice(-MAX_SUBSCRIPTIONS);
    save();
    return kept;
  }

  function remove(endpoint) {
    const before = store.subscriptions.length;
    store.subscriptions = store.subscriptions.filter((x) => x.endpoint !== endpoint);
    if (store.subscriptions.length === before) return false;
    save();
    return true;
  }

  const has = (endpoint) => store.subscriptions.some((x) => x.endpoint === endpoint);

  // Sends one notification to every browser that subscribed. Resolves once each has answered.
  async function notify({ title, body, target, tag, urgency }) {
    if (!store.subscriptions.length || !store.vapid) return [];
    const payload = { title, body, target, tag };
    return Promise.all(store.subscriptions.map(async (sub) => {
      let status;
      try {
        status = await webPush.send(sub, payload, { vapid: store.vapid, subject: sub.subject || 'mailto:botdot@localhost', urgency: urgency || 'normal', fetchImpl });
      } catch (e) {
        log.error(`[push] ${new URL(sub.endpoint).host}: ${e.message}`);
        return { endpoint: sub.endpoint, error: e.message };
      }
      if (status === 404 || status === 410) { remove(sub.endpoint); log.log(`[push] ${new URL(sub.endpoint).host} dropped a subscription (${status}); botdot dropped it too`); }
      else if (status < 200 || status >= 300) log.error(`[push] ${new URL(sub.endpoint).host} answered ${status}`);
      return { endpoint: sub.endpoint, status };
    }));
  }

  // Follows the feed: what makes a notification is sent to every browser that subscribed. `sent` gets each send's
  // promise (for the tests).
  function follow(feed, { onScreen, chiefName, sent = () => {} } = {}) {
    const f = follower({ rung, onScreen, chiefName });
    return feed.subscribe((ev) => {
      const { notices, changed } = f.take(ev);
      if (changed) save();
      for (const n of notices) sent(notify(n).catch((e) => log.error(`[push] ${e.message}`)));
    });
  }

  return { publicKey: () => vapid().publicKey, add, remove, has, count: () => store.subscriptions.length, notify, follow };
}

module.exports = { create, follower, checkSubscription, plain, runText, chiefText, BODY_MAX, MAX_SUBSCRIPTIONS };

// What the web page has on screen, and what the owner has read (ADR 005).
const { NEXT, send, readBody } = require('./http');
const feed = require('../events');
const readLib = require('../read');
const B = require('../bots');
const chief = require('../chief');

function create(ctx) {
  let webChat = null; // the chat the web page last said is on screen (see /api/presence)
  return async function routes(req, res, url, { parts, m }) {
    // Updating botdot from Settings (Docker installs).
    // The web page is open and in use: the phone app doesn't notify meanwhile (see events.js).
    // It also says which chat is on screen: when that changes, the phone takes away that chat's notification.
    if (parts[0] === 'presence' && m === 'POST') {
      const { chat } = await readBody(req).catch(() => ({}));
      // Not a group's chat: `chat_seen` is for apps from before `unread`, and those know no group (ADR 018).
      const on = typeof chat === 'string' && /^(bot|chief):[\w.-]{1,80}$/.test(chat) ? chat : null;
      const wasActive = feed.webActive();
      feed.seenOnWeb();
      if (on && (on !== webChat || !wasActive)) feed.emit('chat_seen', { chat: on });
      webChat = on;
      return send(res, 200, { ok: true });
    }
    // What an app shows, in front (ADR 005): `chat`, which is then read up to now, or null for none. `app` is an
    // id the app made up for itself. It repeats this every `repeatMs` while the chat stays on screen, and says
    // null when it doesn't; a reply that lands while a chat is reported is read at once.
    if (parts[0] === 'read' && !parts[1] && m === 'POST') {
      const { chat = null, app } = await readBody(req).catch(() => ({}));
      if (typeof app !== 'string' || !readLib.APP.test(app)) return send(res, 400, { error: 'Say which app reports (app).' });
      if (chat === null) { B.read.report(app, null); return send(res, 200, { ok: true, chat: null, repeatMs: readLib.REPEAT_MS }); }
      const [kind, id] = typeof chat === 'string' && readLib.CHAT.test(chat) ? [chat.slice(0, chat.indexOf(':')), chat.slice(chat.indexOf(':') + 1)] : [];
      const found = kind === 'bot' ? B.bots.get(id) : kind === 'chief' ? chief.readChat(id) : kind === 'group' ? B.groups.get(id) : null;
      if (!found) return send(res, 400, { error: "That chat doesn't exist." });
      // A group has a read position like any chat (ADR 018), and its new replies are the group's own (ADR 019).
      const before = kind === 'bot' ? B.unreadOfBot(id) : kind === 'chief' ? chief.unreadOfChat(found) : B.groupChat.unread(id);
      const fresh = B.read.report(app, chat);
      if (fresh || before.unread) B.read.mark(chat);
      // A group's count has an event of its own: an app from before groups acts on `unread`, and knows no group (ADR 018).
      if (before.unread) { if (kind === 'group') feed.emit('group_unread', B.groupChat.unreadEvent(id)); else feed.emit('unread', B.unreadEvent(chat, readLib.NOTHING_NEW)); }
      if (fresh && kind !== 'group') feed.emit('chat_seen', { chat }); // apps from before `unread` take that chat's notification away on this; they know no group
      return send(res, 200, { ok: true, chat, readAt: B.read.readAt(chat), repeatMs: readLib.REPEAT_MS });
    }
    return NEXT;
  };
}

module.exports = { create };

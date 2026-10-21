// What's new (#219): the notes of the releases this account has not seen, and marking them seen (lib/whats-new.js).
const path = require('path');
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const whatsNew = require('../whats-new');

const DIR = process.env.BOT_DOT_WHATS_NEW_DIR || path.join(__dirname, '..', '..', 'whats-new');

function create() {
  const notes = whatsNew.create({ dir: DIR, dataDir: B.DATA_DIR });
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'whats-new') return NEXT;
    if (!parts[1] && m === 'GET') return send(res, 200, { entries: notes.unseen() });
    if (parts[1] === 'seen' && !parts[2] && m === 'POST') {
      const { id } = await readBody(req).catch(() => ({}));
      try { return send(res, 200, notes.seen(id)); } catch (e) { return send(res, e.status || 500, { error: e.message }); }
    }
    return NEXT;
  };
}

module.exports = { create };

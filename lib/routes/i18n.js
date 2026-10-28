// The interface's words in a language (#645, ADR 108): GET /api/i18n/pl answers the Polish dictionary the apps draw
// their text with (lib/i18n). English has none: its words are the keys.
const { NEXT, send } = require('./http');
const i18n = require('../i18n');

function create() {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'i18n' || !parts[1] || parts[2] || m !== 'GET') return NEXT;
    if (!i18n.LANGUAGES.includes(parts[1])) return send(res, 404, { error: 'No such language.' });
    return send(res, 200, { language: parts[1], strings: i18n.strings(parts[1]) });
  };
}

module.exports = { create };

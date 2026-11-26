// The interface's words in a language (#645, ADR 108, ADR 280): GET /api/i18n/<code> answers the dictionary the apps
// draw their text with (lib/i18n), the languages the account may choose, and the words of the offered languages the
// apps read in what a bot or the owner wrote (lib/i18n/phrases.js), and the language's elision rule (lib/i18n/elision.js). English has no dictionary: its words are the keys.
const { NEXT, send } = require('./http');
const i18n = require('../i18n');
const phrases = require('../i18n/phrases');

function create() {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'i18n' || !parts[1] || parts[2] || m !== 'GET') return NEXT;
    if (!i18n.isOffered(parts[1])) return send(res, 404, { error: 'No such language.' });
    return send(res, 200, { language: parts[1], strings: i18n.strings(parts[1]), languages: i18n.languages(), phrases: phrases.forApps(), elision: i18n.elisionOf(parts[1]) });
  };
}

module.exports = { create };

// Token usage (#301; docs/api.md, Token usage): what the account's bots and its Chief of Staff used, per day and per
// bot, for a range of days (lib/usage.js). The owner's alone: neither the Chief's tools nor a bot reach it.
const { NEXT, send } = require('./http');
const B = require('../bots');

function create() {
  return async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] !== 'usage' || parts[1]) return NEXT;
    if (m !== 'GET') return send(res, 405, { error: 'Not here' });
    if (by !== 'you') return send(res, 403, { error: 'Only the owner sees the usage.' });
    const q = url.searchParams;
    try {
      return send(res, 200, B.usage.range({ from: q.get('from') || undefined, to: q.get('to') || undefined }, {
        botName: (id) => B.bots.get(id)?.name || null,
        chiefName: B.settings.chiefName(),
      }));
    } catch (e) { return send(res, e.status || 500, { error: e.message }); }
  };
}

module.exports = { create };

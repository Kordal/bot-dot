// Tools installed on the botdot server for one bot (lib/tools.js, ADR 007).
const { NEXT, send } = require('./http');
const toolsLib = require('../tools');

function create(ctx) {
  const { tools } = ctx;
  return async function routes(req, res, url, { parts, m, by }) {
    // Installed tools, for the Chief's tools (find_tool, list_tools, remove_tool); asking is POST /api/asks.
    if (parts[0] === 'tools') {
      if (parts[1] === 'find' && !parts[2] && m === 'GET') return send(res, 200, { ...(await tools.find(url.searchParams.get('name'))), ...(tools.available() ? {} : { note: toolsLib.NO_BROKER }) });
      if (!parts[1] && m === 'GET') return send(res, 200, { available: tools.available(), tools: tools.list(url.searchParams.get('bot')) });
      if (parts[1] && parts[2] && !parts[3] && m === 'DELETE') return send(res, 200, { ok: true, ...(await tools.remove(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]), by)) });
    }
    return NEXT;
  };
}

module.exports = { create };

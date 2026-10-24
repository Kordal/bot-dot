// A site's icon for a link in a reply (#530, ADR 086): GET /api/favicon?host=<host>, fetched and kept by botdot
// (lib/favicon.js). 404 when the site has none botdot keeps: the apps then draw their own globe.
const path = require('path');
const { NEXT, send } = require('./http');
const B = require('../bots');
const favicon = require('../favicon');

function create() {
  const icons = favicon.create({ dir: path.join(B.DATA_DIR, 'favicons') });
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'favicon' || parts[1] || m !== 'GET') return NEXT;
    const host = favicon.siteHost(url.searchParams.get('host'));
    if (!host) return send(res, 400, { error: 'Give a site\'s host name, like example.com.' });
    const icon = await icons.icon(host);
    // The browser and the phone keep the answer too, so a chat drawn again asks nothing.
    const keep = `private, max-age=${Math.round((icon ? favicon.KEEP_MS : favicon.MISS_MS) / 1000)}`;
    if (!icon) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': keep });
      return res.end(JSON.stringify({ error: 'This site has no icon botdot keeps.' }));
    }
    res.writeHead(200, { 'Content-Type': icon.type, 'Content-Length': icon.body.length, 'Cache-Control': keep, 'Content-Security-Policy': "sandbox; default-src 'none'" });
    return res.end(icon.body);
  };
}

module.exports = { create };

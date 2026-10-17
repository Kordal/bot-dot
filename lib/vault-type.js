// Where a saved login may be typed in a bot's browser. The browser itself (deploy/desktop/camoufox-browser)
// accepts the site it is handed and that site's subdomains. A login's additional hosts are exact: so botdot
// asks the browser where it is, and hands it that host only when it is exactly one of them. Anywhere else
// it hands the login's own website, as before, and the browser refuses with its own sentence.
const { hostname } = require('./network-address');

// type: (payload) => the browser's answer, lib/computers.js typeSecret for one bot's computer.
// secret: { site, allowedHosts } from the vault's reveal().
async function siteToType(type, secret) {
  const hosts = (secret.allowedHosts || []).map(hostname);
  if (!hosts.length) return secret.site;
  const where = await type({ op: 'where' });
  const host = where && where.ok ? hostname(where.host) : '';
  return host && hosts.includes(host) ? host : secret.site;
}

module.exports = { siteToType };

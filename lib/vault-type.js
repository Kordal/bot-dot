// Where a saved login may be typed in a bot's browser. The browser itself (deploy/desktop/camoufox-browser)
// accepts the site it is handed and that site's subdomains. A login's additional hosts are exact: so botdot
// asks the browser where it is, and hands it that host only when it is exactly one of them. Anywhere else
// it hands the login's own website, as before, and the browser refuses with its own sentence.
// A login saved for www.<name> is the owner's <name>: its sign-in page is often on another subdomain of it
// (www.ah.be signs in on login.ah.be), so there the browser is handed <name> and accepts its subdomains.
const { hostname } = require('./network-address');

// type: (payload) => the browser's answer, lib/computers.js typeSecret for one bot's computer.
// secret: { site, allowedHosts } from the vault's reveal().
async function siteToType(type, secret) {
  const hosts = (secret.allowedHosts || []).map(hostname);
  const site = hostname(secret.site);
  // www. and at least two labels after it, so www.com hands no "com".
  const base = /^www\.[^.]+\.[^.]+/.test(site) ? site.slice(4) : '';
  if (!hosts.length && !base) return secret.site;
  const where = await type({ op: 'where' });
  const host = where && where.ok ? hostname(where.host) : '';
  if (host && hosts.includes(host)) return host;
  if (host && base && (host === base || host.endsWith(`.${base}`))) return base;
  return secret.site;
}

module.exports = { siteToType };

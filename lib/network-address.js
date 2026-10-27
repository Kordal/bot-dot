const net = require('node:net');

const IPV4_RANGES = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4', '240.0.0.0/4'];
const IPV6_RANGES = ['::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8'];
const blocked = new net.BlockList();
for (const [family, ranges] of [['ipv4', IPV4_RANGES], ['ipv6', IPV6_RANGES]]) {
  for (const range of ranges) { const [address, prefix] = range.split('/'); blocked.addSubnet(address, Number(prefix), family); }
}
const hostname = (value) => String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
function privateAddress(value) {
  const address = hostname(value);
  const family = net.isIP(address);
  return !family || blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}
// These names explicitly designate a local service, unlike a public DNS name that changes its IP.
const internalHost = (value) => {
  const host = hostname(value);
  return net.isIP(host) ? privateAddress(host) : !host.includes('.') || /\.(local|localhost|lan|internal|home\.arpa)$/.test(host);
};
// The machine itself: for a bot's request, the bot's own computer (#611).
const loopbackHost = (value) => {
  const host = hostname(value);
  const family = net.isIP(host);
  if (family === 4) return host.startsWith('127.');
  if (family === 6) return host === '::1';
  return host === 'localhost' || host.endsWith('.localhost');
};
const MAX_EXACT_HOSTS = 20; // a login's additional hosts
function exactHosts(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_EXACT_HOSTS) throw new Error(`Give at most ${MAX_EXACT_HOSTS} exact login hosts`);
  return [...new Set(input.map((value) => {
    const raw = String(value).trim();
    let url;
    try { url = new URL(`https://${raw}`); } catch { throw new Error('Give exact hostnames, without paths or wildcards'); }
    if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || raw.includes('*')) throw new Error('Give exact hostnames, without paths or wildcards');
    return hostname(url.hostname);
  }))];
}
module.exports = { IPV4_RANGES, IPV6_RANGES, hostname, privateAddress, internalHost, loopbackHost, exactHosts, MAX_EXACT_HOSTS };

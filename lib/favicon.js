// A site's small icon, shown before a link in a reply (#530, ADR 086). botdot fetches it itself: never a favicon
// service, which would see every link, and never the app, which would show the site the owner's address. It tries
// the icons the site's home page names, then /favicon.ico, over HTTPS only, and keeps a PNG or an ICO of at most
// ICON_MAX bytes (told by its bytes, never by what the site says it is; an SVG can hold scripts and is never kept).
// Each hop's addresses are checked and pinned for its request, as for notifications (lib/notify.js): a site that
// points to a local, private or Tailscale address gets no request. On disk: an icon for KEEP_MS, a site without
// one for MISS_MS.
const crypto = require('node:crypto');
const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const fs = require('./principal-fs');
const { hostname, privateAddress, internalHost } = require('./network-address');

const ICON_MAX = 32 * 1024;
const PAGE_MAX = 256 * 1024; // the home page is read this far: its head is at its start
const KEEP_MS = 7 * 24 * 3600 * 1000;
const MISS_MS = 24 * 3600 * 1000;
const TIMEOUT_MS = 8000;
const HOPS = 3; // redirects followed per address
const TRIES = 4; // icons tried per site
const AT_ONCE = 4; // sites fetched at the same time

// The host a request names, as botdot fetches it, or null: a public DNS name, without port, path or address.
function siteHost(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 253 || /[/:@?#\\\s]/.test(raw)) return null;
  let host;
  try { host = hostname(new URL(`https://${raw}/`).hostname); } catch { return null; }
  if (!host || net.isIP(host) || internalHost(host) || !/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

// A PNG or an ICO, by its first bytes; null for anything else.
function iconType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 6 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf.readUInt16LE(4) > 0) return 'image/x-icon';
  return null;
}

// The icons a page's <link> tags name, best first: a plain icon before the touch icon (larger), never an SVG.
function iconLinks(html, base) {
  const found = [];
  for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const attr = (name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))?.slice(1).find((v) => v !== undefined);
    const rel = String(attr('rel') || '').toLowerCase().split(/\s+/);
    const href = attr('href');
    if (!href || !rel.some((r) => r === 'icon' || r === 'apple-touch-icon' || r === 'apple-touch-icon-precomposed')) continue;
    if (/svg/i.test(attr('type') || '') || /\.svgz?(\?|#|$)/i.test(href)) continue;
    let url;
    try { url = new URL(href.replace(/&amp;/g, '&'), base); } catch { continue; }
    if (url.protocol !== 'https:') continue;
    found.push({ url: url.href, touch: !rel.includes('icon') });
  }
  return [...found.filter((f) => !f.touch), ...found.filter((f) => f.touch)].map((f) => f.url);
}

// One GET over HTTPS, its redirects followed up to HOPS, each hop's host resolved and checked first. Resolves
// { status, type, body } with at most `max` bytes of the body (`whole: false` when there was more), or null.
// `local` is for tests only: a server on this machine, at its port, with its own certificate.
/** @param {string} url @param {{ max: number, lookup: any, timeoutMs: number, local?: { port: number, ca: any } | null }} o */
async function get(url, { max, lookup, timeoutMs, local = null }) {
  for (let hop = 0; hop <= HOPS; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || (u.port && u.port !== '443')) return null;
    const host = hostname(u.hostname);
    if (net.isIP(host) || internalHost(host)) return null;
    let addresses;
    try { addresses = await lookup(host, { all: true }); } catch { return null; }
    if (!addresses?.length || (!local && addresses.some((a) => privateAddress(a.address)))) return null;
    /** @type {any} */
    const pinned = (_h, options, cb) => cb(null, ...(options?.all ? [addresses] : [addresses[0].address, addresses[0].family]));
    const r = await new Promise((resolve) => {
      let done = false;
      const end = (/** @type {any} */ v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const req = https.request(u, { method: 'GET', headers: { 'User-Agent': 'botdot', Accept: '*/*' }, lookup: pinned, agent: false, ...(local ? { port: local.port, ca: local.ca, checkServerIdentity: () => undefined } : {}) }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400) { res.resume(); return end({ status, location: res.headers.location }); }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          chunks.push(c);
          size += c.length;
          if (size > max) { req.destroy(); end({ status, type: res.headers['content-type'], body: Buffer.concat(chunks).subarray(0, max), whole: false }); }
        });
        res.on('end', () => end({ status, type: res.headers['content-type'], body: Buffer.concat(chunks), whole: true }));
        res.on('error', () => end(null));
      });
      // The whole answer within timeoutMs, not each pause in it: a site that trickles is cut off too.
      const timer = setTimeout(() => { req.destroy(); end(null); }, timeoutMs);
      req.on('error', () => end(null));
      req.end();
    });
    if (!r?.location) return r;
    try { url = new URL(r.location, u).href; } catch { return null; }
  }
  return null;
}

/** @param {{ dir: string, lookup?: any, now?: () => number, timeoutMs?: number, local?: { port: number, ca: any } | null }} o */
function create({ dir, lookup = dns.promises.lookup, now = Date.now, timeoutMs = TIMEOUT_MS, local = null }) {
  const fileOf = (host) => path.join(dir, crypto.createHash('sha256').update(host).digest('hex').slice(0, 32));
  const going = new Map(); // host -> its fetch, so a chat with ten links to one site asks it once
  let running = 0;
  const waiting = [];

  function kept(host) {
    const file = fileOf(host);
    for (const [ext, keep] of [['.icon', KEEP_MS], ['.none', MISS_MS]]) {
      let st;
      try { st = fs.statSync(file + ext); } catch { continue; }
      if (now() - st.mtimeMs > keep) continue;
      if (ext === '.none') return { icon: null };
      const body = fs.readFileSync(file + ext);
      const type = iconType(body);
      if (type) return { icon: { type, body } };
    }
    return null;
  }
  function keep(host, icon) {
    const file = fileOf(host);
    fs.mkdirSync(dir, { recursive: true });
    for (const ext of ['.icon', '.none']) try { fs.rmSync(file + ext, { force: true }); } catch {}
    fs.writeFileSync(file + (icon ? '.icon' : '.none'), icon ? icon.body : '');
  }

  async function fetchIcon(host) {
    const o = { lookup, timeoutMs, local };
    const home = await get(`https://${host}/`, { ...o, max: PAGE_MAX });
    const named = home && home.status === 200 && /html/i.test(String(home.type)) ? iconLinks(home.body.toString('utf8'), `https://${host}/`) : [];
    const tries = [...new Set([...named, `https://${host}/favicon.ico`])].slice(0, TRIES);
    for (const url of tries) {
      const r = await get(url, { ...o, max: ICON_MAX });
      if (!r || r.status !== 200 || !r.whole) continue;
      const type = iconType(r.body);
      if (type) return { type, body: r.body };
    }
    return null;
  }

  async function turn(work) {
    if (running >= AT_ONCE) await new Promise((resolve) => waiting.push(resolve));
    running++;
    try { return await work(); } finally { running--; waiting.shift()?.(); }
  }

  /** A site's icon, { type, body }, or null when it has none botdot keeps. `host` is siteHost's. */
  async function icon(host) {
    const have = kept(host);
    if (have) return have.icon;
    if (!going.has(host)) {
      going.set(host, turn(() => fetchIcon(host)).catch(() => null).then((found) => {
        try { keep(host, found); } catch (e) { console.error(`[favicon] couldn't keep ${host}'s icon: ${e.message}`); }
        return found;
      }).finally(() => going.delete(host)));
    }
    return going.get(host);
  }

  return { icon };
}

module.exports = { create, get, siteHost, iconType, iconLinks, ICON_MAX, KEEP_MS, MISS_MS };

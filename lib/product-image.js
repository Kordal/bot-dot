// A product's photo on a product card in a reply (#682, ADR 113). botdot fetches it itself, as it fetches a site's
// icon (lib/favicon.js, ADR 086): never the app, which would show the store the owner's address and when they read.
// Over HTTPS only, from a public address only (each hop checked and pinned, lib/favicon.js get), and kept when it is
// a JPEG, a PNG, a WebP or a GIF of at most IMAGE_MAX bytes, told by its bytes, never by what the store says it is
// (an SVG can hold scripts and is never kept). On disk: a photo for KEEP_MS, an address without one for MISS_MS; a
// store that did not answer is asked again by the next card.
const crypto = require('node:crypto');
const dns = require('node:dns');
const net = require('node:net');
const path = require('node:path');
const fs = require('./principal-fs');
const { get } = require('./favicon');
const { hostname, internalHost } = require('./network-address');

const IMAGE_MAX = 3 * 1024 * 1024;
const URL_MAX = 2000;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const MISS_MS = 24 * 3600 * 1000;
const TIMEOUT_MS = 10000;
const AT_ONCE = 4; // photos fetched at the same time

// The address botdot fetches, or null: https, on its own port, at a public DNS name, no user or password in it.
function imageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > URL_MAX) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return null;
  const host = hostname(u.hostname);
  if (!host || net.isIP(host) || internalHost(host)) return null;
  u.hash = '';
  return u.href;
}

// The kind of a photo, by its first bytes; null for anything else.
function imageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  return null;
}

/** @param {{ dir: string, lookup?: any, now?: () => number, timeoutMs?: number, local?: { port: number, ca: any } | null }} o */
function create({ dir, lookup = dns.promises.lookup, now = Date.now, timeoutMs = TIMEOUT_MS, local = null }) {
  const fileOf = (url) => path.join(dir, crypto.createHash('sha256').update(url).digest('hex').slice(0, 40));
  const going = new Map(); // url -> its fetch, so a reply drawn in two places asks the store once
  let running = 0;
  const waiting = [];

  function kept(url) {
    const file = fileOf(url);
    for (const [ext, keep] of [['.img', KEEP_MS], ['.none', MISS_MS]]) {
      let st;
      try { st = fs.statSync(file + ext); } catch { continue; }
      if (now() - st.mtimeMs > keep) continue;
      if (ext === '.none') return { image: null };
      const body = fs.readFileSync(file + ext);
      const type = imageType(body);
      if (type) return { image: { type, body } };
    }
    return null;
  }
  function keep(url, image) {
    const file = fileOf(url);
    fs.mkdirSync(dir, { recursive: true });
    for (const ext of ['.img', '.none']) try { fs.rmSync(file + ext, { force: true }); } catch {}
    fs.writeFileSync(file + (image ? '.img' : '.none'), image ? image.body : '');
  }

  // { image } with the photo or null; `again: true` when the store could not be asked or failed (no answer, a 5xx, a
  // 429): that is not kept, so the next card asks again.
  async function fetchImage(url) {
    const r = await get(url, { max: IMAGE_MAX, lookup, timeoutMs, local });
    if (!r || r.status === 429 || r.status >= 500) return { image: null, again: true };
    if (r.status !== 200 || !r.whole) return { image: null };
    const type = imageType(r.body);
    return { image: type ? { type, body: r.body } : null };
  }

  // At most AT_ONCE fetches: a fetch that ends hands its place to the next that waits.
  async function turn(work) {
    if (running >= AT_ONCE) await new Promise((resolve) => waiting.push(resolve));
    else running++;
    try { return await work(); } finally { const next = waiting.shift(); if (next) next(); else running--; }
  }

  // What is past its time goes, at most once an hour, so the folder holds only what is kept.
  let pruned = 0;
  function prune() {
    if (now() - pruned < 3600 * 1000) return;
    pruned = now();
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const keepMs = n.endsWith('.img') ? KEEP_MS : n.endsWith('.none') ? MISS_MS : null;
      if (keepMs == null) continue;
      try { if (now() - fs.statSync(path.join(dir, n)).mtimeMs > keepMs) fs.rmSync(path.join(dir, n), { force: true }); } catch { /* gone already */ }
    }
  }

  /** A product's photo: { image: { type, body } | null, again? }. `url` is imageUrl's. */
  async function image(url) {
    const have = kept(url);
    if (have) return { image: have.image };
    if (!going.has(url)) {
      going.set(url, turn(() => fetchImage(url)).catch(() => ({ image: null, again: true })).then((found) => {
        if (!found.again) {
          try { keep(url, found.image); prune(); } catch (e) { console.error(`[product-image] couldn't keep a photo: ${e.message}`); }
        }
        return found;
      }).finally(() => going.delete(url)));
    }
    return going.get(url);
  }

  return { image };
}

module.exports = { create, imageUrl, imageType, IMAGE_MAX, KEEP_MS, MISS_MS, AGAIN_MS: 300 * 1000 };

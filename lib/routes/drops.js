// Upload from phone (ADR 165; docs/api.md, "Upload from phone"). The owner's page asks for a code for the place it is
// in (POST /api/drops), shows its QR code, and looks at what arrived (GET /api/drops/<token>) until it is done
// (DELETE). The phone that scans it reaches the page and sends its files through the front door without a session,
// at /drop/<account>/<token>, which the front door passes on as /api/drop/<token>[/files] marked X-Botdot-Drop
// (lib/front-door/drops.js): those requests reach phone() below and nothing else of botdot. Each file is taken by
// the upload route the owner's page uses for that place, as the owner: the code is the owner's OK for that one place.
const { NEXT, send, readBody, drained } = require('./http');
const qrcode = require('../../vendor/qrcode-generator/qrcode');
const dropsLib = require('../drops');
const { page } = require('../drop-page');
const uploads = require('../uploads');
const B = require('../bots');

// The address a phone opens, and whether a phone can reach it at all: the front door's own address as it last named
// it (lib/calls.js addresses), unless that is this machine alone (the loopback, a .localhost name).
function addressOf(origin, account, token) {
  if (!origin || !account) return { url: null, reachable: false };
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host);
  return { url: `${origin}/drop/${account}/${token}`, reachable: !local };
}

// The QR code of an address, as an SVG botdot drew (nothing of it comes from a bot or the phone).
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// An answer caught instead of sent: what an upload route said to the owner's page, kept for the phone and the owner.
// { res, done }: res stands in for the route's response, done resolves to { status, data } once it answered.
function caught(req) {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  let status = 200;
  const res = {
    req: { headers: {}, lang: req.lang }, headersSent: false, statusCode: 200,
    setHeader() {}, getHeader() {},
    writeHead(s) { status = s; this.statusCode = s; this.headersSent = true; return this; },
    end(body) { let data = {}; try { data = JSON.parse(String(body || '{}')); } catch { /* not JSON */ } resolve({ status, data }); },
    destroy() { resolve({ status: 500, data: { error: 'Something went wrong' } }); },
    on() { return this; }, once() { return this; },
  };
  return { res, done };
}

// The name the phone shows for a place: the chat's (a bot, the Chief, a group), or the folder's, else its bot's or
// project's. Unknown parts give ''.
function placeName(to) {
  const u = new URL(to, 'http://x');
  const t = u.searchParams.get('to') || '';
  if (u.pathname === '/api/uploads') {
    if (t === 'chief') return B.settings.chiefName();
    if (t.startsWith('bot:')) return B.bots.get(t.slice(4))?.name || '';
    if (t.startsWith('group:')) return B.groups.get(t.slice(6))?.name || '';
    return '';
  }
  const folder = (u.searchParams.get('path') || '').split('/').filter(Boolean).pop();
  if (folder) return folder;
  const [, kind, id] = u.pathname.split('/').slice(1);
  if (kind === 'bots') return B.bots.get(id)?.name || '';
  if (kind === 'chief') return B.settings.chiefName();
  if (kind === 'projects') { try { return decodeURIComponent(id); } catch { return ''; } }
  return u.searchParams.get('project') || '';
}

function create(ctx) {
  const { callAddresses, ACCOUNT, audit } = ctx;
  const drops = dropsLib.create();

  // The owner's routes.
  async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] !== 'drops') return NEXT;
    if (by !== 'you') return send(res, 403, { error: 'Only the owner uploads from a phone.' });
    if (!parts[1] && m === 'POST') {
      const body = await readBody(req);
      let d;
      try { d = drops.make({ to: body?.to, name: dropsLib.TARGET.test(String(body?.to)) ? placeName(body.to) : '' }); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
      const where = addressOf(callAddresses.origin(), ACCOUNT, d.token);
      return send(res, 201, { token: d.token, ...where, qr: where.url ? qrSvg(where.url) : null, ...drops.view(d) });
    }
    const d = parts[1] && !parts[2] ? drops.get(parts[1]) : null;
    if (!d) return send(res, 404, { error: 'That code has expired.' });
    if (m === 'GET') return send(res, 200, drops.view(d));
    if (m === 'DELETE') { drops.end(d.token); return send(res, 200, { ok: true }); }
    return send(res, 405, { error: 'Not here' });
  }

  // The phone's requests, marked by the front door: GET /api/drop/<token> (the page), POST /api/drop/<token>/files
  // (a file, its name in X-File-Name). A code that was never made answers 404, which the front door counts against
  // the sender; one that expired or was ended answers its page, or 410 for a file.
  async function phone(req, res, url) {
    const m = /^\/api\/drop\/([^/]+)(\/files)?\/?$/.exec(url.pathname);
    const d = m ? drops.get(m[1]) : null;
    const open = drops.open(d);
    if (m && !m[2] && (req.method === 'GET' || req.method === 'HEAD')) {
      const { html, csp } = page(req.lang, open ? d : null);
      res.writeHead(d ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    // The body is read and dropped first (up to a little over the largest file): answered while the phone still sends
    // it, the answer could be lost to a closed connection.
    const refuse = async (status, error) => { await drained(req, uploads.MAX_BYTES + 1024 * 1024); return send(res, status, { error }); };
    if (!m || !m[2]) return refuse(404, 'Not found');
    if (req.method !== 'POST') return refuse(405, 'Not here');
    if (req.headers['x-bot-dot'] !== '1') return refuse(403, 'Missing X-Bot-Dot header');
    if (!d) return refuse(404, 'This code has expired');
    if (!open) return refuse(410, 'This code has expired');
    if (drops.full(d)) return refuse(409, `Send at most ${dropsLib.MAX_FILES} files with one code.`);
    let name = 'file';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch { /* keep the default */ }
    const size = Number(req.headers['content-length']) || 0;
    if (size > uploads.MAX_BYTES) return refuse(413, `${name} is over 25 MB.`);
    const f = drops.arriving(d, name, size);
    const { res: shim, done } = caught(req);
    try {
      await ctx.api(req, shim, new URL(d.to, 'http://x'));
    } catch (e) {
      if (!shim.headersSent) send(shim, e.status || 400, { error: e.message });
    }
    const { status, data } = await done;
    if (status >= 200 && status < 300) {
      Object.assign(f, { status: 'saved', saved: data, size: Number(data?.size) || f.size });
      try { audit('phone-upload', 'you', { to: d.to.split('?')[0], name: f.name.slice(0, 200), size: f.size }); } catch (e) { console.error(`[audit] ${e.message}`); }
      return send(res, 201, { name: f.name, size: f.size });
    }
    Object.assign(f, { status: 'failed', error: String(data?.error || 'Upload failed') });
    await drained(req, 1024 * 1024);
    return send(res, status >= 400 ? status : 500, { error: f.error });
  }

  return { routes, phone, drops };
}

module.exports = { create, addressOf, qrSvg, placeName };

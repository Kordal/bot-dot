// The page a phone opens from the QR code of Upload from phone (ADR 165): the place's name, Choose files, each file
// with its progress, then Send more; or that the code has expired. One page with its own style and script (a nonce
// lets only that script run), on the front door's address with no session: it loads nothing of botdot's, and its
// one request is the files, to its own address.
const crypto = require('node:crypto');
const { said } = require('./i18n');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
@font-face { font-family: Geist; src: url(/front-door/fonts/Geist.ttf); font-display: swap; }
:root { color-scheme: dark; --bg: #000; --text: #fff; --muted: #a3a3a3; --raise: #171717; --line: #1f1f1f; --ok: #45c78e; --err: #ef6a6a; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font: 16px/1.4 Geist, system-ui, sans-serif; -webkit-text-size-adjust: 100%; }
main { min-height: 100dvh; display: flex; flex-direction: column; gap: 24px; padding: 48px 20px max(24px, env(safe-area-inset-bottom)); max-width: 520px; margin: 0 auto; }
h1 { margin: 0; font-size: 22px; font-weight: 600; text-align: center; overflow-wrap: anywhere; }
.gone { flex: 1; display: grid; place-items: center; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
li { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; background: var(--raise); font-size: 15px; }
li .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
li .s { color: var(--muted); font-size: 13px; white-space: nowrap; }
li .ok { color: var(--ok); }
li .err { color: var(--err); font-size: 13px; white-space: nowrap; }
li .bar { flex: none; width: 72px; height: 4px; border-radius: 4px; background: var(--line); overflow: hidden; }
li .bar i { display: block; height: 100%; width: 0; background: var(--ok); transition: width .2s; }
.grow { flex: 1; }
button { width: 100%; height: 56px; border: 0; border-radius: 14px; font: inherit; font-size: 17px; background: #fff; color: #000; cursor: pointer; }
button:disabled { background: #232323; color: var(--muted); }
input { display: none; }
`;

// The page's script: files picked are sent one by one, each with its progress; a refusal says why on its row.
const SCRIPT = (t) => `
const T = ${JSON.stringify(t).replace(/</g, '\\u003c')};
const pick = document.getElementById('pick'), input = document.getElementById('files'), list = document.getElementById('list');
const size = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const row = (name) => { const li = document.createElement('li'); const n = document.createElement('span'); n.className = 'n'; n.textContent = name; li.append(n); list.append(li); return li; };
const end = (li, cls, text) => { li.querySelector('.bar')?.remove(); const s = document.createElement('span'); s.className = cls; s.textContent = text; li.append(s); };
function send(file) {
  return new Promise((resolve) => {
    const li = row(file.name);
    const bar = document.createElement('span'); bar.className = 'bar'; bar.append(document.createElement('i')); li.append(bar);
    const x = new XMLHttpRequest();
    x.open('POST', location.pathname.replace(/\\/$/, '') + '/files');
    x.setRequestHeader('X-Bot-Dot', '1');
    x.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) bar.firstChild.style.width = Math.round(e.loaded / e.total * 100) + '%'; };
    x.onload = () => {
      let d = {}; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) { end(li, 's', size(file.size)); end(li, 'ok', '\\u2713'); resolve(true); }
      else { end(li, 'err', d.error || T.failed); resolve(x.status !== 410); }
    };
    x.onerror = () => { end(li, 'err', T.failed); resolve(true); };
    x.send(file);
  });
}
pick.onclick = () => input.click();
input.onchange = async () => {
  const files = [...input.files]; input.value = '';
  if (!files.length) return;
  pick.disabled = true; pick.textContent = T.sending;
  let open = true;
  for (const f of files) { if (!(open = await send(f))) break; }
  pick.disabled = !open; pick.textContent = open ? T.more : T.expired;
};
`;

// The page for a code: open, or gone (expired, ended, or never made: said the same).
function page(lang, drop) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const t = { failed: said(lang, 'Failed'), sending: said(lang, 'Sending…'), more: said(lang, 'Send more'), expired: said(lang, 'This code has expired') };
  const body = drop
    ? `<h1>${esc(drop.name || 'botdot')}</h1><ul id="list"></ul><div class="grow"></div><button id="pick" type="button">${esc(said(lang, 'Choose files'))}</button><input id="files" type="file" multiple><script nonce="${nonce}">${SCRIPT(t)}</script>`
    : `<div class="gone"><h1>${esc(t.expired)}</h1></div>`;
  const html = `<!doctype html><html lang="${esc(lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>botdot</title><style nonce="${nonce}">${STYLE}</style></head><body><main>${body}</main></body></html>`;
  const csp = [`default-src 'none'`, `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "font-src 'self'", "connect-src 'self'", "img-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'none'"].join('; ');
  return { html, csp };
}

module.exports = { page };

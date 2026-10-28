// A long reply or a Markdown file opened as a document (#348): in a tab of its own, at its own address
// (#doc/run/<runId>, #doc/chief/<chatId>/<place>, #doc/file/<src>), at reading width with its sections beside it and
// an Export menu (Word, PDF and Markdown made by the server, POST /api/export; Copy text and Print). Only from a server
// with `document-export`. The page draws the document with the chat's own md(); nothing in it is markup.
// A plain <script>, as window.DocPage; the tests load it the same way. Its drawing uses app.js (api, md, esc, toast).

(function (root) {

const LONG_WORDS = 300; // a reply this long is a document
const SECTIONED_WORDS = 120; // so is a shorter one with a heading or a table
const words = (text) => String(text || '').split(/\s+/).filter(Boolean).length;

// Whether a reply is a document: the rule both apps share (docs/api.md, "A document"). blocks: mdBlocks.
function isLong(text, blocks) {
  const n = words(text);
  if (n >= LONG_WORDS) return true;
  return n >= SECTIONED_WORDS && blocks(text).some((b) => b.type === 'heading' || b.type === 'table');
}

// The address of a document. src: { run } | { chat, at } | { file }.
function address(src) {
  if (src.run) return `#doc/run/${encodeURIComponent(src.run)}`;
  if (src.chat != null) return `#doc/chief/${encodeURIComponent(src.chat)}/${Number(src.at)}`;
  return `#doc/file/${encodeURIComponent(src.file)}`;
}
// An address back to what it names: { run } | { chat, at } | { file }, or null for an address that is no document.
function parse(hash) {
  const m = String(hash || '').match(/^#doc\/(run|chief|file)\/(.+)$/);
  if (!m) return null;
  const [kind, rest] = [m[1], m[2]];
  try {
    if (kind === 'run') return /^[^/]+$/.test(rest) ? { run: decodeURIComponent(rest) } : null;
    if (kind === 'chief') { const c = rest.match(/^([^/]+)\/(\d+)$/); return c ? { chat: decodeURIComponent(c[1]), at: Number(c[2]) } : null; }
    const file = decodeURIComponent(rest);
    return file.startsWith('/') && !file.includes('..') ? { file } : null;
  } catch { return null; }
}

// The button under a long reply, or '' when it isn't one or the server can't export.
function button(src, text, { features, blocks }) {
  if (!features.includes('document-export') || !isLong(text, blocks)) return '';
  return `<div class="doc-open-row"><a class="btn sm doc-open" href="/${address(src)}" target="_blank" rel="noopener">${ICON_OPEN}${tr('Open as document')}</a></div>`;
}

// The sections of a drawn document: each heading gets an id, and the list beside it links to them. A heading that
// starts the document is its title, drawn large and no section.
function outline(article) {
  const first = article.firstElementChild;
  if (first && /^H[1-4]$/.test(first.tagName)) first.classList.add('doc-title');
  return [...article.querySelectorAll('h1, h2, h3, h4')].filter((h) => h !== first || !h.classList.contains('doc-title')).map((h, i) => {
    h.id = `sec-${i + 1}`;
    return { id: h.id, text: h.textContent.trim(), level: Number(h.tagName[1]) };
  });
}

const ICON_OPEN = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="M12 4v11 M7 10l5 5 5-5 M5 20h14"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z M14 3v5h5"/></svg>';
const FORMATS = [['docx', tr('Word document'), '.docx'], ['pdf', 'PDF', '.pdf'], ['md', 'Markdown', '.md']];

// What a document address shows: { title, who, at, text, back, botId }.
async function load(src, g) {
  if (src.run) {
    const r = await g.api(`/runs/${encodeURIComponent(src.run)}`);
    const bot = g.botName?.(r.botId) || r.botName || tr('A bot');
    return { text: r.result || '', who: bot, at: r.endedAt || r.startedAt, back: r.groupId ? `#group/${r.groupId}` : `#bot/${r.botId}`, botId: r.botId };
  }
  if (src.chat != null) {
    const c = await g.api(`/chief/chats/${encodeURIComponent(src.chat)}?offset=${src.at}&limit=1`);
    const m = c.messages?.[0];
    if (!m) throw new Error(tr('This message is gone.'));
    return { text: m.text || '', who: m.role === 'report' && m.from ? (m.from.name || tr('A bot')) : g.chiefName?.() || tr('Chief of Staff'), at: m.endedAt || m.at, back: `#chief/${src.chat}` };
  }
  const v = await g.api(`${src.file}${src.file.includes('?') ? '&' : '?'}view=1`);
  if (v.kind !== 'markdown' && v.kind !== 'text') throw new Error(tr('Only a text document opens here.'));
  // A page with blocks (#395): written out as text and tables, with the values they show now.
  return { text: v.plain || v.text || '', who: v.name, at: v.at, back: ownerOf(src.file), name: v.name, truncated: v.truncated };
}

// Where a file's document goes back to: the chat of the bot whose file or page it is (the Chief's own: #chief), or ''
// for a file no bot owns.
function ownerOf(file) {
  const m = String(file).match(/^\/bots\/([^/?#]+)\//);
  if (!m) return '';
  let id;
  try { id = decodeURIComponent(m[1]); } catch { return ''; }
  return id === 'chief' ? '#chief' : `#bot/${encodeURIComponent(id)}`;
}

// Whether a new address leaves this document: anything but one of its own sections (has: whether the page holds that
// id). The page is drawn instead of the app, at load only, so a chat's address (Back to chat, the browser's back, a
// typed one) or another document's loads the page again; a bare hash change used to leave the document standing.
function leaves(hash, has) {
  const h = String(hash || '');
  return !(h.length > 1 && !h.startsWith('#doc/') && has(h.slice(1)));
}

// The title: the first heading, else the file's name, else the start of the first line.
function titleOf(doc, blocks) {
  const h = blocks(doc.text).find((b) => b.type === 'heading');
  const plain = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e])).replace(/[*_`~]/g, '').trim();
  if (h) return plain(h.text);
  if (doc.name) return doc.name.replace(/\.[^.]+$/, '');
  const first = plain(String(doc.text).split('\n').find((l) => l.trim()) || tr('Document')).replace(/^#+\s*/, '');
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

// Draws the document page in place of the app. g: { api, md, esc, toast, msgTime, mdBlocks, botName, chiefName }.
async function show(hash, g) {
  const src = parse(hash);
  document.body.classList.add('doc-mode');
  const page = document.createElement('main');
  page.id = 'doc-page';
  page.className = 'doc-page';
  document.body.append(page);
  addEventListener('hashchange', () => { if (leaves(location.hash, (id) => !!page.querySelector(`[id="${CSS.escape(id)}"]`))) location.reload(); });
  if (!src) { page.innerHTML = stateHTML(g, tr('No such document'), tr('This address names no reply or file.')); return; }
  let doc;
  try { doc = await load(src, g); } catch (e) { page.innerHTML = stateHTML(g, tr("Couldn't open it"), e.message || tr('Try again.')); return; }
  if (!doc.text.trim()) { page.innerHTML = stateHTML(g, tr('Nothing to show'), tr('This reply has no text.')); return; }
  const title = titleOf(doc, g.mdBlocks);
  document.title = `${title} · botdot`;
  const n = words(doc.text);
  const meta = [trn(n, '{n} word', '{n} words', { n: n.toLocaleString(I18n.locale) }), doc.at ? g.msgTime(doc.at) : ''].filter(Boolean).join(' · ');
  page.innerHTML = `
    <header class="doc-top">
      <div class="doc-crumb"><span>${g.esc(doc.who)}</span><span aria-hidden="true">›</span><b>${g.esc(title)}</b></div>
      <span class="doc-sp"></span>
      <span class="doc-meta">${g.esc(meta)}</span>
      ${doc.back ? `<a class="btn sm" href="/${g.esc(doc.back)}">${tr('Back to chat')}</a>` : ''}
      <div class="doc-export">
        <button type="button" class="btn sm primary" data-doc="menu" aria-haspopup="menu" aria-expanded="false">${ICON_DOWN}${tr('Export')}</button>
        <div class="doc-menu" role="menu" hidden>
          <div class="doc-menu-label">${tr('Download')}</div>
          ${FORMATS.map(([f, label, ext]) => `<button type="button" role="menuitem" data-doc="export" data-format="${f}">${ICON_FILE}${label}<small>${ext}</small></button>`).join('')}
          ${g.features?.includes('document-google-docs') ? `<div class="doc-menu-sep"></div>
          <div class="doc-menu-label">${tr('Save to')}</div>
          <button type="button" role="menuitem" data-doc="gdocs"><span class="doc-gd">G</span>Google Docs<small data-gd-state></small></button>` : ''}
          <div class="doc-menu-sep"></div>
          <button type="button" role="menuitem" data-doc="copy">${tr('Copy text')}</button>
          <button type="button" role="menuitem" data-doc="print">${tr('Print')}</button>
        </div>
      </div>
    </header>
    <div class="doc-wrap">
      <nav class="doc-toc" aria-label="${tr('On this page')}"></nav>
      <article class="md doc-md">${g.md(doc.text, doc.botId)}</article>
    </div>
    <div class="doc-saved" role="status" hidden></div>
    ${doc.truncated ? `<p class="doc-cut">${tr('Too large to show whole: this is its start. Download the file for all of it.')}</p>` : ''}`;
  const sections = outline(page.querySelector('.doc-md'));
  const toc = page.querySelector('.doc-toc');
  toc.innerHTML = sections.length > 1
    ? `<div class="doc-toc-label">${tr('On this page')}</div>${sections.map((s) => `<a href="#${s.id}" data-sec="${s.id}" style="padding-left:${(s.level - 1) * 10}px">${g.esc(s.text)}</a>`).join('')}`
    : '';
  // A section link scrolls to it and keeps the document's address.
  toc.onclick = (e) => {
    const a = e.target.closest('[data-sec]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  wire(page, { title, text: doc.text }, g);
}

function wire(page, doc, g) {
  const menuBtn = page.querySelector('[data-doc="menu"]');
  const menu = page.querySelector('.doc-menu');
  const gdState = page.querySelector('[data-gd-state]');
  const gd = {}; // Google Docs as last asked: { configured, connected }, and busy while connecting or saving
  const open = (on) => {
    menu.hidden = !on;
    menuBtn.setAttribute('aria-expanded', String(on));
    // Asked each time the menu opens, unless it is busy: "connected", "Connect…" or "Not set up".
    if (on && gdState && !gd.busy) g.api('/export/google-docs').then((r) => { Object.assign(gd, r); if (!gd.busy) gdState.textContent = gdLabel(gd); }).catch(() => {});
  };
  const saved = page.querySelector('.doc-saved');
  const ui = {
    open: () => window.open('about:blank', '_blank'),
    row: (text) => { if (gdState) gdState.textContent = text; },
    // A line at the bottom: progress, the result or what went wrong, with a link that opens a tab of its own, or a
    // Reconnect button, which connects Google Docs again and then saves.
    status: (text, { link, error, reconnect } = {}) => {
      saved.innerHTML = `${g.esc(text)}${link ? ` <a href="${g.esc(link.href)}" target="_blank" rel="noopener">${g.esc(link.text)}</a>` : ''}${reconnect ? ` <button type="button" data-doc="gdocs-reconnect">${tr('Reconnect')}</button>` : ''}`;
      saved.classList.toggle('err', !!error);
      saved.hidden = false;
    },
    wait: (ms) => new Promise((res) => setTimeout(res, ms)),
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.doc-export')) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  page.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-doc]');
    if (!b) return;
    const what = b.dataset.doc;
    if (what === 'menu') return open(menu.hidden);
    open(false);
    if (what === 'print') return window.print();
    if (what === 'copy') {
      try { await navigator.clipboard.writeText(doc.text); g.toast(tr('Copied')); } catch { g.toast(tr("Couldn't copy"), true); }
      return;
    }
    if (what === 'gdocs' || what === 'gdocs-reconnect') {
      if (gd.busy) return;
      gd.busy = true;
      if (what === 'gdocs-reconnect') gd.connected = false; // its connection is there but lacks access: a new one
      try { await googleDocs(doc, gd, g, ui); } finally { gd.busy = false; }
      return;
    }
    if (what === 'export') {
      g.toast(tr('Making the file…'));
      try { save(await exportFile(doc, b.dataset.format)); } catch (err) { g.toast(err.message || tr("Couldn't make the file"), true); }
    }
  });
}

// What the Google Docs row says: st from GET /export/google-docs, { configured, connected }.
function gdLabel(st) {
  if (st.configured === false) return tr('Not set up');
  return st.connected === true ? tr('connected') : st.connected === false ? tr('Connect…') : '';
}

const GD_POLL = 3000;
const GD_WAIT = 10 * 60_000;

// "Save to Google Docs" tapped (#351, #378): saves at once while Google Docs is connected; else connects it first, in a sign-in
// tab of its own (the Connectors page's own path, POST /connectors/connect), and saves once the connection is active.
// Without connected apps on this server it says so. st: { configured, connected }, kept up to date. ui: { open, row,
// status, wait }. Called straight from the tap: ui.open() runs before anything awaits, so pop-up blockers allow it.
async function googleDocs(doc, st, g, ui) {
  if (st.configured === false) {
    return ui.status(tr("Google Docs can't be reached: connected apps aren't set up on this server. Add a Composio key on the Connectors page, then try again."),
      { link: { href: '/#connectors', text: tr('Open Connectors ↗') }, error: true });
  }
  if (st.connected === false) {
    const win = ui.open();
    if (!win) return ui.status(tr('Your browser blocked the Google sign-in tab. Allow pop-ups for this page, then tap Google Docs again.'), { error: true });
    ui.row(tr('Connecting…'));
    ui.status(tr('Opening the Google sign-in…'));
    let r;
    try { r = await g.api('/connectors/connect', { method: 'POST', body: { app: 'googledocs' } }); } catch (e) {
      win.close();
      ui.row(gdLabel(st));
      return ui.status(tr("Couldn't start connecting Google Docs: {why}", { why: e.message || tr('try again') }), { error: true });
    }
    if (r.noAuth) win.close();
    else {
      win.location = r.redirectUrl;
      ui.status(tr("Sign in to Google in the tab that opened. botdot saves the document when you're done."));
      let c = null;
      for (const until = Date.now() + GD_WAIT; Date.now() < until;) {
        await ui.wait(GD_POLL);
        c = await g.api(`/connectors/connections/${encodeURIComponent(r.connectionId)}`).catch(() => null);
        if (c && ['ACTIVE', 'FAILED', 'EXPIRED'].includes(c.status)) break;
      }
      if (c?.status !== 'ACTIVE') {
        ui.row(gdLabel(st));
        return ui.status(c && ['FAILED', 'EXPIRED'].includes(c.status) ? (c.statusReason ? tr("Connecting Google Docs didn't work: {why}", { why: c.statusReason }) : tr("Connecting Google Docs didn't work")) : tr('The Google sign-in took too long. Tap Google Docs to try again.'), { error: true });
      }
    }
    st.connected = true;
  }
  ui.row(tr('Saving…'));
  ui.status(tr('Saving to Google Docs…'));
  try {
    const r = await g.api('/export/google-docs', { method: 'POST', body: { title: doc.title, text: doc.text } });
    st.connected = true;
    ui.row(gdLabel(st));
    ui.status(tr('Saved to Google Docs'), { link: { href: r.url, text: tr('Open ↗') } });
  } catch (err) {
    if (err.state === 'not-connected') {
      st.connected = false;
      ui.row(gdLabel(st));
      return ui.status(tr("Google Docs isn't connected. Tap Google Docs again to connect it."), { error: true });
    }
    // Google Docs wasn't given this access, or is signed out: Reconnect connects it again and saves (state "reconnect").
    if (err.state === 'reconnect') st.connected = false;
    ui.row(gdLabel(st));
    ui.status(err.message || tr("Couldn't save it to Google Docs"), { error: true, reconnect: err.state === 'reconnect' });
  }
}

// The file from the server: { name, blob }.
async function exportFile(doc, format) {
  const res = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify({ title: doc.title, text: doc.text, format }) });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error; } catch { /* no words */ }
    throw new Error(msg || tr("Couldn't make the file ({status})", { status: res.status }));
  }
  const name = decodeURIComponent((res.headers.get('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || `document.${format}`);
  return { name, blob: await res.blob() };
}
function save({ name, blob }) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

const stateHTML = (g, title, text) => `<div class="doc-state"><h3>${g.esc(title)}</h3><p class="muted">${g.esc(text)}</p><a class="btn sm" href="/">${tr('Open botdot')}</a></div>`;

// "Open as document" under a long reply, as the chats call it: src { run } or { chat, at }. It reads the page's
// state and mdBlocks (app.js) when called.
root.docButton = (src, text) => button(src, text, { features: state.features, blocks: mdBlocks });

root.DocPage = { LONG_WORDS, SECTIONED_WORDS, words, isLong, address, parse, button, outline, titleOf, load, ownerOf, leaves, show, exportFile, gdLabel, googleDocs };

})(typeof window !== 'undefined' ? window : globalThis);

// The document viewer (#251; docs/api.md, "The document viewer"): a file a bot attached, one of a bot's files, the
// owner's own file sent to a bot, or a file a path in a bot's reply names, opened on this page instead of downloaded.
// Beside the chat in a wide window, over it in a narrow one. botdot sends the file's start as JSON (?view=1) and this
// page draws it: Markdown with the chat's own md(), whose input is escaped first, so HTML in a file stays text;
// text and code with line numbers; a CSV as a table. Every link that opens it carries data-view (its API path), and
// downloads as before where the server has no `document-viewer` in its features. A bot's page (#346, public/pages.js)
// opens here too, with who made it and when it was updated in its header, and its "Keep up to date" in its bar. A
// page with blocks (#395, from a server with `page-blocks`) comes with its `parts`: its Markdown and its blocks, which
// the block kit draws (blocks.js); those bound to the Board's tiles are drawn again when a tile they read changes.

const DocViewer = (() => {
  let cur = null; // { src, name, from, bot, page, view, error, mode, sort, find, full }

  const withQuery = (src, q) => `${src}${src.includes('?') ? '&' : '?'}${q}`;
  const KB = (n) => (typeof fmtSize === 'function' ? fmtSize(n) : `${n} B`);

  // A CSV's rows, each a list of cells: quoted cells may hold the separator, "" and line breaks. tsv: tabs.
  function csvRows(text, sep = ',') {
    const rows = []; let row = []; let cell = ''; let quoted = false;
    const s = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"' && cell === '') quoted = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  const isNum = (v) => v.trim() !== '' && !Number.isNaN(Number(v.replace(/,/g, '')));
  // The table as shown: its header, then the rows that hold the words found, sorted by a column when asked.
  // text: the CSV, or its rows already read (csvRows), so a keystroke in Find does not read it again.
  function tableOf(text, sep, { sort = null, find = '' } = {}) {
    const [head = [], ...rows] = Array.isArray(text) ? text : csvRows(text, sep);
    const cols = Math.max(head.length, ...rows.map((r) => r.length), 0);
    let shown = rows.map((cells, i) => ({ n: i + 1, cells }));
    const q = find.trim().toLowerCase();
    if (q) shown = shown.filter((r) => r.cells.some((c) => c.toLowerCase().includes(q)));
    if (sort) {
      const { col, dir } = sort;
      const nums = shown.every((r) => !r.cells[col] || isNum(r.cells[col]));
      shown = [...shown].sort((a, b) => {
        const x = a.cells[col] ?? '', y = b.cells[col] ?? '';
        return dir * (nums ? Number(x.replace(/,/g, '')) - Number(y.replace(/,/g, '')) : x.localeCompare(y));
      });
    }
    return { head, rows: shown, total: rows.length, cols };
  }

  const ICON = {
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6 M20 4l-7 7 M10 20H4v-6 M4 20l7-7"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11 M7 10l5 5 5-5 M5 20h14"/></svg>',
  };
  const downloadHTML = (c, primary = false) => (c.view?.downloadable === false ? '' : `<a class="btn sm${primary ? ' primary' : ''}" href="/api${esc(c.src)}" ${/\.pdf$/i.test(c.name) ? 'target="_blank" rel="noopener"' : `download="${esc(c.view?.interactive ? c.view.name : c.name)}"`}>${ICON.down}Download</a>`);
  const stateHTML = (title, text, acts) => `<div class="dv-state"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="dv-acts">${acts}</div></div>`;

  function headHTML(c) {
    const v = c.view;
    const sub = c.page ? Pages.subtitle(c.from, v?.page) : [c.from ? `From ${c.from}` : '', v ? KB(v.size) : '', v?.at ? msgTime(v.at) : ''].filter(Boolean).join(' · ');
    return `<div class="dv-head">
      <button type="button" class="icon-btn dv-back" data-dv="close" aria-label="Back to the chat">${ICON.back}</button>
      <div class="dv-title"><b>${esc(c.name)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
      <button type="button" class="icon-btn dv-full" data-dv="full" aria-label="${c.full ? 'Back beside the chat' : 'Open in full window'}" title="${c.full ? 'Back beside the chat' : 'Open in full window'}">${ICON.full}</button>
      <button type="button" class="icon-btn dv-close" data-dv="close" aria-label="Close" title="Close">${ICON.close}</button>
    </div>`;
  }
  const seg = (c, modes) => `<div class="dv-seg" role="group" aria-label="View">${modes.map(([m, label]) => `<button type="button" data-dv="mode" data-mode="${m}" class="${c.mode === m ? 'on' : ''}" aria-pressed="${c.mode === m}">${label}</button>`).join('')}</div>`;
  function barHTML(c) {
    const v = c.view;
    const text = ['markdown', 'text', 'csv'].includes(v.kind);
    const table = v.kind === 'csv' && c.mode === 'table' ? tableOf(rowsOf(c), null, c) : null;
    return `<div class="dv-bar">
      ${c.page && v.page ? Pages.barHTML(v.page) : ''}
      ${v.kind === 'markdown' ? seg(c, [['rendered', 'Rendered'], ['source', 'Source']]) : v.kind === 'csv' ? seg(c, [['table', 'Table'], ['source', 'Source']]) : ''}
      ${table ? `<input class="dv-find" type="search" placeholder="Find in table" aria-label="Find in table" value="${esc(c.find)}"><span class="dv-count faint">${table.total} rows · ${table.cols} columns</span>` : ''}
      <span class="dv-sp"></span>
      ${text ? `<button type="button" class="btn sm" data-dv="copy">${ICON.copy}Copy</button>` : ''}
      ${v.kind === 'markdown' && globalThis.DocPage && state.features.includes('document-export') ? `<a class="btn sm" href="/${esc(DocPage.address({ file: c.src }))}" target="_blank" rel="noopener">Open as document</a>` : ''}
      ${downloadHTML(c)}
    </div>`;
  }
  const sepOf = (name) => (/\.tsv$/i.test(name) ? '\t' : ',');
  const rowsOf = (c) => (c.rows ||= csvRows(c.view.text, sepOf(c.name)));
  const linesHTML = (text) => `<ol class="dv-lines">${String(text).replace(/\n$/, '').split('\n').map((l) => `<li>${esc(l) || ' '}</li>`).join('')}</ol>`;
  function tableHTML(c) {
    const t = tableOf(rowsOf(c), null, c);
    const arrow = (i) => (c.sort?.col === i ? (c.sort.dir > 0 ? ' ▲' : ' ▼') : '');
    return `<div class="dv-table"><table><thead><tr><th class="dv-n"></th>${Array.from({ length: t.cols }, (_, i) => `<th><button type="button" data-dv="sort" data-col="${i}">${esc(t.head[i] ?? '')}${arrow(i)}</button></th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr><td class="dv-n">${r.n}</td>${Array.from({ length: t.cols }, (_, i) => `<td${isNum(r.cells[i] ?? '') ? ' class="num"' : ''}>${esc(r.cells[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${t.rows.length ? '' : '<p class="faint">Nothing found.</p>'}</div>`;
  }
  function bodyHTML(c) {
    const v = c.view;
    if (v.kind === 'image') return `<div class="dv-image"><img src="/api${esc(c.src)}" alt="${esc(c.name)}"></div>`;
    if (v.kind === 'markdown' && c.mode === 'rendered') return v.parts && typeof pageHTML === 'function' ? `<article class="md dv-md dv-page">${pageHTML(v.parts, c.src)}</article>` : `<article class="md dv-md">${md(v.text)}</article>`;
    if (v.kind === 'csv' && c.mode === 'table') return tableHTML(c);
    return linesHTML(v.text);
  }

  // The whole viewer for where it stands: loading, a state (gone, the computer off, no preview) or the file.
  function html(c) {
    if (!c.view && !c.error) return `${headHTML(c)}<div class="dv-body dv-loading" aria-label="Loading">${[60, 92, 84, 70, 88].map((w) => `<div class="dv-sk" style="width:${w}%"></div>`).join('')}</div>`;
    if (c.error) {
      const e = c.error;
      const body = e.status === 404 ? stateHTML('This file is gone', 'Nothing is at this path any more. It may have been moved or deleted.', '<button type="button" class="btn sm" data-dv="close">Back to the chat</button>')
        : e.state === 'computer-off' ? stateHTML('The computer is off', "This file is on the account's computer, which is stopped. Start it to open the file.", `${c.bot ? '<button type="button" class="btn sm primary" data-dv="start">Start the computer</button>' : ''}<button type="button" class="btn sm" data-dv="close">Not now</button>`)
          : stateHTML("Couldn't open it", e.message || '', '<button type="button" class="btn sm" data-dv="close">Back to the chat</button>');
      return `${headHTML(c)}<div class="dv-body">${body}</div>`;
    }
    const v = c.view;
    if (v.downloadable === false) return `${headHTML(c)}<div class="dv-body">${stateHTML('Too large to bring out of the computer', 'Files on the computer open here up to 1 MB. Ask the bot to put it in its folder or to make it smaller.', '<button type="button" class="btn sm" data-dv="close">Back to the chat</button>')}</div>`;
    // A bot's interactive page (#399): its frame on the sandbox's own address.
    if (v.interactive && c.page) return `${headHTML(c)}${Pages.siteBarHTML(c, downloadHTML(c))}<div class="dv-body dv-site-body">${Pages.siteBodyHTML(c, downloadHTML(c, true))}</div>`;
    if (v.kind === 'none') return `${headHTML(c)}<div class="dv-body">${stateHTML('No preview for this kind of file', 'The app shows Markdown, text, code, CSV and pictures. Open this one on your device.', downloadHTML(c, true))}</div>`;
    const cut = v.truncated ? `<div class="dv-cut"><b>Too large to show whole.</b> Showing its start (up to 1 MB or 1,000 lines). ${v.downloadable === false ? '' : 'Download it to see everything.'}</div>` : '';
    return `${headHTML(c)}${barHTML(c)}${cut}<div class="dv-body">${bodyHTML(c)}</div>`;
  }

  const box = () => $('#doc-viewer');
  function draw() {
    const el = box();
    if (!el) return;
    el.classList.toggle('hidden', !cur);
    el.classList.toggle('full', !!cur?.full);
    $('#chat-row')?.classList.toggle('with-viewer', !!cur);
    $('#chat-row')?.classList.toggle('viewer-full', !!cur?.full);
    $('.main')?.classList.toggle('viewing', !!cur);
    el.innerHTML = cur ? html(cur) : '';
    if (cur?.view?.parts && typeof wireCharts === 'function') { wireCharts(el); wireTables(el); }
    const site = $('iframe.dv-site', el);
    if (site) { const c = cur; site.onload = () => handValues(c); }
  }

  // An interactive page in full screen or back (#399): everything but its frame is drawn again, so the page keeps
  // what the owner did in it; an address that ran out is signed anew, which loads it again.
  function around(c) {
    const el = box();
    const i = c.view.interactive;
    if (!el || !$('iframe.dv-site', el) || (i.expires && Date.parse(i.expires) < Date.now())) return load(c, true);
    const t = document.createElement('div');
    t.innerHTML = html(c);
    const fresh = [...t.children];
    const old = [...el.children];
    if (fresh.length !== old.length) return draw();
    el.classList.toggle('full', !!c.full);
    $('#chat-row')?.classList.toggle('viewer-full', !!c.full);
    old.forEach((n, j) => { if (!n.classList.contains('dv-site-body')) n.replaceWith(fresh[j]); });
  }

  // An interactive page's live values (#399): the values of the tiles it reads, handed to its frame when it has loaded
  // and again when one changes. Its origin is opaque, so the message names none ('*'); only that frame gets it.
  function handValues(c, values = c.view?.interactive?.values) {
    const f = $('iframe.dv-site', box());
    if (cur !== c || !f?.contentWindow || !values || !Object.keys(values).length) return;
    f.contentWindow.postMessage({ botdot: 'values', values }, '*');
  }
  async function revalue(c) {
    let r;
    try { r = await api(withQuery(c.src, 'values=1')); } catch { return; }
    if (cur !== c || !c.view?.interactive || !r?.values) return;
    c.view.interactive = { ...c.view.interactive, values: r.values, tiles: r.tiles || [] };
    handValues(c, r.values);
  }
  // The one thing a frame may ask (#399): a link out, which the owner sees first. Nothing else is taken.
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('message', (e) => {
    const f = $('iframe.dv-site', box());
    const d = e.data;
    if (!f || e.source !== f.contentWindow || !cur?.view?.interactive) return;
    if (d && typeof d === 'object' && d.botdot === 'open' && typeof d.url === 'string') Pages.askOpen(d.url.slice(0, 2000));
  });
  // Only the table, so the box keeps its words and the focus while they are typed.
  function drawTable() {
    const body = $('.dv-body', box());
    if (body && cur?.view) body.innerHTML = bodyHTML(cur);
  }

  // again: a page read anew after its bot saved it, or after its job changed, keeps the way it is shown and where
  // it is scrolled to.
  async function load(c, again = false) {
    c.rows = null;
    try { c.view = await api(withQuery(c.src, 'view=1')); c.error = null; } catch (e) { c.view = null; c.error = e; }
    if (c.view && !again) c.mode = c.view.kind === 'markdown' ? 'rendered' : c.view.kind === 'csv' ? 'table' : 'source';
    if (cur !== c) return;
    const top = again ? $('.dv-body', box())?.scrollTop : 0;
    draw();
    if (top) $('.dv-body', box()).scrollTop = top;
  }
  // Opens a file: src is its API path (no /api), as data-view says it.
  // page: { botId, slug } for a bot's page (#346); its src is then the page's own address.
  function open({ src, name, from = '', bot = '', page = null }) {
    cur = { src, name, from, bot, page, view: null, error: null, mode: 'source', sort: null, find: '', full: false };
    draw();
    return load(cur);
  }
  function close() { cur = null; draw(); }

  // A page's blocks filled in anew (#395): when a tile they read has a new value (the live feed's `dashboard`; no id:
  // the Board changed), and each minute while the page is open, which reads its tiles that are due. Only the blocks
  // are drawn again, so the page keeps where it is scrolled to.
  let soon = null;
  async function reblock(c) {
    let r;
    try { r = await api(withQuery(c.src, 'blocks=1')); } catch { return; }
    if (cur !== c || !c.view?.parts || !Array.isArray(r?.parts)) return;
    const same = r.parts.length === c.view.parts.length && r.parts.every((p, i) => (p.md != null) === (c.view.parts[i].md != null));
    c.view = { ...c.view, parts: r.parts, tiles: r.tiles || [], ...(r.plain ? { plain: r.plain } : {}) };
    if (c.mode !== 'rendered') return;
    if (!same) return draw();
    r.parts.forEach((p, i) => {
      const el = $(`.dv-page [data-pb="${i}"]`, box());
      if (!el || p.md != null) return;
      el.innerHTML = pageBlockHTML(p.block, `${c.src}#${i}`);
      wireCharts(el);
      wireTables(el);
    });
  }
  function tileChanged(id) {
    const c = cur;
    if (c?.view?.interactive) {
      if (!c.view.interactive.tiles?.length || (id && !c.view.interactive.tiles.includes(id))) return;
      clearTimeout(soon);
      soon = setTimeout(() => revalue(c), 400);
      return;
    }
    if (!c?.view?.parts || !c.view.tiles?.length || (id && !c.view.tiles.includes(id))) return;
    clearTimeout(soon);
    soon = setTimeout(() => reblock(c), 400);
  }
  if (typeof setInterval === 'function') setInterval(() => {
    if (document.hidden || !cur?.view) return;
    if (cur.view.interactive?.tiles?.length) revalue(cur); else if (cur.view.tiles?.length) reblock(cur);
  }, 60_000);
  // A bot saved a page, or its job changed (the live feed's `page`): the page on screen is read again.
  function pageChanged(botId, slug) {
    if (cur?.page && cur.page.botId === botId && (!slug || cur.page.slug === slug)) {
      if (cur.view?.interactive) cur.src = cur.src.replace(/\?version=\d+$/, ''); // a new version shows the page as it is now
      return load(cur, true);
    }
    return null;
  }

  async function act(btn) {
    const what = btn.dataset.dv;
    if (what === 'close') return close();
    if (what === 'full') { cur.full = !cur.full; return cur.view?.interactive ? around(cur) : draw(); }
    if (what === 'mode') { cur.mode = btn.dataset.mode; return draw(); }
    // A page with blocks copies what it shows, its blocks as text and tables; its Source, the Markdown.
    if (what === 'copy') { if (await copyText((cur.mode === 'rendered' && cur.view?.plain) || cur.view?.text || '')) toast('Copied'); return; }
    if (what === 'sort') {
      const col = Number(btn.dataset.col);
      cur.sort = cur.sort?.col === col ? (cur.sort.dir > 0 ? { col, dir: -1 } : null) : { col, dir: 1 };
      return drawTable();
    }
    // An interactive page's versions (#399): one shown, or the page set back to one.
    if (cur.page && cur.view?.interactive && ['versions', 'version', 'rollback'].includes(what)) {
      const c = cur;
      const show = (n) => { c.src = withQuery(c.src.replace(/\?version=\d+$/, ''), `version=${n}`); return load(c, true); };
      if (what === 'version') return show(Number(btn.dataset.version));
      if (what === 'rollback') { if (await Pages.rollBack(c.page.botId, c.view.page, Number(btn.dataset.version)) && cur === c) load(c, true); return; }
      const r = await Pages.openVersions(c.page.botId, c.view.page, c.view.interactive);
      if (r?.show && cur === c) return show(r.show);
      if (r?.current && cur === c) return show(r.current);
      return;
    }
    if (cur.page && what === 'board') return Pages.toggleBoard(cur.page.botId, cur.view?.page, btn); // on the Board, or off it (#451)
    if (cur.page && ['keep', 'refresh', 'stop'].includes(what)) {
      const c = cur;
      if (await Pages.act(what, c.page.botId, c.view?.page, c.from) && cur === c) load(c, true);
      return;
    }
    if (what === 'start') {
      const c = cur;
      btn.disabled = true;
      try { await api(`/bots/${encodeURIComponent(c.bot)}/computer`, { method: 'POST', body: { action: 'start' } }); } catch (e) { toast(e.message, true); }
      if (cur !== c) return; // closed, or another file opened, while it started
      c.error = null; draw();
      return load(c);
    }
  }

  // Who a file is from, for its header: the chip's own word, else the bot whose chat or path it is.
  const botName = (id) => (state.bots || []).find((b) => b.id === id)?.name || '';
  function fromOf(el) {
    return el.dataset.viewFrom || botName(el.dataset.viewBot || (state.view === 'bot' ? state.botId : ''));
  }

  function wire(doc) {
    // A click on a file opens it here, before the page's own handlers (a picture's big view, a download).
    doc.addEventListener('click', (e) => {
      const el = e.target.closest?.('[data-view]');
      if (!el || !state.features.includes('document-viewer') || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      // data-view-page: "<botId>/<slug>" of a bot's page (#346).
      const [pageBot, slug] = (el.dataset.viewPage || '').split('/');
      open({ src: el.dataset.view, name: el.dataset.viewName || el.dataset.view.split('/').pop(), from: fromOf(el), bot: el.dataset.viewBot || '', page: slug ? { botId: pageBot, slug } : null });
    }, true);
    doc.addEventListener('click', (e) => {
      const btn = e.target.closest?.('#doc-viewer [data-dv]');
      if (btn && cur) act(btn);
    });
    doc.addEventListener('input', (e) => {
      if (!e.target.matches?.('#doc-viewer .dv-find') || !cur) return;
      cur.find = e.target.value;
      drawTable();
    });
    // Esc closes the viewer only: the keypad's own Esc (list.js) skips a key already used.
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur && !$('#modal')?.open) { e.preventDefault(); close(); } });
    // A path's tip says its size once it is known: "Open report.md · 12 KB".
    doc.addEventListener('mouseover', (e) => {
      const a = e.target.closest?.('a.file-path');
      if (!a || a.dataset.tipped) return;
      a.dataset.tipped = '1';
      api(withQuery(a.dataset.view, 'stat=1')).then((v) => { a.title = `Open ${v.name} · ${KB(v.size)}`; }, () => {});
    });
  }

  return { open, close, html, csvRows, tableOf, wire, pageChanged, tileChanged, now: () => cur };
})();

if (typeof document !== 'undefined' && document.addEventListener) DocViewer.wire(document);

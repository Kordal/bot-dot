// A bot's pages (#346, ADR 065; docs/api.md, "Pages"): what a bot saved with save_page, a chip under its reply, a list
// in its settings, opened in the document viewer (viewer.js) with who made it and when it was updated, and "Keep up
// to date": the owner's tap makes a job that rewrites it, with no card to approve. Only from a server with `pages`.
// Every bot's pages in one list (#361): the Pages view, opened from Settings, from a server with `pages-all`.
// The Chief's pages (#384), from a server with `chief-pages`: the same routes and viewer with the id `chief`, a chip
// under its reply, a list in its settings, and a row in the Pages view that opens beside its chat.
// An interactive page (#399, ADR 072), from a server with `interactive-pages`: the bot's own site, shown in a frame on
// the sandbox's own address, with no origin of its own (sandbox="allow-scripts" only). The app hands it the values of
// the tiles it reads and takes one request from it, a link out, which the owner sees before it opens.

const Pages = (() => {
  const ICON = {
    page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6"/></svg>',
    keep: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6 M20 4v5h-5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    site: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18 M7 6.5h.01 M10 6.5h.01"/></svg>',
    board: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  };
  const iconOf = (p) => (p?.kind === 'interactive' ? ICON.site : ICON.page);
  const shows = () => (state.features || []).includes('pages');
  const src = (botId, slug) => `/bots/${encodeURIComponent(botId)}/pages/${encodeURIComponent(slug)}`;
  const CHIEF = 'chief';
  const showsChief = () => shows() && (state.features || []).includes('chief-pages');
  const botName = (id) => (id === CHIEF ? chiefName() : (state.bots || []).find((b) => b.id === id)?.name || '');
  const updated = (p) => `updated ${ago(p.updatedAt)}`;

  // What opens a page in the viewer: a link with data-view, as every file the viewer opens.
  const attrs = (botId, p) => `href="/api${esc(src(botId, p.slug))}" data-view="${esc(src(botId, p.slug))}" data-view-name="${esc(p.title)}" data-view-from="${esc(botName(botId) || p.bot || '')}" data-view-page="${esc(`${botId}/${p.slug}`)}"`;

  // The chips under a reply: the pages its run saved. An entry with its own botId is a page another bot saved (a
  // Chief reply's `botPages`): it opens at that bot's routes.
  function chipsHTML(run) {
    const list = Array.isArray(run?.pages) ? run.pages.filter((p) => p && typeof p.slug === 'string').map((p) => ({ ...p, botId: typeof p.botId === 'string' && p.botId ? p.botId : run.botId }))
      .filter((p) => p.botId !== CHIEF || showsChief()) : [];
    if (!list.length || !shows() || !state.features.includes('document-viewer')) return '';
    return `<div class="bubble-files">${list.map((p) => `<a class="page-chip" ${attrs(p.botId, p)} title="Open ${esc(p.title)}"><span class="pg-icon">${ICON.page}</span><span class="pg-text"><b>${esc(p.title)}</b><span>Page</span></span></a>`).join('')}</div>`;
  }

  // The header's second line: "Page by Ops · updated 5m ago".
  const subtitle = (from, page) => {
    const what = page?.kind === 'interactive' ? 'Interactive page' : 'Page';
    return [from ? `${what} by ${from}` : what, page ? updated(page) : ''].filter(Boolean).join(' · ');
  };

  // A page on the Board (#451), from a server with `pages-board`: "Board" puts it there, "On Board" (filled) takes it off.
  const showsBoard = () => (state.features || []).includes('pages-board');
  const boardBtn = (page) => (showsBoard() && typeof page?.onBoard === 'boolean'
    ? `<button type="button" class="btn sm pg-board${page.onBoard ? ' on' : ''}" data-dv="board" aria-pressed="${page.onBoard}">${ICON.board}${page.onBoard ? 'On Board' : 'Board'}</button>` : '');
  async function setBoard(botId, page, on) {
    try { Object.assign(page, (await api(`${src(botId, page.slug)}/board`, { method: 'PUT', body: { on } })).page); } catch (e) { toast(e.message, true); return false; }
    if (typeof loadDash === 'function') loadDash(true);
    return true;
  }
  // The viewer's "Board" button: it flips at once (#475), and back if the server says no, with nothing reloaded.
  const boarding = new Set(); // "<botId>/<slug>" of a page going on the Board or off it
  async function toggleBoard(botId, page, btn) {
    const key = `${botId}/${page?.slug}`;
    if (!page || boarding.has(key)) return;
    boarding.add(key);
    const was = page.onBoard;
    page.onBoard = !was;
    btn.outerHTML = boardBtn(page);
    if (!(await setBoard(botId, page, !was))) {
      page.onBoard = was;
      const now = document.querySelector('#doc-viewer .pg-board');
      if (now) now.outerHTML = boardBtn(page);
    }
    boarding.delete(key);
  }

  // The viewer's bar on a page: what keeps it up to date, or the button that does; and whether it is on the Board.
  function barHTML(page) {
    if (!page.keep) return `<div class="pg-bar"><button type="button" class="btn sm" data-dv="keep">${ICON.keep}Keep up to date</button>${boardBtn(page)}</div>`;
    return `<div class="pg-bar"><span class="pg-keep">${ICON.keep}Keeps up to date · ${esc(page.keep.when)}</span>
      <button type="button" class="btn sm" data-dv="refresh">Refresh now</button>
      <button type="button" class="btn sm ghost" data-dv="keep">Change</button>
      <button type="button" class="btn sm ghost" data-dv="stop">Stop</button>${boardBtn(page)}</div>`;
  }

  // A bot's pages in its settings, under its Pages row; count: the row's value, how many there are.
  async function drawList(b, box, count = null) {
    if (!box) return;
    let pages;
    try { pages = (await api(`/bots/${encodeURIComponent(b.id)}/pages`)).pages; } catch { box.innerHTML = '<span class="faint">Couldn\'t load its pages.</span>'; return; }
    if (count) count.textContent = pages.length ? String(pages.length) : '';
    if (!pages.length) { box.innerHTML = `<span class="faint" title="Ask ${esc(b.name || botName(b.id))} for a page, a report or an overview.">None yet.</span>`; return; }
    box.innerHTML = pages.map((p) => `<a class="pg-row" ${attrs(b.id, p)}><span class="pg-icon">${iconOf(p)}</span><span class="pg-text"><b>${esc(p.title)}</b><span>${esc(updated(p))}${p.keep ? ` · ${esc(p.keep.when)}` : ''}</span></span>${p.keep ? '<span class="pg-live" aria-label="Keeps up to date"></span>' : ''}</a>`).join('');
  }

  // "Keep up to date": how often, whether to hear of every update, and what to check. The tap is the consent: the
  // job it makes runs with no card. The dialog closes at once and the save runs on with the corner pill (#475); its
  // error opens the dialog again with what was entered. Resolves true once the page keeps up to date (or keeps on
  // another schedule). draft: what was entered before, when the dialog opens again.
  const saving = new Set(); // "<botId>/<slug>" of a page whose schedule is being saved
  function openKeep(botId, page, from, draft = null) {
    const keep = draft || page.keep;
    const every = keep?.every || 'day';
    const time = keep?.time || '07:00';
    return new Promise((resolve) => {
      let body = null;
      const m = openModal(`
        <div class="modal-head"><h2>Keep “${esc(page.title)}” up to date</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
        <div class="modal-body pg-sheet">
          <p class="muted" style="margin:0">${esc(from || 'The bot')} rewrites the page on this schedule, from the same sources.</p>
          <div class="field">How often
            <div class="pg-chips" role="radiogroup">${[['hour', 'Every hour'], ['day', 'Every morning'], ['monday', 'Every Monday']].map(([k, l]) => `<label><input type="radio" name="pg-every" value="${k}" ${k === every ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          </div>
          <label class="field pg-time ${every === 'hour' ? 'hidden' : ''}">At<input type="time" id="pg-time" value="${esc(time)}"></label>
          <div class="field">Tell me
            <label class="toggle"><input type="radio" name="pg-notify" value="report-only" ${keep?.notify !== 'always' ? 'checked' : ''}> Only when something needs me <span class="hint muted">A quiet update otherwise. The page shows when it changed.</span></label>
            <label class="toggle"><input type="radio" name="pg-notify" value="always" ${keep?.notify === 'always' ? 'checked' : ''}> Every time it's updated <span class="hint muted">A short message with what changed.</span></label>
          </div>
          <label class="field">What to check<textarea id="pg-check" rows="3" maxlength="600">${esc(keep?.check ?? page.sources ?? '')}</textarea></label>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-dismiss>Cancel</button>
          <button type="button" class="btn primary" id="pg-go">Keep it up to date</button>
        </div>`);
      $$('[name="pg-every"]', m).forEach((r) => (r.onchange = () => $('.pg-time', m).classList.toggle('hidden', r.value === 'hour' && r.checked)));
      m.addEventListener('close', () => (body ? saveKeep(botId, page, from, body).then(resolve) : resolve(false)), { once: true });
      $('#pg-go', m).onclick = () => {
        body = { every: $('[name="pg-every"]:checked', m).value, time: $('#pg-time', m).value, notify: $('[name="pg-notify"]:checked', m).value, check: $('#pg-check', m).value };
        m.close();
      };
    });
  }
  async function saveKeep(botId, page, from, body) {
    const key = `${botId}/${page.slug}`;
    saving.add(key);
    try {
      return await inBackground('Saving schedule…', () => api(`${src(botId, page.slug)}/keep`, { method: 'POST', body }),
        { ok: 'It keeps up to date now', retry: () => openKeep(botId, page, from, body) });
    } finally { saving.delete(key); }
  }

  // The viewer's buttons on a page, each done at once with the corner pill (#475). Resolves true when the page should
  // be read again.
  async function act(what, botId, page, from) {
    if (!page) return false;
    if (saving.has(`${botId}/${page.slug}`)) return false; // its schedule is still being saved: the pill says so
    const again = () => act(what, botId, page, from);
    if (what === 'keep') return openKeep(botId, page, from);
    if (what === 'refresh') {
      await inBackground('Starting the refresh…', () => api(`/bots/${encodeURIComponent(botId)}/jobs/${encodeURIComponent(page.keep.jobId)}/run`, { method: 'POST' }),
        { ok: `${from || 'The bot'} is refreshing it`, retry: again });
      return false;
    }
    if (what === 'stop') return inBackground('Stopping…', () => api(`${src(botId, page.slug)}/keep`, { method: 'DELETE' }), { ok: 'It no longer keeps up to date', retry: again });
    return false;
  }

  // The Pages view (#361): the pages kept up to date first, then the others, each with its bot, newest first as the
  // server lists them. A row opens the page in the viewer, beside its bot's chat.
  const showsAll = () => (state.features || []).includes('pages-all');
  function rowHTML(p) {
    const sub = [p.bot, updated(p), p.keep?.when].filter(Boolean).join(' · ');
    const sw = showsBoard() && typeof p.onBoard === 'boolean' ? `<label class="switch pg-board-sw"><input type="checkbox" data-page-board="${esc(`${p.botId}/${p.slug}`)}" aria-label="On the Board" ${p.onBoard ? 'checked' : ''}><span></span></label>` : '';
    return `<div class="pg-row-wrap"><button type="button" class="pg-row" data-open-page="${esc(`${p.botId}/${p.slug}`)}"><span class="pg-icon">${iconOf(p)}</span><span class="pg-text"><b>${esc(p.title)}</b><span>${esc(sub)}</span></span>${p.keep ? '<span class="pg-live" aria-label="Keeps up to date"></span>' : ''}</button>${sw}</div>`;
  }
  function allHTML(pages) {
    const kept = pages.filter((p) => p.keep);
    const other = pages.filter((p) => !p.keep);
    const section = (title, list) => (list.length ? `<h3 class="page-sub">${title}</h3><div class="card pg-all">${list.map(rowHTML).join('')}</div>` : '');
    return `${SUB_BACK}
    <div class="section-head"><div><h1>Pages</h1></div></div>
    ${pages.length ? `${section('Kept up to date', kept)}${section(kept.length ? 'Other pages' : 'All pages', other)}`
      : '<div class="card empty" style="padding:36px 20px" title="Ask a bot for a page, a report or an overview.">No pages yet.</div>'}`;
  }
  function openPage(p) {
    if (p.botId === CHIEF) setView('chief'); else setView('bot', p.botId);
    DocViewer.open({ src: src(p.botId, p.slug), name: p.title, from: p.bot, page: { botId: p.botId, slug: p.slug } });
  }
  async function renderAll() {
    const root = $('#view-pages');
    let pages;
    try { pages = (await api('/pages')).pages; } catch (e) {
      if (state.view === 'pages') root.innerHTML = `${SUB_BACK}<div class="card empty">Couldn't load the pages.</div>`;
      return;
    }
    if (state.view !== 'pages') return;
    root.innerHTML = allHTML(pages);
    $$('[data-open-page]', root).forEach((b) => (b.onclick = () => {
      const [botId, slug] = b.dataset.openPage.split('/');
      const p = pages.find((x) => x.botId === botId && x.slug === slug);
      if (p) openPage(p);
    }));
    $$('[data-page-board]', root).forEach((box) => (box.onchange = async () => {
      const [botId, slug] = box.dataset.pageBoard.split('/');
      const p = pages.find((x) => x.botId === botId && x.slug === slug);
      if (!p || !(await setBoard(botId, p, box.checked))) box.checked = !!p?.onBoard;
    }));
  }

  // The live feed's `page`: a bot saved one. The page on screen, the list in its settings and the Pages view follow.
  function changed(d) {
    if (!d?.botId) return;
    DocViewer.pageChanged(d.botId, d.slug);
    const list = $('#page-list');
    if (list && $('#view-botsettings')?.dataset.bot === d.botId) drawList({ id: d.botId, name: botName(d.botId) }, list, $('#bs-pages-val'));
    const own = $('#chief-page-list');
    if (own && d.botId === CHIEF) drawList({ id: CHIEF, name: chiefName() }, own, $('#chief-pages-val'));
    if (state.view === 'pages') renderAll();
  }

  // ---------- an interactive page (#399, ADR 072) ----------

  const ISOLATED = 'Isolated: runs on its own address, cannot see your account, cannot reach the internet.';
  // The viewer's bar on it: what the sandbox is, then Full screen, Versions and Download.
  function siteBarHTML(c, download) {
    const i = c.view.interactive;
    const older = i.shown !== i.current;
    return `<div class="dv-bar pg-site-bar">
      <span class="pg-isolated" title="${esc(ISOLATED)}">${ICON.lock}${esc(ISOLATED)}</span>
      <span class="dv-sp"></span>
      ${boardBtn(c.view.page)}
      <button type="button" class="btn sm" data-dv="full">${c.full ? 'Back beside the chat' : 'Full screen'}</button>
      <button type="button" class="btn sm" data-dv="versions">Versions</button>
      ${download}
    </div>${older ? `<div class="pg-older"><span>You are looking at version ${i.shown}. The page shows version ${i.current}.</span>
      <button type="button" class="btn sm primary" data-dv="rollback" data-version="${i.shown}">Go back to this version</button>
      <button type="button" class="btn sm ghost" data-dv="version" data-version="${i.current}">Show the current one</button></div>` : ''}`;
  }
  // The frame: scripts only, no origin of its own, no forms, popups or navigation of the app. Without the sandbox's
  // address (a front door older than #399, or no second address set up), only the download.
  function siteBodyHTML(c, download) {
    const i = c.view.interactive;
    if (!i.frame) return `<div class="dv-state"><h3>This machine can't show interactive pages yet</h3><p class="muted">They need an address of their own, which the admin's next update of botdot sets up. Download it to open it on your device.</p><div class="dv-acts">${download}</div></div>`;
    return `<iframe class="dv-site" sandbox="allow-scripts" src="${esc(i.frame)}" referrerpolicy="no-referrer" title="${esc(c.name)}" allow="fullscreen 'none'"></iframe>`;
  }
  // Its versions, newest first: show one, or make it the page again (roll back). Resolves { show } or { current }, or null.
  function openVersions(botId, page, i) {
    return new Promise((resolve) => {
      let out = null;
      const row = (v) => `<div class="pg-version${v.n === i.current ? ' on' : ''}"><span class="pg-text"><b>Version ${v.n}${v.n === i.current ? ' · on the page' : ''}</b><span>${esc(ago(v.at))} · ${esc(typeof fmtSize === 'function' ? fmtSize(v.bytes) : `${v.bytes} B`)} · ${v.files} file${v.files === 1 ? '' : 's'}</span></span>
        <button type="button" class="btn sm ghost" data-show="${v.n}">Show</button>${v.n === i.current ? '' : `<button type="button" class="btn sm" data-current="${v.n}">Go back to it</button>`}</div>`;
      const m = openModal(`
        <div class="modal-head"><h2>Versions of “${esc(page.title)}”</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
        <div class="modal-body"><p class="muted" style="margin:0 0 10px">Each time the bot publishes it, a new version. The last ${i.versions.length > 1 ? i.versions.length : 'ten'} are kept.</p>${i.versions.map(row).join('')}</div>`);
      $$('[data-show]', m).forEach((b) => (b.onclick = () => { out = { show: Number(b.dataset.show) }; m.close(); }));
      $$('[data-current]', m).forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        try { await api(`${src(botId, page.slug)}/versions/${b.dataset.current}`, { method: 'POST' }); } catch (e) { b.disabled = false; return toast(e.message, true); }
        toast(`The page shows version ${b.dataset.current} again`);
        out = { current: Number(b.dataset.current) };
        m.close();
      }));
      m.addEventListener('close', () => resolve(out), { once: true });
    });
  }
  async function rollBack(botId, page, n) {
    try { await api(`${src(botId, page.slug)}/versions/${n}`, { method: 'POST' }); } catch (e) { toast(e.message, true); return false; }
    toast(`The page shows version ${n} again`);
    return true;
  }
  // The page's one request: a link out. The owner sees where it leads first; it opens in a new tab with nothing of
  // botdot's (no opener, no referrer).
  function askOpen(url) {
    let u;
    try { u = new URL(url); } catch { return; }
    if (!['http:', 'https:'].includes(u.protocol)) return;
    const m = openModal(`
      <div class="modal-head"><h2>Open a link?</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body"><p style="margin:0 0 6px">The page wants to open <b>${esc(u.host)}</b>:</p><p class="muted pg-link">${esc(u.href)}</p></div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Cancel</button><button type="button" class="btn primary" id="pg-open">Open</button></div>`);
    $('#pg-open', m).onclick = () => { window.open(u.href, '_blank', 'noopener,noreferrer'); m.close(); };
  }

  return { toggleBoard, showsBoard, siteBarHTML, siteBodyHTML, openVersions, rollBack, askOpen, ISOLATED, chipsHTML, subtitle, barHTML, drawList, openKeep, act, changed, shows, showsAll, showsChief, allHTML, renderAll, openPage, CHIEF };
})();

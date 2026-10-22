// A bot's pages (#346, ADR 065; docs/api.md, "Pages"): what a bot saved with save_page, a chip under its reply, a list
// in its settings, opened in the document viewer (viewer.js) with who made it and when it was updated, and "Keep up
// to date": the owner's tap makes a job that rewrites it, with no card to approve. Only from a server with `pages`.
// Every bot's pages in one list (#361): the Pages view, opened from Settings, from a server with `pages-all`.

const Pages = (() => {
  const ICON = {
    page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6"/></svg>',
    keep: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6 M20 4v5h-5"/></svg>',
  };
  const shows = () => (state.features || []).includes('pages');
  const src = (botId, slug) => `/bots/${encodeURIComponent(botId)}/pages/${encodeURIComponent(slug)}`;
  const botName = (id) => (state.bots || []).find((b) => b.id === id)?.name || '';
  const updated = (p) => `updated ${ago(p.updatedAt)}`;

  // What opens a page in the viewer: a link with data-view, as every file the viewer opens.
  const attrs = (botId, p) => `href="/api${esc(src(botId, p.slug))}" data-view="${esc(src(botId, p.slug))}" data-view-name="${esc(p.title)}" data-view-from="${esc(botName(botId))}" data-view-page="${esc(`${botId}/${p.slug}`)}"`;

  // The chips under a reply: the pages its run saved.
  function chipsHTML(run) {
    const list = Array.isArray(run?.pages) ? run.pages.filter((p) => p && typeof p.slug === 'string') : [];
    if (!list.length || !shows() || !state.features.includes('document-viewer')) return '';
    return `<div class="bubble-files">${list.map((p) => `<a class="page-chip" ${attrs(run.botId, p)} title="Open ${esc(p.title)}"><span class="pg-icon">${ICON.page}</span><span class="pg-text"><b>${esc(p.title)}</b><span>Page</span></span></a>`).join('')}</div>`;
  }

  // The header's second line: "Page by Ops · updated 5m ago".
  const subtitle = (from, page) => [from ? `Page by ${from}` : 'Page', page ? updated(page) : ''].filter(Boolean).join(' · ');

  // The viewer's bar on a page: what keeps it up to date, or the button that does.
  function barHTML(page) {
    if (!page.keep) return `<div class="pg-bar"><button type="button" class="btn sm" data-dv="keep">${ICON.keep}Keep up to date</button></div>`;
    return `<div class="pg-bar"><span class="pg-keep">${ICON.keep}Keeps up to date · ${esc(page.keep.when)}</span>
      <button type="button" class="btn sm" data-dv="refresh">Refresh now</button>
      <button type="button" class="btn sm ghost" data-dv="keep">Change</button>
      <button type="button" class="btn sm ghost" data-dv="stop">Stop</button></div>`;
  }

  // A bot's pages in its settings.
  async function drawList(b, box) {
    if (!box) return;
    let pages;
    try { pages = (await api(`/bots/${encodeURIComponent(b.id)}/pages`)).pages; } catch { box.innerHTML = '<span class="faint">Couldn\'t load its pages.</span>'; return; }
    if (!pages.length) { box.innerHTML = `<span class="faint">None yet. Ask ${esc(b.name)} for a page, a report or an overview.</span>`; return; }
    box.innerHTML = pages.map((p) => `<a class="pg-row" ${attrs(b.id, p)}><span class="pg-icon">${ICON.page}</span><span class="pg-text"><b>${esc(p.title)}</b><span>${esc(updated(p))}${p.keep ? ` · ${esc(p.keep.when)}` : ''}</span></span>${p.keep ? '<span class="pg-live" aria-label="Keeps up to date"></span>' : ''}</a>`).join('');
  }

  // "Keep up to date": how often, whether to hear of every update, and what to check. The tap is the consent: the
  // job it makes runs with no card. Resolves true once the page keeps up to date (or keeps on another schedule).
  function openKeep(botId, page, from) {
    const keep = page.keep;
    const every = keep?.every || 'day';
    const time = keep?.time || '07:00';
    return new Promise((resolve) => {
      let done = false;
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
      m.addEventListener('close', () => resolve(done), { once: true });
      $('#pg-go', m).onclick = async () => {
        $('#pg-go', m).disabled = true;
        const body = { every: $('[name="pg-every"]:checked', m).value, time: $('#pg-time', m).value, notify: $('[name="pg-notify"]:checked', m).value, check: $('#pg-check', m).value };
        try { await api(`${src(botId, page.slug)}/keep`, { method: 'POST', body }); } catch (e) { $('#pg-go', m).disabled = false; return toast(e.message, true); }
        done = true;
        toast('It keeps up to date now');
        m.close();
      };
    });
  }

  // The viewer's buttons on a page. Resolves true when the page should be read again.
  async function act(what, botId, page, from) {
    if (!page) return false;
    if (what === 'keep') return openKeep(botId, page, from);
    try {
      if (what === 'refresh') { await api(`/bots/${encodeURIComponent(botId)}/jobs/${encodeURIComponent(page.keep.jobId)}/run`, { method: 'POST' }); toast(`${from || 'The bot'} is refreshing it`); return false; }
      if (what === 'stop') { await api(`${src(botId, page.slug)}/keep`, { method: 'DELETE' }); toast('It no longer keeps up to date'); return true; }
    } catch (e) { toast(e.message, true); }
    return false;
  }

  // The Pages view (#361): the pages kept up to date first, then the others, each with its bot, newest first as the
  // server lists them. A row opens the page in the viewer, beside its bot's chat.
  const showsAll = () => (state.features || []).includes('pages-all');
  function rowHTML(p) {
    const sub = [p.bot, updated(p), p.keep?.when].filter(Boolean).join(' · ');
    return `<button type="button" class="pg-row" data-open-page="${esc(`${p.botId}/${p.slug}`)}"><span class="pg-icon">${ICON.page}</span><span class="pg-text"><b>${esc(p.title)}</b><span>${esc(sub)}</span></span>${p.keep ? '<span class="pg-live" aria-label="Keeps up to date"></span>' : ''}</button>`;
  }
  function allHTML(pages) {
    const kept = pages.filter((p) => p.keep);
    const other = pages.filter((p) => !p.keep);
    const section = (title, list) => (list.length ? `<h3 class="page-sub">${title}</h3><div class="card pg-all">${list.map(rowHTML).join('')}</div>` : '');
    return `${SUB_BACK}
    <div class="section-head"><div><h1>Pages</h1><p>Made by your bots</p></div></div>
    ${pages.length ? `${section('Kept up to date', kept)}${section(kept.length ? 'Other pages' : 'All pages', other)}`
      : '<div class="card empty" style="padding:36px 20px">No pages yet. Ask a bot for a page, a report or an overview: it shows here, and under the bot\'s reply.</div>'}`;
  }
  function openPage(p) {
    setView('bot', p.botId);
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
  }

  // The live feed's `page`: a bot saved one. The page on screen, the list in its settings and the Pages view follow.
  function changed(d) {
    if (!d?.botId) return;
    DocViewer.pageChanged(d.botId, d.slug);
    const list = $('#page-list');
    if (list && $('#view-botsettings')?.dataset.bot === d.botId) drawList({ id: d.botId, name: botName(d.botId) }, list);
    if (state.view === 'pages') renderAll();
  }

  return { chipsHTML, subtitle, barHTML, drawList, openKeep, act, changed, shows, showsAll, allHTML, renderAll, openPage };
})();

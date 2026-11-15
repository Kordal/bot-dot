// The fixed project overview (ADR 236). Each project's snapshot and files keep their own loading/error state.
const ProjectOverview = (() => {
  const snapshots = new Map();
  const stateOf = (id) => { if (!snapshots.has(id)) snapshots.set(id, { at: 0, busy: false, data: null, error: '', files: null, filesError: '' }); return snapshots.get(id); };
  function refresh(c, force = false) {
    const s = stateOf(c.id);
    if (s.busy || (!force && Date.now() - s.at < 30_000)) return;
    s.busy = true;
    const query = `?project=${encodeURIComponent(c.id)}`;
    const overviewPath = `/company/overview${query}`, filesPath = `/company/files${query}`;
    const repaint = () => { if (state.company?.id === c.id && Company.place() === 'company' && (state.view === 'company' || Dock.docked())) Company.redraw(); };
    const data = api(overviewPath).then((r) => {
      if (r.projectId !== c.id) throw new Error(tr('Information unavailable'));
      s.data = r; s.error = '';
    }).catch((e) => { s.error = e.message || tr("Couldn't refresh"); }).finally(repaint);
    const files = api(filesPath).then((r) => { s.files = r; s.filesError = ''; })
      .catch((e) => { s.filesError = e.message || tr("Couldn't load files"); }).finally(repaint);
    return Promise.all([data, files]).finally(() => { s.at = Date.now(); s.busy = false; repaint(); });
  }
  const label = (k) => ({ working: tr('Working'), planned: tr('Planned'), failed: tr('Failed'), asks: tr('Asks'), reply: tr('Reply') })[k] || '';
  function rows(items, empty = '') {
    return items.length ? items.map((x) => `<div class="po-row" ${x.groupId ? `data-po-group="${esc(x.groupId)}"` : x.chatId ? `data-po-chief="${esc(x.chatId)}"` : x.botId ? `data-po-bot="${esc(x.botId)}"` : 'data-po-chat'}>
      <button type="button" class="po-meta"><b>${esc(x.name)}</b><span>${esc(label(x.state))}${x.at ? ` · ${esc(ago(x.at))}` : ''}</span></button><span class="po-text md">${x.text ? mdPreview(x.text) : esc(label(x.state))}</span></div>`).join('') : empty ? `<p class="po-empty">${empty}</p>` : '';
  }
  function html(c) {
    refresh(c);
    const s = stateOf(c.id), d = s.data;
    const notice = s.error ? `<p role="alert" class="po-error">${tr("Couldn't refresh")}: ${esc(s.error)}${d ? ` · ${tr('Showing saved information')}` : ''}</p>` : '';
    const updated = d ? `<p class="po-stamp">${tr('Updated {when}', { when: esc(ago(d.at)) })}${s.busy ? ` · ${tr('Updating…')}` : ''}</p>` : `<p role="status">${s.error ? tr('Information unavailable') : tr('Loading…')}</p>`;
    const section = (title, body) => `<section class="po-section"><h2>${title}</h2>${body}</section>`;
    const fileState = s.filesError ? `<p role="alert">${tr("Couldn't load files")}: ${esc(s.filesError)}${s.files ? ` · ${tr('Showing saved information')}` : ''}</p>` : '';
    const files = !s.files ? `<p>${s.filesError ? tr('Information unavailable') : tr('Loading…')}</p>` : s.files.state === 'off' ? `<p>${tr('Files are unavailable while the computer is off.')}</p>`
      : (s.files.files || []).length ? s.files.files.map((f) => `<button type="button" class="po-row" data-po-file="${esc(f.path)}"><span class="po-text">${esc(f.name)}</span><span class="po-stamp">${esc(Files.whenOf(f.at, true))}</span></button>`).join('') : `<p>${tr('No files yet.')}</p>`;
    return `<div data-po-root class="po-overview">${notice}${updated}<button type="button" class="btn sm" data-po-refresh${s.busy ? ' disabled' : ''}>${tr('Refresh')}</button>
      ${d ? section(tr('Current work'), rows(d.work, tr('No recorded work.'))) + section(tr('Blockers'), rows(d.blockers.filter((x) => x.state !== 'asks'), tr('No failed work.'))) + section(tr('Latest replies'), rows(d.replies, tr('No replies yet.'))) : ''}
      ${section(tr('Files'), fileState + files + (c.folder ? `<button type="button" class="btn sm" data-po-folder>${tr('Open folder')}</button>` : ''))}</div>`;
  }
  // One of its sections as a board tile (overview-board, ADR 245): Current work, Blockers or Latest replies. It reads the
  // same snapshot and keeps it fresh while a tile shows; a failed refresh says so in the tile.
  function tile(c, key) {
    refresh(c);
    const s = stateOf(c.id), d = s.data;
    const title = { work: tr('Current work'), blockers: tr('Blockers'), replies: tr('Latest replies') }[key];
    const notice = s.error ? `<p role="alert" class="po-error">${tr("Couldn't refresh")}: ${esc(s.error)}</p>` : '';
    const body = !d ? `<p class="po-empty">${s.error ? tr('Information unavailable') : tr('Loading…')}</p>`
      : key === 'work' ? rows(d.work, tr('No recorded work.'))
        : key === 'blockers' ? rows(d.blockers.filter((x) => x.state !== 'asks'), tr('No failed work.'))
          : rows(d.replies, tr('No replies yet.'));
    return `<section class="cf-ov" data-cf-ov="${key}"><h2>${title}</h2>${notice}${body}</section>`;
  }
  function wire(root, c) {
    const folder = () => ({ folder: c.folder.name, name: c.name || c.start, color: c.color });
    root.querySelector('[data-po-refresh]')?.addEventListener('click', () => { refresh(c, true); Company.redraw(); });
    // A row holds links, so it is no <button>: its name is the button, a tap anywhere else in it opens the chat as
    // well, and a link opens only itself.
    const open = (sel, go) => root.querySelectorAll(sel).forEach((b) => b.onclick = (e) => { if (!e.target.closest('a')) go(b); });
    open('[data-po-bot]', (b) => setView('bot', b.dataset.poBot));
    open('[data-po-group]', (b) => setView('group', b.dataset.poGroup));
    open('[data-po-chief]', (b) => Dock.openChief(b.dataset.poChief));
    open('[data-po-chat]', () => Dock.openDefault());
    root.querySelectorAll('[data-po-file]').forEach((b) => b.onclick = () => c.folder && Files.openFolderFile(folder(), b.dataset.poFile));
    root.querySelector('[data-po-folder]')?.addEventListener('click', () => Files.openFolder(folder()));
  }
  setInterval(() => { if (!document.hidden && state.company && Company.place() === 'company' && (state.view === 'company' || Dock.docked()) && document.querySelector('[data-po-root], [data-cf-ov], [data-cf-ov-feed]')) { refresh(state.company, true); Company.redraw(); } }, 30_000);
  // The questions waiting for the owner (a bot's, a team chat's, the Chief's): they stand in Needs you, not under Blockers.
  // A question in a chat that already has a card in Needs you (the Chief's) is that card's: shown once, as the card.
  const questions = (c, cards = []) => (stateOf(c.id).data?.blockers || []).filter((x) => x.state === 'asks' && (!x.chatId || !cards.some((k) => k.a?.chatId === x.chatId)));
  return { html, tile, refresh, wire, rows, questions, sig: (id) => snapshots.get(id) || null };
})();

// The fixed project overview (ADR 236). Each project's snapshot and files keep their own loading/error state.
const ProjectOverview = (() => {
  const snapshots = new Map();
  const stateOf = (id) => { if (!snapshots.has(id)) snapshots.set(id, { at: 0, busy: false, data: null, error: '', files: null, filesError: '' }); return snapshots.get(id); };
  function refresh(c, force = false) {
    const s = stateOf(c.id);
    if (s.busy || (!force && Date.now() - s.at < 30_000)) return;
    s.busy = true;
    const overviewPath = Company.at('/company/overview'), filesPath = Company.at('/company/files');
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
  function rows(items, empty) {
    return items.length ? items.map((x) => `<button type="button" class="po-row" ${x.groupId ? `data-po-group="${esc(x.groupId)}"` : x.chatId ? `data-po-chief="${esc(x.chatId)}"` : x.botId ? `data-po-bot="${esc(x.botId)}"` : 'data-po-chat'}>
      <span class="po-meta"><b>${esc(x.name)}</b><span>${esc(label(x.state))}${x.at ? ` · ${esc(ago(x.at))}` : ''}</span></span><span class="po-text">${esc(x.text || label(x.state))}</span></button>`).join('') : `<p class="po-empty">${empty}</p>`;
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
      ${section(tr('Goal'), `<p class="po-goal">${esc(c.goal || tr('No goal set.'))}</p>`)}
      ${d ? section(tr('Current work'), rows(d.work, tr('No recorded work.'))) + section(tr('Blockers'), rows(d.blockers, tr('No failed work or open questions.'))) + section(tr('Latest replies'), rows(d.replies, tr('No replies yet.'))) : ''}
      ${section(tr('Files'), fileState + files + (c.folder ? `<button type="button" class="btn sm" data-po-folder>${tr('Open folder')}</button>` : ''))}</div>`;
  }
  function wire(root, c) {
    const folder = () => ({ folder: c.folder.name, name: c.name || c.start, color: c.color });
    root.querySelector('[data-po-refresh]')?.addEventListener('click', () => { refresh(c, true); Company.redraw(); });
    root.querySelectorAll('[data-po-bot]').forEach((b) => b.onclick = () => setView('bot', b.dataset.poBot));
    root.querySelectorAll('[data-po-group]').forEach((b) => b.onclick = () => setView('group', b.dataset.poGroup));
    root.querySelectorAll('[data-po-chief]').forEach((b) => b.onclick = () => Dock.openChief(b.dataset.poChief));
    root.querySelectorAll('[data-po-chat]').forEach((b) => b.onclick = () => Dock.openDefault());
    root.querySelectorAll('[data-po-file]').forEach((b) => b.onclick = () => c.folder && Files.openFolderFile(folder(), b.dataset.poFile));
    root.querySelector('[data-po-folder]')?.addEventListener('click', () => Files.openFolder(folder()));
  }
  setInterval(() => { if (state.company && Company.place() === 'company' && (state.view === 'company' || Dock.docked()) && document.querySelector('[data-po-root]')) { refresh(state.company, true); Company.redraw(); } }, 30_000);
  return { html, wire, sig: (id) => snapshots.get(id) || null };
})();

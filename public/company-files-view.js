// The Files tile of a project's board (`project-files`): the newest files of the project's folder, from
// GET /api/company/files, asked again for another project and at most once a minute as the page is drawn. The server
// never starts the account's computer for it: while it is off the tile lists nothing. A click on the tile opens the
// folder in Files (which starts it); a click on a file opens that file over its folder. company-home.js puts the tile
// on the floor (Company.files.tile) and adds its sig.
(() => {
  const DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5"/></svg>';
  const AGAIN_MS = 60_000;
  const tile = { key: null, files: [], at: 0, asking: false };
  function refresh(c) {
    if (tile.asking || (tile.key === c.id && Date.now() - tile.at < AGAIN_MS)) return;
    tile.asking = true;
    api(Company.at('/company/files'))
      .then((r) => { tile.files = r.files || []; })
      .catch((e) => { console.warn(e.message); if (tile.key !== c.id) tile.files = []; })
      .finally(() => { tile.key = c.id; tile.at = Date.now(); tile.asking = false; Company.redraw(); });
  }
  const project = (c) => ({ folder: c.folder.name, name: c.name || c.start, color: c.color });

  function tileHTML(c) {
    if (!c.folder) return '';
    refresh(c);
    const files = tile.key === c.id ? tile.files : [];
    const rows = files.map((f) => `<button type="button" class="cf-files-row" data-cf-file="${esc(f.path)}" title="${esc(f.path)}">${DOC}<span class="cf-row-text">${esc(f.name)}</span><span class="cf-files-when">${esc(Files.whenOf(f.at, true))}</span></button>`).join('');
    return `<section class="cf-files" data-cf-files tabindex="0" aria-label="${tr('Files')}">
      <div class="cf-room-head"><i class="cf-dot"></i>${tr('Files')}</div>${rows ? `<div class="cf-files-rows">${rows}</div>` : ''}</section>`;
  }

  function wire(root) {
    const el = root.querySelector('[data-cf-files]');
    const c = state.company;
    if (!el || !c?.folder) return;
    el.onclick = (e) => {
      const row = e.target.closest('[data-cf-file]');
      if (row) return Files.openFolderFile(project(c), row.dataset.cfFile);
      return Files.openFolder(project(c));
    };
    el.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); Files.openFolder(project(c)); } };
  }

  Company.files = { tile: tileHTML, wire, sig: () => [tile.key, tile.at] };
})();

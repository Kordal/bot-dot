// Settings → Storage (docs/api.md, Storage; lib/storage.js): what the account's files take on the disk. The total and
// a bar of the groups, a row each, then the largest files; a group or a folder opens to what it holds, largest first.
// A folder or file a Files place can open has a menu: Open in Files, Ask the Chief, and Delete, which asks on its own
// row first and deletes with the Files routes. Caches are cleared from their row, after the same question.
// Only from a server whose features have `storage`; settings.js links it, app.js shows it.

const StoragePage = (() => {
  const GROUP_NAMES = {
    computer: () => tr('Computer'), bots: () => tr('Bots’ files'), projects: () => tr('Projects'), uploads: () => tr('Uploads'),
    chats: () => tr('Chats and memory'), caches: () => tr('Caches'), other: () => tr('Other'),
  };
  const LABELS = {
    home: () => tr('Home'), browser: () => tr('Browser'), system: () => tr('Installed programs'), runs: () => tr('Runs'),
    memory: () => tr('Memory'), botdot: () => 'botdot', computer: () => tr('Computer'), disk: () => tr('System'),
  };
  const FOLDER = '<svg viewBox="0 0 16 16"><path d="M2 4.5h4l1.5 1.5H14v6.5H2z"/></svg>';
  const FILE = '<svg viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4z"/></svg>';
  const REFRESH = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>';
  // trail: the names opened from the overview, the group's id first. menu: the key of the row whose menu is open.
  // ask: { key, what: 'delete' | 'clear' } for the question on a row. busy: a delete or clear under way.
  const cur = { data: null, error: null, trail: [], menu: null, ask: null, busy: false, timer: null };

  // 14 GB, 6.4 GB, 812 MB, 4 KB: by thousands, as a Mac counts.
  function size(bytes) {
    const n = Number(bytes) || 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let v = n;
    while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
    const digits = i === 0 || v >= 10 ? 0 : 1;
    return `${v.toLocaleString(I18n.locale || 'en', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[i]}`;
  }
  const nameOf = (n) => (n.label && LABELS[n.label] ? LABELS[n.label]() : n.name);

  // What the trail opens: { node, place, base } where `place` and `base` are of the nearest node a Files place opens,
  // and `crumbs` the names on the way.
  function opened() {
    const d = cur.data;
    if (!d || !cur.trail.length) return null;
    const group = d.groups.find((g) => g.id === cur.trail[0]);
    if (!group) return null;
    let node = { ...group, name: GROUP_NAMES[group.id]?.() || group.id };
    let place = null; let base = ''; let rel = [];
    const crumbs = [node.name];
    for (const name of cur.trail.slice(1)) {
      const kid = (node.kids || []).find((k) => k.name === name);
      if (!kid) return { node, place, base, rel: rel.join('/'), crumbs, short: true };
      if (kid.place) { place = kid.place; base = kid.path || ''; rel = []; } else if (place) rel.push(kid.name);
      node = kid;
      crumbs.push(nameOf(kid));
    }
    return { node, place, base, rel: rel.join('/'), crumbs };
  }
  const join = (...parts) => parts.filter(Boolean).join('/');

  // A row's own place and path, when a Files place opens it: the node with a place is its own top.
  function where(kid, at) {
    if (kid.place) return { place: kid.place, path: kid.path || '' };
    if (!at?.place) return null;
    return { place: at.place, path: join(at.base, at.rel, kid.name) };
  }
  const deletable = (w) => !!w && !!w.path && w.path !== 'uploads';

  async function load() {
    try { cur.data = await api('/storage'); cur.error = null; } catch (e) { cur.error = e.message; }
    draw();
    clearTimeout(cur.timer);
    if (cur.data?.checking && state.view === 'storage') cur.timer = setTimeout(load, 3000);
  }

  function head(o) {
    const d = cur.data;
    const total = o ? o.node.bytes : d?.total;
    const title = o ? o.crumbs[o.crumbs.length - 1] : tr('Storage');
    const checked = d?.checkedAt ? tr('Checked {when}', { when: shortTime(d.checkedAt) }) : tr('Checking…');
    return `${o ? `<button type="button" class="btn sm sub-back" data-st-up>${ICON.back} ${esc(o.crumbs.length > 1 ? o.crumbs[o.crumbs.length - 2] : tr('Storage'))}</button>` : subBack()}
      <div class="section-head"><div><h1>${esc(title)}</h1></div></div>
      ${o && o.crumbs.length > 1 ? `<nav class="st-crumbs" aria-label="${esc(tr('Path'))}"><button type="button" class="link-btn" data-st-to="0">${tr('Storage')}</button>${o.crumbs.map((c, i) => `<span aria-hidden="true">›</span>${i < o.crumbs.length - 1 ? `<button type="button" class="link-btn" data-st-to="${i + 1}">${esc(c)}</button>` : `<b>${esc(c)}</b>`}`).join('')}</nav>` : ''}
      <div class="st-total"><b>${d?.checkedAt ? size(total) : '—'}</b>${o ? '' : `<button type="button" class="icon-btn st-check${d?.checking ? ' spin' : ''}" data-st-check aria-label="${esc(tr('Check again'))}"${tipAttrs(checked)}${d?.checking ? ' disabled' : ''}>${REFRESH}</button>`}</div>`;
  }

  function overview() {
    const d = cur.data;
    const shown = d.groups.filter((g) => g.bytes > 0);
    const bar = `<div class="st-bar" role="img" aria-label="${esc(shown.map((g) => `${GROUP_NAMES[g.id]()} ${size(g.bytes)}`).join(', '))}">${shown.map((g) => `<i class="st-c-${g.id}" style="flex:${g.bytes}"${tipAttrs(`${GROUP_NAMES[g.id]()} · ${size(g.bytes)}`)}></i>`).join('')}</div>`;
    const rows = shown.map((g) => {
      const key = `g:${g.id}`;
      const clear = g.id === 'caches' ? `<button type="button" class="btn sm" data-st-clear${cur.busy ? ' disabled' : ''}>${tr('Clear')}</button>` : '';
      const ask = cur.ask?.key === key ? askRow(tr('Clear the caches? {size}.', { size: size(g.bytes) }), tr('Clear')) : '';
      return `<div class="bs-row bs-link st-group" role="button" tabindex="0" data-st-open="${esc(g.id)}"><span class="st-sw st-c-${g.id}" aria-hidden="true"></span><b>${GROUP_NAMES[g.id]()}</b>${clear}<span class="bs-val st-size">${size(g.bytes)}</span>${CHEV}</div>${ask}`;
    }).join('');
    const top = d.largest[0]?.bytes || 1;
    const largest = d.largest.slice(0, 10).map((f, i) => row({ key: `l:${i}`, name: f.name, owner: f.owner, bytes: f.bytes, dir: false, w: { place: f.place, path: f.path }, top }));
    return `${bar}${rows ? `<div class="set-list st-list">${rows}</div>` : ''}
      ${largest.length ? `<h2 class="st-h">${tr('Largest')}</h2><div class="set-list st-list">${largest.join('')}</div>` : ''}`;
  }

  function folder(o) {
    const kids = (o.node.kids || []).filter((k) => k.bytes > 0);
    if (!kids.length) return `<div class="empty">${tr('Nothing here.')}</div>`;
    const top = kids[0].bytes || 1;
    return `<div class="set-list st-list">${kids.map((k, i) => row({ key: `k:${i}`, name: nameOf(k), bytes: k.bytes, dir: k.dir !== false, files: k.files, opens: !!k.kids?.length, w: where(k, o), real: k.name, top })).join('')}</div>`;
  }

  // One folder or file: its icon, name, a bar against the largest beside it, its size and its menu.
  function row({ key, name, owner, bytes, dir, files, opens, w, real, top }) {
    const menu = !!w;
    const open = cur.menu === key;
    const ask = cur.ask?.key === key
      ? askRow(dir ? tr('Delete {name}? {size}, {count}.', { name, size: size(bytes), count: trn(files || 0, '{n} file', '{n} files') }) : tr('Delete {name}? {size}.', { name, size: size(bytes) }), tr('Delete'))
      : '';
    return `<div class="st-row${open || ask ? ' hot' : ''}" data-st-row="${key}"${opens ? ` data-st-into="${esc(real ?? name)}"` : ''} data-st-key="${key}" tabindex="0">
        <span class="st-ic" aria-hidden="true">${dir ? FOLDER : FILE}</span>
        <span class="st-name">${esc(name)}${owner ? ` <span class="faint">· ${esc(owner)}</span>` : ''}</span>
        <span class="st-mini" aria-hidden="true"><i style="width:${Math.max(2, Math.round((bytes / top) * 100))}%"></i></span>
        <span class="st-size">${size(bytes)}</span>
        ${menu ? `<button type="button" class="icon-btn st-more" data-st-menu="${key}" aria-label="${esc(tr('More'))}" aria-expanded="${open}">⋯</button>` : opens ? CHEV : '<span></span>'}
        ${open ? `<div class="menu st-menu" role="menu">
          <button type="button" role="menuitem" data-st-files="${key}">${tr('Open in Files')}</button>
          <button type="button" role="menuitem" data-st-chief="${key}">${tr('Ask the Chief')}</button>
          ${deletable(w) ? `<button type="button" role="menuitem" class="danger" data-st-delete="${key}">${tr('Delete…')}</button>` : ''}
        </div>` : ''}
      </div>${ask}`;
  }
  const askRow = (words, yes) => `<div class="st-confirm" role="alertdialog"><span>${esc(words)}</span><button type="button" class="btn sm" data-st-cancel${cur.busy ? ' disabled' : ''}>${tr('Cancel')}</button><button type="button" class="btn sm st-danger" data-st-yes${cur.busy ? ' disabled' : ''}>${esc(yes)}</button></div>`;

  // The rows of what is shown, by key: { name, bytes, dir, files, w } for a menu's and a question's actions.
  function rowsByKey() {
    const out = {};
    const d = cur.data;
    if (!d) return out;
    const o = opened();
    if (!o) d.largest.slice(0, 10).forEach((f, i) => { out[`l:${i}`] = { name: f.name, bytes: f.bytes, dir: false, w: { place: f.place, path: f.path }, owner: f.owner }; });
    else (o.node.kids || []).filter((k) => k.bytes > 0).forEach((k, i) => { out[`k:${i}`] = { name: nameOf(k), bytes: k.bytes, dir: k.dir !== false, files: k.files, w: where(k, o) }; });
    return out;
  }

  function draw() {
    const root = $('#view-storage');
    if (!root || state.view !== 'storage') return;
    if (cur.error && !cur.data) { root.innerHTML = `${head(null)}<div class="req-note">${esc(cur.error)}</div>`; wire(root); return; }
    if (!cur.data) { root.innerHTML = `${head(null)}<div class="empty">${tr('Loading…')}</div>`; wire(root); return; }
    const o = opened();
    if (cur.trail.length && !o) cur.trail = [];
    root.innerHTML = `${head(o)}${o ? folder(o) : overview()}`;
    wire(root);
  }

  // The Files route of a place: a bot's folder on botdot or on the computer, the Chief's, or a project's.
  function filesBase(place) {
    if (place.project) return `/projects/${encodeURIComponent(place.project)}/workspace?`;
    if (place.bot === '_chief') return '/chief/workspace?';
    return `/bots/${encodeURIComponent(place.bot)}/workspace?root=${encodeURIComponent(place.root || 'server')}&`;
  }
  function openInFiles(r) {
    const { place, path } = r.w;
    const into = r.dir ? path : path.split('/').slice(0, -1).join('/');
    if (place.project) return Files.openFolder({ folder: place.project, name: place.project }, into);
    const bot = place.bot === '_chief' ? chiefAsBot() : botById(place.bot);
    if (!bot) return toast(tr('That bot is gone.'), true);
    return Files.open(bot, { place: { root: place.root || 'server' }, path: into });
  }
  function askChief(r) {
    const whose = r.w.place.project ? r.w.place.project : r.w.place.bot === '_chief' ? chiefTitle() : botById(r.w.place.bot)?.name || '';
    const text = tr('What is {name} ({size}) in {whose}’s files, and can it go?', { name: r.w.path, size: size(r.bytes), whose });
    setView('chief');
    requestAnimationFrame(() => {
      const box = $('#view-chief form.composer textarea');
      if (!box) return;
      box.value = text;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
    });
  }
  async function remove(r) {
    cur.busy = true; draw();
    try {
      await api(`${filesBase(r.w.place)}path=${encodeURIComponent(r.w.path)}`, { method: 'DELETE' });
      cur.ask = null;
      toast(tr('Deleted'));
    } catch (e) { toast(e.message, true); }
    cur.busy = false;
    await load();
  }
  async function clear() {
    cur.busy = true; draw();
    try {
      cur.data = await api('/storage/clear-caches', { method: 'POST' });
      cur.ask = null;
      toast(tr('Cleared {size}', { size: size(cur.data.freed) }));
    } catch (e) { toast(e.message, true); }
    cur.busy = false;
    draw();
  }

  function wire(root) {
    const go = (trail) => { cur.trail = trail; cur.menu = null; cur.ask = null; draw(); root.scrollTop = 0; };
    $$('[data-st-up]', root).forEach((b) => (b.onclick = () => go(cur.trail.slice(0, -1))));
    $$('[data-st-to]', root).forEach((b) => (b.onclick = () => go(cur.trail.slice(0, Number(b.dataset.stTo)))));
    $$('[data-st-check]', root).forEach((b) => (b.onclick = async () => {
      try { cur.data = await api('/storage/check', { method: 'POST' }); } catch (e) { toast(e.message, true); }
      load();
    }));
    $$('[data-st-open]', root).forEach((b) => {
      b.onclick = (e) => { if (!e.target.closest('[data-st-clear]')) go([b.dataset.stOpen]); };
      b.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === b) { e.preventDefault(); go([b.dataset.stOpen]); } };
    });
    $$('[data-st-clear]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); cur.ask = { key: 'g:caches', what: 'clear' }; cur.menu = null; draw(); }));
    const rows = rowsByKey();
    $$('[data-st-row]', root).forEach((el) => {
      const act = (e) => {
        if (e.target.closest('button')) return;
        if (el.dataset.stInto) return go([...cur.trail, el.dataset.stInto]);
        if (rows[el.dataset.stKey]?.w) { cur.menu = cur.menu === el.dataset.stKey ? null : el.dataset.stKey; cur.ask = null; draw(); }
      };
      el.onclick = act;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(e); } };
    });
    $$('[data-st-menu]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); cur.menu = cur.menu === b.dataset.stMenu ? null : b.dataset.stMenu; cur.ask = null; draw(); }));
    $$('[data-st-files]', root).forEach((b) => (b.onclick = () => { const r = rows[b.dataset.stFiles]; cur.menu = null; draw(); if (r) openInFiles(r); }));
    $$('[data-st-chief]', root).forEach((b) => (b.onclick = () => { const r = rows[b.dataset.stChief]; cur.menu = null; if (r) askChief(r); }));
    $$('[data-st-delete]', root).forEach((b) => (b.onclick = () => { cur.ask = { key: b.dataset.stDelete, what: 'delete' }; cur.menu = null; draw(); }));
    $$('[data-st-cancel]', root).forEach((b) => (b.onclick = () => { cur.ask = null; draw(); }));
    $$('[data-st-yes]', root).forEach((b) => (b.onclick = () => {
      if (cur.ask?.what === 'clear') return clear();
      const r = rows[cur.ask?.key];
      if (r) remove(r);
    }));
  }

  // Opened from Settings: the overview at the top, fresh from the server.
  function open() {
    cur.trail = []; cur.menu = null; cur.ask = null;
    draw();
    load();
  }
  // Escape closes a menu, then a question, then goes up a folder.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state.view !== 'storage' || document.body.classList.contains('files-open')) return;
    if (cur.menu) cur.menu = null; else if (cur.ask) cur.ask = null; else if (cur.trail.length) cur.trail = cur.trail.slice(0, -1); else return;
    draw();
  });
  // A click outside an open menu closes it.
  document.addEventListener('click', (e) => {
    if (!cur.menu || state.view !== 'storage' || e.target.closest('.st-menu, [data-st-menu], [data-st-row]')) return;
    cur.menu = null; draw();
  });

  return { open, draw, size };
})();

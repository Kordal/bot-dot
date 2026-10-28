// Files (#603; docs/api.md, "A bot's workspace"): a full-screen file manager for one bot, or the Chief, opened from the
// folder button in its chat's head and from its settings. Its places: the bot's folder on botdot, its folder on the
// account's computer, each shared project it is in (#578), and what is kept in mind (#235), with folders the owner
// pinned. A folder lists as rows or as a grid (images as themselves, small), sorted by name, date or size; entries are
// selected (checkbox, Shift, Ctrl), opened in the document viewer (viewer.js), renamed, moved or copied to any folder
// of any place, downloaded, kept in mind and deleted. A wide window adds a preview of the selected file; a phone has
// bottom sheets, long-press to select and a + button. Files dropped from the desktop upload into the open folder.
// What botdot keeps (CLAUDE.md, .claude/, …) shows a lock and offers nothing that writes. Only from a server whose
// features have `files-explorer`; it replaces the Files and Workspace sections of the settings.

const Files = (() => {
  const MAX_FILES = 10; // of one upload, as the attachments
  const MAX_BYTES = 25 * 1024 * 1024;
  const MAX_FOLDER_FILES = 1000; // of one uploaded folder
  const NARROW = '(max-width: 760px)';
  let cur = null;

  const I = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    server: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/></svg>',
    computer: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    project: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 13h6"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2"/></svg>',
    sheet: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M10 5v14"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="15.5" cy="9.5" r="1.5"/><path d="M4 17l5-5 4 4 2.5-2.5L20 17"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6M10 4v6l-3 4h10l-3-4V4M12 14v7"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 20V7M6 12l6-6 6 6M5 4h14"/></svg>',
    sort: '<svg viewBox="0 0 24 24"><path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
    more: '<svg viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.6"/></svg>',
    move: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 13h6M13 10.5l2.5 2.5-2.5 2.5"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v13M7 12l5 5 5-5"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    caret: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 17l1-3 5-5 2 2-5 5z"/></svg>',
  };

  // ---------- what a folder shows ----------

  const extOf = (name) => (String(name).match(/\.([a-z0-9]{1,8})$/i)?.[1] || '').toLowerCase();
  const SHEETS = new Set(['csv', 'tsv', 'xlsx', 'xls', 'ods']);
  const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
  const THUMBS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
  const DOCS = new Set(['md', 'markdown', 'txt', 'docx', 'pdf', 'rst', 'odt', 'rtf']);
  // An entry's kind, for its icon: folder, lock (what botdot keeps), link, sheet, image, doc or file.
  function kindOf(e) {
    if (e.protected && e.type !== 'folder') return 'lock';
    if (e.type === 'folder') return e.protected && e.name !== 'uploads' ? 'lock' : 'folder';
    if (e.type === 'link') return 'link';
    const x = extOf(e.name);
    return SHEETS.has(x) ? 'sheet' : IMAGES.has(x) ? 'image' : DOCS.has(x) ? 'doc' : 'file';
  }
  const iconOf = (e) => `<span class="fx-ic fx-k-${kindOf(e)}">${I[kindOf(e)]}</span>`;
  const KB = (n) => (typeof fmtSize === 'function' ? fmtSize(n) : `${n} B`);
  // A folder's size is how many entries it holds.
  const sizeOf = (e) => (e.type === 'folder' ? (Number.isFinite(e.items) ? trn(e.items, '{n} item', '{n} items', { n: e.items.toLocaleString(I18n.locale || 'en') }) : '') : e.type === 'file' ? KB(e.size || 0) : '');
  // "Today 07:20", "Yesterday", "20 Oct"; on a phone "07:20" today.
  function whenOf(iso, short = false) {
    if (!iso) return '';
    const d = new Date(iso); const now = new Date();
    const time = d.toLocaleTimeString(I18n.locale || 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (d.toDateString() === now.toDateString()) return short ? time : tr('Today {time}', { time });
    if (d.toDateString() === new Date(now - 864e5).toDateString()) return tr('Yesterday');
    return d.toLocaleDateString(I18n.locale || 'en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }

  // The entries as shown: folders first, then the rest by name, newest first or largest first. Names that start with
  // a dot are listed too: a bot's .env or .gitignore is its owner's to open, change or delete.
  function sorted(entries, sort = 'name') {
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const by = {
      name: byName,
      date: (a, b) => String(b.at || '').localeCompare(String(a.at || '')) || byName(a, b),
      size: (a, b) => (b.type === 'folder' ? b.items || 0 : b.size || 0) - (a.type === 'folder' ? a.items || 0 : a.size || 0) || byName(a, b),
    }[sort] || byName;
    const folder = (e) => (e.type === 'folder' ? 0 : 1);
    return entries.slice().sort((a, b) => folder(a) - folder(b) || by(a, b));
  }

  // What can be done to an entry where it is: { open, rename, move, copy, download, keep, unpin, del }.
  function canDo(c, e) {
    // A search's hits are in every place: they are opened and downloaded there, and changed from their folder.
    if (c.results) return { open: e.type === 'folder' || e.type === 'file', rename: false, move: false, copy: false, download: e.type === 'file', keep: false, unpin: false, del: false };
    const kept = c.place.root === 'kept';
    const listing = c.data || {};
    const computer = c.place.root === 'computer' || c.place.root === 'project';
    const writes = !kept && !listing.readOnly && (computer || (!e.protected && e.type !== 'link'));
    const isFile = e.type === 'file';
    return {
      open: e.type === 'folder' || isFile,
      rename: writes && !e.keepsName && e.type !== 'link',
      move: writes && !e.keepsName && e.type !== 'link',
      copy: !kept && (e.type === 'folder' || isFile),
      download: isFile,
      keep: c.place.root === 'server' && isFile && !pinnedFile(c, e.path),
      unpin: isFile && pinnedFile(c, e.path),
      del: kept ? false : writes || (computer && e.type === 'link'),
    };
  }
  const pinnedFile = (c, p) => (c.place.root === 'server' || c.place.root === 'kept') && (c.kept || []).some((f) => f.pinned && f.file === p);

  // ---------- places ----------

  const isChief = (c) => !!c.bot.base;
  const hasComputer = (c) => c.bot.computer === 'linux';
  const mine = (c) => (c.projects || []).filter((p) => p.bots.includes(c.bot.id));
  const sameKey = (a, b) => a.root === b.root && (a.project || null) === (b.project || null);
  const placeKey = (p) => (p.root === 'project' ? `project:${p.project}` : p.root);
  function placeName(p) {
    if (p.root === 'server') return tr('On botdot');
    if (p.root === 'computer') return tr('Computer');
    if (p.root === 'kept') return tr('Kept in mind');
    return p.project;
  }
  const placeIcon = (p) => (p.root === 'server' ? I.server : p.root === 'computer' ? I.computer : p.root === 'kept' ? I.pin : I.project);
  // Every place of this bot, in the sidebar's order (Kept in mind is listed under the pins).
  function places(c) {
    return [{ root: 'server' }, ...(hasComputer(c) ? [{ root: 'computer' }] : []), ...mine(c).map((p) => ({ root: 'project', project: p.name }))];
  }

  // The breadcrumb: the place (or, on a phone, the bot), then each folder on the way.
  function crumbs(p, top) {
    const parts = p ? p.split('/') : [];
    return [{ name: top, path: '' }, ...parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))];
  }
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);

  // ---------- addresses ----------

  const base = (c) => `${c.bot.base || `/bots/${encodeURIComponent(c.bot.id)}`}/workspace`;
  const rootQuery = (p) => `?root=${p.root === 'kept' ? 'server' : p.root}${p.root === 'project' ? `&project=${encodeURIComponent(p.project)}` : ''}`;
  const at = (c, what, p, place = c.place) => `${base(c)}${what ? `/${what}` : ''}${rootQuery(place)}${p === null ? '' : `&path=${encodeURIComponent(p)}`}`;
  const filesBase = (c) => `${c.bot.base || `/bots/${encodeURIComponent(c.bot.id)}`}/files`;

  // Folders the owner pinned to the side, kept in this browser for this bot: [{ root, project?, path }].
  const pinKey = (c) => `botdot-files-pins:${c.bot.id}`;
  function readPins(c) { try { return JSON.parse(localStorage.getItem(pinKey(c)) || '[]').filter((x) => x && typeof x.path === 'string'); } catch { return []; } }
  function writePins(c) { try { localStorage.setItem(pinKey(c), JSON.stringify(c.pins)); } catch { /* this browser keeps none */ } }

  // ---------- drawing ----------

  const narrow = () => typeof matchMedia === 'function' && matchMedia(NARROW).matches;
  const box = () => (typeof document !== 'undefined' ? document.getElementById('files') : null);
  const visible = (c) => (c.results ? c.results : c.place.root === 'kept' ? keptEntries(c) : sorted(c.data?.entries || [], c.sort));
  function keptEntries(c) {
    return (c.kept || []).filter((f) => f.pinned).map((f) => ({ name: f.name, path: f.file, type: 'file', size: f.size, at: f.at }));
  }

  function topHTML(c) {
    const bot = c.bot;
    const face = typeof botFigure === 'function' && !isChief(c) ? botFigure(bot.color, bot.state, 'sm', bot.outfit) : typeof chiefFigure === 'function' && isChief(c) ? chiefFigure('sm') : '';
    const trail = crumbs(c.path, placeName(c.place));
    const crumb = c.results ? `<b>${tr('Search')}</b>` : trail.map((x, i) => (i === trail.length - 1 ? `<b>${esc(x.name)}</b>` : `<button type="button" class="fx-crumb" data-fx="go" data-path="${esc(x.path)}">${esc(x.name)}</button><span class="fx-sep">/</span>`)).join('');
    const search = c.searches ? `<label class="fx-search">${I.search}<input type="search" data-fx-search placeholder="${tr('Search in {name}', { name: esc(bot.name) })}" aria-label="${tr('Search in {name}', { name: esc(bot.name) })}" value="${esc(c.query)}"></label>` : '';
    return `<header class="fx-top">
      <button type="button" class="icon-btn" data-fx="close" aria-label="${tr('Back to the chat')}" title="${tr('Back to the chat')}">${I.back}</button>
      <div class="fx-who"><span class="fx-face">${face}</span><b>${esc(bot.name)}</b></div>
      <button type="button" class="icon-btn" data-fx="hist-back" aria-label="${tr('Back')}" title="${tr('Back')}"${c.back.length ? '' : ' disabled'}>${I.back}</button>
      <button type="button" class="icon-btn" data-fx="hist-fwd" aria-label="${tr('Forward')}" title="${tr('Forward')}"${c.fwd.length ? '' : ' disabled'}>${I.fwd}</button>
      <nav class="fx-trail" aria-label="${tr('Folder')}">${crumb}</nav>
      ${search}
    </header>`;
  }

  function sideHTML(c) {
    const row = (p, extra = '') => {
      const on = !c.results && sameKey(p, c.place) && (p.path === undefined ? true : c.path === p.path);
      return `<button type="button" class="fx-place${on && p.path === undefined ? ' on' : ''}" data-fx="place" data-root="${p.root}"${p.project ? ` data-project="${esc(p.project)}"` : ''} data-drop-place="${esc(placeKey(p))}">${placeIcon(p)}<span>${esc(placeName(p))}</span>${extra}</button>`;
    };
    const dot = hasComputer(c) ? `<i class="fx-dot${state.computers?.[c.bot.id] === 'running' ? ' on' : ''}"></i>` : '';
    const kept = (c.kept || []).filter((f) => f.pinned).length;
    const projects = !isChief(c) && hasComputer(c) && (state.features || []).includes('projects')
      ? `<div class="fx-head">${tr('Projects')}</div>${mine(c).map((p) => row({ root: 'project', project: p.name })).join('')}<button type="button" class="fx-place" data-fx="new-project">${I.plus}<span>${tr('New project')}</span></button>` : '';
    const pins = c.pins.map((p, i) => `<button type="button" class="fx-place" data-fx="pinned" data-i="${i}" data-drop-pin="${i}">${I.folder.replace('<svg', '<svg class="fx-folder"')}<span>${esc(nameOf(p.path))}</span></button>`).join('');
    return `<aside class="fx-side">
      ${row({ root: 'server' })}
      ${hasComputer(c) ? row({ root: 'computer' }, dot) : ''}
      ${projects}
      <div class="fx-head">${tr('Pinned')}</div>
      <button type="button" class="fx-place${c.place.root === 'kept' && !c.results ? ' on' : ''}" data-fx="place" data-root="kept">${I.pin.replace('<svg', '<svg class="fx-pin"')}<span>${tr('Kept in mind')}</span>${kept ? `<span class="fx-count">${kept}</span>` : ''}</button>
      ${pins}
    </aside>`;
  }

  function barHTML(c) {
    const writes = writesHere(c);
    const sort = { name: tr('Name'), date: tr('Date'), size: tr('Size') }[c.sort];
    return `<div class="fx-bar">
      ${writes ? `<button type="button" class="btn primary" data-fx="upload">${I.upload}${tr('Upload')}</button><button type="button" class="btn" data-fx="new-folder">${I.plus}${tr('New folder')}</button>` : ''}
      ${c.busy ? `<span class="faint fx-busy">${esc(c.busy)}</span>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn" data-fx="sort" aria-label="${tr('Sort by {sort}', { sort })}">${I.sort}${sort}</button>
      <div class="fx-seg" role="group" aria-label="${tr('View')}"><button type="button" data-fx="view" data-show="list" class="${c.view === 'list' ? 'on' : ''}" aria-label="${tr('List')}" aria-pressed="${c.view === 'list'}">${I.list}</button><button type="button" data-fx="view" data-show="grid" class="${c.view === 'grid' ? 'on' : ''}" aria-label="${tr('Grid')}" aria-pressed="${c.view === 'grid'}">${I.grid}</button></div>
    </div>`;
  }
  const writesHere = (c) => !c.results && c.place.root !== 'kept' && !!c.data && !c.data.readOnly;

  function thumbHTML(c, e) {
    if (!THUMBS.has(extOf(e.name)) || e.type !== 'file') return `<span class="fx-card-ic">${iconOf(e)}</span>`;
    const place = e.place || c.place;
    return `<span class="fx-card-ic">${iconOf(e)}<img loading="lazy" alt="" src="/api${esc(at(c, 'thumb', e.path, place))}" onerror="this.remove()"></span>`;
  }

  function entryHTML(c, e, grid, phone) {
    const sel = c.sel.has(e.path);
    const box = `<span class="fx-check${sel ? ' on' : ''}" data-fx="check" role="checkbox" aria-checked="${sel}" aria-label="${tr('Select {name}', { name: esc(e.name) })}">${sel ? I.check : ''}</span>`;
    const where = e.place && c.results ? `<span class="fx-where">${esc([placeName(e.place), parentOf(e.path)].filter(Boolean).join(' / '))}</span>` : '';
    const drag = canDo(c, e).move ? ' draggable="true"' : '';
    const attrs = `data-path="${esc(e.path)}"${e.type === 'folder' ? ' data-folder="1"' : ''}${e.place ? ` data-place="${esc(placeKey(e.place))}"` : ''}${drag}`;
    if (grid) {
      return `<div class="fx-card${sel ? ' sel' : ''}${c.focus === e.path ? ' focus' : ''}" ${attrs}>${phone && !c.selecting ? '' : box}${thumbHTML(c, e)}<span class="fx-name">${esc(e.name)}</span><span class="fx-meta">${esc(sizeOf(e))}</span></div>`;
    }
    if (phone) {
      const meta = [sizeOf(e), whenOf(e.at, true)].filter(Boolean).join(' · ');
      return `<div class="fx-row${sel ? ' sel' : ''}" ${attrs}>${c.selecting ? box : ''}${iconOf(e)}<span class="fx-two"><span class="fx-name">${esc(e.name)}</span><span class="fx-meta">${esc(meta)}</span>${where}</span>${c.selecting ? '' : `<button type="button" class="icon-btn fx-more" data-fx="more" aria-label="${tr('More for {name}', { name: esc(e.name) })}">${I.more}</button>`}</div>`;
    }
    return `<div class="fx-row${sel ? ' sel' : ''}${c.focus === e.path ? ' focus' : ''}" ${attrs}>${box}${iconOf(e)}<span class="fx-name">${esc(e.name)}${where}</span><span class="fx-size">${esc(sizeOf(e))}</span><span class="fx-when">${esc(whenOf(e.at))}</span></div>`;
  }

  function listHTML(c, phone) {
    if (c.error) {
      const e = c.error;
      const body = e.state === 'computer-off'
        ? `<p class="muted">${tr('The computer is off.')}</p><button type="button" class="btn" data-fx="start">${tr('Start the computer')}</button>`
        : e.status === 404 ? `<p class="muted">${tr('This folder is gone.')}</p><button type="button" class="btn" data-fx="go" data-path="">${tr('Back to the top')}</button>`
          : `<p class="muted">${esc(e.message || tr("Couldn't load it."))}</p>`;
      return `<div class="fx-state">${body}</div>`;
    }
    if (!c.results && !c.data && c.place.root !== 'kept') return `<div class="fx-state faint">${tr('Loading…')}</div>`;
    const list = visible(c);
    if (!list.length) return `<div class="fx-state faint">${c.results ? tr('Nothing found.') : tr('Empty.')}</div>`;
    const grid = c.view === 'grid';
    const all = list.length && list.every((e) => c.sel.has(e.path));
    const head = grid || phone ? '' : `<div class="fx-row fx-heads"><span class="fx-check${all ? ' on' : ''}" data-fx="all" role="checkbox" aria-checked="${all}" aria-label="${tr('Select all')}">${all ? I.check : ''}</span><span class="fx-name">${tr('Name')}</span><span class="fx-size">${tr('Size')}</span><span class="fx-when">${tr('Changed')}</span></div>`;
    const more = c.data?.more && !c.results ? `<div class="fx-state faint">${trn(c.data.more, '{n} more not listed.', '{n} more not listed.', { n: c.data.more.toLocaleString(I18n.locale || 'en') })}</div>` : '';
    return `${head}<div class="${grid ? 'fx-grid' : 'fx-rows'}">${list.map((e) => entryHTML(c, e, grid, phone)).join('')}</div>${more}`;
  }

  // The floating bar of a selection of several: N selected · Move to… · Copy to… · Download · Delete · ✕.
  function selBarHTML(c, phone) {
    const chosen = selected(c);
    if (phone ? !c.selecting : chosen.length < 2) return '';
    const can = (k) => chosen.length && chosen.every((e) => canDo(c, e)[k]);
    if (phone) {
      const b = (k, what, icon, label, cls = '') => `<button type="button" class="fx-act${cls}" data-fx="${what}"${can(k) ? '' : ' disabled'}>${icon}<span>${label}</span></button>`;
      return `<nav class="fx-selbar">${b('move', 'move-to', I.move, tr('Move'))}${b('copy', 'copy-to', I.file, tr('Copy'))}${b('download', 'download', I.down, tr('Download'))}${b('del', 'delete', I.trash, tr('Delete'), ' danger')}</nav>`;
    }
    const b = (k, what, label, cls = '') => (can(k) ? `<button type="button" class="btn${cls}" data-fx="${what}">${label}</button>` : '');
    return `<div class="fx-float"><b>${trn(chosen.length, '{n} selected', '{n} selected')}</b>${b('move', 'move-to', tr('Move to…'))}${b('copy', 'copy-to', tr('Copy to…'))}${b('download', 'download', tr('Download'))}${b('del', 'delete', tr('Delete'), ' danger')}<button type="button" class="icon-btn" data-fx="clear" aria-label="${tr('Clear the selection')}">${I.close}</button></div>`;
  }
  const selected = (c) => visible(c).filter((e) => c.sel.has(e.path));

  // The preview of the one selected file, beside the list in a wide window.
  function previewHTML(c) {
    const e = selected(c).length === 1 ? selected(c)[0] : null;
    if (!e || e.type !== 'file') return '';
    const p = c.preview?.path === e.path ? c.preview : null;
    let body = `<p class="faint">${tr('Loading…')}</p>`;
    if (p?.error) body = `<p class="muted">${esc(p.error.state === 'computer-off' ? tr('The computer is off.') : p.error.message || tr("Couldn't open it."))}</p>`;
    else if (p?.view) {
      const v = p.view;
      if (v.kind === 'image') body = `<img class="fx-pv-img" src="/api${esc(at(c, 'file', e.path, e.place || c.place))}" alt="${esc(e.name)}">`;
      else if (v.kind === 'markdown') body = `<article class="md">${typeof md === 'function' ? md(v.text || '') : esc(v.text || '')}</article>`;
      else if (v.kind === 'csv' && typeof DocViewer !== 'undefined') {
        const t = DocViewer.tableOf(v.text || '', /\.tsv$/i.test(e.name) ? '\t' : ',');
        body = `<div class="fx-pv-table"><table><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.slice(0, 50).map((r) => `<tr>${r.cells.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      } else if (v.kind === 'text' || v.kind === 'csv') body = `<pre class="fx-pv-text">${esc(String(v.text || '').slice(0, 20000))}</pre>`;
      else body = `<p class="faint">${tr('No preview for this kind of file.')}</p>`;
    }
    const place = e.place || c.place;
    return `<aside class="fx-pv">
      <div class="fx-pv-head">${iconOf(e)}<b>${esc(e.name)}</b><button type="button" class="icon-btn" data-fx="clear" aria-label="${tr('Close')}">${I.close}</button></div>
      <div class="fx-pv-body">${body}</div>
      <dl class="fx-pv-facts"><dt>${tr('Size')}</dt><dd>${esc(KB(e.size || 0))}</dd><dt>${tr('Changed')}</dt><dd>${esc(whenOf(e.at))}</dd><dt>${tr('Where')}</dt><dd>${esc([placeName(place), parentOf(e.path)].filter(Boolean).join(' / '))}</dd></dl>
    </aside>`;
  }

  // The right-click menu of an entry, or of the selection it is in.
  function menuHTML(c) {
    const m = c.menu;
    if (!m) return '';
    const spot = `style="left:${Math.round(m.x)}px;top:${Math.round(m.y)}px"`;
    // A shared project's own (#578): its bots, and its delete.
    if (m.project) return `<div class="fx-menu" role="menu" ${spot}><button type="button" role="menuitem" class="fx-mi" data-fx="members">${tr('Bots…')}</button><hr><button type="button" role="menuitem" class="fx-mi danger" data-fx="delete-project">${tr('Delete project')}</button></div>`;
    const e = visible(c).find((x) => x.path === m.path);
    if (!e) return '';
    const can = canDo(c, e);
    const key = (k) => `<kbd>${k}</kbd>`;
    const item = (ok, what, label, k = '', cls = '') => (ok ? `<button type="button" role="menuitem" class="fx-mi${cls}" data-fx="${what}">${label}${k ? key(k) : ''}</button>` : '');
    const folderPin = e.type === 'folder' && c.place.root !== 'kept' ? item(true, 'pin-folder', c.pins.some((p) => sameKey(p, c.place) && p.path === e.path) ? tr('Unpin') : tr('Pin to the side')) : '';
    return `<div class="fx-menu" role="menu" ${spot}>
      ${item(can.open, 'open', tr('Open'), 'Enter')}${item(can.rename, 'rename', tr('Rename'), 'F2')}${item(can.move, 'move-to', tr('Move to…'))}${item(can.copy, 'copy-to', tr('Copy to…'))}${item(can.download, 'download', tr('Download'))}${item(can.keep, 'keep', tr('Keep in mind'))}${item(can.unpin, 'unpin', tr('Unpin'))}${folderPin}
      ${can.del ? `<hr>${item(true, 'delete', tr('Delete'), 'Del', ' danger')}` : ''}
    </div>`;
  }

  // A phone's bottom sheets: the places, an entry's actions, the + button's, and the sort.
  function sheetHTML(c) {
    const s = c.sheet;
    if (!s) return '';
    const row = (what, icon, label, extra = '', cls = '') => `<button type="button" class="fx-sheet-row${cls}" data-fx="${what}"${extra}>${icon}<span>${label}</span></button>`;
    let body = '';
    if (s.kind === 'places') {
      body = [...places(c), { root: 'kept' }].map((p) => `<button type="button" class="fx-sheet-row" data-fx="place" data-root="${p.root}"${p.project ? ` data-project="${esc(p.project)}"` : ''}>${placeIcon(p)}<span>${esc(placeName(p))}</span>${sameKey(p, c.place) ? I.check : ''}</button>`).join('');
    } else if (s.kind === 'entry') {
      const e = visible(c).find((x) => x.path === s.path);
      if (!e) return '';
      const can = canDo(c, e);
      const meta = [sizeOf(e), whenOf(e.at, true)].filter(Boolean).join(' · ');
      body = `<div class="fx-sheet-title">${iconOf(e)}<span class="fx-two"><b>${esc(e.name)}</b><span class="fx-meta">${esc(meta)}</span></span></div>
        ${can.open ? row('open', I.file, tr('Open')) : ''}${can.rename ? row('rename', I.edit, tr('Rename')) : ''}${can.move ? row('move-to', I.move, tr('Move to…')) : ''}${can.copy ? row('copy-to', I.file, tr('Copy to…')) : ''}${can.download ? row('download', I.down, tr('Download')) : ''}${can.keep ? row('keep', I.pin, tr('Keep in mind')) : ''}${can.unpin ? row('unpin', I.pin, tr('Unpin')) : ''}${can.del ? row('delete', I.trash, tr('Delete'), '', ' danger') : ''}`;
    } else if (s.kind === 'add') {
      body = `${row('upload', I.upload, tr('Upload files'))}${row('upload-folder', I.folder, tr('Upload folder'))}${row('new-folder', I.plus, tr('New folder'))}`;
    } else if (s.kind === 'sort') {
      body = [['name', tr('Name')], ['date', tr('Date')], ['size', tr('Size')]].map(([k, label]) => `<button type="button" class="fx-sheet-row" data-fx="sort-by" data-sort="${k}"><span>${label}</span>${c.sort === k ? I.check : ''}</button>`).join('');
    }
    return `<div class="fx-scrim" data-fx="sheet-close"></div><div class="fx-sheet" role="dialog"><i class="fx-grip"></i>${body}</div>`;
  }

  // A project's bots: any bot on the account's computer.
  function membersHTML(c, d) {
    const p = (c.projects || []).find((x) => x.name === d.project);
    if (!p) return '';
    const all = (state.bots || []).filter((b) => b.computer === 'linux');
    return `<div class="fx-scrim" data-fx="dialog-close"></div><div class="fx-dialog" role="dialog" aria-label="${tr('Bots in {name}', { name: esc(p.name) })}">
      <h3>${esc(p.name)}</h3>
      <div class="fx-tree">${all.map((b) => `<label class="fx-node"><input type="checkbox" data-fx-member="${esc(b.id)}"${p.bots.includes(b.id) ? ' checked' : ''}><span>${esc(b.name)}</span></label>`).join('')}</div>
      <div class="fx-dialog-acts"><span class="grow"></span><button type="button" class="btn" data-fx="dialog-close">${tr('Cancel')}</button><button type="button" class="btn primary" data-fx="members-save">${tr('Save')}</button></div>
    </div>`;
  }

  // Move to… / Copy to…: a tree of every folder of every place, opened one level at a time.
  function dialogHTML(c) {
    const d = c.dialog;
    if (!d) return '';
    if (d.mode === 'members') return membersHTML(c, d);
    const off = (p, path) => d.mode === 'move' && sameKey(p, c.place) && path === c.path;
    const inside = (p, path) => sameKey(p, d.from) && d.items.some((e) => e.type === 'folder' && (path === e.path || path.startsWith(`${e.path}/`)));
    const node = (p, path, name, depth, icon) => {
      const k = `${placeKey(p)}|${path}`;
      const kids = d.open[k];
      const disabled = off(p, path) || inside(p, path);
      const on = d.to && sameKey(d.to, p) && d.to.path === path;
      const head = `<button type="button" class="fx-node${on ? ' on' : ''}" style="padding-left:${12 + depth * 22}px" data-fx="pick" data-key="${esc(k)}"${disabled ? ' disabled' : ''}>${icon}<span>${esc(name)}</span></button>`;
      const inner = Array.isArray(kids) ? kids.map((f) => node(p, f.path, f.name, depth + 1, I.folder.replace('<svg', '<svg class="fx-folder"'))).join('') : '';
      return head + inner;
    };
    const tree = places(c).map((p) => node(p, '', placeName(p), 0, placeIcon(p))).join('');
    const n = d.items.length;
    const what = n === 1 ? d.items[0].name : trn(n, '{n} item', '{n} items');
    const title = d.mode === 'move' ? tr('Move {what}', { what }) : tr('Copy {what}', { what });
    return `<div class="fx-scrim" data-fx="dialog-close"></div><div class="fx-dialog" role="dialog" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <div class="fx-tree">${tree}</div>
      <div class="fx-dialog-acts"><button type="button" class="btn" data-fx="dialog-folder"${d.to ? '' : ' disabled'}>${tr('New folder')}</button><span class="grow"></span><button type="button" class="btn" data-fx="dialog-close">${tr('Cancel')}</button><button type="button" class="btn primary" data-fx="dialog-go"${d.to && !d.busy ? '' : ' disabled'}>${d.mode === 'move' ? tr('Move here') : tr('Copy here')}</button></div>
    </div>`;
  }

  function phoneTopHTML(c) {
    if (c.selecting) {
      return `<header class="fx-ptop"><button type="button" class="icon-btn" data-fx="clear" aria-label="${tr('Stop selecting')}">${I.close}</button><b class="fx-ptitle">${trn(c.sel.size, '{n} selected', '{n} selected')}</b><span class="grow"></span><button type="button" class="btn" data-fx="all">${tr('All')}</button></header>`;
    }
    const title = c.results ? tr('Search') : c.path ? nameOf(c.path) : placeName(c.place);
    return `<header class="fx-ptop">
      <button type="button" class="icon-btn" data-fx="close" aria-label="${tr('Back to the chat')}">${I.back}</button>
      <div class="fx-ptitle"><b>${esc(title)}</b><button type="button" class="fx-pplace" data-fx="places">${esc(placeName(c.place))} ▾</button></div>
      <span class="grow"></span>
      <button type="button" class="icon-btn" data-fx="sort-sheet" aria-label="${tr('Sort')}">${I.sort}</button>
      <button type="button" class="icon-btn" data-fx="view" data-show="${c.view === 'grid' ? 'list' : 'grid'}" aria-label="${c.view === 'grid' ? tr('List') : tr('Grid')}">${c.view === 'grid' ? I.list : I.grid}</button>
    </header>`;
  }

  function html(c) {
    const phone = narrow();
    if (phone) {
      const trail = crumbs(c.path, c.bot.name);
      const crumb = c.results || c.place.root === 'kept' ? '' : `<nav class="fx-trail" aria-label="${tr('Folder')}">${trail.map((x, i) => (i === trail.length - 1 ? `<b>${esc(x.name)}</b>` : `<button type="button" class="fx-crumb" data-fx="go" data-path="${esc(x.path)}">${esc(x.name)}</button><span class="fx-sep">/</span>`)).join('')}</nav>`;
      const search = c.searches && !c.selecting ? `<label class="fx-search">${I.search}<input type="search" data-fx-search placeholder="${tr('Search')}" aria-label="${tr('Search')}" value="${esc(c.query)}"></label>` : '';
      const fab = writesHere(c) && !c.selecting ? `<button type="button" class="fx-fab" data-fx="add" aria-label="${tr('Add')}">${I.plus}</button>` : '';
      return `<div class="fx-phone">${phoneTopHTML(c)}${search}${crumb}<div class="fx-main" data-drop-main>${listHTML(c, true)}</div>${fab}${selBarHTML(c, true)}${sheetHTML(c)}${dialogHTML(c)}</div>${inputsHTML()}`;
    }
    const drop = c.drop ? `<div class="fx-drop">${I.upload}<span>${tr('Drop to upload into {name}', { name: esc(c.path ? nameOf(c.path) : placeName(c.place)) })}</span></div>` : '';
    return `${topHTML(c)}<div class="fx-body">${sideHTML(c)}<section class="fx-main" data-drop-main>${barHTML(c)}<div class="fx-list">${listHTML(c, false)}</div>${drop}${selBarHTML(c, false)}</section>${previewHTML(c)}</div>${menuHTML(c)}${dialogHTML(c)}${inputsHTML()}`;
  }
  const inputsHTML = () => '<input type="file" multiple hidden data-fx-files><input type="file" webkitdirectory hidden data-fx-folder>';

  function draw(c = cur) {
    const el = box();
    if (!el || c !== cur) return;
    const focused = document.activeElement?.matches?.('[data-fx-search]') ? document.activeElement.selectionStart : null;
    const scroll = el.querySelector('.fx-list, .fx-main')?.scrollTop || 0;
    el.innerHTML = html(c);
    const list = el.querySelector('.fx-list, .fx-main');
    if (list) list.scrollTop = scroll;
    if (focused !== null) { const s = el.querySelector('[data-fx-search]'); if (s) { s.focus(); s.setSelectionRange(focused, focused); } }
  }

  // ---------- loading ----------

  // Only the answer of the last folder asked for is drawn: an older, slower one is dropped.
  async function load(c = cur) {
    const seq = (c.seq = (c.seq || 0) + 1);
    c.data = null; c.error = null; c.sel = new Set(); c.focus = null; c.preview = null; c.menu = null;
    draw(c);
    if (c.place.root === 'kept') { await loadKept(c); if (c.seq === seq) draw(c); return; }
    let data = null; let error = null;
    try { data = await api(at(c, '', c.path)); } catch (e) { error = e; }
    if (c.seq !== seq) return;
    c.data = data; c.error = error;
    draw(c);
  }
  async function loadKept(c) {
    try { c.kept = (await api(filesBase(c))).files || []; } catch { c.kept = c.kept || []; }
  }
  async function loadProjects(c) {
    if (isChief(c) || !hasComputer(c) || !(state.features || []).includes('projects')) return;
    try { c.projects = (await api('/projects')).projects || []; } catch { c.projects = []; }
  }
  // The selected file's preview (#251's view of it), fetched once it is the one selected.
  async function loadPreview(c, e) {
    if (narrow() || !e || e.type !== 'file' || c.preview?.path === e.path) return;
    c.preview = { path: e.path };
    let view = null; let error = null;
    try { view = await api(`${at(c, 'file', e.path, e.place || c.place)}&view=1`); } catch (err) { error = err; }
    if (c.preview?.path !== e.path) return;
    c.preview = { path: e.path, view, error };
    draw(c);
  }

  function go(c, place, p, { record = true } = {}) {
    if (record) { c.back.push({ place: c.place, path: c.path }); c.fwd = []; }
    c.place = place; c.path = p; c.results = null; c.query = ''; c.selecting = false; c.sheet = null;
    return load(c);
  }

  // ---------- uploads ----------

  async function sendFile(c, dir, file, made = false) {
    const r = await fetch(`/api${at(c, 'upload', dir)}${made ? '&folders=1' : ''}`, { method: 'POST', headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || tr('Upload failed ({status})', { status: r.status }));
  }
  async function upload(c, files) {
    if (files.length > MAX_FILES) toast(tr('Upload at most {n} files at a time.', { n: MAX_FILES }), true);
    const list = [...files].slice(0, MAX_FILES);
    for (const [i, file] of list.entries()) {
      c.busy = tr('Uploading {i} of {n}', { i: i + 1, n: list.length }); draw(c);
      if (file.size > MAX_BYTES) { toast(tr('{name} is over 25 MB.', { name: file.name }), true); continue; }
      try { await sendFile(c, c.path, file); } catch (e) { toast(`${file.name}: ${e.message}`, true); }
    }
    c.busy = null;
    return load(c);
  }
  // Where each file of a folder goes: its folder inside the folder made for it ("site/css/a.css" into "site (2)" goes
  // to "site (2)/css"). `rel` is its path from the picked folder's parent, as webkitRelativePath.
  function folderPlan(files, into) {
    return files.map(({ file, rel }) => ({ file, dir: [into, ...String(rel || file.webkitRelativePath || file.name).split('/').slice(1, -1)].filter(Boolean).join('/') }));
  }
  // A whole folder: its top made first under a free name, then its files one by one, its tree made as they come.
  async function uploadFolder(c, items) {
    if (!items.length) return undefined;
    const top = String(items[0].rel || items[0].file.webkitRelativePath || '').split('/')[0] || 'folder';
    if (items.length > MAX_FOLDER_FILES) return toast(tr('{name} has {n} files: upload at most {max} at a time.', { name: top, n: items.length.toLocaleString(I18n.locale || 'en'), max: MAX_FOLDER_FILES.toLocaleString(I18n.locale || 'en') }), true);
    let made;
    try { made = await api(at(c, 'folder', null), { method: 'POST', body: { path: c.path, name: top, free: true } }); } catch (e) { return toast(e.message, true); }
    let failed = 0;
    const plan = folderPlan(items, made.path);
    for (const [i, { file, dir }] of plan.entries()) {
      c.busy = tr('Uploading {name}: {i} of {n}', { name: top, i: i + 1, n: plan.length }); draw(c);
      if (file.size > MAX_BYTES) { failed++; continue; }
      try { await sendFile(c, dir, file, true); } catch { failed++; }
    }
    c.busy = null;
    toast(failed ? trn(plan.length, "{name}: {failed} of {n} file didn't upload.", "{name}: {failed} of {n} files didn't upload.", { name: top, failed }) : tr('Uploaded {name}', { name: top }), !!failed);
    return load(c);
  }
  // What was dropped from the desktop: files, and folders read with what they hold.
  async function dropped(c, dt) {
    const entries = [...(dt.items || [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return upload(c, [...(dt.files || [])]);
    const files = entries.filter((e) => e.isFile);
    const folders = entries.filter((e) => e.isDirectory);
    if (files.length) await upload(c, await Promise.all(files.map((e) => new Promise((ok, no) => e.file(ok, no)))));
    for (const f of folders) {
      const items = [];
      const walk = async (dir, at) => {
        const reader = dir.createReader();
        for (;;) {
          const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
          if (!batch.length) break;
          for (const x of batch) {
            if (x.isFile) items.push({ file: await new Promise((ok, no) => x.file(ok, no)), rel: `${at}/${x.name}` });
            else if (x.isDirectory) await walk(x, `${at}/${x.name}`);
            if (items.length > MAX_FOLDER_FILES) return;
          }
        }
      };
      await walk(f, f.name);
      if (!items.length) { try { await api(at(c, 'folder', null), { method: 'POST', body: { path: c.path, name: f.name, free: true } }); } catch (e) { toast(e.message, true); } continue; }
      await uploadFolder(c, items);
    }
    return load(c);
  }

  // ---------- actions ----------

  // `project`: the words of a shared project's delete, which holds as a folder does.
  function deleteWords(e, n, project = false) {
    if (n.type !== 'folder') return tr("Delete {name}? This can't be undone.", { name: e.name });
    if (n.files + n.folders === 0) return project ? tr("Delete the project {name}? It is empty. This can't be undone.", { name: e.name }) : tr("Delete the folder {name}? It is empty. This can't be undone.", { name: e.name });
    const files = n.files ? trn(n.files, '{n} file', '{n} files', { n: n.files.toLocaleString(I18n.locale || 'en') }) : '';
    const folders = n.folders ? trn(n.folders, '{n} folder', '{n} folders', { n: n.folders.toLocaleString(I18n.locale || 'en') }) : '';
    const what = files && folders ? tr('{files} and {folders}', { files, folders }) : files || folders;
    if (project) {
      return n.capped ? tr("Delete the project {name}? It holds more than {what}, which go with it. This can't be undone.", { name: e.name, what })
        : tr("Delete the project {name}? It holds {what}, which go with it. This can't be undone.", { name: e.name, what });
    }
    return n.capped ? tr("Delete the folder {name}? It holds more than {what}, which go with it. This can't be undone.", { name: e.name, what })
      : tr("Delete the folder {name}? It holds {what}, which go with it. This can't be undone.", { name: e.name, what });
  }

  // The entries an action is for: the selection when the entry is in it, else the entry alone.
  function targets(c, path) {
    if (path && !c.sel.has(path)) return visible(c).filter((e) => e.path === path);
    return selected(c);
  }

  function openEntry(c, e) {
    if (e.type === 'folder') {
      if (e.place && !sameKey(e.place, c.place)) return go(c, e.place, e.path);
      return go(c, c.results ? e.place || c.place : c.place, e.path);
    }
    if (e.type !== 'file') return undefined;
    const place = e.place || (c.place.root === 'kept' ? { root: 'server' } : c.place);
    const src = at(c, 'file', e.path, place);
    if (typeof DocViewer !== 'undefined' && (state.features || []).includes('document-viewer')) return DocViewer.open({ src, name: e.name, from: c.bot.name, bot: place.root === 'server' ? '' : c.bot.id });
    return window.open(`/api${src}`, '_blank', 'noopener');
  }

  function download(c, list) {
    for (const e of list.filter((x) => x.type === 'file')) {
      const a = document.createElement('a');
      a.href = `/api${at(c, 'file', e.path, e.place || (c.place.root === 'kept' ? { root: 'server' } : c.place))}`;
      a.download = e.name;
      document.body.appendChild(a); a.click(); a.remove();
    }
  }

  async function remove(c, list) {
    if (!list.length) return undefined;
    if (list.length === 1) {
      let n;
      try { n = await api(at(c, 'count', list[0].path)); } catch (err) { return toast(err.message, true); }
      if (!confirm(deleteWords(list[0], n))) return undefined;
    } else if (!confirm(trn(list.length, "Delete {n} item? Folders go with what they hold. This can't be undone.", "Delete {n} items? Folders go with what they hold. This can't be undone."))) return undefined;
    let failed = 0;
    for (const e of list) { try { await api(at(c, '', e.path), { method: 'DELETE' }); } catch (err) { failed++; toast(`${e.name}: ${err.message}`, true); } }
    if (!failed) toast(list.length === 1 ? tr('Deleted {name}', { name: list[0].name }) : trn(list.length, 'Deleted {n} item', 'Deleted {n} items'));
    return load(c);
  }

  async function rename(c, e) {
    const name = prompt(tr('New name for {name}', { name: e.name }), e.name);
    if (name === null || !name.trim() || name.trim() === e.name) return undefined;
    if (name.includes('/')) return toast(tr("A name can't have / in it. To put it in another folder, use Move to."), true);
    const to = parentOf(e.path) ? `${parentOf(e.path)}/${name.trim()}` : name.trim();
    try { await api(at(c, 'move', null), { method: 'POST', body: { from: e.path, to } }); } catch (err) { return toast(err.message, true); }
    return load(c);
  }

  async function newFolder(c, place = c.place, dir = c.path) {
    const name = prompt(tr('Name of the new folder'));
    if (!name?.trim()) return null;
    try { return (await api(at(c, 'folder', null, place), { method: 'POST', body: { path: dir, name: name.trim() } })).path; } catch (e) { toast(e.message, true); return null; }
  }

  async function keep(c, e, pinned) {
    try {
      if (pinned) await api(`${base(c)}/keep`, { method: 'POST', body: { path: e.path } });
      else await api(`${filesBase(c)}/${encodeURIComponent(nameOf(e.path))}`, { method: 'PUT', body: { pinned: false } });
    } catch (err) { return toast(err.message, true); }
    toast(pinned ? tr('Keeping {name} in mind', { name: e.name }) : tr('{name} is no longer kept in mind', { name: e.name }));
    await loadKept(c);
    return c.place.root === 'kept' ? draw(c) : load(c);
  }

  // Move or copy every one of `items` (from `from`, a place) into folder `to` ({ root, project?, path }).
  async function carry(c, mode, items, from, to) {
    let failed = 0;
    for (const e of items) {
      const body = { from: e.path, into: to.path, ...(sameKey(from, to) ? {} : { place: { root: to.root, ...(to.project ? { project: to.project } : {}) } }) };
      try { await api(at(c, mode, null, from), { method: 'POST', body }); } catch (err) { failed++; toast(`${e.name}: ${err.message}`, true); }
    }
    const where = [placeName(to), to.path ? nameOf(to.path) : ''].filter(Boolean).join(' / ');
    if (!failed) {
      const what = items.length === 1 ? items[0].name : trn(items.length, '{n} item', '{n} items');
      toast(mode === 'move' ? tr('Moved {what} to {where}', { what, where }) : tr('Copied {what} to {where}', { what, where }));
    }
    return load(c);
  }

  async function openDialog(c, mode, list) {
    if (!list.length) return;
    const from = list[0].place || c.place;
    c.menu = null; c.sheet = null;
    c.dialog = { mode, items: list, from, open: {}, to: null };
    draw(c);
    await expand(c, places(c).find((p) => sameKey(p, from.root === 'kept' ? { root: 'server' } : from)) || { root: 'server' }, '');
  }
  async function expand(c, place, p) {
    const d = c.dialog;
    if (!d) return;
    const k = `${placeKey(place)}|${p}`;
    if (Array.isArray(d.open[k])) { delete d.open[k]; return draw(c); }
    try {
      const r = await api(at(c, '', p, place));
      d.open[k] = sorted(r.entries || []).filter((e) => e.type === 'folder' && !e.protected);
    } catch { d.open[k] = []; }
    return draw(c);
  }
  const keyPlace = (k) => {
    const [pk, ...rest] = k.split('|');
    const place = pk.startsWith('project:') ? { root: 'project', project: pk.slice(8) } : { root: pk };
    return { place, path: rest.join('|') };
  };

  // Select by a click: alone, toggled (Ctrl or Cmd), or a range from the last one clicked (Shift).
  function rangeSelect(paths, sel, anchor, target, { toggle = false, range = false } = {}) {
    const next = new Set(toggle || range ? sel : []);
    if (range && anchor && paths.includes(anchor)) {
      const [a, b] = [paths.indexOf(anchor), paths.indexOf(target)].sort((x, y) => x - y);
      for (const p of paths.slice(a, b + 1)) next.add(p);
    } else if (toggle && next.has(target)) next.delete(target);
    else next.add(target);
    return next;
  }

  function pick(c, path, how = {}) {
    c.sel = rangeSelect(visible(c).map((e) => e.path), c.sel, c.anchor, path, how);
    if (!how.range) c.anchor = path;
    c.focus = path;
    c.menu = null;
    draw(c);
    if (c.sel.size === 1) loadPreview(c, visible(c).find((e) => e.path === path));
  }

  async function act(el, ev) {
    const c = cur;
    if (!c) return undefined;
    const what = el.dataset.fx;
    const row = el.closest?.('[data-path]');
    const entry = row ? visible(c).find((e) => e.path === row.dataset.path) : null;
    const menuFor = c.menu?.path || c.sheet?.path || null;
    const list = () => targets(c, menuFor || entry?.path || null);
    if (what !== 'more') { c.menu = null; if (!['sort-by'].includes(what)) c.sheet = null; }
    switch (what) {
      case 'close': return close();
      case 'go': return go(c, c.place, el.dataset.path || '');
      case 'hist-back': case 'hist-fwd': {
        const [from, to] = what === 'hist-back' ? [c.back, c.fwd] : [c.fwd, c.back];
        const step = from.pop();
        if (!step) return undefined;
        to.push({ place: c.place, path: c.path });
        return go(c, step.place, step.path, { record: false });
      }
      case 'place': {
        const p = el.dataset.root === 'project' ? { root: 'project', project: el.dataset.project } : { root: el.dataset.root };
        return go(c, p, '');
      }
      case 'pinned': { const p = c.pins[Number(el.dataset.i)]; return p ? go(c, { root: p.root, ...(p.project ? { project: p.project } : {}) }, p.path) : undefined; }
      case 'places': c.sheet = { kind: 'places' }; return draw(c);
      case 'sort-sheet': c.sheet = { kind: 'sort' }; return draw(c);
      case 'add': c.sheet = { kind: 'add' }; return draw(c);
      case 'sheet-close': case 'dialog-close': c.sheet = null; c.dialog = null; return draw(c);
      case 'sort': c.sort = { name: 'date', date: 'size', size: 'name' }[c.sort]; return draw(c);
      case 'sort-by': c.sort = el.dataset.sort; c.sheet = null; return draw(c);
      case 'view': c.view = el.dataset.show; try { localStorage.setItem('botdot-files-view', c.view); } catch { /* none kept */ } return draw(c);
      case 'check': if (entry) { c.sel = rangeSelect(visible(c).map((e) => e.path), c.sel, c.anchor, entry.path, { toggle: true, range: ev?.shiftKey }); c.anchor = entry.path; draw(c); if (c.sel.size === 1) loadPreview(c, selected(c)[0]); } return undefined;
      case 'all': {
        const all = visible(c);
        c.sel = all.every((e) => c.sel.has(e.path)) && !c.selecting ? new Set() : new Set(all.map((e) => e.path));
        return draw(c);
      }
      case 'clear': c.sel = new Set(); c.selecting = false; c.preview = null; return draw(c);
      case 'more': if (entry) { c.sheet = { kind: 'entry', path: entry.path }; draw(c); } return undefined;
      case 'start':
        el.disabled = true;
        try { await api(`/bots/${encodeURIComponent(c.bot.id)}/computer`, { method: 'POST', body: { action: 'start' } }); } catch (e) { toast(e.message, true); }
        return cur === c ? load(c) : undefined;
      case 'upload': return box()?.querySelector('[data-fx-files]')?.click();
      case 'upload-folder': return box()?.querySelector('[data-fx-folder]')?.click();
      case 'new-folder': { if (await newFolder(c)) return load(c); return draw(c); }
      case 'new-project': {
        const name = prompt(tr('Name of the new project'));
        if (!name?.trim()) return undefined;
        let made;
        try { made = await api('/projects', { method: 'POST', body: { name: name.trim(), bots: [c.bot.id] } }); } catch (e) { return toast(e.message, true); }
        await loadProjects(c);
        return go(c, { root: 'project', project: made.name }, '');
      }
      case 'open': { const e = list()[0]; return e ? openEntry(c, e) : undefined; }
      case 'rename': { const e = list()[0]; return e ? rename(c, e) : undefined; }
      case 'download': download(c, list()); return draw(c);
      case 'delete': return remove(c, list());
      case 'keep': { const e = list()[0]; return e ? keep(c, e, true) : undefined; }
      case 'unpin': { const e = list()[0]; return e ? keep(c, e, false) : undefined; }
      case 'pin-folder': {
        const e = list()[0];
        if (!e) return undefined;
        const i = c.pins.findIndex((p) => sameKey(p, c.place) && p.path === e.path);
        if (i >= 0) c.pins.splice(i, 1); else c.pins.push({ root: c.place.root, ...(c.place.project ? { project: c.place.project } : {}), path: e.path });
        writePins(c);
        return draw(c);
      }
      case 'move-to': case 'copy-to': return openDialog(c, what === 'move-to' ? 'move' : 'copy', list());
      case 'members': c.dialog = { mode: 'members', project: c.menuProject }; return draw(c);
      case 'members-save': {
        const d = c.dialog;
        const bots = [...box().querySelectorAll('[data-fx-member]')].filter((x) => x.checked).map((x) => x.dataset.fxMember);
        if (!bots.length) return toast(tr('Keep at least one bot in the project, or delete it.'), true);
        try { await api(`/projects/${encodeURIComponent(d.project)}`, { method: 'PUT', body: { bots } }); } catch (e) { return toast(e.message, true); }
        c.dialog = null;
        await loadProjects(c);
        if (!bots.includes(c.bot.id) && c.place.project === d.project) return go(c, { root: 'computer' }, '');
        return draw(c);
      }
      case 'delete-project': {
        const name = c.menuProject;
        let n;
        try { n = await api(at(c, 'count', '', { root: 'project', project: name })); } catch (err) { return toast(err.message, true); }
        if (!confirm(deleteWords({ name }, n, true))) return undefined;
        try { await api(`/projects/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (err) { return toast(err.message, true); }
        toast(tr('Deleted {name}', { name }));
        await loadProjects(c);
        return c.place.project === name ? go(c, { root: 'computer' }, '') : draw(c);
      }
      case 'pick': {
        const { place, path } = keyPlace(el.dataset.key);
        c.dialog.to = { ...place, path };
        draw(c);
        return expand(c, place, path);
      }
      case 'dialog-folder': {
        const d = c.dialog; const to = d?.to;
        if (!to) return undefined;
        const made = await newFolder(c, to, to.path);
        if (!made) return undefined;
        d.to = { ...to, path: made };
        delete d.open[`${placeKey(to)}|${to.path}`];
        return expand(c, to, to.path);
      }
      case 'dialog-go': {
        const d = c.dialog;
        if (!d?.to) return undefined;
        d.busy = true; draw(c);
        c.dialog = null;
        return carry(c, d.mode, d.items, d.from.root === 'kept' ? { root: 'server' } : d.from, d.to);
      }
      default: return undefined;
    }
  }

  // ---------- searching (with #604's search, from a server whose features have `workspace-search`) ----------

  let soon = null;
  function searchFor(c, q) {
    c.query = q;
    clearTimeout(soon);
    if (!q.trim()) { c.results = null; return draw(c); }
    soon = setTimeout(async () => {
      let r;
      try { r = await api(`${base(c)}/search?q=${encodeURIComponent(q.trim())}&root=all`); } catch (e) { return toast(e.message, true); }
      if (cur !== c || c.query !== q) return undefined;
      c.results = (r.results || []).map((x) => ({ ...x, place: { root: x.root, ...(x.project ? { project: x.project } : {}) } }));
      c.sel = new Set();
      return draw(c);
    }, 250);
    return undefined;
  }

  // ---------- the page's events ----------

  function placeOfKey(k) { return k.startsWith('project:') ? { root: 'project', project: k.slice(8) } : { root: k }; }
  let press = null; // a phone's long-press: { timer, path }
  let lastClick = null; // { path, at }
  function wire(el) {
    el.addEventListener('click', (ev) => {
      const c = cur;
      if (!c) return;
      const btn = ev.target.closest('[data-fx]');
      if (btn && !btn.disabled) { ev.preventDefault(); act(btn, ev); return; }
      const row = ev.target.closest('[data-path]');
      if (c.menu && !ev.target.closest('.fx-menu')) { c.menu = null; draw(c); }
      if (!row || row.classList.contains('fx-heads')) return;
      const e = visible(c).find((x) => x.path === row.dataset.path);
      if (!e) return;
      if (narrow()) {
        if (press?.fired) { press = null; return; }
        if (c.selecting) { c.sel = rangeSelect(visible(c).map((x) => x.path), c.sel, null, e.path, { toggle: true }); if (!c.sel.size) c.selecting = false; draw(c); return; }
        openEntry(c, e);
        return;
      }
      // A second click on the same entry soon after opens it: a click draws the list again, so the browser's own
      // double-click never reaches the row that was clicked first.
      const now = Date.now();
      if (lastClick && lastClick.path === e.path && now - lastClick.at < 450 && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) { lastClick = null; openEntry(c, e); return; }
      lastClick = { path: e.path, at: now };
      pick(c, e.path, { toggle: ev.ctrlKey || ev.metaKey, range: ev.shiftKey });
    });
    el.addEventListener('contextmenu', (ev) => {
      const c = cur;
      const project = ev.target.closest('.fx-place[data-root="project"]');
      if (c && project) {
        ev.preventDefault();
        const r = el.getBoundingClientRect();
        c.menuProject = project.dataset.project;
        c.menu = { project: project.dataset.project, x: ev.clientX - r.left, y: ev.clientY - r.top };
        return draw(c);
      }
      const row = ev.target.closest('[data-path]');
      if (!c || !row || narrow()) return;
      ev.preventDefault();
      if (!c.sel.has(row.dataset.path)) pick(c, row.dataset.path);
      const r = el.getBoundingClientRect();
      c.menu = { path: row.dataset.path, x: Math.min(ev.clientX - r.left, r.width - 240), y: Math.min(ev.clientY - r.top, r.height - 380) };
      draw(c);
    });
    // A phone's long-press starts selecting.
    el.addEventListener('pointerdown', (ev) => {
      const row = ev.target.closest('[data-path]');
      if (!row || !narrow() || ev.target.closest('[data-fx]')) return;
      const path = row.dataset.path;
      press = { path, timer: setTimeout(() => {
        const c = cur;
        if (!c) return;
        press.fired = true;
        c.selecting = true; c.sel = new Set([path]);
        draw(c);
        navigator.vibrate?.(15);
      }, 500) };
    });
    for (const t of ['pointerup', 'pointercancel', 'pointermove']) el.addEventListener(t, (ev) => { if (press && !press.fired && (t !== 'pointermove' || Math.abs(ev.movementY) > 4)) { clearTimeout(press.timer); press = null; } });
    el.addEventListener('input', (ev) => { if (ev.target.matches('[data-fx-search]') && cur) searchFor(cur, ev.target.value); });
    el.addEventListener('change', (ev) => {
      const c = cur; const t = ev.target;
      if (!c) return;
      if (t.matches('[data-fx-files]')) { const files = [...t.files]; t.value = ''; upload(c, files); }
      else if (t.matches('[data-fx-folder]')) { const files = [...t.files].map((file) => ({ file, rel: file.webkitRelativePath })); t.value = ''; uploadFolder(c, files); }
    });
    // Rows dragged onto a folder or a place move there; files from the desktop upload into the open folder.
    el.addEventListener('dragstart', (ev) => {
      const row = ev.target.closest?.('[data-path]');
      if (!row || !cur) return;
      if (!cur.sel.has(row.dataset.path)) pick(cur, row.dataset.path);
      ev.dataTransfer.setData('application/x-botdot-files', JSON.stringify(selected(cur).map((e) => e.path)));
      ev.dataTransfer.effectAllowed = 'move';
    });
    const fromDesktop = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
    el.addEventListener('dragover', (ev) => {
      const c = cur;
      if (!c) return;
      const target = ev.target.closest('[data-folder], [data-drop-place], [data-drop-pin]');
      if (fromDesktop(ev) && writesHere(c)) { ev.preventDefault(); if (!c.drop) { c.drop = true; draw(c); } return; }
      if (target && [...ev.dataTransfer.types].includes('application/x-botdot-files')) ev.preventDefault();
    });
    el.addEventListener('dragleave', (ev) => { if (cur?.drop && !el.contains(ev.relatedTarget)) { cur.drop = false; draw(cur); } });
    el.addEventListener('drop', (ev) => {
      const c = cur;
      if (!c) return;
      ev.preventDefault();
      if (c.drop || fromDesktop(ev)) { c.drop = false; draw(c); if (writesHere(c)) dropped(c, ev.dataTransfer); return; }
      let paths = [];
      try { paths = JSON.parse(ev.dataTransfer.getData('application/x-botdot-files') || '[]'); } catch { return; }
      const items = visible(c).filter((e) => paths.includes(e.path) && canDo(c, e).move);
      if (!items.length) return;
      const folder = ev.target.closest('[data-folder]');
      const placeEl = ev.target.closest('[data-drop-place]');
      const pinEl = ev.target.closest('[data-drop-pin]');
      let to = null;
      if (folder && !paths.includes(folder.dataset.path)) to = { ...c.place, path: folder.dataset.path };
      else if (placeEl) to = { ...placeOfKey(placeEl.dataset.dropPlace), path: '' };
      else if (pinEl) to = { ...c.pins[Number(pinEl.dataset.dropPin)] };
      if (to && to.root !== 'kept') carry(c, 'move', items, c.place, to);
    });
  }

  // Keys, while Files is open and nothing else takes them: arrows, Enter, Backspace (up a folder), F2, Del, Ctrl+A, Esc.
  function onKey(ev) {
    const c = cur;
    if (!c || ev.defaultPrevented || (typeof DocViewer !== 'undefined' && DocViewer.now())) return;
    if (ev.target.matches?.('input, textarea, select') && ev.key !== 'Escape') return;
    const list = visible(c);
    const i = list.findIndex((e) => e.path === c.focus);
    const one = list[i] || null;
    const k = ev.key;
    if (k === 'Escape') {
      ev.preventDefault();
      if (c.menu || c.sheet || c.dialog) { c.menu = null; c.sheet = null; c.dialog = null; return draw(c); }
      if (c.sel.size) { c.sel = new Set(); c.selecting = false; return draw(c); }
      return close();
    }
    if (c.dialog) return undefined;
    if (k === 'ArrowDown' || k === 'ArrowUp' || (c.view === 'grid' && (k === 'ArrowRight' || k === 'ArrowLeft'))) {
      ev.preventDefault();
      const step = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1;
      const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + step))];
      return next ? pick(c, next.path, { range: ev.shiftKey }) : undefined;
    }
    if (k === 'Enter' && one) { ev.preventDefault(); return openEntry(c, one); }
    if (k === 'Backspace' && c.path && !c.results) { ev.preventDefault(); return go(c, c.place, parentOf(c.path)); }
    if (k === 'F2' && one && canDo(c, one).rename) { ev.preventDefault(); return rename(c, one); }
    if ((k === 'Delete' || (k === 'Backspace' && ev.metaKey)) && c.sel.size) { ev.preventDefault(); const l = selected(c); return l.every((e) => canDo(c, e).del) ? remove(c, l) : undefined; }
    if (k === 'a' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); c.sel = new Set(list.map((e) => e.path)); return draw(c); }
    return undefined;
  }

  // ---------- open and close ----------

  // Opens Files for `bot` ({ id, name, color, state, outfit, computer }, or the Chief's { id: '_chief', name, base:
  // '/chief' }), at the top of its folder on botdot.
  function open(bot) {
    const el = box();
    let view = 'list';
    try { view = localStorage.getItem('botdot-files-view') === 'grid' ? 'grid' : 'list'; } catch { /* none kept */ }
    const c = { bot, place: { root: 'server' }, path: '', data: null, error: null, sort: 'name', view, sel: new Set(), anchor: null, focus: null, preview: null, back: [], fwd: [], projects: [], kept: [], pins: [], menu: null, sheet: null, dialog: null, selecting: false, query: '', results: null, drop: false, busy: null, searches: (state.features || []).includes('workspace-search') };
    c.pins = readPins(c);
    cur = c;
    if (el) {
      el.classList.remove('hidden');
      document.body.classList.add('files-open');
      if (!el.dataset.wired) { el.dataset.wired = '1'; wire(el); document.addEventListener('keydown', onKey); }
    }
    Promise.all([loadProjects(c), loadKept(c)]).then(() => draw(c));
    return load(c);
  }
  function close() {
    cur = null;
    const el = box();
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
    document.body?.classList.remove('files-open');
  }

  return { open, close, html, sorted, kindOf, sizeOf, canDo, crumbs, rangeSelect, folderPlan, deleteWords, act, places, placeName, now: () => cur };
})();

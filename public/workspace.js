// A bot's workspace in its settings (#296; docs/api.md, "A bot's workspace"): every file in its folder on botdot's
// server, to open in the viewer (viewer.js), download, upload into, rename, move and delete, and, for a bot that uses
// the computer, its folder there, to open, download and delete in while the computer runs. Only from a server whose
// features have `workspace-files`; bots.js draws the box, this file fills it. The Chief's settings (settings.js) open
// its own folder here too, from a server with `chief-files` (#383): its `bot` is { name, base: '/chief' }, with no computer.

const Workspace = (() => {
  const MAX_FILES = 10;
  const MAX_BYTES = 25 * 1024 * 1024;
  let cur = null; // { bot, box, root, path, data, error, sort, hidden }

  const base = (c) => `${c.bot.base || `/bots/${encodeURIComponent(c.bot.id)}`}/workspace`; // the Chief's (#383): base '/chief'
  const query = (c, p) => `?root=${c.root}&path=${encodeURIComponent(p)}`;
  const KB = (n) => (typeof fmtSize === 'function' ? fmtSize(n) : `${n} B`);
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

  // The entries as shown: folders first, then files, by name or newest first; dot-names only under "Show hidden".
  function sorted(entries, { sort = 'name', hidden = false } = {}) {
    const shown = entries.filter((e) => hidden || !e.name.startsWith('.'));
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const byDate = (a, b) => String(b.at || '').localeCompare(String(a.at || '')) || byName(a, b);
    const folder = (e) => (e.type === 'folder' ? 0 : 1);
    return [...shown].sort((a, b) => folder(a) - folder(b) || (sort === 'date' ? byDate(a, b) : byName(a, b)));
  }
  // The breadcrumb: the folder itself, then each folder on the way.
  function crumbs(p, rootName) {
    const parts = p ? p.split('/') : [];
    return [{ name: rootName, path: '' }, ...parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))];
  }
  // The confirmation of a delete: what goes, counted (at most 10,000).
  function deleteWords(e, n) {
    if (n.type !== 'folder') return `Delete ${e.name}? This can't be undone.`;
    const many = (k, one) => `${k.toLocaleString('en')} ${one}${k === 1 ? '' : 's'}`;
    const held = n.files + n.folders === 0 ? 'It is empty.' : `It holds ${n.capped ? 'more than ' : ''}${[n.files ? many(n.files, 'file') : '', n.folders ? many(n.folders, 'folder') : ''].filter(Boolean).join(' and ')}, which go with it.`;
    return `Delete the folder ${e.name}? ${held} This can't be undone.`;
  }
  const hiddenCount = (c) => (c.data?.entries || []).filter((e) => e.name.startsWith('.')).length;

  function rowHTML(c, e) {
    const icon = e.type === 'folder' ? '📁' : e.type === 'link' ? '🔗' : '📄';
    const src = `${base(c)}/file${query(c, e.path)}`;
    const meta = [e.type === 'file' ? KB(e.size || 0) : e.type === 'link' ? 'A link: botdot doesn\'t follow it' : '', when(e.at)].filter(Boolean).join(' · ');
    const view = state.features.includes('document-viewer') ? ` data-view="${esc(src)}" data-view-name="${esc(e.name)}" data-view-from="${esc(c.bot.name)}"${c.root === 'computer' ? ` data-view-bot="${esc(c.bot.id)}"` : ''}` : '';
    const name = e.type === 'folder' ? `<button type="button" class="ws-name link-btn" data-ws="go" data-path="${esc(e.path)}">${icon} ${esc(e.name)}</button>`
      : e.type === 'file' ? `<a class="ws-name" href="/api${esc(src)}" target="_blank" rel="noopener"${view}>${icon} ${esc(e.name)}</a>`
        : `<span class="ws-name">${icon} ${esc(e.name)}</span>`;
    // On botdot a link is never changed; on the computer deleting one takes the link alone.
    const canDelete = c.root === 'computer' || (!e.protected && e.type !== 'link' && !c.data.readOnly);
    const canChange = c.root === 'server' && canDelete && !e.keepsName;
    const acts = [
      e.type === 'file' ? `<a class="link-btn" href="/api${esc(src)}" download="${esc(e.name)}">Download</a>` : '',
      canChange ? '<button type="button" class="link-btn" data-ws="rename">Rename</button><button type="button" class="link-btn" data-ws="move">Move</button>' : '',
      canDelete ? '<button type="button" class="link-btn danger-text" data-ws="delete">Delete</button>' : '',
      e.protected && c.root === 'server' ? '<span class="faint" title="botdot keeps it: it is part of how the bot works">Kept by botdot</span>' : '',
    ].join('');
    return `<div class="ws-row" data-path="${esc(e.path)}">${name}<span class="faint ws-meta">${esc(meta)}</span><span class="ws-acts">${acts}</span></div>`;
  }

  function html(c) {
    const roots = c.bot.computer === 'linux' ? `<div class="dv-seg ws-roots" role="group" aria-label="Which folder">
      <button type="button" data-ws="root" data-root="server" class="${c.root === 'server' ? 'on' : ''}" aria-pressed="${c.root === 'server'}">On botdot</button>
      <button type="button" data-ws="root" data-root="computer" class="${c.root === 'computer' ? 'on' : ''}" aria-pressed="${c.root === 'computer'}">On the computer</button></div>` : '';
    const rootName = c.root === 'computer' ? `/workspace/${c.bot.id}` : 'Its folder';
    const nav = `<nav class="ws-crumbs" aria-label="Folder">${crumbs(c.path, rootName).map((x, i, all) => (i === all.length - 1 ? `<b>${esc(x.name)}</b>` : `<button type="button" class="link-btn" data-ws="go" data-path="${esc(x.path)}">${esc(x.name)}</button><span class="faint">/</span>`)).join('')}</nav>`;
    if (c.error) {
      const e = c.error;
      const body = e.state === 'computer-off'
        ? `<p class="muted">The computer is off. botdot doesn't start it just to show its files.</p><button type="button" class="btn sm" data-ws="start">Start the computer</button>`
        : e.status === 404 ? `<p class="muted">This folder is gone.</p><button type="button" class="btn sm" data-ws="go" data-path="">Back to the top</button>`
          : `<p class="muted">${esc(e.message || "Couldn't load it.")}</p>`;
      return `${roots}${nav}<div class="ws-state">${body}</div>`;
    }
    if (!c.data) return `${roots}${nav}<p class="faint">Loading…</p>`;
    const d = c.data;
    const writes = c.root === 'server' && !d.readOnly;
    const hid = hiddenCount(c);
    const bar = `<div class="ws-bar">
      <label class="ws-sort">Sort <select data-ws-sort aria-label="Sort"><option value="name"${c.sort === 'name' ? ' selected' : ''}>Name</option><option value="date"${c.sort === 'date' ? ' selected' : ''}>Date</option></select></label>
      ${hid ? `<label class="toggle ws-hidden"><input type="checkbox" data-ws-hidden${c.hidden ? ' checked' : ''}> Show hidden (${hid})</label>` : ''}
      <span class="grow"></span>
      ${writes ? '<button type="button" class="btn sm" data-ws="folder">New folder</button><button type="button" class="btn sm" data-ws="upload">Upload</button><input type="file" multiple hidden data-ws-files>' : ''}
    </div>`;
    const list = sorted(d.entries, c);
    const rows = list.length ? list.map((e) => rowHTML(c, e)).join('') : `<p class="faint">${d.entries.length ? 'Only hidden files here.' : 'Empty.'}</p>`;
    const note = d.readOnly ? '<p class="faint">botdot keeps this folder as it is: it is part of how the bot works. Open or download what is in it.</p>' : '';
    const more = d.more ? `<p class="faint">…and ${d.more.toLocaleString('en')} more, not listed.</p>` : '';
    return `${roots}${nav}${bar}${note}<div class="ws-list">${rows}</div>${more}`;
  }

  function draw(c = cur) { if (c?.box) c.box.innerHTML = html(c); }

  // Only the answer of the last folder asked for is drawn: an older, slower one is dropped.
  async function load(c = cur) {
    const seq = (c.seq = (c.seq || 0) + 1);
    c.data = null; c.error = null;
    draw(c);
    let data = null; let error = null;
    try { data = await api(`${base(c)}${query(c, c.path)}`); } catch (e) { error = e; }
    if (c.seq !== seq) return;
    c.data = data; c.error = error;
    draw(c);
  }

  const entryOf = (c, btn) => c.data?.entries.find((e) => e.path === btn.closest('[data-path]')?.dataset.path);
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  async function upload(c, files) {
    if (files.length > MAX_FILES) toast(`Upload at most ${MAX_FILES} files at a time.`, true);
    for (const file of [...files].slice(0, MAX_FILES)) {
      if (file.size > MAX_BYTES) { toast(`${file.name} is over 25 MB.`, true); continue; }
      try {
        const r = await fetch(`/api${base(c)}/upload${query(c, c.path)}`, { method: 'POST', headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Upload failed (${r.status})`);
      } catch (e) { toast(`${file.name}: ${e.message}`, true); }
    }
    return load(c);
  }

  async function act(btn) {
    const c = cur;
    if (!c) return;
    const what = btn.dataset.ws;
    if (what === 'go') { c.path = btn.dataset.path || ''; return load(c); }
    if (what === 'root') { if (c.root !== btn.dataset.root) { c.root = btn.dataset.root; c.path = ''; return load(c); } return; }
    if (what === 'start') {
      btn.disabled = true;
      try { await api(`/bots/${encodeURIComponent(c.bot.id)}/computer`, { method: 'POST', body: { action: 'start' } }); } catch (e) { toast(e.message, true); }
      return cur === c ? load(c) : undefined;
    }
    if (what === 'upload') return c.box.querySelector('[data-ws-files]')?.click();
    if (what === 'folder') {
      const name = prompt('Name of the new folder');
      if (!name?.trim()) return;
      try { await api(`${base(c)}/folder`, { method: 'POST', body: { path: c.path, name: name.trim() } }); } catch (e) { return toast(e.message, true); }
      return load(c);
    }
    const e = entryOf(c, btn);
    if (!e) return;
    if (what === 'rename' || what === 'move') {
      const answer = what === 'rename' ? prompt(`New name for ${e.name}`, e.name)
        : prompt(`Move ${e.name} to which folder? A path in its folder, such as notes/old. Empty for the top.`, parentOf(e.path));
      if (answer === null || (what === 'rename' && !answer.trim())) return;
      if (what === 'rename' && answer.includes('/')) return toast("A name can't have / in it. To put it in another folder, use Move.", true);
      const folder = answer.trim().replace(/^\/+|\/+$/g, '');
      const to = what === 'rename' ? (parentOf(e.path) ? `${parentOf(e.path)}/${answer.trim()}` : answer.trim()) : (folder ? `${folder}/${e.name}` : e.name);
      if (to === e.path) return;
      try { await api(`${base(c)}/move`, { method: 'POST', body: { from: e.path, to } }); } catch (err) { return toast(err.message, true); }
      toast(what === 'rename' ? 'Renamed' : 'Moved');
      return load(c);
    }
    if (what === 'delete') {
      let n;
      try { n = await api(`${base(c)}/count${query(c, e.path)}`); } catch (err) { return toast(err.message, true); }
      if (!confirm(deleteWords(e, n))) return;
      try { await api(`${base(c)}${query(c, e.path)}`, { method: 'DELETE' }); } catch (err) { return toast(err.message, true); }
      toast(`Deleted ${e.name}`);
      return load(c);
    }
  }

  // Fills `box` with the bot's workspace, at the top of its folder on botdot. Each box keeps its own place: the
  // Chief's settings stay drawn while a bot's open and close (#383), and a tap in a box acts on that box's folder.
  function open(bot, box) {
    const c = { bot, box, root: 'server', path: '', data: null, error: null, sort: 'name', hidden: false };
    cur = c;
    box.onclick = (ev) => { const btn = ev.target.closest?.('[data-ws]'); if (btn) { ev.preventDefault(); cur = c; act(btn); } };
    box.onchange = (ev) => {
      cur = c;
      const t = ev.target;
      if (t.matches?.('[data-ws-sort]')) { cur.sort = t.value; draw(); }
      else if (t.matches?.('[data-ws-hidden]')) { cur.hidden = t.checked; draw(); }
      else if (t.matches?.('[data-ws-files]')) { const files = [...t.files]; t.value = ''; upload(cur, files); }
    };
    return load(cur);
  }

  return { open, html, sorted, crumbs, deleteWords, act, now: () => cur };
})();

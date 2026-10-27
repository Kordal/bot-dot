// Files in a bot's own chat (#604, feature `file-mentions`): "@" and part of a name lists the bot's files and folders
// in every place it has (its workspace on botdot, its folder on the account's computer, its shared projects), found
// by the workspace's search (docs/api.md, "A bot's workspace"), above the other mentions. A folder opens in the list:
// picked, or "/" typed after its name ("@reports/"); its header goes back up. A picked file or folder goes in the
// message as its mention ("@[botdot:reports/summary.md]", public/mentions.js) and is drawn as a chip: in the box
// behind its text, and in the owner's bubble, where it opens in the viewer.
// The search is one request a while after the last key, never more than one at a time; answers are kept a little.

const FileMentions = (() => {
  const FILES_FIRST = 4; // file rows above the other mentions
  const FOLDER_ROWS = 50; // rows of a folder opened
  const WAIT_MS = 150; // after the last key, before a search goes
  const KEEP_MS = 15000; // a search or a folder is asked again after this

  const svg = (d, cls = '') => `<svg class="fm-icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6"/>'),
    table: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16 M4 15h16 M10 5v14"/>', 'fm-table'),
    image: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="15" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 2-2 5 5"/>', 'fm-image'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 'fm-folder'),
  };
  const PLACE_ICONS = {
    server: svg('<rect x="4" y="5" width="16" height="6" rx="1.5"/><rect x="4" y="13" width="16" height="6" rx="1.5"/><path d="M8 8h.01 M8 16h.01"/>', 'fm-place'),
    computer: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8 M12 16v4"/>', 'fm-place'),
    project: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 13h6"/>', 'fm-place'),
  };
  const BACK = svg('<path d="M15 6l-6 6 6 6"/>');
  const MORE = svg('<path d="M9 6l6 6-6 6"/>', 'fm-more');

  // What a file looks like by its name: a table, an image, a document; a folder is a folder.
  function kindOf(name, type) {
    if (type === 'folder') return 'folder';
    const ext = String(name || '').toLowerCase().split('.').pop();
    if (['csv', 'tsv', 'xlsx', 'xls', 'ods'].includes(ext)) return 'table';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp'].includes(ext)) return 'image';
    return 'doc';
  }
  const placeName = (root, project) => (root === 'server' ? 'On botdot' : root === 'computer' ? 'Computer' : project || '');
  const dirKey = (d) => `${d.root}|${d.project || ''}|${d.path}`;
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const baseOf = (p) => p.split('/').pop();
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  // On in a bot's own chat (not the Chief's, a group or a room), on a botdot that hands files over.
  const on = (chat) => (state.features || []).includes('file-mentions') && (state.bots || []).some((b) => b.id === chat);
  const base = (botId) => `/bots/${encodeURIComponent(botId)}/workspace`;
  const where = (d) => `root=${d.root}${d.root === 'project' ? `&project=${encodeURIComponent(d.project)}` : ''}`;

  // A file mention as a chip: its icon and name; in a bot's own chat it opens in the viewer (or downloads).
  // A name without an extension is drawn as a folder: the text of a mention doesn't say which it is.
  function chipHTML(f, chat) {
    const file = !!f.path && /\.[^./]+$/.test(f.name);
    const inner = `${file ? ICONS[kindOf(f.name, 'file')] : ICONS.folder}<span>${esc(f.name)}</span>`;
    const bot = (state.bots || []).find((b) => b.id === chat);
    if (!bot || !file) return `<span class="file-mention" title="${esc(f.path || f.name)}">${inner}</span>`;
    const src = `${base(bot.id)}/file?${where(f)}&path=${encodeURIComponent(f.path)}`;
    const view = (state.features || []).includes('document-viewer') ? ` data-view="${esc(src)}" data-view-name="${esc(f.name)}" data-view-from="${esc(bot.name)}"${f.root !== 'server' ? ` data-view-bot="${esc(bot.id)}"` : ''}` : '';
    return `<a class="file-mention" href="/api${esc(src)}" target="_blank" rel="noopener" title="${esc(f.path)}"${view}>${inner}</a>`;
  }

  // The name with what was typed in it marked.
  function nameHTML(name, q) {
    const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
    return i < 0 ? esc(name) : `${esc(name.slice(0, i))}<b>${esc(name.slice(i, i + q.length))}</b>${esc(name.slice(i + q.length))}`;
  }
  // A row of the list: icon, name, and in a search where it lives (its folder, or its place).
  function rowHTML(r) {
    const label = r.inFolder ? '' : `<span class="fm-where">${PLACE_ICONS[r.root] || ''}<span>${esc(parentOf(r.path) ? baseOf(parentOf(r.path)) : placeName(r.root, r.project))}</span></span>`;
    return `${ICONS[kindOf(r.name, r.type)]}<span class="fm-name">${nameHTML(r.name, r.q)}</span>${label}${r.type === 'folder' ? MORE : ''}`;
  }
  // The header of a folder opened: back, its place, and the folders on the way.
  function headerHTML(d) {
    const trail = [placeName(d.root, d.project), ...(d.path ? d.path.split('/') : [])];
    return `<button type="button" class="fm-back" data-fm="back" aria-label="Back">${BACK}</button>${PLACE_ICONS[d.root] || ''}`
      + `<button type="button" class="fm-trail" data-fm="this" title="Mention this folder">${trail.map((t, i) => (i === trail.length - 1 ? `<b>${esc(t)}</b>` : `${esc(t)}<span class="fm-sep">/</span>`)).join('')}</button>`;
  }

  // The picker of one message box. redraw() is called when an answer came in.
  function picker(chat, redraw) {
    let walk = null; // a folder opened: { start (the "@"), prefix (the text from it that opened it), dir }
    let timer = null, asked = 0;
    const kept = new Map(); // key → { at, answer: Promise }
    const fetchOnce = (key, url) => {
      const k = kept.get(key);
      if (k && Date.now() - k.at < KEEP_MS) return k.answer;
      for (const [x, v] of kept) if (Date.now() - v.at >= KEEP_MS) kept.delete(x);
      // One that failed is not kept: the next key asks again.
      const answer = api(url).catch(() => { kept.delete(key); return null; });
      kept.set(key, { at: Date.now(), answer });
      return answer;
    };
    const find = (q) => fetchOnce(`s|${q.toLowerCase()}`, `${base(chat)}/search?root=all&q=${encodeURIComponent(q)}`).then((a) => a?.results || []);
    const list = (d) => fetchOnce(`l|${dirKey(d)}`, `${base(chat)}?${where(d)}&path=${encodeURIComponent(d.path)}`).then((a) => a?.entries || []);
    const sub = (d, e) => ({ root: d.root, ...(d.project ? { project: d.project } : {}), path: e.path });
    // The folder `names` lead to from `d` (or, with no `d`, from the best folder of the first name found), or null.
    async function follow(d, names) {
      for (const n of names) {
        // The name as typed before one in another case, and the nearest.
        const fit = (x) => (x.name === n ? 0 : 1) * 100 + x.path.split('/').length;
        const e = (d ? await list(d) : await find(n)).filter((x) => x.type === 'folder' && same(x.name, n)).sort((a, b) => fit(a) - fit(b))[0];
        if (!e) return null;
        d = d ? sub(d, e) : { root: e.root, ...(e.project ? { project: e.project } : {}), path: e.path };
      }
      return d;
    }
    const fileRow = (e, d, q, inFolder) => {
      const ref = d ? sub(d, e) : { root: e.root, ...(e.project ? { project: e.project } : {}), path: e.path };
      return { kind: 'file', type: e.type, name: e.name, ...ref, q, inFolder, text: Mentions.fileText(ref) };
    };
    const state0 = { rows: [], dir: null };
    let last = state0;

    // What the list shows for the text before the cursor: { rows (file rows), dir (a folder opened) }. Asks the
    // server when it has to, and calls redraw() with what came back.
    function look(typed) {
      clearTimeout(timer);
      if (!on(chat)) return state0;
      let dir = null, rest = null;
      if (walk && typed.length >= walk.start + walk.prefix.length && typed.slice(walk.start, walk.start + walk.prefix.length) === walk.prefix) {
        rest = typed.slice(walk.start + walk.prefix.length);
        if (/[\s@[\]]/.test(rest)) rest = null;
        else dir = walk.dir;
      }
      if (rest == null) walk = null;
      const t = rest == null ? Mentions.fileTyping(typed) : null;
      if (rest == null && !t) return (last = state0);
      const names = rest != null ? rest.split('/') : [...t.folders, t.q];
      const q = names.pop();
      if (!dir && !names.length && !q) return (last = state0); // "@" alone: the other mentions
      const mine = ++asked;
      timer = setTimeout(async () => {
        const d = names.length ? await follow(dir, names) : dir;
        let rows = [];
        if (d) rows = (await list(d)).filter((e) => e.type !== 'other' && !e.name.startsWith('.') && !/[\]\n]/.test(e.name) && (!q || e.name.toLowerCase().includes(q.toLowerCase())))
          .slice(0, FOLDER_ROWS).map((e) => fileRow(e, d, q, true));
        else if (!names.length) rows = (await find(q)).filter((h) => h.type !== 'other' && Mentions.fileText(h)).slice(0, FILES_FIRST).map((h) => fileRow(h, null, q, false));
        if (mine !== asked) return; // a later key asked again
        last = { rows, dir: d || null };
        redraw();
      }, dir && !names.length ? 0 : WAIT_MS);
      return last;
    }
    return {
      look,
      // A folder row picked: it opens, and the text says so ("@reports/"). Returns the new text and cursor.
      enter(text, cursor, row) {
        const at = walk ? walk.start : Mentions.fileTyping(text.slice(0, cursor))?.start;
        if (at == null) return null;
        const prefix = `@${row.name}/`;
        const end = cursor + (text.slice(cursor).match(/^[^\s@[\]]*/u) || [''])[0].length;
        walk = { start: at, prefix, dir: { root: row.root, ...(row.project ? { project: row.project } : {}), path: row.path } };
        return { text: text.slice(0, at) + prefix + text.slice(end), cursor: at + prefix.length };
      },
      // Up one folder; from a place's top back to "@".
      back(text, cursor) {
        const d = last.dir;
        const at = walk ? walk.start : Mentions.fileTyping(text.slice(0, cursor))?.start;
        if (!d || at == null) return null;
        const end = cursor + (text.slice(cursor).match(/^[^\s@[\]]*/u) || [''])[0].length;
        const up = d.path.includes('/') ? { ...d, path: parentOf(d.path) } : null;
        const prefix = up ? `@${baseOf(up.path)}/` : '@';
        walk = up ? { start: at, prefix, dir: up } : null;
        last = state0;
        return { text: text.slice(0, at) + prefix + text.slice(end), cursor: at + prefix.length };
      },
      // A file or folder picked: its mention and a space in place of the "@" and all typed after it (as Mentions.pick,
      // also where an opened folder's name has a space in it). Returns { text, cursor }, or null.
      put(text, cursor, row) {
        const at = walk ? walk.start : Mentions.fileTyping(text.slice(0, cursor))?.start;
        if (at == null || !row.text) return null;
        const end = cursor + (text.slice(cursor).match(/^[^\s@[\]]*/u) || [''])[0].length;
        const spaced = text[end] === ' ';
        walk = null; last = state0;
        return { text: text.slice(0, at) + row.text + (spaced ? '' : ' ') + text.slice(end), cursor: at + row.text.length + 1 };
      },
      // The folder opened, as a row to mention.
      self() { const d = last.dir; return d && d.path ? { kind: 'file', type: 'folder', name: baseOf(d.path), ...d, text: Mentions.fileText(d) } : null; },
      reset() { clearTimeout(timer); asked++; walk = null; last = state0; },
    };
  }

  return { on, picker, rowHTML, headerHTML, chipHTML, kindOf, FILES_FIRST };
})();

// A file dropped onto the screen goes to the bot's own folder on its computer (#1736, ADR 279), by the route the web
// page's Files uses for it: POST /api/bots/<id>/workspace/upload?root=computer, as the owner, with its size limit and
// its errors. Only with control: while watching, a drop sends nothing and says so. Nothing here touches the picture or
// the transport, so it needs neither.
//
//   setupDrop({ allowed })   allowed(): whether the owner has control now
//
// botdot writes what it needs into #drop's data-drop (lib/screen-drop.js): the bot, the words in the account's
// language, the size and number the route takes, and whether the bot's computer is on boat.dev, where there is no
// route for it yet.
const NOTE_MS = 6000;

export function setupDrop({ allowed }) {
  const overlay = document.getElementById('drop');
  const hint = document.getElementById('drop-hint');
  const note = document.getElementById('drop-note');
  let drop;
  try { drop = JSON.parse(overlay.dataset.drop || ''); } catch { return; }
  const { bot, boat, maxBytes, maxFiles, words } = drop;
  const say = (key, values = {}) => String(words[key] || '').replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

  // The sentence beside the picture, for a few seconds (the last one stays while a file is on its way).
  let timer = null;
  function tell(text, { keep = false } = {}) {
    clearTimeout(timer);
    note.textContent = text;
    note.hidden = !text;
    if (text && !keep) timer = setTimeout(() => tell(''), NOTE_MS);
  }

  // One drop after another, never two at once.
  let queue = Promise.resolve();

  // What a drag carries: only files count, and the page never lets the browser open one in this frame.
  const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  let over = 0;
  const show = (on) => {
    overlay.hidden = !on;
    if (on) hint.textContent = boat ? say('boat') : allowed() ? say('hint') : say('watching');
  };
  addEventListener('dragenter', (e) => { if (!carriesFiles(e)) return; e.preventDefault(); over++; show(true); });
  addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = allowed() && !boat ? 'copy' : 'none';
  });
  addEventListener('dragleave', (e) => { if (!carriesFiles(e)) return; over = Math.max(0, over - 1); if (!over) show(false); });
  addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    over = 0;
    show(false);
    if (boat) return tell(say('boat'));
    if (!allowed()) return tell(say('watching'));
    // Read now: the browser empties the drop's list once this handler has returned.
    const dropped = droppedBy(e.dataTransfer);
    queue = queue.then(() => put(dropped));
  });

  // The files of a drop, each with whether it is a folder (which the browser hands over as an empty "file").
  const droppedBy = (transfer) => (transfer.items?.length
    ? [...transfer.items].filter((i) => i.kind === 'file').map((i) => ({ file: i.getAsFile(), folder: !!i.webkitGetAsEntry?.()?.isDirectory }))
    : [...transfer.files].map((file) => ({ file, folder: false })));

  // One file, as the Files page puts it: its bytes as the body, its name in X-File-Name. { name } of what it was saved
  // as (a taken name becomes "name (2).ext"), or { error } with the server's own sentence when it gave one.
  async function upload(file) {
    let res;
    try {
      res = await fetch(`/api/bots/${encodeURIComponent(bot)}/workspace/upload?root=computer`, {
        method: 'POST',
        headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
        body: file,
      });
    } catch { return { error: '' }; }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.name) return { name: data.name };
    return { error: typeof data.error === 'string' ? data.error : '' };
  }

  async function put(dropped) {
    if (!dropped.length) return;
    if (dropped.length > maxFiles) return tell(say('tooMany', { count: maxFiles }));
    const saved = [];
    const lines = [];
    for (const { file, folder } of dropped) {
      const name = file?.name || '';
      if (folder || !file) { lines.push(say('folder', { name })); continue; }
      if (file.size > maxBytes) { lines.push(say('big', { name, mb: Math.round(maxBytes / 1024 / 1024) })); continue; }
      tell(say('sending', { name }), { keep: true });
      const r = await upload(file);
      if (r.name) saved.push(r.name);
      else lines.push([say('failed', { name }), r.error].filter(Boolean).join(' '));
    }
    if (saved.length) lines.unshift(saved.length === 1 ? say('done', { name: saved[0] }) : say('many', { count: saved.length }));
    tell(lines.join('\n'));
  }
}

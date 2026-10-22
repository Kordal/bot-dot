// Files: a file attached to a message, and a file sent to be attached (lib/uploads.js).
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const fs = require('../principal-fs');
const chief = require('../chief');
const path = require('path');
const uploads = require('../uploads');
const fileView = require('../file-view');
const docExport = require('../doc-export');
const docGoogle = require('../doc-google');

const typeOf = (ext) => { const t = fileView.TYPES[ext]; return !t ? 'application/octet-stream' : t.startsWith('text/') ? `${t}; charset=utf-8` : t; };

// A file for the owner to open or save. Downloaded, never shown as a page on botdot's own address (an HTML file from
// a bot could run scripts there); a PDF opens in the browser.
const downloadHeaders = (name, size, cache = 'private, max-age=86400') => {
  const ext = name.split('.').pop().toLowerCase();
  return { 'Content-Type': typeOf(ext), 'Content-Length': size, 'Content-Disposition': `${ext === 'pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`, 'X-Content-Type-Options': 'nosniff', ...(ext === 'pdf' ? {} : { 'Content-Security-Policy': "sandbox; default-src 'none'" }), 'Cache-Control': cache };
};
// cache: 'no-store' for a file that may change under the same address (a path in a bot's folder).
function download(res, file, name, cache) {
  res.writeHead(200, downloadHeaders(name, fs.statSync(file).size, cache));
  return fs.createReadStream(file).pipe(res);
}

// The document viewer (#251, lib/file-view.js): with ?view=1 a file comes as JSON for the apps to draw, its text
// cut at 1 MB and 1,000 lines; with ?stat=1 the same without its text. Else it downloads, as before.
const viewAsked = (url) => url.searchParams.has('view') || url.searchParams.has('stat');
async function sendView(res, url, file, name) {
  return send(res, 200, await fileView.viewFile(file, name, { text: !url.searchParams.has('stat') }));
}
const refusal = (res, e) => send(res, e.status || 500, { error: e.message, ...(e.state ? { state: e.state } : {}) });

// A file a path in a bot's reply names (#251): GET /api/bots/<id>/path?path=<path>[&view=1|&stat=1]. A path relative
// to the bot's workspace is read here; /home/box/…, ~/… and /workspace/… on the account's computer, as box, only
// while it runs: a computer that is off answers 409 { state: 'computer-off' } and is not started for it.
async function pathRoute(res, url, bot) {
  let place;
  try { place = fileView.placeOf(url.searchParams.get('path')); } catch (e) { return refusal(res, e); }
  const name = path.posix.basename(place.path);
  if (place.where === 'workspace') {
    let file;
    try { file = fileView.inWorkspace(path.join(B.WORKSPACES_DIR, bot.id), place.path); } catch (e) { return refusal(res, e); }
    return viewAsked(url) ? sendView(res, url, file, name) : download(res, file, name, 'no-store');
  }
  if (bot.computer !== 'linux') return send(res, 404, { error: 'This file is gone.', state: 'gone' });
  return computerFile(res, url, bot, place.path);
}

// The account's computer, for a bot that uses it, only while it runs: false once it has answered why not. Never
// started for a read.
async function computerOn(res, bot, words = 'Start it to open the file.') {
  if (bot.computer !== 'linux') { send(res, 404, { error: "This bot doesn't use the computer.", state: 'no-computer' }); return false; }
  if ((await B.computers.inspect(bot.id).catch(() => ({ state: 'none' }))).state !== 'running') {
    send(res, 409, { error: `The computer is off. ${words}`, state: 'computer-off' });
    return false;
  }
  return true;
}

// A file on the account's computer, `file` its absolute path there: read as box, inside `roots` (file-view.js
// computerScript), as JSON for the viewer or whole up to 1 MB.
async function computerFile(res, url, bot, file, roots) {
  const name = path.posix.basename(file);
  if (!(await computerOn(res, bot))) return;
  let got;
  try {
    const r = await B.computers.runShell(bot.id, { command: fileView.computerScript(file, roots ? { roots } : {}), timeoutSeconds: 30 });
    if (r.code !== 0) return send(res, 502, { error: "Couldn't read it on the computer." });
    got = fileView.computerAnswer(r.stdout);
  } catch (e) { return refusal(res, e); }
  const whole = got.size <= got.bytes.length;
  if (viewAsked(url)) {
    const v = fileView.viewOf(name, got.bytes, got.size, got.at, { text: !url.searchParams.has('stat') });
    // Over the cap it can't be brought out whole: its text shows cut, anything else not at all.
    return send(res, 200, whole ? v : { ...v, downloadable: false, ...(v.kind === 'image' ? { kind: 'none' } : {}) });
  }
  if (!whole) return send(res, 413, { error: 'Too large to bring out of the computer: at most 1 MB.' });
  res.writeHead(200, downloadHeaders(name, got.bytes.length, 'no-store'));
  return res.end(got.bytes);
}

// A file the owner sent in a Chief chat or a group (#268): GET /api/chief/chats/<id>/uploads/<name> and
// /api/group-chats/<id>/uploads/<name>[?view=1|&stat=1]. find(name) gives { dir, file, name } only for a file a
// message of that chat lists (lib/chief.js, lib/group-chat.js ownerFile): no free path, and a link out of its folder
// is refused. The owner's alone. The Chief may rewrite a file in its folder: never kept by the browser.
function ownerUpload(res, url, by, raw, find) {
  if (by !== 'you') return send(res, 403, { error: "Only the owner opens the files they sent." });
  let name = '';
  try { name = decodeURIComponent(raw); } catch { /* no such file */ }
  const f = name && !name.includes('/') ? find(name) : null;
  if (!f) return send(res, 404, { error: 'That file is gone.', state: 'gone' });
  let file;
  try { file = fileView.inWorkspace(f.dir, f.file); } catch (e) { return refusal(res, e); }
  return viewAsked(url) ? sendView(res, url, file, f.name) : download(res, file, f.name, 'no-store');
}

function create(ctx) {
  return async function routes(req, res, url, { parts, m, by }) {
    // A file a bot attached to its reply: /api/files/<runId>/<name>. Only files the run lists.
    if (parts[0] === 'files' && parts.length === 3 && m === 'GET') {
      const run = B.readMeta(parts[1]);
      let name = '';
      try { name = decodeURIComponent(parts[2]); } catch { /* no such file */ }
      const f = run?.files?.find((x) => x.name === name);
      const file = f && B.outbox.find(run.id, f.name);
      if (!file) return send(res, 404, { error: 'That file is gone (files are kept for 90 days).', state: 'gone' });
      return viewAsked(url) ? sendView(res, url, file, f.name) : download(res, file, f.name);
    }
    if (parts[0] === 'bots' && parts[2] === 'path' && parts.length === 3 && m === 'GET') {
      const bot = B.bots.get(parts[1]);
      if (!bot) return send(res, 404, { error: 'No such bot' });
      if (by !== 'you') return send(res, 403, { error: "Only the owner opens a bot's files." });
      return pathRoute(res, url, bot);
    }
    // A file attached to a message: the raw body, its name in X-File-Name. ?to=bot:<id>, ?to=chief or, for a
    // message in a group, ?to=group:<id>: kept once in the group's own folder, which no bot reads, and copied into
    // the workspace of each member whose turn on that message starts (ADR 020). The owner's alone (CHIEF_ROUTES).
    if (parts[0] === 'uploads' && m === 'POST') {
      const to = url.searchParams.get('to') || '';
      let workspace;
      if (to === 'chief') workspace = chief.WORKDIR;
      else if (to.startsWith('bot:') && B.bots.get(to.slice(4))) workspace = path.join(B.WORKSPACES_DIR, to.slice(4));
      else if (to.startsWith('group:') && B.groups.get(to.slice(6))) { workspace = B.groups.filesDir(to.slice(6)); fs.mkdirSync(workspace, { recursive: true, mode: 0o700 }); }
      else return send(res, 400, { error: 'Say where the file goes' });
      let name = 'file';
      try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch { /* keep the default */ }
      return send(res, 201, await uploads.save(req, workspace, name));
    }
    // Google Docs (#351): GET says whether it is connected, POST { title, text } saves a new Google Doc and answers
    // { id, url, title }. The owner's tap is the OK (ADR 047); the Chief has no route here.
    if (parts[0] === 'export' && parts[1] === 'google-docs' && parts.length === 2 && (m === 'GET' || m === 'POST')) {
      if (by !== 'you') return send(res, 403, { error: 'Only the owner saves a document.' });
      try {
        return send(res, 200, m === 'GET' ? await docGoogle.status(B.connectors) : await docGoogle.save(B.connectors, await readBody(req, 3e6)));
      } catch (e) { return refusal(res, e); }
    }
    // A reply or a Markdown file as a document (#348): POST /api/export { title, text, format } answers the file. The
    // owner's alone: the Chief has no route here (CHIEF_ROUTES).
    if (parts[0] === 'export' && parts.length === 1 && m === 'POST') {
      if (by !== 'you') return send(res, 403, { error: 'Only the owner exports a document.' });
      let doc;
      try { doc = await docExport.exportDoc(await readBody(req, 3e6)); } catch (e) { return refusal(res, e); }
      res.writeHead(200, { 'Content-Type': doc.type, 'Content-Length': doc.body.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'no-store' });
      return res.end(doc.body);
    }
    return NEXT;
  };
}

module.exports = { create, download, viewAsked, sendView, ownerUpload, computerOn, computerFile, refusal };

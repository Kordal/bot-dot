// Files: a file attached to a message, and a file sent to be attached (lib/uploads.js).
const { NEXT, send } = require('./http');
const B = require('../bots');
const fs = require('../principal-fs');
const chief = require('../chief');
const path = require('path');
const uploads = require('../uploads');

const TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet' };

// A file for the owner to open or save. Downloaded, never shown as a page on botdot's own address (an HTML file from
// a bot could run scripts there); a PDF opens in the browser.
function download(res, file, name) {
  const ext = name.split('.').pop().toLowerCase();
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Content-Disposition': `${ext === 'pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`, 'X-Content-Type-Options': 'nosniff', ...(ext === 'pdf' ? {} : { 'Content-Security-Policy': "sandbox; default-src 'none'" }), 'Cache-Control': 'private, max-age=86400' });
  return fs.createReadStream(file).pipe(res);
}

function create(ctx) {
  return async function routes(req, res, url, { parts, m }) {
    // A file a bot attached to its reply: /api/files/<runId>/<name>. Only files the run lists.
    if (parts[0] === 'files' && parts.length === 3 && m === 'GET') {
      const run = B.readMeta(parts[1]);
      let name = '';
      try { name = decodeURIComponent(parts[2]); } catch { /* no such file */ }
      const f = run?.files?.find((x) => x.name === name);
      const file = f && B.outbox.find(run.id, f.name);
      if (!file) return send(res, 404, { error: 'That file is gone (files are kept for 90 days).' });
      return download(res, file, f.name);
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
    return NEXT;
  };
}

module.exports = { create, download };

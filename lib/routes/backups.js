// Backups: the list, a backup now, its settings, and restoring one (lib/backup.js).
const { NEXT, send, readBody } = require('./http');
const fs = require('../principal-fs');
const path = require('path');
const crypto = require('crypto');
const B = require('../bots');
const chief = require('../chief');

function create(ctx) {
  const { backups, audit, ACCOUNT } = ctx;
  return async function routes(req, res, url, { parts, m, by }) {
    // Backups (backup.js): only the owner, never the Chief's tools. It holds everything, the vault's key too.
    if (parts[0] === 'backups') {
      if (by !== 'you') return send(res, 403, { error: 'Only the owner can use backups.' });
      if (!parts[1] && m === 'GET') return send(res, 200, backups.status());
      if (parts[1] === 'passphrase' && m === 'PUT') { const b = await readBody(req); backups.setPassphrase(b.passphrase); return send(res, 200, backups.status()); }
      if (parts[1] === 'now' && m === 'POST') { await backups.run(); return send(res, 200, backups.status()); }
      // Restore: upload the file (raw body), then restore it with its passphrase. botdot restarts.
      if (parts[1] === 'upload' && m === 'POST') {
        fs.mkdirSync(backups.dir, { recursive: true, mode: 0o700 });
        const file = path.join(backups.dir, `upload-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.tmp`);
        try { await require('../backup-upload').save(req, file); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
        return send(res, 201, { file: path.basename(file) });
      }
      if (parts[1] === 'restore' && m === 'POST') {
        const b = await readBody(req);
        const name = String(b.file || '');
        const file = /^upload-\d+(?:-[a-f0-9]{16})?\.tmp$/.test(name) || backups.isName(name) ? path.join(backups.dir, name) : null;
        if (!file || !fs.existsSync(file)) return send(res, 400, { error: 'Upload the backup first.' });
        if (B.activeCount() || chief.activeCount()) return send(res, 409, { error: 'Bots are still working. Stop them, or wait until they are done.' });
        const r = await backups.stage(file, b.passphrase);
        audit('backup.restored', by);
        if (name.startsWith('upload-')) fs.rmSync(file, { force: true });
        send(res, 200, { ok: true, restarting: true, ...r });
        console.log('[backup] restore staged; restarting');
        setTimeout(() => process.exit(0), 500); // Docker starts it again (restart: unless-stopped)
        return;
      }
      if (backups.isName(parts[1] || '') && m === 'GET') {
        const file = path.join(backups.dir, parts[1]);
        if (!fs.existsSync(file)) return send(res, 404, { error: 'No such backup' });
        audit('backup.downloaded', by);
        // Named with the account it holds (ADR 028): bot-dot-<account>-<date>.bdb.
        const saved = /^[a-z][a-z0-9-]{1,30}$/.test(ACCOUNT) ? parts[1].replace(/^bot-dot-/, `bot-dot-${ACCOUNT}-`) : parts[1];
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Content-Disposition': `attachment; filename="${saved}"`, 'Cache-Control': 'no-store' });
        return fs.createReadStream(file).pipe(res);
      }
    }
    return NEXT;
  };
}

module.exports = { create };

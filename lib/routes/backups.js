// Backups (lib/backup.js): how the off-site backup went, a download made on request, and restoring one.
const { NEXT, send, readBody } = require('./http');
const fs = require('../principal-fs');
const path = require('path');
const crypto = require('crypto');
const B = require('../bots');
const chief = require('../chief');

function create(ctx) {
  const { backups, backupAlert, audit, fromFrontDoor } = ctx;
  return async function routes(req, res, url, { parts, m, by }) {
    // A consistent copy of memory.db for root's backup of the machine (#1015): root's step asks for it on the front
    // door's socket, with the header the front door strips from every request a person sends. Not the owner, the
    // Chief or a bot.
    if (parts[0] === 'backups' && parts[1] === 'snapshot' && !parts[2]) {
      if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: "Only root's step asks for a copy of the memory." });
      if (m !== 'POST') return send(res, 405, { error: 'A copy of the memory is asked with a POST.' });
      return send(res, 200, backups.snapshot());
    }
    // The machine's off-site backup turned late or works again (#1017): the front door tells the admin's account alone,
    // which says it once, as a Chief message held through quiet hours.
    if (parts[0] === 'backups' && parts[1] === 'machine' && !parts[2]) {
      if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door says how the machine\'s backup goes.' });
      if (m !== 'POST') return send(res, 405, { error: 'Use POST.' });
      const b = await readBody(req);
      if (typeof b?.late !== 'boolean') return send(res, 400, { error: 'Say whether it is late.' });
      const plain = (v, max) => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, ' ').slice(0, max) : null);
      const lastSuccess = typeof b.lastSuccess === 'string' && !Number.isNaN(Date.parse(b.lastSuccess)) ? new Date(b.lastSuccess).toISOString() : null;
      backupAlert.machine({ late: b.late, lastSuccess, error: plain(b.error, 300) });
      return send(res, 200, { ok: true });
    }
    // This account's off-site backup (ADR 158): the front door says how it went, from what root's step wrote.
    if (parts[0] === 'backups' && parts[1] === 'offsite' && !parts[2]) {
      if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door says how the off-site backup goes.' });
      if (m !== 'POST') return send(res, 405, { error: 'Use POST.' });
      try { return send(res, 200, backups.offsite(await readBody(req))); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    }
    // Backups (backup.js): only the owner, never the Chief's tools. It holds everything, the vault's key too.
    if (parts[0] === 'backups') {
      if (by !== 'you') return send(res, 403, { error: 'Only the owner can use backups.' });
      if (!parts[1] && m === 'GET') return send(res, 200, backups.status());
      // A download: asked for with its passphrase, then fetched once at its address (a browser's or Android's own
      // download, which sends no body), within backup.PREPARED_MS.
      if (parts[1] === 'download' && !parts[2] && m === 'POST') {
        const b = await readBody(req);
        try {
          const r = await backups.prepare(b?.passphrase);
          return send(res, 200, { url: `/api/backups/download/${r.token}`, name: r.name });
        } catch (e) { return send(res, e.status || 500, { error: e.message }); }
      }
      if (parts[1] === 'download' && parts[2] && !parts[3] && m === 'GET') {
        let failed = null;
        const found = await backups.download(parts[2], res, {
          started: (name) => res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }),
        }).catch((e) => { failed = e; return true; });
        if (!found) return send(res, 404, { error: 'Ask for the download again.' });
        if (failed) { console.error(`[backup] download: ${failed.message}`); res.destroy(); }
        return;
      }
      // The account's own nightly backups are gone (ADR 158): an older app that asks for them is told so.
      if ((parts[1] === 'passphrase' && m === 'PUT') || (parts[1] === 'now' && m === 'POST')) return send(res, 410, { error: 'Backups are made off-site now. Download one in Settings.' });
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
        const file = /^upload-\d+(?:-[a-f0-9]{16})?\.tmp$/.test(name) ? path.join(backups.dir, name) : null;
        if (!file || !fs.existsSync(file)) return send(res, 400, { error: 'Upload the backup first.' });
        if (B.activeCount() || chief.activeCount()) return send(res, 409, { error: 'Bots are still working. Stop them, or wait until they are done.' });
        const r = await backups.stage(file, b.passphrase);
        audit('backup.restored', by);
        fs.rmSync(file, { force: true });
        send(res, 200, { ok: true, restarting: true, ...r });
        console.log('[backup] restore staged; restarting');
        setTimeout(() => process.exit(0), 500); // Docker starts it again (restart: unless-stopped)
        return;
      }
    }
    return NEXT;
  };
}

module.exports = { create };

// Storage (docs/api.md, Storage; lib/storage.js): what the account's files take on the disk. The owner and the Chief
// read it and ask for a new check; only the owner clears the caches. A file or folder is deleted with the Files routes,
// which tell Storage (workspace.js onDeleted); what a deleted bot left, which no Files route opens, with DELETE
// /api/storage/gone, the owner's alone.
const { NEXT, send } = require('./http');
const W = require('../workspace-files');

function create({ storage }) {
  return async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] !== 'storage') return NEXT;
    if (by !== 'you' && by !== 'chief') return send(res, 403, { error: 'Only the owner and the Chief see the storage.' });
    const what = parts[1] || '';
    if (parts[2]) return send(res, 404, { error: 'Not here' });
    if (!what && m === 'GET') return send(res, 200, storage.view());
    if (what === 'check' && m === 'POST') { storage.start(); return send(res, 202, storage.view()); }
    if (what === 'clear-caches' && m === 'POST') {
      if (by !== 'you') return send(res, 403, { error: 'Only the owner clears the caches.' });
      try { return send(res, 200, { ...(await storage.clearCaches(by)), ...storage.view() }); } catch (e) { return send(res, 500, { error: e.message }); }
    }
    if (what === 'gone' && m === 'DELETE') {
      if (by !== 'you') return send(res, 403, { error: 'Only the owner deletes files.' });
      try {
        const rel = W.relOf(url.searchParams.get('path') || '');
        return send(res, 200, await storage.removeGone({ bot: url.searchParams.get('bot') || '', root: url.searchParams.get('root') || 'server', rel }, by));
      } catch (e) {
        if (e.status) return send(res, e.status, { error: e.message, ...(e.state ? { state: e.state } : {}) });
        if (e.code === 'EACCES' || e.code === 'EPERM') return send(res, 403, { error: "botdot can't change that.", state: 'refused' });
        return send(res, 500, { error: e.message });
      }
    }
    return send(res, 405, { error: 'Not here' });
  };
}

module.exports = { create };

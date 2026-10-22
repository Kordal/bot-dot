// A bot's workspace in its settings (#296; docs/api.md, "A bot's workspace"): /api/bots/<id>/workspace…, the owner's
// alone. ?root=server (the default) is its folder on this server, fully managed; ?root=computer its folder on the
// account's computer, browsed, opened, downloaded and deleted in while the computer runs, never started for it.
// Every write goes to the audit log as workspace-file.*, with the bot, the root and the path.
const path = require('path');
const { send, readBody } = require('./http');
const B = require('../bots');
const W = require('../workspace-files');
const { download, viewAsked, sendView, computerOn, computerFile, refusal } = require('./files');

async function workspaceRoute(req, res, url, { parts, m, by, bot, audit }) {
  if (by !== 'you') return send(res, 403, { error: "Only the owner manages a bot's workspace." });
  const ws = path.join(B.WORKSPACES_DIR, bot.id);
  const what = parts[3] || '';
  if (parts[4]) return send(res, 404, { error: 'Not here' });
  const root = url.searchParams.get('root') || 'server';
  if (!['server', 'computer'].includes(root)) return send(res, 400, { error: 'Say which folder: server or computer.' });
  const asked = url.searchParams.get('path') || '';
  // Written once the change is made: a path is logged without control characters and cut at 1,024, so the log
  // never refuses what was done.
  const clean = (p) => String(p).replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 1024) || '?';
  const logged = (action, p, more = {}) => {
    try { audit(`workspace-file.${action}`, 'you', { bot: bot.id, root, path: clean(p), ...(more.to !== undefined ? { to: clean(more.to) } : {}) }); } catch (e) { console.error(`[audit] ${e.message}`); }
  };
  try {
    if (root === 'computer') return await onComputer(req, res, url, { what, m, bot, asked, logged });
    if (!what && m === 'GET') return send(res, 200, W.list(ws, asked));
    if (what === 'file' && m === 'GET') {
      const file = W.file(ws, asked);
      const name = path.posix.basename(W.relOf(asked));
      return viewAsked(url) ? sendView(res, url, file, name) : download(res, file, name, 'no-store');
    }
    if (what === 'count' && m === 'GET') return send(res, 200, W.count(ws, asked));
    if (!what && m === 'DELETE') {
      // A file the owner gave the bot goes as in its Files section: with its readable copy and its pin.
      const rel = W.relOf(asked);
      const given = /^uploads\/[^/]+$/.test(rel) && B.botFiles.list(bot.id, ws).some((f) => f.file === rel);
      const p = given ? B.botFiles.remove(bot.id, ws, rel).file : W.remove(ws, rel);
      logged('deleted', p);
      return send(res, 200, { ok: true, path: p });
    }
    if (what === 'upload' && m === 'POST') {
      let name = 'file';
      try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch { /* keep the default */ }
      const saved = await W.upload(req, ws, asked, name);
      logged('uploaded', saved.path);
      return send(res, 201, saved);
    }
    if (what === 'folder' && m === 'POST') {
      const body = (await readBody(req)) || {};
      const p = W.makeFolder(ws, body.path ?? asked, body.name);
      logged('folder-made', p);
      return send(res, 201, { ok: true, path: p });
    }
    if (what === 'move' && m === 'POST') {
      const body = (await readBody(req)) || {};
      const from = W.relOf(body.from);
      const p = W.move(ws, from, body.to);
      if (p !== from) logged('moved', from, { to: p });
      return send(res, 200, { ok: true, path: p });
    }
  } catch (e) {
    if (e.status) return refusal(res, e);
    if (e.code === 'ENOENT') return send(res, 404, { error: 'This is gone.', state: 'gone' });
    if (e.code === 'EACCES' || e.code === 'EPERM') return send(res, 403, { error: "botdot can't change that.", state: 'refused' });
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') return send(res, 409, { error: 'Something of that name is already there.', state: 'exists' });
    throw e;
  }
  return send(res, 405, { error: 'Not here' });
}

// The bot's folder on the account's computer: list, count, open, download and delete. Nothing else changes there.
async function onComputer(req, res, url, { what, m, bot, asked, logged }) {
  const rel = W.relOf(asked);
  const root = W.computerRoot(bot.id);
  if (what === 'file' && m === 'GET') {
    if (!rel) return send(res, 400, { error: 'That is a folder, not a file.', state: 'not-file' });
    return computerFile(res, url, bot, `${root}/${rel}`, [root]);
  }
  const script = !what && m === 'GET' ? W.listScript(root, rel)
    : what === 'count' && m === 'GET' ? W.countScript(root, rel)
      : !what && m === 'DELETE' ? (rel ? W.removeScript(root, rel) : null)
        : undefined;
  if (script === undefined) return send(res, 405, { error: 'On the computer, the workspace is browsed, opened, downloaded and deleted in only.' });
  if (script === null) return send(res, 403, { error: "The bot's folder itself stays.", state: 'protected' });
  if (!(await computerOn(res, bot, 'Start it to see its files.'))) return undefined;
  const r = await B.computers.runShell(bot.id, { command: script, timeoutSeconds: 60 });
  if (r.code !== 0) return send(res, 502, { error: "Couldn't do it on the computer." });
  if (!what && m === 'GET') return send(res, 200, W.computerList(r.stdout, rel));
  if (what === 'count') return send(res, 200, W.computerCount(r.stdout));
  W.computerRemoved(r.stdout);
  logged('deleted', rel);
  return send(res, 200, { ok: true, path: rel });
}

module.exports = { workspaceRoute };

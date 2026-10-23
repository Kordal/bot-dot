// A bot's workspace in its settings (#296; docs/api.md, "A bot's workspace"): /api/bots/<id>/workspace…, the owner's
// alone. ?root=server (the default) is its folder on this server, fully managed; ?root=computer its folder on the
// account's computer, browsed, opened, downloaded and deleted in while the computer runs, never started for it.
// Every write goes to the audit log as workspace-file.*, with the bot, the root and the path.
const path = require('path');
const { send, readBody } = require('./http');
const B = require('../bots');
const W = require('../workspace-files');
const { download, viewAsked, sendView, computerOn, computerFile, refusal } = require('./files');

// The Chief's (#383) is the same, under /api/chief/workspace…: `bot` is then { id: '_chief' } (the key of its files'
// pins), `ws` its folder, `at` the index of `workspace` in `parts`, and it has no folder on the computer.
async function workspaceRoute(req, res, url, { parts, m, by, bot, audit, ws = path.join(B.WORKSPACES_DIR, bot.id), at = 2, computer = true }) {
  if (by !== 'you') return send(res, 403, { error: computer ? "Only the owner manages a bot's workspace." : "Only the owner manages the Chief's workspace." });
  const what = parts[at + 1] || '';
  if (parts[at + 2]) return send(res, 404, { error: 'Not here' });
  const root = url.searchParams.get('root') || 'server';
  if (!['server', 'computer'].includes(root) || (!computer && root !== 'server')) return send(res, 400, { error: computer ? 'Say which folder: server or computer.' : "The Chief's workspace is its folder on this server." });
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

// A bot's files (#235): what the owner and teammates gave it, kept in its uploads/. The owner lists, pins ("keep in
// mind"), downloads and deletes them; the Chief lists and deletes them, by name only, never their content.
// The Chief's own (#383) the same, under /api/chief/files: `key` '_chief', `ws` its folder, and `chief` set: then the
// Chief lists its own and keeps one in mind (its pin_file, with its summary), and only the owner deletes one.
// name: the file's name in uploads/ (the last part of `file`), as the request has it.
async function filesRoute(req, res, url, { name: asked, m, by, key, ws, chief = null }) {
  const own = !!chief && by === 'chief';
  const listed = () => ({ files: B.botFiles.list(key, ws).map((f) => (by === 'chief' && !own ? { file: f.file, name: f.name, size: f.size, at: f.at, pinned: f.pinned } : f)), maxPinned: B.botFiles.MAX_PINNED });
  if (!asked && m === 'GET') return send(res, 200, listed());
  let name = '';
  try { name = decodeURIComponent(asked || ''); } catch { /* no such file */ }
  const one = () => B.botFiles.find(key, ws, `uploads/${name}`);
  try {
    if (name && m === 'GET' && by === 'you') {
      const f = one();
      return viewAsked(url) ? sendView(res, url, path.join(ws, f.file), f.name) : download(res, path.join(ws, f.file), f.name);
    }
    if (name && m === 'PUT' && (by === 'you' || own)) {
      const body = (await readBody(req)) || {};
      // The Chief keeps a file in mind in a turn the owner started (they asked for it); its summary it saves in any.
      const f = one();
      if (own && body.pinned !== false && !f.pinned && chief.standing()?.startedBy !== 'owner') return send(res, 403, { error: 'A file is kept in mind when the owner asks for it, in a turn they started.' });
      const pinned = B.botFiles.pin(key, ws, f.file, { pinned: body.pinned !== false, ...(own && body.summary !== undefined ? { summary: body.summary } : {}), byBot: own });
      return send(res, 200, own ? { file: pinned, ...listed() } : listed());
    }
    if (name && m === 'DELETE' && !own) { B.botFiles.remove(key, ws, one().file); return send(res, 200, listed()); }
  } catch (e) {
    if (e.status === 404) return send(res, 404, { error: e.message, state: 'gone' });
    if (e.status) return send(res, e.status, { error: e.message });
    throw e;
  }
  return send(res, by === 'you' ? 405 : 403, { error: by === 'you' ? 'Not here' : chief ? 'Only the owner opens or deletes the Chief\'s files.' : 'Only the owner opens or pins a bot\'s files.' });
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

module.exports = { workspaceRoute, filesRoute };

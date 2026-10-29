// A bot's workspace in its settings (#296; docs/api.md, "A bot's workspace"): /api/bots/<id>/workspace…, the owner's
// alone. ?root=server (the default) is its folder on this server; ?root=computer its folder on the account's
// computer, managed the same while the computer runs (#576), never started for it; ?root=project&project=<name> a
// shared project's folder there that the bot is in (#578), managed as its own folder there.
// Since #603 the Files view copies within and between them, moves between them, keeps any file on botdot in mind and
// shows images small.
// Every write goes to the audit log as workspace-file.*, with the bot, the root and the path.
// `only` (#702): a project's folder alone, under /api/projects/<name>/workspace…, its one place; `bot` is then the seat
// its calls on the computer are made from (lib/project-folder.js SEAT), and no bot is logged.
const path = require('path');
const { send, readBody } = require('./http');
const B = require('../bots');
const W = require('../workspace-files');
const P = require('../projects');
const fileView = require('../file-view');
const pfs = require('../principal-fs');
const { download, viewAsked, sendView, computerOn, computerFile, refusal } = require('./files');

// The Chief's (#383) is the same, under /api/chief/workspace…: `bot` is then { id: '_chief' } (the key of its files'
// pins), `ws` its folder, `at` the index of `workspace` in `parts`, and it has no folder on the computer.
async function workspaceRoute(req, res, url, { parts, m, by, bot, audit, ws = path.join(B.WORKSPACES_DIR, bot.id), at = 2, computer = true, only = null }) {
  if (by !== 'you') return send(res, 403, { error: computer ? "Only the owner manages a bot's workspace." : "Only the owner manages the Chief's workspace." });
  const what = parts[at + 1] || '';
  if (parts[at + 2]) return send(res, 404, { error: 'Not here' });
  const root = only ? 'project' : url.searchParams.get('root') || 'server';
  // A search may look in every place at once (#604): root=all.
  if (what === 'search' && m === 'GET' && root === 'all') {
    try { return send(res, 200, await searchAll(bot, ws, url.searchParams.get('q'), computer)); } catch (e) { if (e.status) return refusal(res, e); throw e; }
  }
  if (!['server', 'computer', 'project'].includes(root) || (!computer && root !== 'server')) return send(res, 400, { error: computer ? 'Say which folder: server, computer or project.' : "The Chief's workspace is its folder on this server." });
  const project = only || (root === 'project' ? P.get(url.searchParams.get('project') || '') : null);
  if (root === 'project' && !only && !project?.bots.includes(bot.id)) return send(res, 404, { error: "The bot isn't in that project.", state: 'no-project' });
  const asked = url.searchParams.get('path') || '';
  // Written once the change is made: a path is logged without control characters and cut at 1,024, so the log
  // never refuses what was done.
  const clean = (p) => String(p).replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 1024) || '?';
  const logged = (action, p, more = {}) => {
    const there = more.place ? { toRoot: more.place.root, ...(more.place.project ? { toProject: more.place.project.name } : {}) } : {};
    try { audit(`workspace-file.${action}`, 'you', { ...(only ? {} : { bot: bot.id }), root, ...(project ? { project: project.name } : {}), path: clean(p), ...(more.to !== undefined ? { to: clean(more.to) } : {}), ...there }); } catch (e) { console.error(`[audit] ${e.message}`); }
  };
  try {
    // A move into a folder, maybe in another place, and any copy (#603): { from, into, place? }.
    const posted = (what === 'move' || what === 'copy' || what === 'keep') && m === 'POST' ? ((await readBody(req)) || {}) : null;
    if (what === 'copy' || (what === 'move' && posted && posted.into !== undefined)) {
      if (m !== 'POST') return send(res, 405, { error: 'Not here' });
      return await carry(res, { bot, ws, computer: computer && !only, here: { root, project }, body: posted, moving: what === 'move', logged, only });
    }
    if (what === 'thumb' && m === 'GET') return await thumb(res, { bot, ws, root, project, asked });
    if (root !== 'server') return await onComputer(req, res, url, { what, m, bot, asked, logged, posted, root: project ? project.folder : W.computerRoot(bot.id), as: root, project: project?.name });
    if (!what && m === 'GET') return send(res, 200, W.list(ws, asked));
    if (what === 'file' && m === 'GET') {
      const file = W.file(ws, asked);
      const name = path.posix.basename(W.relOf(asked));
      return viewAsked(url) ? sendView(res, url, file, name) : download(res, file, name, 'no-store');
    }
    if (what === 'count' && m === 'GET') return send(res, 200, W.count(ws, asked));
    if (what === 'search' && m === 'GET') return send(res, 200, W.search(ws, url.searchParams.get('q')));
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
      const saved = await W.upload(req, ws, asked, name, { folders: url.searchParams.get('folders') === '1' });
      logged('uploaded', saved.path);
      return send(res, 201, saved);
    }
    if (what === 'folder' && m === 'POST') {
      const body = (await readBody(req)) || {};
      const p = W.makeFolder(ws, body.path ?? asked, body.name, { free: body.free === true });
      logged('folder-made', p);
      return send(res, 201, { ok: true, path: p });
    }
    if (what === 'keep' && m === 'POST') {
      // Keep in mind (#235) any file on botdot: one the owner gave the bot as it is, any other as a copy in uploads/.
      const rel = W.relOf(posted.path);
      const given = /^uploads\/[^/]+$/.test(rel) && B.botFiles.list(bot.id, ws).some((f) => f.file === rel);
      const kept = given ? rel : W.keepCopy(ws, rel);
      try { B.botFiles.pin(bot.id, ws, kept, { pinned: true }); } catch (e) {
        if (!given) W.remove(ws, kept);
        throw e;
      }
      logged('kept', rel, given ? {} : { to: kept });
      return send(res, 200, { ok: true, file: kept });
    }
    if (what === 'move' && m === 'POST') {
      const body = posted;
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

// The bot's folder on the account's computer: list, count, open, download, delete and, since #576, make a folder,
// upload, rename and move, each by a fixed script of workspace-files.js run as box, the bot's own user there.
// `root`: its folder there, or a shared project's that it is in (#578).
async function onComputer(req, res, url, { what, m, bot, asked, logged, posted, root, as, project }) {
  const rel = W.relOf(asked);
  if (what === 'search' && m === 'GET') {
    const q = W.queryOf(url.searchParams.get('q'));
    if (!(await computerOn(res, bot, 'Start it to look in it.'))) return undefined;
    const places = [{ root: as, ...(project ? { project } : {}), dir: root }];
    const r = await B.computers.runShell(bot.id, { command: W.searchScript(places, q), timeoutSeconds: 30 });
    if (r.code !== 0) return send(res, 502, { error: "Couldn't look on the computer." });
    const { hits, more } = W.computerSearch(r.stdout, places, q);
    return send(res, 200, { results: W.ranked(hits, q), more: more || hits.length > W.SEARCH_MAX });
  }
  if (what === 'file' && m === 'GET') {
    if (!rel) return send(res, 400, { error: 'That is a folder, not a file.', state: 'not-file' });
    return computerFile(res, url, bot, `${root}/${rel}`, [root]);
  }
  // What is asked is checked before the computer is: a wrong name never waits on it.
  let job;
  if (!what && m === 'GET') job = { script: W.listScript(root, rel), done: (out) => send(res, 200, { ...W.computerList(out, rel), root: as }) };
  else if (what === 'count' && m === 'GET') job = { script: W.countScript(root, rel), done: (out) => send(res, 200, W.computerCount(out)) };
  else if (!what && m === 'DELETE') {
    if (!rel) return send(res, 403, { error: 'The folder itself stays.', state: 'protected' });
    job = { script: W.removeScript(root, rel), done: (out) => { W.computerRemoved(out); logged('deleted', rel); return send(res, 200, { ok: true, path: rel }); } };
  } else if (what === 'folder' && m === 'POST') {
    const body = (await readBody(req)) || {};
    const at = W.relOf(body.path ?? asked);
    job = { script: W.folderScript(root, at, W.nameOf(body.name), { free: body.free === true }), done: (out) => { const p = join(at, W.computerMade(out)); logged('folder-made', p); return send(res, 201, { ok: true, path: p }); } };
  } else if (what === 'move' && m === 'POST') {
    const body = posted;
    const from = W.relOf(body.from); const to = W.relOf(body.to);
    if (!from || !to) return send(res, 400, { error: 'Say what moves where.', state: 'refused' });
    if (to === from) return send(res, 200, { ok: true, path: to });
    if (to.startsWith(`${from}/`)) return send(res, 400, { error: "A folder can't go into itself.", state: 'refused' });
    W.nameOf(path.posix.basename(to));
    job = { script: W.moveScript(root, from, to), done: (out) => { W.computerMoved(out); logged('moved', from, { to }); return send(res, 200, { ok: true, path: to }); } };
  } else if (what === 'upload' && m === 'POST') {
    let name = 'file';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch { /* keep the default */ }
    const script = W.putScript(root, rel, W.uploadName(name), { folders: url.searchParams.get('folders') === '1' });
    if (!(await computerOn(res, bot, 'Start it to upload into it.'))) return undefined; // before 25 MB are read
    const data = await W.readUpload(req);
    job = { on: true, data, script, done: (out) => { const n = W.computerMade(out); const p = join(rel, n); logged('uploaded', p); return send(res, 201, { name: n, path: p, size: data.length }); } };
  } else return send(res, 405, { error: 'Not here' });
  if (!job.on && !(await computerOn(res, bot, 'Start it to see its files.'))) return undefined;
  // A shared project's folder is made first where it is not there yet (#578): it is the project's top.
  if (project) job.script = `(\n${P.makeScript([project])}\n) >/dev/null 2>&1\n${job.script}`;
  const r = job.data
    ? await B.computers.putFile(bot.id, { script: job.script, data: job.data })
    : await B.computers.runShell(bot.id, { command: job.script, timeoutSeconds: 60 });
  if (r.code !== 0) return send(res, 502, { error: "Couldn't do it on the computer." });
  return job.done(r.stdout);
}
const join = (rel, name) => (rel ? `${rel}/${name}` : name);

// A copy, or a move into a folder, of `from` in this place (`here`) into folder `into` of `place` ({ root, project? },
// this place when left out), under its own name or a free one (#603). Between botdot and the computer it is carried
// as a tar, at most W.MAX_CARRIED; on the computer box does it; a move between places takes it from where it was only
// once it is whole in its new place. Answers { ok, path, root, project? }.
async function carry(res, { bot, ws, computer, here, body, moving, logged, only = null }) {
  const from = W.relOf(body.from); const into = W.relOf(body.into ?? '');
  if (!from) return send(res, 400, { error: moving ? 'Say what moves where.' : 'Say what to copy.', state: 'refused' });
  const asked = body.place && typeof body.place === 'object' ? body.place : {};
  const toRoot = only ? 'project' : asked.root ?? here.root;
  if (!only && (!['server', 'computer', 'project'].includes(toRoot) || (!computer && toRoot !== 'server'))) return send(res, 400, { error: computer ? 'Say which folder: server, computer or project.' : "The Chief's workspace is its folder on this server." });
  const toProject = only || (toRoot === 'project' ? (toRoot === here.root && asked.project === undefined ? here.project : P.get(String(asked.project || ''))) : null);
  if (toRoot === 'project' && !only && !toProject?.bots.includes(bot.id)) return send(res, 404, { error: "The bot isn't in that project.", state: 'no-project' });
  const place = { root: toRoot, project: toProject };
  const folderOf = (p) => (p.root === 'project' ? p.project.folder : W.computerRoot(bot.id));
  const madeFirst = (script) => {
    const made = [here.project, toProject].filter(Boolean);
    return made.length ? `(\n${P.makeScript(made.map((p) => p.name))}\n) >/dev/null 2>&1\n${script}` : script;
  };
  const done = (p) => {
    logged(moving ? 'moved' : 'copied', from, { to: p, ...(toRoot !== here.root || toProject?.name !== here.project?.name ? { place } : {}) });
    return send(res, moving ? 200 : 201, { ok: true, path: p, root: toRoot, ...(toProject ? { project: toProject.name } : {}) });
  };
  const failed = () => send(res, 502, { error: "Couldn't do it on the computer." });
  if (here.root === 'server' && toRoot === 'server') return done(moving ? W.moveInto(ws, from, into) : W.copy(ws, from, into));
  if (here.root !== 'server' && toRoot !== 'server') {
    if (!(await computerOn(res, bot, 'Start it to copy or move its files.'))) return undefined;
    const r = await B.computers.runShell(bot.id, { command: madeFirst(W.carryScript(folderOf(here), from, folderOf(place), into, { move: moving })), timeoutSeconds: 120 });
    if (r.code !== 0) return failed();
    return done(join(into, W.computerMade(r.stdout)));
  }
  if (here.root === 'server') {
    // From botdot to the computer: packed here, unpacked there by box.
    if (moving) W.movable(from);
    if (!(await computerOn(res, bot, 'Start it to copy or move files to it.'))) return undefined;
    const packed = W.packServer(ws, from, { move: moving });
    const r = await B.computers.putFile(bot.id, { script: madeFirst(W.unpackScript(folderOf(place), into, packed.name)), data: packed.tar });
    if (r.code !== 0) return failed();
    const p = join(into, W.computerMade(r.stdout));
    if (moving) W.remove(ws, from);
    return done(p);
  }
  // From the computer to botdot: packed there by box, unpacked here.
  if (!(await computerOn(res, bot, 'Start it to copy or move its files.'))) return undefined;
  const r = await B.computers.bringOut(bot.id, { script: madeFirst(W.packScript(folderOf(here), from, undefined, { move: moving })) });
  if (r.code !== 0) return failed();
  const p = W.unpackServer(ws, into, W.computerPacked(r.stdout));
  if (moving) {
    // Taken from the computer only once it is here; if that fails, the copy here goes too: whole or not at all.
    const gone = await B.computers.runShell(bot.id, { command: W.removeScript(folderOf(here), from), timeoutSeconds: 60 }).catch(() => ({ code: 1 }));
    try {
      if (gone.code !== 0) throw new Error('not removed');
      W.computerRemoved(gone.stdout);
    } catch (e) {
      W.remove(ws, p);
      if (e.status) throw e;
      return failed();
    }
  }
  return done(p);
}

// An image small enough to show in a grid as itself (#603): png, jpg, gif or webp of at most THUMB_BYTES, kept by the
// browser a few minutes. Anything else is 404 { state: 'no-thumb' }: the apps draw its icon.
const THUMB_BYTES = 1024 * 1024;
async function thumb(res, { bot, ws, root, project, asked }) {
  const rel = W.relOf(asked);
  const type = fileView.TYPES[(rel.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()];
  const none = () => send(res, 404, { error: 'No small picture of this.', state: 'no-thumb' });
  if (!rel || !/^image\/(png|jpeg|gif|webp)$/.test(type || '')) return none();
  let bytes;
  if (root === 'server') {
    // One call to the privilege broker, never more: a grid asks for many (lib/principal-fs-worker.js readSmall).
    const got = pfs.readSmallSync(path.join(ws, ...rel.split('/')), THUMB_BYTES, ws);
    if (!got?.data) return none();
    bytes = Buffer.from(got.data, 'base64');
  } else {
    if (!(await computerOn(res, bot, 'Start it to see its files.'))) return undefined;
    const top = project ? project.folder : W.computerRoot(bot.id);
    const r = await B.computers.runShell(bot.id, { command: fileView.computerScript(`${top}/${rel}`, { roots: [top], max: THUMB_BYTES + 1 }), timeoutSeconds: 30 });
    if (r.code !== 0) return send(res, 502, { error: "Couldn't read it on the computer." });
    const got = fileView.computerAnswer(r.stdout);
    if (got.size > THUMB_BYTES) return none();
    bytes = got.bytes;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  return res.end(bytes);
}

// Every place of the bot at once (#604): its folder on this server and, while the account's computer runs, its folder
// there and each shared project it is in, in one script. A computer that is off is not started: it is left out.
async function searchAll(bot, ws, q, computer) {
  const want = W.queryOf(q);
  const here = W.search(ws, want);
  let there = { hits: [], more: false };
  if (computer && bot.computer === 'linux' && (await B.computers.inspect(bot.id).catch(() => ({ state: 'none' }))).state === 'running') {
    const places = [{ root: 'computer', dir: W.computerRoot(bot.id) }, ...P.ofBot(bot.id).map((p) => ({ root: 'project', project: p.name, dir: p.folder }))];
    try {
      const r = await B.computers.runShell(bot.id, { command: W.searchScript(places, want), timeoutSeconds: 30 });
      if (r.code === 0) there = W.computerSearch(r.stdout, places, want);
    } catch (e) { console.error(`[workspace] search on the computer for ${bot.id}: ${e.message}`); }
  }
  const all = [...here.results, ...there.hits];
  return { results: W.ranked(all, want), more: here.more || there.more || all.length > W.SEARCH_MAX };
}

module.exports = { workspaceRoute, filesRoute };

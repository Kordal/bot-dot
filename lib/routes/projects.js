// Shared projects (#578, lib/projects.js, ADR 097): /api/projects…, the owner's alone. A project is a folder on the
// account's computer that the bots in it work in together; its files are browsed and managed in a member's Workspace
// (lib/routes/workspace.js, ?root=project&project=<name>).
// A project of the Projects place has its folder here too (#702, ADR 122): listed with `project`, its id; its bots are
// its teams', changed there, and it goes with the project. /api/projects/<name>/workspace… is its folder alone, as the
// owner's Files opens it from the project's settings, the account's computer started for it when it is off.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const P = require('../projects');
const W = require('../workspace-files');
const { workspaceRoute } = require('./workspace');
const { SEAT } = require('../project-folder');

function create({ audit }) {
  // The bots asked for: each one on the account's computer.
  const membersOf = (bots) => {
    if (!Array.isArray(bots) || !bots.length) throw Object.assign(new Error('Put at least one bot in the project.'), { status: 400 });
    for (const id of bots) {
      const b = typeof id === 'string' ? B.bots.get(id) : null;
      if (!b) throw Object.assign(new Error('One of those bots is gone.'), { status: 400 });
      if (b.computer !== 'linux') throw Object.assign(new Error(`${b.name} doesn't use the account's computer, where a project's folder is.`), { status: 400 });
    }
    return bots;
  };
  // A bot whose seat runs a command on the account's computer, when it runs: else null.
  const running = async (bots) => {
    const seat = [...bots, ...B.bots.list().filter((b) => b.computer === 'linux').map((b) => b.id)].find((id) => B.bots.get(id)?.computer === 'linux');
    if (!seat) return null;
    return (await B.computers.inspect(seat).catch(() => ({ state: 'none' }))).state === 'running' ? seat : null;
  };
  const makeFolder = async (p) => {
    const seat = await running(p.bots);
    if (seat) await B.computers.runShell(seat, { command: P.makeScript([p.name]), timeoutSeconds: 30 }).catch((e) => console.warn(`[projects] ${e.message}`));
  };
  const logged = (action, p) => { try { audit(`project.${action}`, 'you', { project: p.name, bots: p.bots }); } catch (e) { console.error(`[audit] ${e.message}`); } };

  return async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] !== 'projects' || (parts[2] && parts[2] !== 'workspace')) return NEXT;
    if (by !== 'you') return send(res, 403, { error: 'Only the owner manages projects.' });
    let name = '';
    try { name = decodeURIComponent(parts[1] || ''); } catch { return send(res, 404, { error: 'That project is gone.', state: 'gone' }); }
    if (parts[2] === 'workspace') {
      const p = P.get(name);
      if (!p) return send(res, 404, { error: 'That project is gone.', state: 'gone' });
      try { await B.projectFolder.on(); } catch (e) { return send(res, 502, { error: `The computer couldn't start: ${e.message}` }); }
      return workspaceRoute(req, res, url, { parts, m, by, audit, bot: { id: SEAT, computer: 'linux' }, only: p });
    }
    try {
      if (!name && m === 'GET') return send(res, 200, { projects: P.list(), max: P.MAX_PROJECTS });
      if (!name && m === 'POST') {
        const body = (await readBody(req)) || {};
        const p = P.create(body.name, membersOf(body.bots));
        await makeFolder(p);
        logged('created', p);
        return send(res, 201, p);
      }
      const p = name && P.get(name);
      if (!p) return send(res, 404, { error: 'That project is gone.', state: 'gone' });
      if (m === 'GET') return send(res, 200, p);
      if ((m === 'PUT' || m === 'DELETE') && p.project) return send(res, 409, { error: P.LINKED, state: 'linked' });
      if (m === 'PUT') {
        const body = (await readBody(req)) || {};
        const changed = P.setBots(p.name, membersOf(body.bots));
        await makeFolder(changed);
        logged('changed', changed);
        return send(res, 200, changed);
      }
      if (m === 'DELETE') {
        // Its folder goes with it, so the computer must run; a project no bot can reach any more just goes.
        const seat = await running(p.bots);
        const anyone = B.bots.list().some((b) => b.computer === 'linux');
        if (!seat && anyone) return send(res, 409, { error: 'The computer is off. Start it to delete the project with its files.', state: 'computer-off' });
        if (seat) {
          const r = await B.computers.runShell(seat, { command: W.removeScript(P.ROOT, p.name), timeoutSeconds: 120 });
          if (r.code !== 0) return send(res, 502, { error: "Couldn't do it on the computer." });
          try { W.computerRemoved(r.stdout); } catch (e) { if (e.status !== 404) throw e; } // a folder never made goes too
        }
        P.remove(p.name);
        logged('deleted', p);
        return send(res, 200, { ok: true, name: p.name });
      }
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message, ...(e.state ? { state: e.state } : {}) });
      throw e;
    }
    return send(res, 405, { error: 'Not here' });
  };
}

module.exports = { create };

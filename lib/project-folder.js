// A project's folder (#702, ADR 122): /workspace/projects/<name> on the account's computer (lib/projects.js), shared by
// every bot of the project's teams. A bot that works on the account's computer reaches it with its own tools there; any
// other (on botdot alone, or on boat.dev) reaches it over botdot, with the tools of lib/self-mcp.js, which call this.
// The owner's Files opens it the same way. One truth, on the computer: no copy to keep in step.
//
// Every call is made from a seat of its own, SEAT, never a bot's: a bot's calls go to its own machine (boat.dev), and
// the folder is on the account's computer. The computer is started when it is off, as a bot's first computer tool does.
const path = require('path');
const P = require('./projects');
const W = require('./workspace-files');
const fileView = require('./file-view');

const SEAT = 'projects';
// What a bot reads as text: at most this much of a file, and only one that is text.
const TEXT_MAX = 100_000;

// `computers`: lib/computer-screens.js's facade (B.computers).
function create({ computers }) {
  async function on() {
    if ((await computers.inspect(SEAT).catch(() => ({ state: 'none' }))).state !== 'running') await computers.ensure();
  }
  // The project's folder is made first where it is not there yet, as for a member's Workspace (ADR 097).
  const first = (p, script) => `(\n${P.makeScript([p.name])}\n) >/dev/null 2>&1\n${script}`;
  const failed = (r) => new Error(`Couldn't do it on the computer${r.error ? `: ${r.error}` : ''}.`);
  async function shell(p, script, timeoutSeconds = 60) {
    await on();
    const r = await computers.runShell(SEAT, { command: first(p, script), timeoutSeconds });
    if (r.code !== 0) throw failed(r);
    return r.stdout;
  }
  async function put(p, script, data) {
    await on();
    const r = await computers.putFile(SEAT, { script: first(p, script), data });
    if (r.code !== 0) throw failed(r);
    return r.stdout;
  }

  // A folder of it, as the Workspace lists one.
  const list = async (p, rel) => W.computerList(await shell(p, W.listScript(p.folder, W.relOf(rel))), W.relOf(rel));
  // A text file of it: { text, size, cut }.
  async function read(p, rel) {
    const r = W.relOf(rel);
    if (!r) throw fileView.refused('That is a folder, not a file.', 400, 'not-file');
    const got = fileView.computerAnswer(await shell(p, fileView.computerScript(`${p.folder}/${r}`, { roots: [p.folder], max: TEXT_MAX * 4 })));
    if (got.bytes.includes(0)) throw fileView.refused(`${r} is not text: copy it to your workspace with copy_from_project instead.`, 400, 'not-text');
    const text = got.bytes.toString('utf8');
    return { text: text.slice(0, TEXT_MAX), size: got.size, cut: text.length > TEXT_MAX || got.bytes.length < got.size };
  }
  // A text file written at `rel`, in place of what was there.
  async function write(p, rel, content) {
    const r = W.relOf(rel);
    if (!r) throw fileView.refused('Say which file.', 400, 'refused');
    W.nameOf(path.posix.basename(r));
    const data = Buffer.from(String(content ?? ''), 'utf8');
    if (data.length > W.MAX_BYTES) throw fileView.refused(`That is over ${W.MAX_BYTES / 1024 / 1024} MB.`, 413, 'too-large');
    W.computerRemoved(await put(p, W.writeScript(p.folder, r), data));
    return r;
  }
  async function remove(p, rel) {
    const r = W.relOf(rel);
    if (!r) throw fileView.refused('The folder itself stays.', 403, 'protected');
    W.computerRemoved(await shell(p, W.removeScript(p.folder, r)));
    return r;
  }
  // `from`, a file or folder of the bot's workspace on botdot (`ws`), copied into folder `into` of the project, under
  // its own name or a free one. Answers its path there.
  async function copyIn(p, ws, from, into) {
    const dir = W.relOf(into ?? '');
    const packed = W.packServer(ws, from);
    const name = W.computerMade(await put(p, W.unpackScript(p.folder, dir, packed.name), packed.tar));
    return dir ? `${dir}/${name}` : name;
  }
  // `rel` of the project copied into folder `into` of the bot's workspace. Answers its path there.
  async function copyOut(p, ws, rel, into) {
    const r = W.relOf(rel);
    if (!r) throw fileView.refused('Say what to copy.', 400, 'refused');
    await on();
    const got = await computers.bringOut(SEAT, { script: first(p, W.packScript(p.folder, r)) });
    if (got.code !== 0) throw failed(got);
    return W.unpackServer(ws, into ?? '', W.computerPacked(got.stdout));
  }
  // The whole folder, with what it holds, when the owner deletes the project with it.
  async function removeAll(p) {
    await on();
    const r = await computers.runShell(SEAT, { command: W.removeScript(P.ROOT, p.name), timeoutSeconds: 120 });
    if (r.code !== 0) throw failed(r);
    try { W.computerRemoved(r.stdout); } catch (e) { if (e.status !== 404) throw e; } // a folder never made goes too
  }
  // Made now, while the computer runs (a new project): else on the first use.
  async function make(p) {
    if ((await computers.inspect(SEAT).catch(() => ({ state: 'none' }))).state !== 'running') return;
    await computers.runShell(SEAT, { command: P.makeScript([p.name]), timeoutSeconds: 30 }).catch((e) => console.warn(`[projects] ${e.message}`));
  }
  return { on, list, read, write, remove, copyIn, copyOut, removeAll, make };
}

// A listing as a bot reads it: one line per entry.
function listText(l) {
  if (!l.entries.length) return 'Empty.';
  const lines = l.entries.map((e) => (e.type === 'folder' ? `${e.path}/ (${e.items ?? 0} items)` : e.type === 'file' ? `${e.path} (${e.size} bytes)` : `${e.path} (link)`));
  return [...lines, ...(l.more ? [`and ${l.more} more`] : [])].join('\n');
}

module.exports = { create, SEAT, TEXT_MAX, listText };

// The bridge between a bot's two places for files (#545): its workspace on botdot (data/workspaces/<bot>: uploads/,
// Read, Write, attach_file) and its folder on the account's computer (/workspace/<bot>: run_shell, read_file,
// write_file), two disks. attach_file and message_bot take a file of the computer too, brought out byte for byte;
// a file handed to the bot is in uploads/ of both, under the same name. `computers` is lib/computer-screens.js's
// facade, by bot id.
const path = require('path');
const fileView = require('./file-view');
const uploads = require('./uploads');

const HOME = '/home/box';
// What a bot may bring out: its own folder there, and the computer's home, where its browser downloads.
const rootsOf = (botId) => [`/workspace/${botId}`, HOME];

// The path on the computer a bot named, or null for one in its workspace: /workspace/…, /home/box/… or ~/….
function computerPath(p) {
  let s = String(p || '').trim();
  if (s.startsWith('~/')) s = `${HOME}/${s.slice(2)}`;
  if (!s.startsWith('/')) return null;
  s = path.posix.normalize(s);
  return s.startsWith('/workspace/') || s.startsWith(`${HOME}/`) ? s : null;
}

// A file of the bot's on its computer, whole: { name, data }. Throws in plain words.
async function bringOut(computers, botId, file, { roots = rootsOf(botId) } = {}) {
  const outside = new Error(`${file} isn't in your folder on the computer, /workspace/${botId}, or in ${HOME}.`);
  const r = await computers.bringOut(botId, { script: fileView.computerScript(file, { roots, max: uploads.MAX_BYTES + 1 }) });
  if (r.code !== 0) throw new Error(`Couldn't read ${file} on your computer: ${(r.error || r.stderr || 'no answer from it').trim().slice(0, 200)}.`);
  let got;
  try { got = fileView.computerAnswer(r.stdout); } catch (e) {
    if (e.message === fileView.OUTSIDE) throw outside;
    if (e.state === 'not-file') throw new Error(`${file} is a folder, not a file.`);
    throw new Error(`There's no file ${file} on your computer.`);
  }
  if (got.size > uploads.MAX_BYTES) throw new Error(`${file} is over ${uploads.MAX_BYTES / 1024 / 1024} MB.`);
  if (!got.size) throw new Error(`${file} is empty.`);
  if (got.bytes.length !== got.size) throw new Error(`${file} changed while it was read. Try again.`);
  return { name: path.posix.basename(file), data: got.bytes };
}

// The files of the bot's uploads/ in its workspace that its computer lacks, copied there. Names the files copied.
// `files` are bot-files.js list()'s, newest first. A file that can't be copied is left for the next run.
async function copyUploads(computers, botId, workspace, files, { fs = require('./principal-fs') } = {}) {
  if (!files.length) return [];
  const listed = await computers.listUploads(botId);
  if (listed.code !== 0) throw new Error(listed.error || listed.stderr || "couldn't list uploads/ on the computer");
  const there = new Set(String(listed.stdout).split('\n'));
  const copied = [];
  for (const f of files) {
    const name = path.posix.basename(f.file);
    if (there.has(name)) continue;
    const r = await computers.putUpload(botId, { name, data: fs.readFileSync(path.join(workspace, f.file)) });
    if (r.code !== 0) throw new Error(r.error || r.stderr || `couldn't copy ${name}`);
    copied.push(name);
  }
  return copied;
}

module.exports = { computerPath, bringOut, copyUploads, rootsOf };

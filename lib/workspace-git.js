// Git in a bot's workspace and on the account's computer. Kept free of the rest of botdot: the privilege
// broker's file worker (lib/principal-fs-worker.js) runs it as the bot.
//
// A bot's workspace is no git repository of its own: botdot used to make an empty one there, and a bot that ran
// git in its workspace rather than in its clone got "does not have any commits yet" or "'origin' does not appear
// to be a git repository". What that empty repository was for, keeping git from finding the repository botdot's
// data sits in, is GIT_CEILING_DIRECTORIES on each run now (lib/identity.js runAs).
//
// Each bot commits under its own name: botdot's git identity for it is the lowest of git's levels (the "system"
// file, GIT_CONFIG_SYSTEM), so what the bot, the owner or a repository sets wins.
const fs = require('node:fs');
const path = require('node:path');

// Where a principal's git identity is, in its home, for its runs on the botdot server.
const IDENTITY_FILE = '.botdot-gitconfig';
// The same for each bot on the account's computer, whose home /home/box every bot shares.
const computerIdentityFile = (botId) => `/home/box/.config/botdot/git/${botId}`;

// A value as git config reads it: in quotes, with no line break or control character.
const quoted = (s) => `"${String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/[\\"]/g, '\\$&')}"`;
// botdot's git identity for a bot: its name, and an address that reaches nobody (.invalid never resolves). The
// machine's own /etc/gitconfig, which GIT_CONFIG_SYSTEM stands in for, still applies (git skips it when missing).
function identityConfig(id, name) {
  const who = String(name || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() || id;
  return `[include]\n\tpath = /etc/gitconfig\n[user]\n\tname = ${quoted(who)}\n\temail = ${quoted(`${id}@bots.botdot.invalid`)}\n`;
}

// Whether the folder's .git is one nothing was ever done in: no commit, branch, tag, staged file, remote or
// submodule. Only such a one is removed; a link or a .git file (a worktree's) is left as it is.
function emptyRepo(gitDir) {
  let st;
  try { st = fs.lstatSync(gitDir); } catch { return false; }
  if (!st.isDirectory()) return false;
  const has = (name) => { try { fs.lstatSync(path.join(gitDir, name)); return true; } catch { return false; } };
  if (['index', 'packed-refs', 'shallow', 'modules', 'worktrees'].some(has)) return false;
  const holdsFiles = (dir) => {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    return list.some((e) => !e.isDirectory() || holdsFiles(path.join(dir, e.name)));
  };
  if (holdsFiles(path.join(gitDir, 'refs')) || holdsFiles(path.join(gitDir, 'objects'))) return false;
  let config = '';
  try { config = fs.readFileSync(path.join(gitDir, 'config'), 'utf8'); } catch { /* none */ }
  return !/^\s*\[\s*(remote|submodule|branch)\b/im.test(config);
}

// A bot's workspace as a run finds it: the folder there, no empty repository at its top, and its git identity
// written when it changed (its name did). identity: { file, content }, or none.
function prepare(dir, identity) {
  fs.mkdirSync(dir, { recursive: true });
  const gitDir = path.join(dir, '.git');
  if (emptyRepo(gitDir)) fs.rmSync(gitDir, { recursive: true, force: true });
  if (!identity) return;
  let now = null;
  try { now = fs.readFileSync(identity.file, 'utf8'); } catch { /* not there yet */ }
  if (now === identity.content) return;
  fs.mkdirSync(path.dirname(identity.file), { recursive: true });
  fs.writeFileSync(identity.file, identity.content, { mode: 0o600 });
}

module.exports = { IDENTITY_FILE, computerIdentityFile, identityConfig, emptyRepo, prepare };

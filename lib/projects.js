// Shared projects (#578, ADR 097): a folder on the account's computer, /workspace/projects/<name>, and the bots the
// owner put in it. Every bot there works as box (ADR 035), so they all read and write it; only a bot that uses the
// account's computer can be in one. Kept in data/projects.json: [{ name, bots, createdAt }]. The folder is made when
// the project is made while the computer runs, and else on the first computer use of a member's run.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');
const { refused } = require('./file-view');

const DATA_DIR = process.env.BOT_DOT_DATA || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'projects.json');
const ROOT = '/workspace/projects';
const MAX_NAME = 64;
const MAX_PROJECTS = 50;

const folder = (name) => `${ROOT}/${name}`;
const all = () => readJson(FILE, []).filter((p) => p && typeof p.name === 'string' && Array.isArray(p.bots));
const save = (list) => writeJson(FILE, list);

// A project's name is one folder name: no "/", not hidden, at most 64 characters.
function nameOf(n) {
  const s = String(n ?? '').normalize('NFC').trim();
  if (!s || s.startsWith('.') || s.includes('/') || s.includes('\\') || /[\u0000-\u001f\u007f]/.test(s) || s.length > MAX_NAME) {
    throw refused(`Give the project a name of at most ${MAX_NAME} characters, without / and not starting with a dot.`, 400, 'refused');
  }
  return s;
}

const list = () => all().map((p) => ({ name: p.name, bots: p.bots, createdAt: p.createdAt || null, folder: folder(p.name) }));
const get = (name) => list().find((p) => p.name === name) || null;
const ofBot = (botId) => list().filter((p) => p.bots.includes(botId));

function create(name, bots, now = new Date()) {
  const n = nameOf(name);
  const had = all();
  if (had.some((p) => p.name === n)) throw refused(`There is a project called ${n} already.`, 409, 'exists');
  if (had.length >= MAX_PROJECTS) throw refused(`An account has at most ${MAX_PROJECTS} projects.`, 409, 'too-many');
  save([...had, { name: n, bots: [...new Set(bots)], createdAt: now.toISOString() }]);
  return get(n);
}
function setBots(name, bots) {
  const had = all();
  const p = had.find((x) => x.name === name);
  if (!p) throw refused('That project is gone.', 404, 'gone');
  p.bots = [...new Set(bots)];
  save(had);
  return get(name);
}
function remove(name) {
  const had = all();
  if (!had.some((p) => p.name === name)) return false;
  save(had.filter((p) => p.name !== name));
  return true;
}
// A deleted bot leaves its projects; a project with no bot left stays until the owner deletes it.
function dropBot(botId) {
  const had = all();
  if (!had.some((p) => p.bots.includes(botId))) return;
  save(had.map((p) => ({ ...p, bots: p.bots.filter((b) => b !== botId) })));
}

// The folders of `names`, made as box where they are not there yet; a link in place of one, or of projects/, is
// left alone. Prints one line for each it could not make.
function makeScript(names) {
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  return [
    `[ -L ${q(ROOT)} ] && { echo "link ${ROOT}"; exit 0; }`,
    `mkdir -p -- ${q(ROOT)} || exit 0`,
    ...names.map((n) => `[ -L ${q(folder(n))} ] && echo "link ${n}" || mkdir -p -- ${q(folder(n))} || echo "failed ${n}"`),
    'exit 0',
  ].join('\n');
}

// What a member's prompt says of its projects (only for a bot on the account's computer). nameOfBot: id -> name.
function promptNote(botId, nameOfBot = (id) => id) {
  const mine = ofBot(botId);
  if (!mine.length) return '';
  const line = (p) => {
    const others = p.bots.filter((b) => b !== botId).map(nameOfBot).filter(Boolean);
    return `- ${p.name}: ${p.folder}${others.length ? `, with ${others.join(', ')}` : ''}`;
  };
  return `Shared projects: folders on your computer that you and the teammates named work in together, for the work the owner gives you on that project. Their files are yours and theirs: change them there, not in a copy in your own folder, and leave what a teammate is in the middle of.\n${mine.map(line).join('\n')}`;
}

module.exports = { ROOT, MAX_NAME, MAX_PROJECTS, FILE, folder, nameOf, list, get, ofBot, create, setBots, remove, dropBot, makeScript, promptNote };

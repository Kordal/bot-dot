// Importing many skills from one link (#30): a link to a repository or a folder that holds several skills lists
// them all, and the owner imports the ones ticked in one go, each through the path one import takes. Against a
// stand-in for GitHub: no test reaches it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('node:http');
const vm = require('vm');
const { startServer, makeBot } = require('./helpers');
const { cut, esc } = require('./web-page');

// github.com/acme/kit: three skills under skills/, one of them ("notes") with a script, one SKILL.md nested
// inside a skill (part of that skill, not one of its own), and a fourth whose folder name is no skill name.
const md = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\nDo it well.`;
const FILES = {
  'README.md': 'A kit.',
  'skills/tidy-desk/SKILL.md': md('tidy-desk', 'Keeps a desk tidy.'),
  'skills/notes/SKILL.md': md('notes', 'Takes notes.'),
  'skills/notes/run.sh': 'echo hi',
  'skills/notes/examples/SKILL.md': md('example', 'An example inside notes.'),
  'skills/weekly-report/SKILL.md': md('weekly-report', 'Writes the weekly report.'),
  'skills/Bad Name!/SKILL.md': '---\ndescription: No usable name.\n---\nx',
};

async function fakeGithub() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url);
    seen.push(url);
    if (url === '/repos/acme/kit') return res.end(JSON.stringify({ default_branch: 'main' }));
    const tree = url.match(/^\/repos\/acme\/kit\/git\/trees\/main(?::([^?]*))?\?recursive=1$/);
    if (tree) {
      const base = tree[1] ? `${tree[1]}/` : '';
      const blobs = Object.entries(FILES).filter(([p]) => p.startsWith(base)).map(([p, c]) => ({ type: 'blob', path: p.slice(base.length), size: c.length }));
      return res.end(JSON.stringify({ tree: blobs }));
    }
    const raw = url.match(/^\/acme\/kit\/main\/(.*)$/);
    if (raw && FILES[raw[1]] !== undefined) return res.end(FILES[raw[1]]);
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${server.address().port}`;
  return { env: { BOT_DOT_GITHUB_API_URL: at, BOT_DOT_GITHUB_RAW_URL: at }, seen, close: () => server.close() };
}

let github, S, data;
before(async () => {
  github = await fakeGithub();
  Object.assign(process.env, github.env); // lib/skills reads where GitHub is when it is created
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-skills-many-'));
  S = require('../lib/skills').create(data);
});
after(() => github.close());

const listings = () => github.seen.filter((u) => u.includes('/git/trees/')).length;

test('a link to one skill is previewed as before', async () => {
  const p = await S.previewImport('https://github.com/acme/kit/tree/main/skills/tidy-desk', { many: true });
  assert.equal(p.many, undefined);
  assert.equal(p.name, 'tidy-desk');
  assert.ok(p.id);
});

test('without many, a repository of several skills is still refused (a skill a bot asks for is one skill)', async () => {
  await assert.rejects(S.previewImport('https://github.com/acme/kit'), /That repository has 4 skills/);
});

test('a repository link lists every skill found, with what each holds, from one listing', async () => {
  S.save({ name: 'notes', description: 'Mine.', instructions: 'My own notes skill.' });
  const before = listings();
  const p = await S.previewImport('https://github.com/acme/kit', { many: true });
  assert.equal(listings() - before, 1, 'one listing call');
  assert.equal(p.many, true);
  assert.ok(p.id);
  assert.equal(p.url, 'https://github.com/acme/kit');
  assert.deepEqual(p.skills.map((k) => k.folder), ['skills/Bad Name!', 'skills/notes', 'skills/tidy-desk', 'skills/weekly-report']);
  const by = Object.fromEntries(p.skills.map((k) => [k.folder.split('/').pop(), k]));
  assert.equal(by.notes.name, 'notes');
  assert.equal(by.notes.description, 'Takes notes.');
  assert.equal(by.notes.exists, true, 'flagged: the library has one of that name');
  assert.deepEqual(by.notes.scripts, ['run.sh']);
  assert.equal(by.notes.fileCount, 2, 'its nested SKILL.md is one of its files');
  assert.equal(by['tidy-desk'].exists, false);
  assert.equal(by['tidy-desk'].problem, undefined);
  assert.equal(by['Bad Name!'].name, 'bad-name', 'named as one import names it');
  assert.equal(p.skills.length, 4, 'a SKILL.md inside a skill is not a skill of its own');
});

test('a folder link lists the skills in that folder', async () => {
  const p = await S.previewImport('https://github.com/acme/kit/tree/main/skills', { many: true });
  assert.equal(p.many, true);
  assert.deepEqual(p.skills.map((k) => k.folder), ['skills/Bad Name!', 'skills/notes', 'skills/tidy-desk', 'skills/weekly-report']);
});

test('importing the ticked ones skips those the library has unless told to replace them, and says how many', async () => {
  const p = await S.previewImport('https://github.com/acme/kit', { many: true });
  const r = await S.confirmImportMany(p.id, { folders: ['skills/notes', 'skills/tidy-desk', 'skills/weekly-report'] });
  assert.deepEqual(r.imported, ['tidy-desk', 'weekly-report']);
  assert.deepEqual(r.skipped, ['notes']);
  assert.deepEqual(r.failed, []);
  assert.equal(r.text, 'Imported 2 skills. Skipped 1 you already have.');
  assert.match(S.read('notes').instructions, /My own notes skill/, 'kept');
  const tidy = S.read('tidy-desk');
  assert.equal(tidy.source, 'github');
  assert.equal(tidy.sourceUrl, 'https://github.com/acme/kit');
  assert.equal(tidy.description, 'Keeps a desk tidy.');
  await assert.rejects(S.confirmImportMany(p.id, { folders: ['skills/notes'] }), /expired/, 'a preview is used once');
});

test('with overwrite, the ones the library has are replaced, files and all', async () => {
  const p = await S.previewImport('https://github.com/acme/kit', { many: true });
  const r = await S.confirmImportMany(p.id, { folders: ['skills/notes'], overwrite: true });
  assert.deepEqual(r.imported, ['notes']);
  assert.equal(r.text, 'Imported 1 skill.');
  const notes = S.read('notes');
  assert.equal(notes.description, 'Takes notes.');
  assert.deepEqual(notes.scripts, ['run.sh']);
  assert.ok(fs.existsSync(path.join(data, 'skills', 'notes', 'examples', 'SKILL.md')));
});

test('a skill that cannot be imported is said, and the rest go in', async () => {
  fs.rmSync(path.join(data, 'skills', 'tidy-desk'), { recursive: true, force: true });
  const p = await S.previewImport('https://github.com/acme/kit', { many: true });
  delete FILES['skills/weekly-report/SKILL.md']; // gone from GitHub since the preview
  try {
    const r = await S.confirmImportMany(p.id, { folders: ['skills/tidy-desk', 'skills/weekly-report', 'skills/nowhere'], overwrite: true });
    assert.deepEqual(r.imported, ['tidy-desk']);
    assert.deepEqual(r.failed.map((f) => f.name), ['weekly-report']);
    assert.match(r.failed[0].error, /Not found on GitHub/);
    assert.equal(r.text, 'Imported 1 skill. 1 could not be imported: weekly-report (Not found on GitHub (is the repository public?)).');
  } finally { FILES['skills/weekly-report/SKILL.md'] = md('weekly-report', 'Writes the weekly report.'); }
});

test('nothing ticked is refused', async () => {
  const p = await S.previewImport('https://github.com/acme/kit', { many: true });
  await assert.rejects(S.confirmImportMany(p.id, { folders: [] }), /Tick at least one skill/);
});

test('the API: preview lists them, confirm imports the ticked ones and gives them to the bots named', async () => {
  const srv = await startServer({ env: github.env });
  try {
    const bot = await makeBot(srv, { name: 'Clerk', emoji: '📎' });
    const p = (await srv.api('/skills/import/preview', { method: 'POST', body: { url: 'https://github.com/acme/kit' } })).data;
    assert.equal(p.many, true);
    assert.equal(p.skills.length, 4);
    const r = await srv.api('/skills/import/confirm', { method: 'POST', body: { id: p.id, skills: ['skills/tidy-desk', 'skills/notes'], bots: [bot.id] } });
    assert.equal(r.status, 201);
    assert.deepEqual(r.data.imported, ['notes', 'tidy-desk']);
    assert.equal(r.data.text, 'Imported 2 skills.');
    const lib = (await srv.api('/skills')).data.library;
    assert.deepEqual(lib.map((k) => k.name), ['notes', 'tidy-desk']);
    assert.ok(lib.every((k) => k.usedBy.includes(bot.id)));
    const one = (await srv.api('/skills/import/preview', { method: 'POST', body: { url: 'https://github.com/acme/kit/tree/main/skills/weekly-report' } })).data;
    assert.equal(one.name, 'weekly-report', 'one skill: the preview of one, as before');
  } finally { await srv.stop(); }
});

// The web page's list of the skills a link holds (public/app.js skillPickHTML).
test('the web page lists each skill with a box, flags the ones the library has and cannot tick a broken one', () => {
  const ctx = vm.createContext({ esc });
  vm.runInContext(`${cut('function skillPickHTML(', 'function openSkillImport(')}; this.skillPickHTML = skillPickHTML;`, ctx);
  const html = ctx.skillPickHTML({ skills: [
    { folder: 'skills/notes', name: 'notes', description: 'Takes notes.', exists: true, scripts: ['run.sh'], allowedTools: [], fileCount: 2 },
    { folder: 'skills/tidy-desk', name: 'tidy-desk', description: 'Keeps <a> desk tidy.', exists: false, scripts: [], allowedTools: [], fileCount: 0 },
    { folder: 'skills/x', name: '', description: '', exists: false, scripts: [], allowedTools: [], fileCount: 0, problem: 'No usable name.' },
  ] });
  assert.equal((html.match(/type="checkbox" name="pick"/g) || []).length, 3);
  assert.match(html, /value="skills\/notes" checked data-exists>/, 'the count leaves it out unless it is replaced');
  assert.match(html, /value="skills\/tidy-desk" checked/);
  assert.match(html, /value="skills\/x" disabled/);
  assert.match(html, /You already have it/);
  assert.match(html, /No usable name\./);
  assert.match(html, /Keeps &lt;a&gt; desk tidy\./, 'escaped');
  assert.match(html, /data-pick="all"/);
  assert.match(html, /data-pick="none"/);
  assert.match(html, /name="overwrite"/);
  assert.match(html, /run\.sh/, 'scripts are named');
});

// The bots under "Give them to" (#488): Select all / Deselect all in their header row, leaving a bot with skills
// turned off as it is and the skills list's own pair alone.
test('the web page selects and deselects every bot that can take skills', () => {
  const ctx = vm.createContext({ esc, state: { bots: [{ id: 'b1', name: 'Clerk' }, { id: 'b2', name: 'Off', useSkills: false }] }, CHIEF_BOT: { id: 'chief', name: 'Chief' }, botLabel: (b) => esc(b.name) });
  vm.runInContext(`${cut('function botCheckboxes(', 'function openSkillEditor(')}; this.botPickHTML = botPickHTML; this.wireBotPick = wireBotPick;`, ctx);
  const html = ctx.botPickHTML('Give them to', ['b1']);
  assert.match(html, /Give them to/);
  assert.match(html, /data-bots="all">Select all</);
  assert.match(html, /data-bots="none">Deselect all</);
  assert.doesNotMatch(html, /data-pick=/, 'the skills list keeps its own pair');
  const boxes = [...html.matchAll(/<input type="checkbox" name="bot" value="([^"]*)"([^>]*)>/g)].map(([, value, rest]) => ({ value, checked: /\bchecked\b/.test(rest), disabled: /\bdisabled\b/.test(rest) }));
  assert.deepEqual(boxes.map((b) => b.checked), [false, true, false]);
  assert.deepEqual(boxes.map((b) => b.value), ['chief', 'b1', 'b2']);
  const buttons = [{ dataset: { bots: 'all' } }, { dataset: { bots: 'none' } }];
  ctx.$$ = (sel) => (sel === '[data-bots]' ? buttons : sel === 'input[name=bot]:not(:disabled)' ? boxes.filter((b) => !b.disabled) : []);
  ctx.wireBotPick({});
  buttons[0].onclick();
  assert.deepEqual(boxes.map((b) => b.checked), [true, true, false]);
  buttons[1].onclick();
  assert.deepEqual(boxes.map((b) => b.checked), [false, false, false]);
});

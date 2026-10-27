// Files mentioned with "@" on the web page (#604): public/file-mentions.js with public/mentions.js as the page loads
// them, the server's answers stood in for. The search and the folder walk, the pick, and the chip.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SEARCH = { results: [
  { name: 'summaries', path: 'summaries', type: 'folder', root: 'server' },
  { name: 'summary.md', path: 'summary.md', type: 'file', root: 'project', project: 'Website' },
  { name: 'summary-w42.md', path: 'archive/summary-w42.md', type: 'file', root: 'computer' },
  { name: 'summary-w43.md', path: 'reports/summary-w43.md', type: 'file', root: 'server' },
  { name: 'sum].md', path: 'sum].md', type: 'file', root: 'server' },
  { name: 'summary-x.md', path: 'summary-x.md', type: 'file', root: 'server' },
] };
const LISTS = {
  'reports': [{ name: '2026-w43', path: 'reports/2026-w43', type: 'folder' }, { name: 'prices-w43.csv', path: 'reports/prices-w43.csv', type: 'file' }, { name: '.hidden', path: 'reports/.hidden', type: 'file' }],
  'reports/2026-w43': [{ name: 'Q3 notes', path: 'reports/2026-w43/Q3 notes', type: 'folder' }],
  'reports/2026-w43/Q3 notes': [{ name: 'a.md', path: 'reports/2026-w43/Q3 notes/a.md', type: 'file' }],
};

function page(features = ['file-mentions', 'document-viewer']) {
  const asked = [];
  const ctx = vm.createContext({
    String, Date, Math, Promise, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, URLSearchParams,
    state: { features, bots: [{ id: 'news', name: 'News Monitor', jobs: [] }] },
    esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    api: async (url) => {
      asked.push(url);
      if (url.includes('/search?')) return new URLSearchParams(url.split('?')[1]).get('q') === 'reports' ? { results: [{ name: 'Reports', path: 'old/Reports', type: 'folder', root: 'computer' }, { name: 'reports.md', path: 'reports.md', type: 'file', root: 'server' }, { name: 'reports', path: 'reports', type: 'folder', root: 'server' }] } : SEARCH;
      const p = new URLSearchParams(url.split('?')[1]).get('path');
      return { entries: LISTS[p] || [] };
    },
  });
  for (const f of ['mentions.js', 'file-mentions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), ctx);
  vm.runInContext('this.FileMentions = FileMentions;', ctx);
  return { F: ctx.FileMentions, asked };
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const settle = () => new Promise((r) => setTimeout(r, 220));
function pickerOf(p, chat = 'news') {
  let redrawn = 0;
  const pk = p.F.picker(chat, () => { redrawn++; });
  return { pk, redrawn: () => redrawn };
}

test('web: "@sum" in a bot\'s chat asks once, after the last key, and lists four files and folders, best first', async () => {
  const p = page();
  const { pk, redrawn } = pickerOf(p);
  pk.look('Send @s'); pk.look('Send @su'); pk.look('Send @sum');
  await settle();
  assert.equal(p.asked.length, 1, 'one request for the last key');
  assert.match(p.asked[0], /^\/bots\/news\/workspace\/search\?root=all&q=sum$/);
  assert.equal(redrawn(), 1);
  const { rows, dir } = pk.look('Send @sum');
  assert.equal(dir, null);
  assert.deepEqual(plain(rows).map((r) => [r.name, r.text]), [
    ['summaries', '@[botdot:summaries]'], ['summary.md', '@[project:Website/summary.md]'], ['summary-w42.md', '@[computer:archive/summary-w42.md]'], ['summary-w43.md', '@[botdot:reports/summary-w43.md]'],
  ], 'a name a mention cannot hold is left out');
  const html = p.F.rowHTML(rows[2]);
  assert.match(html, /<b>sum<\/b>mary-w42\.md/);
  assert.match(html, /<span>archive<\/span>/, 'where it lives: its folder');
  assert.match(p.F.rowHTML(rows[1]), /<span>Website<\/span>/, 'or its place');
  assert.match(p.F.rowHTML(rows[0]), /fm-more/, 'a folder opens');
  await settle();
  assert.equal(p.asked.length, 1, 'kept for a while');
});

test('web: "@reports/" opens the folder, and a "/" after a name goes deeper; a folder picked opens with its name, spaces and all', async () => {
  const p = page();
  const { pk } = pickerOf(p);
  pk.look('Check @reports/');
  await settle();
  let r = pk.look('Check @reports/');
  assert.deepEqual(plain(r.dir), { root: 'server', path: 'reports' });
  assert.deepEqual(plain(r.rows).map((x) => x.name), ['2026-w43', 'prices-w43.csv'], 'no dot-names');
  assert.ok(r.rows.every((x) => x.inFolder));
  pk.look('Check @reports/pri');
  await settle();
  assert.deepEqual(plain(pk.look('Check @reports/pri').rows).map((x) => x.text), ['@[botdot:reports/prices-w43.csv]']);

  const opened = pk.enter('Check @reports/', 15, r.rows[0]);
  assert.deepEqual(plain(opened), { text: 'Check @2026-w43/', cursor: 16 });
  pk.look(opened.text);
  await settle();
  r = pk.look(opened.text);
  assert.deepEqual(plain(r.dir), { root: 'server', path: 'reports/2026-w43' });
  const spaced = pk.enter(opened.text, opened.cursor, r.rows[0]);
  assert.equal(spaced.text, 'Check @Q3 notes/');
  pk.look(spaced.text);
  await settle();
  r = pk.look(spaced.text);
  assert.deepEqual(plain(r.rows).map((x) => x.text), ['@[botdot:reports/2026-w43/Q3 notes/a.md]'], 'a folder with a space in its name is walked all the same');
  assert.deepEqual(plain(pk.put(spaced.text, spaced.cursor, r.rows[0])), { text: 'Check @[botdot:reports/2026-w43/Q3 notes/a.md] ', cursor: 47 });
  assert.match(p.F.headerHTML(r.dir), /On botdot<span class="fm-sep">\/<\/span>reports<span class="fm-sep">\/<\/span>2026-w43<span class="fm-sep">\/<\/span><b>Q3 notes<\/b>/);
});

test('web: back goes up one folder, and from the top of a place back to "@"; the folder opened can be mentioned itself', async () => {
  const p = page();
  const { pk } = pickerOf(p);
  pk.look('@reports/2026-w43/');
  await settle();
  pk.look('@reports/2026-w43/');
  assert.equal(pk.self().text, '@[botdot:reports/2026-w43]');
  const up = pk.back('@reports/2026-w43/', 18);
  assert.deepEqual(plain(up), { text: '@reports/', cursor: 9 });
  pk.look(up.text);
  await settle();
  pk.look(up.text);
  assert.deepEqual(plain(pk.back(up.text, up.cursor)), { text: '@', cursor: 1 });
});

test('web: off in the Chief chat, a group, and on a botdot without file mentions', async () => {
  for (const [features, chat] of [[['file-mentions'], 'chief'], [['file-mentions'], 'group:g1'], [[], 'news']]) {
    const p = page(features);
    const { pk } = pickerOf(p, chat);
    pk.look('@sum');
    await settle();
    assert.equal(p.asked.length, 0, `${chat} ${features}`);
  }
});

test('web: a file mentioned is a chip that opens in the viewer in its bot\'s chat; a folder is a chip that opens nothing', () => {
  const p = page();
  const M = require('../public/mentions.js');
  const [file, folder] = M.findFiles('@[computer:archive/prices w42.csv] @[botdot:reports]');
  const chip = p.F.chipHTML(file, 'news');
  assert.match(chip, /^<a class="file-chip" href="\/api\/bots\/news\/workspace\/file\?root=computer&amp;path=archive%2Fprices%20w42\.csv"/);
  assert.match(chip, /data-view-bot="news"/);
  assert.match(chip, /fm-table/);
  assert.match(chip, /<span>prices w42\.csv<\/span>/);
  assert.match(p.F.chipHTML(folder, 'news'), /^<span class="file-chip" title="reports">.*fm-folder/);
  assert.match(p.F.chipHTML(file, 'chief'), /^<span class="file-chip"/, 'in the Chief chat it is no bot\'s');
});

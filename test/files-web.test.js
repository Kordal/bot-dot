// Files on the web page (#603): public/files.js run against stand-ins. Folders first and dot-names left out, sorted by
// name, date or size; an icon by kind and a folder's size as its items; what botdot keeps offers nothing that writes;
// Shift and Ctrl select as a file manager does; names are text; a delete asks first and names what goes; a move into
// another place names that place; a computer that is off is started only on a tap. The browser check is
// test/browser/files.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc } = require('./web-page');

const LIST = {
  root: 'server', path: '', more: 0, readOnly: false,
  entries: [
    { name: 'notes', path: 'notes', type: 'folder', items: 14, at: '2026-10-20T07:00:00Z' },
    { name: '.cache', path: '.cache', type: 'folder', items: 2, at: '2026-10-22T07:00:00Z' },
    { name: 'uploads', path: 'uploads', type: 'folder', items: 3, at: '2026-10-19T07:00:00Z', protected: true },
    { name: 'b<script>.md', path: 'b<script>.md', type: 'file', size: 4096, at: '2026-10-21T07:00:00Z' },
    { name: 'prices.csv', path: 'prices.csv', type: 'file', size: 18000, at: '2026-10-18T07:00:00Z' },
    { name: 'acme.png', path: 'acme.png', type: 'file', size: 412000, at: '2026-10-23T07:00:00Z' },
    { name: 'CLAUDE.md', path: 'CLAUDE.md', type: 'file', size: 5, at: '2026-10-17T07:00:00Z', protected: true },
    { name: '.claude', path: '.claude', type: 'folder', items: 1, at: '2026-10-17T07:00:00Z', protected: true },
    { name: 'away', path: 'away', type: 'link', at: '2026-10-17T07:00:00Z' },
  ],
};

function page({ answers = {}, features = ['files-explorer', 'document-viewer', 'projects'], confirmed = true, prompted = null, bots = [], computers = {} } = {}) {
  const calls = []; const toasts = []; const asked = [];
  const ctx = vm.createContext({
    api: async (url, opts = {}) => {
      calls.push([url, JSON.parse(JSON.stringify(opts))]);
      const key = Object.keys(answers).find((k) => url.startsWith(k));
      const a = key ? answers[key] : url.includes('/files') ? { files: [] } : url === '/projects' ? { projects: [] } : LIST;
      if (a instanceof Error) throw a;
      return typeof a === 'function' ? a(url, opts) : a;
    },
    esc, toast: (t, bad) => toasts.push([t, !!bad]), confirm: (t) => { asked.push(t); return confirmed; }, prompt: (t) => { asked.push(t); return prompted; },
    fmtSize: (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`),
    state: { features, bots, computers }, Date, encodeURIComponent, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false }),
  });
  vm.runInContext(`${read('files.js')}\nthis.Files = Files;`, ctx);
  return { F: ctx.Files, calls, toasts, asked };
}
const bot = { id: 'b1', name: 'News Monitor', computer: 'linux' };
const settle = () => new Promise((r) => setTimeout(r, 0));

test('web: index.html loads files.js and has its box; the chat head and the settings open it', () => {
  const html = read('index.html');
  assert.match(html, /<div id="files" class="fx hidden" aria-label="Files"><\/div>/);
  const scripts = [...html.matchAll(/<script src="\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('files.js') > scripts.indexOf('viewer.js'));
  assert.ok(!scripts.includes('workspace.js'), 'the old Workspace section is gone');
  assert.match(read('bot-chat.js'), /\$\('#bot-files'\)\.classList\.toggle\('hidden', !state\.features\.includes\('files-explorer'\)\)/);
  assert.match(read('bots.js'), /files\.onclick = \(\) => Files\.open\(b\)/);
  assert.match(read('settings.js'), /link\.onclick = \(\) => Files\.open\(chiefAsBot\(\)\)/);
});

test('web: folders first, dot-names left out but what botdot keeps; by name, newest or largest', () => {
  const { F } = page();
  assert.deepEqual(F.sorted(LIST.entries.map((e) => ({ ...e }))).map((e) => e.name), ['.claude', 'notes', 'uploads', 'acme.png', 'away', 'b<script>.md', 'CLAUDE.md', 'prices.csv']);
  assert.deepEqual(F.sorted(LIST.entries.map((e) => ({ ...e })), 'date').filter((e) => e.type !== 'folder').map((e) => e.name), ['acme.png', 'b<script>.md', 'prices.csv', 'away', 'CLAUDE.md']);
  assert.deepEqual(F.sorted(LIST.entries.map((e) => ({ ...e })), 'size').map((e) => e.name).slice(0, 3), ['notes', 'uploads', '.claude']);
  assert.equal(F.sizeOf(LIST.entries[0]), '14 items');
  assert.equal(F.sizeOf({ type: 'folder', items: 1 }), '1 item');
  assert.equal(F.sizeOf(LIST.entries[4]), '18 KB');
  assert.deepEqual(['notes', 'CLAUDE.md', 'prices.csv', 'acme.png', 'b<script>.md', 'away'].map((n) => F.kindOf(LIST.entries.find((e) => e.name === n))), ['folder', 'lock', 'sheet', 'image', 'doc', 'link']);
});

test('web: Files lists the folder as text, with a lock on what botdot keeps and nothing that writes on it', async () => {
  const { F, calls } = page();
  await F.open(bot);
  await settle();
  const c = F.now();
  const html = F.html(c);
  assert.ok(calls.some(([u]) => u === '/bots/b1/workspace?root=server&path='));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /b&lt;script&gt;\.md/);
  assert.match(html, /data-path="CLAUDE\.md"[^>]*>.*?fx-k-lock/s);
  const can = (n) => F.canDo(c, LIST.entries.find((e) => e.name === n));
  assert.deepEqual({ ...can('CLAUDE.md') }, { open: true, rename: false, move: false, copy: true, download: true, keep: true, unpin: false, del: false });
  assert.deepEqual({ ...can('prices.csv') }, { open: true, rename: true, move: true, copy: true, download: true, keep: true, unpin: false, del: true });
  assert.equal(can('away').del, false, 'a link on botdot is never changed');
  assert.equal(can('uploads').del, false);
  assert.match(html, /On botdot/);
  assert.match(html, /Computer/);
  assert.match(html, /New project/);
  assert.match(html, /Kept in mind/);
});

test('web: Shift selects a range, Ctrl one more, a plain click one alone', () => {
  const { F } = page();
  const paths = ['a', 'b', 'c', 'd'];
  const one = F.rangeSelect(paths, new Set(['a']), 'a', 'c');
  assert.deepEqual([...one], ['c']);
  assert.deepEqual([...F.rangeSelect(paths, new Set(['b']), 'b', 'd', { range: true })].sort(), ['b', 'c', 'd']);
  assert.deepEqual([...F.rangeSelect(paths, new Set(['b']), 'b', 'd', { toggle: true })].sort(), ['b', 'd']);
  assert.deepEqual([...F.rangeSelect(paths, new Set(['b', 'd']), 'b', 'd', { toggle: true })], ['b']);
});

test('web: a delete asks first and names what goes; declined, nothing is deleted', async () => {
  const { F, calls, asked } = page({ answers: { '/bots/b1/workspace/count': { type: 'folder', files: 12, folders: 2, capped: false } }, confirmed: false });
  await F.open(bot);
  await settle();
  const c = F.now();
  c.sel = new Set(['notes']);
  await F.act({ dataset: { fx: 'delete' }, closest: () => null });
  assert.deepEqual(asked, ['Delete the folder notes? It holds 12 files and 2 folders, which go with it. This can\'t be undone.']);
  assert.ok(!calls.some(([, o]) => o.method === 'DELETE'));
});

test('web: Move to… into a project sends the place; within this place it does not', async () => {
  const { F, calls } = page({ answers: { '/projects': { projects: [{ name: 'Website', bots: ['b1'] }] } } });
  await F.open(bot);
  await settle();
  const c = F.now();
  c.sel = new Set(['prices.csv']);
  await F.act({ dataset: { fx: 'move-to' }, closest: () => null });
  c.dialog.to = { root: 'project', project: 'Website', path: 'data' };
  await F.act({ dataset: { fx: 'dialog-go' }, closest: () => null });
  c.sel = new Set(['acme.png']);
  await F.act({ dataset: { fx: 'copy-to' }, closest: () => null });
  c.dialog.to = { root: 'server', path: 'notes' };
  await F.act({ dataset: { fx: 'dialog-go' }, closest: () => null });
  const posts = calls.filter(([, o]) => o.method === 'POST').map(([u, o]) => [u, o.body]);
  assert.deepEqual(posts, [
    ['/bots/b1/workspace/move?root=server', { from: 'prices.csv', into: 'data', place: { root: 'project', project: 'Website' } }],
    ['/bots/b1/workspace/copy?root=server', { from: 'acme.png', into: 'notes' }],
  ]);
});

test('web: the computer off shows Start the computer, and only a tap starts it', async () => {
  const off = Object.assign(new Error('The computer is off.'), { status: 409, state: 'computer-off' });
  const { F, calls } = page({ answers: { '/bots/b1/workspace?root=computer': off } });
  await F.open(bot);
  await settle();
  await F.act({ dataset: { fx: 'place', root: 'computer' }, closest: () => null });
  assert.match(F.html(F.now()), /Start the computer/);
  assert.ok(!calls.some(([u]) => u.endsWith('/computer')), 'nothing started');
  await F.act({ dataset: { fx: 'start' }, closest: () => null, disabled: false });
  assert.ok(calls.some(([u, o]) => u === '/bots/b1/computer' && o.body.action === 'start'));
});

test('web: a dropped folder keeps its tree inside the folder made for it', () => {
  const { F } = page();
  const plan = F.folderPlan([{ file: { name: 'a.css' }, rel: 'site/css/a.css' }, { file: { name: 'i.html' }, rel: 'site/i.html' }], 'site (2)');
  assert.deepEqual(plan.map((x) => x.dir), ['site (2)/css', 'site (2)']);
});

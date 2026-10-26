// A bot's workspace in its settings on the web page (#296): public/workspace.js run against stand-ins. Folders
// first, sort by name or date, dot-names under "Show hidden", files open in the viewer, writes only where botdot
// allows them, a delete asks first and names what goes, and a computer that is off is started only on a tap.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, esc, element } = require('./web-page');

const LIST = {
  root: 'server', path: '', more: 0, readOnly: false,
  entries: [
    { name: 'notes', path: 'notes', type: 'folder', at: '2026-10-20T07:00:00Z' },
    { name: '.cache', path: '.cache', type: 'folder', at: '2026-10-22T07:00:00Z' },
    { name: 'uploads', path: 'uploads', type: 'folder', at: '2026-10-19T07:00:00Z', protected: true },
    { name: 'b<script>.md', path: 'b<script>.md', type: 'file', size: 2048, at: '2026-10-21T07:00:00Z' },
    { name: 'a.txt', path: 'a.txt', type: 'file', size: 3, at: '2026-10-18T07:00:00Z' },
    { name: 'CLAUDE.md', path: 'CLAUDE.md', type: 'file', size: 5, at: '2026-10-17T07:00:00Z', protected: true },
    { name: 'away', path: 'away', type: 'link', at: '2026-10-17T07:00:00Z' },
  ],
};

function page({ answers = {}, features = ['workspace-files', 'document-viewer'], confirmed = true, prompted = null, bots = [] } = {}) {
  const calls = []; const toasts = []; const asked = [];
  const ctx = vm.createContext({
    api: async (url, opts = {}) => {
      calls.push([url, JSON.parse(JSON.stringify(opts))]);
      const key = Object.keys(answers).find((k) => url.startsWith(k));
      const a = key ? answers[key] : LIST;
      if (a instanceof Error) throw a;
      return typeof a === 'function' ? a(url, opts) : a;
    },
    fetch: async (url, opts) => { calls.push([url, { method: opts.method, name: opts.headers['X-File-Name'] }]); return { ok: true, status: 201, json: async () => ({}) }; },
    esc, toast: (t, bad) => toasts.push([t, !!bad]), confirm: (t) => { asked.push(t); return confirmed; }, prompt: (t, v) => { asked.push(t); return prompted; },
    fmtSize: (n) => `${n} B`, state: { features, bots }, Date, encodeURIComponent,
  });
  vm.runInContext(`${read('workspace.js')}\nthis.Workspace = Workspace;`, ctx);
  return { W: ctx.Workspace, calls, toasts, asked };
}
const bot = { id: 'b1', name: 'Researcher', computer: 'none' };
const button = (data, rowPath) => ({ dataset: data, disabled: false, closest: () => (rowPath === undefined ? null : { dataset: { path: rowPath } }) });

test('web: index.html loads workspace.js after boot.js, and bots.js shows the box only with workspace-files', () => {
  const scripts = [...read('index.html').matchAll(/<script src="\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('workspace.js') > scripts.indexOf('boot.js'));
  const bots = read('bots.js');
  assert.match(bots, /state\.features\.includes\('workspace-files'\) \? `<div class="bs-row" id="bs-workspace">/);
  assert.match(bots, /Workspace\.open\(b, \$\('#ws-box', root\)\)/);
});

test('web: folders first, then files, by name; dot-names fold under Show hidden; names are text', async () => {
  const p = page();
  const box = element();
  await p.W.open(bot, box);
  assert.deepEqual(p.calls.map(([u]) => u), ['/bots/b1/workspace?root=server&path=']);
  const order = [...box.innerHTML.matchAll(/class="ws-row" data-path="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['notes', 'uploads', 'a.txt', 'away', 'b&lt;script&gt;.md', 'CLAUDE.md']);
  assert.match(box.innerHTML, /Show hidden \(1\)/);
  assert.doesNotMatch(box.innerHTML, /<script>/);
  // Newest first, still folders first; hidden ones shown.
  assert.deepEqual([...p.W.sorted(LIST.entries, { sort: 'date', hidden: true }).map((e) => e.name)], ['.cache', 'notes', 'uploads', 'b<script>.md', 'a.txt', 'away', 'CLAUDE.md']);
  assert.deepEqual([...p.W.crumbs('notes/old', 'Its folder').map((c) => c.path)], ['', 'notes', 'notes/old']);
});

test('web: a file opens in the viewer and downloads; writes only where botdot allows them', async () => {
  const p = page();
  const box = element();
  await p.W.open(bot, box);
  const h = box.innerHTML;
  assert.match(h, /data-view="\/bots\/b1\/workspace\/file\?root=server&amp;path=a\.txt" data-view-name="a\.txt" data-view-from="Researcher"/);
  assert.match(h, /href="\/api\/bots\/b1\/workspace\/file\?root=server&amp;path=a\.txt" download="a\.txt"/);
  const row = (name) => h.slice(h.indexOf(`data-path="${name}"`), h.indexOf('</div>', h.indexOf(`data-path="${name}"`)));
  assert.match(row('a.txt'), /data-ws="rename".*data-ws="move".*data-ws="delete"/);
  assert.doesNotMatch(row('CLAUDE.md'), /data-ws="(rename|move|delete)"/);
  assert.match(row('CLAUDE.md'), /Kept by botdot/);
  assert.doesNotMatch(row('away'), /data-ws=|data-view/, 'a link is shown, never opened or changed');
  assert.match(h, /data-ws="upload"/);
  assert.match(h, /data-ws="folder"/);
  // A folder botdot keeps: no upload, no new folder, and nothing in it changes.
  const ro = page({ answers: { '/bots/b1/workspace?': { ...LIST, path: '.claude', readOnly: true, entries: [{ name: 'settings.json', path: '.claude/settings.json', type: 'file', size: 2 }] } } });
  const b2 = element();
  await ro.W.open(bot, b2);
  assert.doesNotMatch(b2.innerHTML, /data-ws="(upload|folder|rename|move|delete)"/);
  assert.match(b2.innerHTML, /botdot keeps this folder as it is/);
  // Without the viewer, a file downloads as before.
  const old = page({ features: ['workspace-files'] });
  const b3 = element();
  await old.W.open(bot, b3);
  assert.doesNotMatch(b3.innerHTML, /data-view=/);
});

test('web: a folder opens, and the breadcrumb goes back', async () => {
  const p = page();
  const box = element();
  await p.W.open(bot, box);
  await p.W.act(button({ ws: 'go', path: 'notes' }));
  assert.equal(p.calls.at(-1)[0], '/bots/b1/workspace?root=server&path=notes');
  assert.match(box.innerHTML, /data-ws="go" data-path="">Its folder<\/button>/);
  assert.match(box.innerHTML, /<b>notes<\/b>/);
});

test('web: delete counts first and names what goes; nothing without a yes', async () => {
  const p = page({ answers: { '/bots/b1/workspace/count': { type: 'folder', files: 1200, folders: 3, capped: false } } });
  const box = element();
  await p.W.open(bot, box);
  await p.W.act(button({ ws: 'delete' }, 'notes'));
  assert.equal(p.asked[0], "Delete the folder notes? It holds 1,200 files and 3 folders, which go with it. This can't be undone.");
  assert.deepEqual(p.calls.slice(1, 3), [['/bots/b1/workspace/count?root=server&path=notes', {}], ['/bots/b1/workspace?root=server&path=notes', { method: 'DELETE' }]]);
  assert.equal(p.W.deleteWords({ name: 'x' }, { type: 'folder', files: 10000, folders: 0, capped: true }), "Delete the folder x? It holds more than 10,000 files, which go with it. This can't be undone.");
  assert.equal(p.W.deleteWords({ name: 'a.txt' }, { type: 'file', files: 1, folders: 0 }), "Delete a.txt? This can't be undone.");
  const no = page({ confirmed: false, answers: { '/bots/b1/workspace/count': { type: 'file', files: 1, folders: 0, capped: false } } });
  await no.W.open(bot, element());
  await no.W.act(button({ ws: 'delete' }, 'a.txt'));
  assert.ok(!no.calls.some(([, o]) => o.method === 'DELETE'));
});

test('web: rename, move and new folder send the new path; upload sends at most 10 files of up to 25 MB', async () => {
  let p = page({ prompted: 'b.txt' });
  await p.W.open(bot, element());
  await p.W.act(button({ ws: 'rename' }, 'a.txt'));
  assert.deepEqual(p.calls.at(-2), ['/bots/b1/workspace/move?root=server', { method: 'POST', body: { from: 'a.txt', to: 'b.txt' } }]);
  p = page({ prompted: 'notes/old/' });
  await p.W.open(bot, element());
  await p.W.act(button({ ws: 'move' }, 'a.txt'));
  assert.deepEqual(p.calls.at(-2), ['/bots/b1/workspace/move?root=server', { method: 'POST', body: { from: 'a.txt', to: 'notes/old/a.txt' } }]);
  p = page({ prompted: 'drafts' });
  await p.W.open(bot, element());
  await p.W.act(button({ ws: 'folder' }));
  assert.deepEqual(p.calls.at(-2), ['/bots/b1/workspace/folder?root=server', { method: 'POST', body: { path: '', name: 'drafts' } }]);

  p = page();
  const box = element();
  await p.W.open(bot, box);
  const files = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, size: i === 1 ? 26 * 1024 * 1024 : 4 }));
  box.onchange({ target: { matches: (s) => s === '[data-ws-files]', files, value: 'x' } });
  await new Promise((r) => setTimeout(r, 20));
  const sent = p.calls.filter(([, o]) => o.method === 'POST');
  assert.equal(sent.length, 9, 'ten taken, the one over 25 MB left out');
  assert.equal(sent[0][0], '/api/bots/b1/workspace/upload?root=server&path=');
  assert.deepEqual(p.toasts.map(([t]) => t), ['Upload at most 10 files at a time.', 'f1.txt is over 25 MB.']);
});

test("web: on the computer, a computer that is off offers to start it, and only browse, open, download and delete", async () => {
  const off = Object.assign(new Error('The computer is off. Start it to see its files.'), { status: 409, state: 'computer-off' });
  let started = false;
  const p = page({ answers: {
    '/bots/b2/computer': () => { started = true; return {}; },
    '/bots/b2/workspace?root=computer': () => { if (!started) throw off; return { ...LIST, root: 'computer', entries: [{ name: 'out.csv', path: 'out.csv', type: 'file', size: 9 }, { name: 'old', path: 'old', type: 'link' }] }; },
  } });
  const pc = { id: 'b2', name: 'Desk Worker', computer: 'linux' };
  const box = element();
  await p.W.open(pc, box);
  assert.match(box.innerHTML, /On the computer/);
  await p.W.act(button({ ws: 'root', root: 'computer' }));
  assert.match(box.innerHTML, /The computer is off/);
  assert.match(box.innerHTML, /data-ws="start">Start the computer/);
  assert.ok(!started, 'not started by the listing');
  await p.W.act(button({ ws: 'start' }));
  assert.deepEqual(p.calls.find(([u]) => u === '/bots/b2/computer'), ['/bots/b2/computer', { method: 'POST', body: { action: 'start' } }]);
  const h = box.innerHTML;
  assert.match(h, /\/workspace\/b2/);
  assert.match(h, /data-view-bot="b2"/, 'the viewer can start it too');
  assert.match(h, /data-ws="delete"/);
  assert.doesNotMatch(h, /data-ws="(rename|move|upload|folder)"/);
  const link = h.slice(h.indexOf('data-path="old"'), h.indexOf('data-path="out.csv"'));
  assert.match(link, /data-ws="delete"/, 'on the computer a link may go: the link alone');
  assert.doesNotMatch(link, /data-view/);
});

test('web: a file the owner gave the bot is deleted, never renamed or moved; a name with / in it is refused', async () => {
  const p = page({ answers: { '/bots/b1/workspace?': { ...LIST, path: 'uploads', entries: [{ name: '20261021070000-ab12-CV.pdf', path: 'uploads/20261021070000-ab12-CV.pdf', type: 'file', size: 4, keepsName: true }] } } });
  const box = element();
  await p.W.open(bot, box);
  assert.match(box.innerHTML, /data-ws="delete"/);
  assert.doesNotMatch(box.innerHTML, /data-ws="(rename|move)"/);
  const r = page({ prompted: 'old/b.txt' });
  await r.W.open(bot, element());
  await r.W.act(button({ ws: 'rename' }, 'a.txt'));
  assert.ok(!r.calls.some(([u]) => u.endsWith('/move')));
  assert.match(r.toasts[0][0], /can't have \/ in it/);
});

test('web: only the answer for the folder last asked for is drawn', async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const p = page({ answers: { '/bots/b1/workspace?root=server&path=slow': () => slow.then(() => ({ ...LIST, path: 'slow', entries: [{ name: 'late.txt', path: 'slow/late.txt', type: 'file', size: 1 }] })) } });
  const box = element();
  await p.W.open(bot, box);
  const going = p.W.act(button({ ws: 'go', path: 'slow' }));
  await p.W.act(button({ ws: 'go', path: '' }));
  release();
  await going;
  assert.doesNotMatch(box.innerHTML, /late\.txt/);
  assert.match(box.innerHTML, /data-path="a\.txt"/);
});

test("web: the Chief's workspace (#383) is asked of /chief/workspace, and two boxes each keep their own folder", async () => {
  const p = page();
  const mine = element(); const its = element();
  await p.W.open(bot, its);
  await p.W.open({ id: '_chief', name: 'Chief of Staff', base: '/chief', computer: 'none' }, mine);
  assert.equal(p.calls.at(-1)[0], '/chief/workspace?root=server&path=');
  assert.doesNotMatch(mine.innerHTML, /On the computer/);
  // A tap in the bot's box, still drawn, goes to the bot's folder.
  its.onclick({ target: { closest: () => button({ ws: 'go', path: 'notes' }) }, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.calls.at(-1)[0], '/bots/b1/workspace?root=server&path=notes');
  const settings = read('settings.js');
  assert.match(settings, /state\.features\.includes\('chief-files'\)/);
  assert.match(settings, /drawBotFiles\(chief, null, list\)/);
});

test('web (#576): with workspace-folders the computer takes writes too, and a whole folder goes up file by file under a free name', async () => {
  const p = page({ features: ['workspace-files', 'document-viewer', 'workspace-folders'], prompted: 'drafts', answers: {
    '/bots/b2/workspace/folder': (url, opts) => ({ ok: true, path: opts.body.name === 'site' ? 'proj/site (2)' : `proj/${opts.body.name}` }),
    '/bots/b2/workspace?root=computer': { ...LIST, root: 'computer', path: 'proj', entries: [{ name: 'out.csv', path: 'proj/out.csv', type: 'file', size: 9 }] },
  } });
  const pc = { id: 'b2', name: 'Desk Worker', computer: 'linux' };
  const box = element();
  await p.W.open(pc, box);
  assert.match(box.innerHTML, /data-ws="upload-folder">Upload folder/);
  assert.match(box.innerHTML, /webkitdirectory hidden data-ws-folder/);
  await p.W.act(button({ ws: 'root', root: 'computer' }));
  await p.W.act(button({ ws: 'go', path: 'proj' }));
  const h = box.innerHTML;
  assert.match(h, /data-ws="folder">New folder/);
  assert.match(h, /data-ws="upload">Upload/);
  assert.match(h, /data-ws="rename".*data-ws="move".*data-ws="delete"/);
  await p.W.act(button({ ws: 'folder' }));
  assert.deepEqual(p.calls.at(-2), ['/bots/b2/workspace/folder?root=computer', { method: 'POST', body: { path: 'proj', name: 'drafts' } }]);

  const file = (rel, size = 3) => ({ name: rel.split('/').at(-1), webkitRelativePath: rel, size });
  const files = [file('site/index.html'), file('site/css/deep/a.css'), file('site/huge.bin', 26 * 1024 * 1024)];
  const before = p.calls.length;
  box.onchange({ target: { matches: (sel) => sel === '[data-ws-folder]', files, value: 'x' } });
  await new Promise((r) => setTimeout(r, 30));
  const sent = p.calls.slice(before);
  assert.deepEqual(sent[0], ['/bots/b2/workspace/folder?root=computer', { method: 'POST', body: { path: 'proj', name: 'site', free: true } }]);
  assert.deepEqual(sent.slice(1, 3), [
    [`/api/bots/b2/workspace/upload?root=computer&path=${encodeURIComponent('proj/site (2)')}&folders=1`, { method: 'POST', name: 'index.html' }],
    [`/api/bots/b2/workspace/upload?root=computer&path=${encodeURIComponent('proj/site (2)/css/deep')}&folders=1`, { method: 'POST', name: 'a.css' }],
  ]);
  assert.ok(!sent.some(([u, o]) => o.name === 'huge.bin'), 'over 25 MB is not sent');
  assert.deepEqual(p.toasts.at(-1), ["site: 1 of 3 files didn't upload.", true]);

  const many = Array.from({ length: 1001 }, (_, i) => file(`big/${i}.txt`));
  const n = p.calls.length;
  box.onchange({ target: { matches: (sel) => sel === '[data-ws-folder]', files: many, value: 'x' } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(p.calls.length, n, 'nothing sent');
  assert.match(p.toasts.at(-1)[0], /big has 1,001 files: upload at most 1,000/);
});

test('web: without workspace-folders there is no folder upload', async () => {
  const p = page();
  const box = element();
  await p.W.open(bot, box);
  assert.doesNotMatch(box.innerHTML, /upload-folder|webkitdirectory/);
});

test('web (#578): a bot on the computer has its projects as roots, makes one, changes its bots and deletes it', async () => {
  let projects = [{ name: 'site', bots: ['b2', 'b3'], folder: '/workspace/projects/site' }, { name: 'other', bots: ['b3'], folder: '/workspace/projects/other' }];
  const p = page({ features: ['workspace-files', 'workspace-folders', 'projects'], prompted: 'docs', bots: [{ id: 'b2', name: 'Desk Worker', computer: 'linux' }, { id: 'b3', name: 'Scout', computer: 'linux' }, { id: 'b4', name: 'Writer', computer: 'none' }], answers: {
    '/projects/': (url, opts) => { if (opts.method === 'PUT') projects = projects.map((x) => (url.endsWith('/site') ? { ...x, bots: opts.body.bots } : x)); if (opts.method === 'DELETE') projects = projects.filter((x) => !url.endsWith(`/${x.name}`)); return { ok: true }; },
    '/projects': (url, opts) => { if (opts.method === 'POST') { projects.push({ name: opts.body.name, bots: opts.body.bots }); return { name: opts.body.name, bots: opts.body.bots }; } return { projects }; },
    '/bots/b2/workspace/count': { type: 'folder', files: 2, folders: 0, capped: false },
    '/bots/b2/workspace?root=project': (url) => ({ ...LIST, root: 'project', entries: [{ name: 'index.html', path: 'index.html', type: 'file', size: 3 }] }),
  } });
  const pc = { id: 'b2', name: 'Desk Worker', computer: 'linux' };
  const box = element();
  await p.W.open(pc, box);
  await new Promise((r) => setTimeout(r, 5));
  assert.match(box.innerHTML, /data-root="project" data-project="site"[^>]*>site<\/button>/);
  assert.doesNotMatch(box.innerHTML, /data-project="other"/, 'only its own projects');
  assert.match(box.innerHTML, /data-ws="new-project">\+ Project/);
  await p.W.act(button({ ws: 'root', root: 'project', project: 'site' }));
  assert.ok(p.calls.some(([u]) => u === '/bots/b2/workspace?root=project&project=site&path='));
  assert.match(box.innerHTML, /\/workspace\/projects\/site/);
  assert.match(box.innerHTML, /<span>Desk Worker, Scout<\/span><button type="button" class="link-btn" data-ws="members">Bots/);
  assert.match(box.innerHTML, /data-ws="upload-folder"/, 'managed as the computer root is');

  await p.W.act(button({ ws: 'new-project' }));
  assert.deepEqual(p.calls.find(([u, o]) => u === '/projects' && o.method === 'POST'), ['/projects', { method: 'POST', body: { name: 'docs', bots: ['b2'] } }]);
  assert.match(box.innerHTML, /data-ws-member="b2" checked> Desk Worker/, 'its bots are picked next');
  assert.match(box.innerHTML, /data-ws-member="b3"> Scout/);
  assert.doesNotMatch(box.innerHTML, /Writer/, 'only bots on the computer');
  assert.match(box.innerHTML, /data-ws="members-save"/);

  await p.W.act(button({ ws: 'root', root: 'project', project: 'site' }));
  await p.W.act(button({ ws: 'delete-project' }));
  assert.equal(p.asked.at(-1), "Delete the project site? It holds 2 files, which go with it. This can't be undone.");
  assert.deepEqual(p.calls.find(([u, o]) => u === '/projects/site' && o.method === 'DELETE'), ['/projects/site', { method: 'DELETE' }]);
  assert.doesNotMatch(box.innerHTML, /data-project="site"/);
});

test('web: a bot without the computer, or a server without projects, shows no projects', async () => {
  const p = page({ features: ['workspace-files', 'workspace-folders'] });
  const box = element();
  await p.W.open({ id: 'b2', name: 'Desk Worker', computer: 'linux' }, box);
  assert.doesNotMatch(box.innerHTML, /new-project/);
  assert.ok(!p.calls.some(([u]) => u === '/projects'));
});

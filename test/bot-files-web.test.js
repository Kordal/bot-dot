// A bot's files in its settings on the web page (#235): each file with its size and date, to open, keep in mind or
// delete. The page's own code, cut out of public/bots.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element } = require('./web-page');

const FILES = [
  { file: 'uploads/20261021070000-ab12-CV.pdf', name: 'CV.pdf', size: 2048, at: '2026-10-21T07:00:00Z', readable: null, pinned: true },
  { file: 'uploads/20261020070000-cd34-x<b>.txt', name: 'x<b>.txt', size: 12, at: '2026-10-20T07:00:00Z', readable: null, pinned: false },
];

function page({ files = FILES, confirmed = true, features = [] } = {}) {
  const calls = []; const toasts = [];
  const pins = files.map(() => element()); const deletes = files.map(() => element());
  const rows = files.map((f, i) => element({ '[data-file-pin]': pins[i], '[data-file-delete]': deletes[i] }, { dataset: { file: f.file } }));
  const box = element({ '.bs-file': rows });
  const ctx = vm.createContext({
    api: async (url, opts = {}) => { calls.push([url, JSON.parse(JSON.stringify(opts))]); return { files, maxPinned: 10 }; },
    $: (sel) => (sel === '#file-list' ? box : null),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmtSize: (n) => `${n} B`,
    toast: (t, bad) => toasts.push([t, !!bad]),
    confirm: () => confirmed,
    Date, state: { features },
  });
  vm.runInContext(`${cut('// Its files (#235)', '// "Duplicate" (#227)')}
    Object.assign(this, { drawBotFiles });`, ctx);
  return { ctx, calls, toasts, box, pins, deletes };
}

const bot = { id: 'b1', name: 'Recruiter' };

test('web: the files are listed as text, each with a link, its size and whether it is kept in mind', async () => {
  const p = page();
  await p.ctx.drawBotFiles(bot);
  assert.deepEqual(p.calls.map(([u]) => u), ['/bots/b1/files']);
  assert.match(p.box.innerHTML, /href="\/api\/bots\/b1\/files\/20261021070000-ab12-CV\.pdf"/);
  assert.match(p.box.innerHTML, /x&lt;b&gt;\.txt/, 'a name is drawn as text');
  assert.match(p.box.innerHTML, /📌 Kept in mind/);
  assert.match(p.box.innerHTML, />Keep in mind</);
  assert.match(p.box.innerHTML, /2048 B/);
  assert.doesNotMatch(p.box.innerHTML, /data-view/, 'without the viewer, a link downloads as before');
  // With the viewer (#251), a file opens in it: its API path, its name and whose it is.
  const v = page({ features: ['document-viewer'] });
  await v.ctx.drawBotFiles(bot);
  assert.match(v.box.innerHTML, /data-view="\/bots\/b1\/files\/20261021070000-ab12-CV\.pdf" data-view-name="CV\.pdf" data-view-from="Recruiter"/);
});

test('web: Keep in mind flips the pin, and Delete asks first', async () => {
  const p = page();
  await p.ctx.drawBotFiles(bot);
  await p.pins[0].onclick();
  await p.pins[1].onclick();
  assert.deepEqual(p.calls.slice(1, 3), [
    ['/bots/b1/files/20261021070000-ab12-CV.pdf', { method: 'PUT', body: { pinned: false } }],
    ['/bots/b1/files/20261020070000-cd34-x%3Cb%3E.txt', { method: 'PUT', body: { pinned: true } }],
  ]);
  await p.deletes[0].onclick();
  assert.deepEqual(p.calls[3], ['/bots/b1/files/20261021070000-ab12-CV.pdf', { method: 'DELETE' }]);

  const no = page({ confirmed: false });
  await no.ctx.drawBotFiles(bot);
  await no.deletes[0].onclick();
  assert.equal(no.calls.length, 1, 'nothing deleted without a yes');
});

test('web: a bot with no files says how to give it one', async () => {
  const p = page({ files: [] });
  await p.ctx.drawBotFiles(bot);
  assert.match(p.box.innerHTML, /None yet\. Attach a file in its chat\./);
});

// An empty chat on the web page (#727): the bot's head and name, the message box right under them and the bot's jobs
// as chips under it; a tap runs the job as its "Run now" does. The Chief's new chat offers its own jobs the same way.
// The page's own code, cut out of public/ and run against stand-in elements and a stand-in server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { app, cut, esc, element, words } = require('./web-page');

function page({ features = ['chief-jobs'], answer = {} } = {}) {
  const calls = [], toasts = [];
  const boxes = { '#bot-job-chips': element(), '#chief-job-chips': element() };
  const ctx = vm.createContext({ ...words, esc, state: { features },
    $: (sel) => boxes[sel] || null, toast: (t, bad) => toasts.push([t, !!bad]), refresh() {},
    OpeningLine: { text: (s) => s || '' },
    api: async (p, opts = {}) => { calls.push([opts.method || 'GET', p]); const a = answer[p]; if (a instanceof Error) throw a; return a || {}; },
  });
  vm.runInContext(`${cut('// "Run now": a bot\'s job starts at once', '// A script job\'s run in the chat')}
    ${cut('// A new chat (#727)', '// The Chief\'s previous chats')}
    this.runJobNow = runJobNow; this.drawJobChips = drawJobChips; this.startableJobs = startableJobs; this.drawChiefJobChips = drawChiefJobChips;`, ctx);
  return { ctx, boxes, calls, toasts };
}
// A tap on a chip: what the box's click hears from a button with that job's id.
const tap = (box, id) => box.onclick({ target: { closest: (sel) => (sel === '[data-job]' ? { dataset: { job: id } } : null) } });

test('a bot with jobs: its approved jobs that are on, each a chip with its name, and never markup', () => {
  const p = page();
  const bot = { id: 'b1', jobs: [
    { id: 'j1', name: 'Morning <b>summary</b>', approved: true, enabled: true },
    { id: 'j2', name: 'Waits for OK', approved: false, enabled: true },
    { id: 'j3', name: 'Paused', approved: true, enabled: false },
    { id: 'j4', name: 'Sort mail', approved: true },
  ] };
  p.ctx.drawJobChips(p.boxes['#bot-job-chips'], p.ctx.startableJobs(bot), () => {});
  const html = p.boxes['#bot-job-chips'].innerHTML;
  assert.deepEqual([...html.matchAll(/data-job="([^"]+)"/g)].map((m) => m[1]), ['j1', 'j4']);
  assert.match(html, /Morning &lt;b&gt;summary/);
  assert.doesNotMatch(html, /<b>/);
});

test('a bot without jobs: no chip, so only its head, name and message box show', () => {
  const p = page();
  p.ctx.drawJobChips(p.boxes['#bot-job-chips'], p.ctx.startableJobs({ id: 'b2' }), () => {});
  assert.equal(p.boxes['#bot-job-chips'].innerHTML, '');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.job-chips \{ display: none; \}/, 'chips show only in an empty chat');
  assert.match(css, /> \.job-chips:not\(:empty\) \{ display: flex;/);
  assert.match(css, /:not\(:has\(\.chat-sent:not\(:empty\)\)\) > \.chat-thread \{ flex: none; margin-top: auto;/, 'the first message puts the box back at the foot');
});

test("a tap runs the job by its own Run now: the same route and the same words", async () => {
  const p = page({ answer: { '/bots/b1/jobs/j1/run': { queued: true } } });
  p.ctx.drawJobChips(p.boxes['#bot-job-chips'], [{ id: 'j1', name: 'A' }], (id) => p.ctx.runJobNow('b1', id));
  tap(p.boxes['#bot-job-chips'], 'j1');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.calls, [['POST', '/bots/b1/jobs/j1/run']]);
  assert.deepEqual(p.toasts, [['It will run as soon as the bot is free', false]]);
  assert.match(app, /\$\('\[data-run-job\]', card\)\.onclick = \(\) => runJobNow\(bot\.id, card\.dataset\.job\)/, 'the card\'s Run now is the same function');
  assert.match(app, /drawJobChips\(part\('job-chips'\), startableJobs\(bot\), \(jobId\) => runJobNow\(bot\.id, jobId\)\)/);
});

test("the Chief's new chat: its own jobs that are on, and a tap runs one", async () => {
  const p = page({ answer: { '/chief/jobs': { jobs: [{ id: 'cj1', name: 'News', on: true }, { id: 'cj2', name: 'Off', on: false }] } } });
  await p.ctx.drawChiefJobChips();
  const box = p.boxes['#chief-job-chips'];
  assert.deepEqual([...box.innerHTML.matchAll(/data-job="([^"]+)"/g)].map((m) => m[1]), ['cj1']);
  tap(box, 'cj1');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.calls, [['GET', '/chief/jobs'], ['POST', '/chief/jobs/cj1/run']]);
  assert.deepEqual(p.toasts, [['Started', false]]);
});

test("a botdot without the Chief's jobs: no chip and no request", async () => {
  const p = page({ features: [] });
  await p.ctx.drawChiefJobChips();
  assert.equal(p.boxes['#chief-job-chips'].innerHTML, '');
  assert.deepEqual(p.calls, []);
});

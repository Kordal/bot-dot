// While the web page is in use, events carry webActive, and the phone app doesn't notify.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, feed } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('events are marked only while the web page says it is in use', async () => {
  const f = await feed(srv);
  const bot = await makeBot(srv);
  const a = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'one' } });
  const quiet = await f.wait('run_finished', (d) => d.id === a.data.id);
  assert.equal(quiet.data.webActive, undefined);
  assert.equal((await srv.api('/presence', { method: 'POST' })).data.ok, true);
  const b = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'two' } });
  const marked = await f.wait('run_finished', (d) => d.id === b.data.id);
  assert.equal(marked.data.webActive, true);
  const hello = f.events.find((e) => e.type === 'hello');
  assert.ok(hello, 'the feed says hello first');
  f.close();
});

test('a page that is left says so, and it is not in use from then; another page in use stays in use (#899)', async () => {
  const f = await feed(srv);
  const bot = await makeBot(srv);
  const marked = async () => {
    const run = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'again' } });
    return (await f.wait('run_finished', (d) => d.id === run.data.id)).data.webActive === true;
  };
  await srv.api('/presence', { method: 'POST', body: { away: true } }); // the page of the test before, which names none
  assert.equal(await marked(), false);
  await srv.api('/presence', { method: 'POST', body: { page: 'mac' } });
  assert.equal(await marked(), true);
  await srv.api('/presence', { method: 'POST', body: { away: true, page: 'mac' } });
  assert.equal(await marked(), false, 'left: at once, not a minute later');
  await srv.api('/presence', { method: 'POST', body: { page: 'mac' } });
  await srv.api('/presence', { method: 'POST', body: { page: 'office' } });
  await srv.api('/presence', { method: 'POST', body: { away: true, page: 'mac' } });
  assert.equal(await marked(), true, 'the other page is still in use');
  await srv.api('/presence', { method: 'POST', body: { away: true, page: 'office' } });
  assert.equal(await marked(), false);
  f.close();
});

// The page's side (public/replies.js): it says it is in use, and that it was left when it is hidden or another window
// is in front, and not when a frame inside it takes the focus.
test('web: the page says it was left when it is hidden or loses the focus, not for a frame of its own', async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'replies.js'), 'utf8');
  const part = src.slice(0, src.indexOf('// ---------- new replies ----------'));
  const sent = [];
  const on = {};
  const doc = { visibilityState: 'visible', focused: true, hasFocus() { return this.focused; }, addEventListener: (t, fn) => { on[`doc:${t}`] = fn; } };
  const ctx = vm.createContext({
    document: doc, state: { view: 'bot', botId: 'b1' }, Unread: { appId: () => 'web-abc123' },
    $: () => ({}), panelPage: () => null, getComputedStyle: () => ({ display: 'block' }),
    api: (url, o) => { sent.push(o.body); return Promise.resolve(); },
    addEventListener: (t, fn) => { on[t] = fn; }, setInterval: () => {}, setTimeout: (fn) => fn(), Date,
  });
  vm.runInContext(`${part}\nthis.sayPresent = sayPresent;`, ctx);
  ctx.sayPresent();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ chat: 'bot:b1', page: 'abc123' }]);
  on.blur(); // a frame inside the page took the focus: the page still has it
  assert.equal(sent.length, 1);
  doc.focused = false;
  on.blur(); // another window in front
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1])), { away: true, page: 'abc123' });
  on.blur();
  assert.equal(sent.length, 2, 'said once');
  doc.focused = true;
  on.focus();
  assert.equal(sent.length, 3, 'back: at once');
  doc.visibilityState = 'hidden';
  on['doc:visibilitychange']();
  assert.equal(sent[3].away, true);
});

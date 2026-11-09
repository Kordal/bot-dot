// refresh() runs once at a time (#1066): a refresh asked for while one is under way runs once more after it, however
// many asked, each caller is answered when the one that read its change is done, and an answer older than a later
// read is dropped. The page's own refresh, cut out of public/app.js, against a stand-in api whose answers wait.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut } = require('./web-page');

function page() {
  const asked = [];
  const pending = [];
  // Each request waits until the test lets it answer: { path, answer(value) }.
  const api = (path) => new Promise((resolve) => { asked.push(path); pending.push({ path, answer: resolve }); });
  const drawn = { renders: 0, needs: 0 };
  const state = { features: ['x'], view: 'chief' };
  const ctx = vm.createContext({
    state, api, Date, Promise, Array, Object, console: { warn() {} },
    fresh: { check() {} }, loadSkillLib: () => Promise.resolve(), loadMentionPages() {}, loadMentionProjects() {}, loadGroups: () => Promise.resolve([]),
    Unread: { count: () => 0 }, takeChiefName: () => false, openingLines: { sync() {} }, OpeningLine: { ofRun: () => '' }, chiefTurns: new Map(),
    report: { shown: () => null }, Figure: { saw() {} }, redrawMarks() {}, showJobApprovals() {}, MEMORY_WAITS: '/memory/waits',
    showNeeds: () => { drawn.needs++; }, renderContacts() {}, render: () => { drawn.renders++; },
  });
  vm.runInContext(`${cut('// ---------- data ----------', 'function render()')} this.refresh = refresh;`, ctx);
  // Answer every request that waits: the lists, then (a tick later) what is read after them.
  const answerAll = async (tag, rounds = 5) => {
    for (let i = 0; i < rounds; i++) {
      for (const p of pending.splice(0)) {
        p.answer(p.path === '/bots' ? [{ id: tag }] : p.path === '/chief' ? { chats: [], busy: false } : p.path === '/asks?vault-switch=1&vault-remove=1&vault-save=1&vault-file=1&override=1&chief-action=1&room-tool=1&room-post=1&computer-step=1&connect-app=1' ? [tag] : p.path.startsWith('/runs') ? [] : {});
      }
      await new Promise((r) => setImmediate(r));
    }
  };
  return { ctx, state, asked, pending, drawn, answerAll };
}

test('web: a refresh asked for while one is under way runs once after it, and every caller waits for that one (#1066)', async () => {
  const p = page();
  const first = p.ctx.refresh();
  await new Promise((r) => setImmediate(r));
  const lists = p.asked.filter((x) => x === '/bots').length;
  assert.equal(lists, 1);
  // Three more while it reads: none starts now.
  const more = [p.ctx.refresh(), p.ctx.refresh(), p.ctx.refresh()];
  await new Promise((r) => setImmediate(r));
  assert.equal(p.asked.filter((x) => x === '/bots').length, 1, 'no second read while one is under way');
  let answered = 0;
  more.forEach((m) => m.then(() => answered++));
  await p.answerAll('one', 1); // the first read's lists only
  await first;
  assert.equal(p.state.bots[0].id, 'one');
  assert.equal(answered, 0, 'those asked later wait for the read after theirs');
  assert.equal(p.asked.filter((x) => x === '/bots').length, 2, 'one more read for all three');
  await p.answerAll('two');
  await Promise.all(more);
  assert.equal(answered, 3);
  assert.equal(p.state.bots[0].id, 'two');
  assert.equal(p.asked.filter((x) => x === '/bots').length, 2, 'and no third');
  // With none under way, a refresh reads at once.
  const again = p.ctx.refresh();
  await new Promise((r) => setImmediate(r));
  assert.equal(p.asked.filter((x) => x === '/bots').length, 3);
  await p.answerAll('three');
  await again;
});

test('web: an answer read after the lists that comes after a later refresh began is dropped (#1066)', async () => {
  const p = page();
  const asks = '/asks?vault-switch=1&vault-remove=1&vault-save=1&vault-file=1&override=1&chief-action=1&room-tool=1&room-post=1&computer-step=1&connect-app=1';
  const first = p.ctx.refresh();
  await new Promise((r) => setImmediate(r));
  // The lists answer; its asks are asked and wait.
  for (const q of p.pending.splice(0)) q.answer(q.path === '/chief' ? { chats: [], busy: false } : q.path.startsWith('/runs') ? [] : [{ id: 'one' }]);
  await first;
  const slow = p.pending.find((q) => q.path === asks);
  assert.ok(slow, 'its asks are read after the lists');
  p.pending.splice(p.pending.indexOf(slow), 1);
  // A later refresh reads all and answers first.
  const second = p.ctx.refresh();
  await p.answerAll('new');
  await second;
  assert.deepEqual([...p.state.asks], ['new']);
  slow.answer(['old']);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...p.state.asks], ['new'], 'the older answer does not draw what was already read anew');
});

test('web: a read that hangs holds the others back for 30 s at most (#1066)', async () => {
  const p = page();
  let now = 1_000_000;
  p.ctx.Date = { now: () => now };
  const hung = p.ctx.refresh();
  await new Promise((r) => setImmediate(r));
  const waiting = p.ctx.refresh();
  let answered = false;
  waiting.then(() => { answered = true; });
  p.pending.splice(0); // never answered
  now += 31_000;
  const next = p.ctx.refresh();
  await new Promise((r) => setImmediate(r));
  assert.equal(p.asked.filter((x) => x === '/bots').length, 2, 'a new read starts');
  await p.answerAll('fresh');
  await next;
  await new Promise((r) => setImmediate(r));
  assert.equal(answered, true, 'and answers who waited behind the one that hung');
  assert.equal(p.state.bots[0].id, 'fresh');
  void hung;
});

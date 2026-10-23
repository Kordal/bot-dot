// An open page after an update (public/fresh.js): a page whose files changed on the server loads itself again, once
// nothing would be lost, and says nothing. Run against a stand-in page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fresh = require('../public/fresh');

function page({ dialog = false, focus = null, typed = '' } = {}) {
  const log = [];
  const doc = {
    activeElement: focus,
    querySelector: (q) => (q === 'dialog[open]' && dialog ? {} : null),
    querySelectorAll: (q) => (q === 'textarea' ? [{ value: typed }] : []),
  };
  const win = { document: doc, location: { reload: () => log.push('reload') } };
  return { win, doc, log };
}
const tick = () => new Promise((r) => setImmediate(r));

test('the same files: nothing happens; changed files: the page loads itself again', async () => {
  const { win, log } = page();
  let web = 'aaa';
  let asks = 0;
  const fresh = Fresh.keeper(win, async () => { asks++; return { web }; }, { every: 0 });
  fresh.seen({ web: 'aaa', features: [] }); // what the page was loaded with
  await fresh.check();
  assert.deepEqual(log, []);
  web = 'bbb'; // the update
  await fresh.check();
  assert.deepEqual(log, ['reload']);
  await fresh.check();
  assert.equal(asks, 2, 'asked no more once it knows');
  assert.deepEqual(log, ['reload'], 'once');
});

test('it waits for a quiet moment: an open dialog, a text field in use, unsent text', async () => {
  const { win, doc, log } = page({ dialog: true });
  const fresh = Fresh.keeper(win, async () => ({ web: 'new' }), { every: 0, retry: 5 });
  fresh.seen({ web: 'old' });
  await fresh.check();
  assert.ok(fresh.stale());
  assert.deepEqual(log, [], 'not over a dialog');
  doc.querySelector = () => null;
  doc.activeElement = { tagName: 'INPUT' };
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(log, [], 'not while typing');
  doc.activeElement = { tagName: 'BUTTON' };
  doc.querySelectorAll = () => [{ value: 'half a message' }];
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(log, [], 'not over unsent text');
  doc.querySelectorAll = () => [{ value: '  ' }];
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(log, ['reload']);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(log, ['reload'], 'and stops looking');
});

test('asks at most once a minute, and a server away or one that says no `web` changes nothing', async () => {
  const { win, log } = page();
  let asks = 0;
  let answer = () => Promise.reject(new Error('Bad gateway'));
  const fresh = Fresh.keeper(win, () => { asks++; return answer(); });
  fresh.seen({ web: 'old' });
  await fresh.check();
  assert.equal(asks, 0, 'the answer the page just had counts');
  const often = Fresh.keeper(win, () => { asks++; return answer(); }, { every: 0 });
  often.seen({ web: 'old' });
  await often.check();
  await tick();
  answer = async () => ({ features: [] }); // no `web`
  await often.check();
  assert.equal(asks, 2);
  assert.deepEqual(log, []);
  assert.equal(often.stale(), false);
});

test('a page loaded without an answer takes the first one it gets as its own', async () => {
  const { win, log } = page();
  const fresh = Fresh.keeper(win, async () => ({ web: 'x' }), { every: 0 });
  await fresh.check();
  await fresh.check();
  assert.deepEqual(log, []);
});

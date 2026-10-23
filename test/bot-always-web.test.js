// A bot's "Always approved" in its settings (#474): the jobs it may change without an OK and its lasting grants in
// connected apps, each in the owner's words, with Revoke.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { cut, element, finders } = require('./web-page');

function botAlways(b, { fail = null } = {}) {
  const row = element({}, { classes: ['hidden'] });
  const picks = element();
  const root = element({ '#bs-always': row, '#always-picks': picks });
  const calls = [], toasts = [];
  let picker = null, refreshed = 0;
  const ctx = vm.createContext({
    ...finders(), toast: (...a) => toasts.push(a), jobLine: (j) => `line of ${j.name}`, refresh: () => { refreshed++; },
    foldPicker: (el, items, selected, onChange, opts) => { picker = { el, items, selected, opts }; },
    api: async (path, opts = {}) => {
      calls.push([opts.method || 'GET', path, opts.body && JSON.parse(JSON.stringify(opts.body))]);
      if (fail) throw new Error(fail);
      return {};
    },
  });
  vm.runInContext(`${cut('// What you said to always approve for a bot', 'function foldPicker(')}; this.drawAlwaysApproved = drawAlwaysApproved;`, ctx);
  ctx.drawAlwaysApproved(b, root);
  return { row, calls, toasts, picker: () => picker, refreshed: () => refreshed };
}

const BOT = {
  id: 'b1',
  jobs: [{ id: 'j1', name: 'Daily digest', alwaysApprove: true }, { id: 'j2', name: 'Other', alwaysApprove: false }],
  alwaysAllowed: [{ action: 'github:GITHUB_MERGE_A_PULL_REQUEST', label: 'Merge a pull request with GitHub' }],
};

test("web: a bot's settings list its always-approved jobs and app actions in the owner's words", () => {
  const s = botAlways(BOT);
  assert.equal(s.row.classList.contains('hidden'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(s.picker().items.map((x) => [x.id, x.label]))), [['job j1', 'Daily digest'], ['app github:GITHUB_MERGE_A_PULL_REQUEST', 'Merge a pull request with GitHub']]);
  assert.equal(s.picker().opts.action.label, 'Revoke');
});

test('web: Revoke on an app action removes the lasting grant; on a job it turns off its always approve', async () => {
  const s = botAlways(BOT);
  assert.equal(await s.picker().opts.action.run('app github:GITHUB_MERGE_A_PULL_REQUEST'), true);
  assert.equal(await s.picker().opts.action.run('job j1'), true);
  assert.deepEqual(s.calls, [
    ['DELETE', '/bots/b1/connector-actions', { action: 'github:GITHUB_MERGE_A_PULL_REQUEST' }],
    ['PUT', '/bots/b1/jobs/j1', { alwaysApprove: false }],
  ]);
  assert.deepEqual(s.toasts.map((t) => t[0]), ['Revoked: it asks you again', 'Revoked: its next change waits for your OK']);
  assert.equal(s.refreshed(), 2);
});

test('web: a refused Revoke says why and keeps the row', async () => {
  const s = botAlways(BOT, { fail: 'Nope' });
  assert.equal(await s.picker().opts.action.run('app github:GITHUB_MERGE_A_PULL_REQUEST'), false);
  assert.deepEqual(s.toasts, [['Nope', true]]);
});

test('web: nothing always approved, and the row is hidden', () => {
  const s = botAlways({ id: 'b2', jobs: [] });
  assert.equal(s.row.classList.contains('hidden'), true);
  assert.equal(s.picker(), null);
});

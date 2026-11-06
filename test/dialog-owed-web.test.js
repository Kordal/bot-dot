// A feed event that arrives while a dialog is open is not lost (#1067): the refresh is owed, nothing is drawn under
// the dialog, and boot.js reads it when the dialog closes. The page's own followFeed, cut out of public/feed.js, against
// a stand-in feed and timers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, cut, feedStandIns } = require('./web-page');

test('web: a feed event under an open dialog owes a refresh, which its close reads (#1067)', () => {
  const heard = {};
  const modal = { open: true };
  let refreshed = 0;
  const timers = [];
  const feed = { addEventListener: (t, fn) => { (heard[t] ||= []).push(fn); } };
  class EventSource { constructor() { return feed; } }
  const state = {};
  const ctx = vm.createContext({
    ...feedStandIns(), state, EventSource, window: { EventSource }, JSON, refresh: () => { refreshed++; },
    $: (sel) => (sel === '#modal' ? modal : null), setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    setAway() {}, pollLoginRequests() {}, pollBitwarden() {},
  });
  vm.runInContext(`${cut('function followFeed()', '// ---------- boot ----------')}\nfollowFeed();`, ctx);
  heard.run_finished[0]({ data: '{}' });
  timers.pop()();
  assert.deepEqual([refreshed, state.refreshOwed], [0, true], 'nothing drawn under the dialog, and the refresh is owed');
  modal.open = false;
  heard.bots[0]({ data: '{}' });
  timers.pop()();
  assert.equal(refreshed, 1, 'with no dialog open the feed refreshes at once');
  // boot.js: the dialog's close reads what was owed, once; the interval and a tab shown again owe it too.
  assert.match(app, /\$\('#modal'\)\.addEventListener\('close', \(\) => \{ if \(state\.refreshOwed\) \{ state\.refreshOwed = false; refresh\(\); \} \}\);/);
  assert.match(app, /const refreshUnlessDialog = \(\) => \{ if \(\$\('#modal'\)\.open\) state\.refreshOwed = true; else refresh\(\); \};/);
  assert.match(app, /setInterval\(\(\) => \{ if \(!document\.hidden && due\(state\.refreshedAt, 60_000\)\) refreshUnlessDialog\(\); \}, 8000\);/);
  assert.match(app, /if \(document\.hidden\) return;\n    refreshUnlessDialog\(\);/);
});

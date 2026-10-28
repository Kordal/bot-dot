// Settings → "Updates" on the web page (#259, ADR 053): where the front door says this account's owner chooses (its
// session's `updates`), the switch "Update automatically" and, for a version the admin installed, "Update now", both on
// the front door's own routes. The page's own code, cut out of public/app.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, read, answer, element } = require('./web-page');

const READY = { autoUpdate: false, asked: false, canUpdate: true, ready: { version: 'abc1234', from: '0123456', since: '2026-10-21T10:00:00.000Z', deadline: '2026-10-28T10:00:00.000Z' }, last: null };

const NOTES = { entries: [{ id: '2026-10-22-b', title: 'Second <b>', points: ['One', 'Two'] }, { id: '2026-10-21-a', title: 'First', points: ['Three', 'Four'] }] };

function page({ features = ['accounts'], session = { updates: true }, update = READY, after = null, confirmed = true, notes = answer(200, NOTES) } = {}) {
  const calls = [];
  const toasts = [];
  const box = element();
  const now = element();
  const card = element({ '#auto-update': box, '#update-now': now }, {});
  card.hidden = true;
  const ctx = vm.createContext({
    state: { features },
    esc: (s) => String(s).replace(/</g, '&lt;'),
    toast: (text, bad = false) => toasts.push([text, bad]), flashSaved() {},
    confirm: () => confirmed,
    setTimeout: () => 0, clearTimeout: () => {},
    $: (sel, root) => (sel === '#update-card' ? card : root ? root.querySelector(sel) : null),
    fetch: async (url, opts) => {
      calls.push([url, opts]);
      if (url === '/front-door/session') return answer(200, session)();
      if (url === '/front-door/update/notes') return notes();
      if (opts?.method === 'POST') return (after || answer(200, { ...update, autoUpdate: JSON.parse(opts.body).autoUpdate ?? update.autoUpdate }))();
      return answer(200, update)();
    },
  });
  vm.runInContext(`${read('whats-new.js')}
    ${cut('const CHEV = ', '// A change on a settings screen saves by itself')}
    ${cut('// ---------- when this account switches to a new version ----------', '// ---------- signing out everywhere ----------')}
    Object.assign(this, { loadUpdateCard, drawUpdateCard, updateCardText });`, ctx);
  return { ctx, calls, toasts, card, box, now };
}

test('web: Settings shows Updates only where the front door says this account chooses', async () => {
  const shown = page();
  await shown.ctx.loadUpdateCard();
  assert.equal(shown.card.hidden, false);
  assert.match(shown.card.innerHTML, /Update automatically/);
  assert.match(shown.card.innerHTML, /A new version \(abc1234\) is ready/);
  assert.match(shown.card.innerHTML, /id="update-now"[^>]*>Update now</);
  assert.doesNotMatch(shown.card.innerHTML, /id="auto-update"[^>]* checked/, 'off, as the front door keeps it');
  assert.deepEqual(shown.calls.map(([u]) => u), ['/front-door/session', '/front-door/update', '/front-door/update/notes'], "the front door's own routes, not botdot's /api");

  for (const hidden of [page({ session: { updates: false } }), page({ features: [] })]) {
    await hidden.ctx.loadUpdateCard();
    assert.equal(hidden.card.hidden, true);
  }
  assert.match(cut('function renderSettings()', '// ---------- backups ----------'), /id="update-card"[\s\S]*loadUpdateCard\(\)/);
});

test('web: the switch saves at once, and "Update now" asks after a yes', async () => {
  const { ctx, calls, card, box, now } = page();
  await ctx.loadUpdateCard();
  box.checked = true;
  await box.onchange();
  const [url, opts] = calls.at(-1);
  assert.equal(url, '/front-door/update');
  assert.equal(opts.headers['X-Bot-Dot'], '1');
  assert.deepEqual(JSON.parse(opts.body), { autoUpdate: true });
  assert.match(card.innerHTML, /id="auto-update"[^>]* checked/);

  await now.onclick();
  assert.equal(calls.at(-1)[0], '/front-door/update/now');
  const no = page({ confirmed: false });
  await no.ctx.loadUpdateCard();
  await no.now.onclick();
  assert.ok(!no.calls.some(([u]) => u === '/front-door/update/now'), 'nothing without a yes');
});

test('web: a refusal is said and the switch goes back', async () => {
  const { ctx, toasts, box } = page({ after: answer(503, { error: 'Your account is paused by the admin.' }) });
  await ctx.loadUpdateCard();
  box.checked = true;
  await box.onchange();
  assert.deepEqual(toasts, [['Your account is paused by the admin.', true]]);
  assert.equal(box.checked, false);
});

test('web: the card says what became of the last move, and that it moves now', () => {
  const { ctx } = page();
  assert.match(ctx.updateCardText({ autoUpdate: true, asked: true, last: null }), /^Moving to the new version/);
  assert.match(ctx.updateCardText({ autoUpdate: false, last: { state: 'kept', error: "Its new botdot server didn't start" } }), /didn't happen: Its new botdot server didn't start\./);
  assert.equal(ctx.updateCardText({ autoUpdate: true, last: null, ready: null }), '', 'nothing waits or moves: the switch says it all');
  assert.equal(ctx.updateCardText({ autoUpdate: false, last: null, ready: null }), '');
});

test("web: the switch says what On and Off do, and no line follows while nothing waits", async () => {
  const { ctx, card } = page({ update: { autoUpdate: true, asked: false, canUpdate: false, ready: null, last: null } });
  await ctx.loadUpdateCard();
  // As its tooltip and its description for a screen reader, not lines under it (#635).
  assert.match(card.innerHTML, /<label class="bs-row" title="On: always use the latest botdot version\. Off: update when you're ready, before the admin's deadline\." aria-description="On: [^"]*"><b>Update automatically<\/b>/);
  assert.match(card.innerHTML, /<summary><b>Updates<\/b><span class="bs-val">Automatic<\/span>/, 'its row says how it is');
  assert.doesNotMatch(card.innerHTML, /id="update-said"/);
  assert.doesNotMatch(card.innerHTML, /What's new/);
});

test("web: while a version waits, its What's new shows under Updates (#303)", async () => {
  const { ctx, card, calls, box } = page();
  await ctx.loadUpdateCard();
  assert.deepEqual(calls.map(([u]) => u), ['/front-door/session', '/front-door/update', '/front-door/update/notes']);
  assert.match(card.innerHTML, /What's new[\s\S]*<h3>Second &lt;b><\/h3><ul><li>One<\/li><li>Two<\/li><\/ul>[\s\S]*<h3>First<\/h3>/, 'newest first, as text');
  assert.match(card.innerHTML, /id="update-now"[\s\S]*What's new/, 'below the controls');
  box.checked = true;
  await box.onchange();
  assert.match(card.innerHTML, /Second &lt;b>/, 'kept when the card is drawn again');

  const none = page({ update: { autoUpdate: true, asked: false, canUpdate: false, ready: null, last: null } });
  await none.ctx.loadUpdateCard();
  assert.ok(!none.calls.some(([u]) => u === '/front-door/update/notes'), 'nothing waits: not asked');
  assert.doesNotMatch(none.card.innerHTML, /What's new/);

  const older = page({ notes: answer(404, { error: 'Not found' }) });
  await older.ctx.loadUpdateCard();
  assert.equal(older.card.hidden, false);
  assert.doesNotMatch(older.card.innerHTML, /What's new/, 'an older front door: no notes, the card as before');
});

test('web: every note a waiting version brings shows under Updates, past the newest three as titles that open (#380)', async () => {
  const entries = Array.from({ length: 14 }, (_, i) => ({ id: `2026-10-${String(30 - i).padStart(2, '0')}-n`, title: `Note ${i + 1}`, points: ['One', 'Two'] }));
  const { ctx, card } = page({ notes: answer(200, { entries }) });
  await ctx.loadUpdateCard();
  assert.match(card.innerHTML, /14 changes, newest first/);
  assert.equal((card.innerHTML.match(/<section>/g) || []).length, 3);
  assert.equal((card.innerHTML.match(/<details><summary>Note \d+<\/summary>/g) || []).length, 11);
});

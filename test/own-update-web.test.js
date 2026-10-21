// Settings → "Updates" on the web page (#259, ADR 053): where the front door says this account's owner chooses (its
// session's `updates`), the switch "Update automatically" and, for a version the admin installed, "Update now", both on
// the front door's own routes. The page's own code, cut out of public/app.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, answer, element } = require('./web-page');

const READY = { autoUpdate: false, asked: false, canUpdate: true, ready: { version: 'abc1234', from: '0123456', since: '2026-10-21T10:00:00.000Z', deadline: '2026-10-28T10:00:00.000Z' }, last: null };

function page({ features = ['accounts'], session = { updates: true }, update = READY, after = null, confirmed = true } = {}) {
  const calls = [];
  const toasts = [];
  const box = element();
  const now = element();
  const card = element({ '#auto-update': box, '#update-now': now }, {});
  card.hidden = true;
  const ctx = vm.createContext({
    state: { features },
    esc: (s) => String(s),
    toast: (text, bad = false) => toasts.push([text, bad]),
    confirm: () => confirmed,
    setTimeout: () => 0, clearTimeout: () => {},
    $: (sel, root) => (sel === '#update-card' ? card : root ? root.querySelector(sel) : null),
    fetch: async (url, opts) => {
      calls.push([url, opts]);
      if (url === '/front-door/session') return answer(200, session)();
      if (opts?.method === 'POST') return (after || answer(200, { ...update, autoUpdate: JSON.parse(opts.body).autoUpdate ?? update.autoUpdate }))();
      return answer(200, update)();
    },
  });
  vm.runInContext(`${cut('// ---------- when this account switches to a new version ----------', '// ---------- signing out everywhere ----------')}
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
  assert.deepEqual(shown.calls.map(([u]) => u), ['/front-door/session', '/front-door/update'], "the front door's own routes, not botdot's /api");

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
  assert.match(ctx.updateCardText({ autoUpdate: true, last: null, ready: null }), /when the admin updates botdot/);
});

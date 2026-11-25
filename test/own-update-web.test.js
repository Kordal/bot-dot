// Settings → "Updates" on the web page (#259, ADR 053): where the front door says this account's owner chooses (its
// session's `updates`), the switch "Update automatically" and, for a version the admin installed, "Update now", both on
// the front door's own routes. The page's own code, cut out of public/app.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, read, answer, element, words } = require('./web-page');

const READY = { autoUpdate: false, asked: false, canUpdate: true, ready: { version: 'abc1234', from: '0123456', since: '2026-10-21T10:00:00.000Z', deadline: '2026-10-28T10:00:00.000Z' }, last: null };

const NOTES = { entries: [{ id: '2026-10-22-b', title: 'Second <b>', points: ['One', 'Two'] }, { id: '2026-10-21-a', title: 'First', points: ['Three', 'Four'] }] };

function page({ features = ['accounts'], session = { updates: true }, update = READY, after = null, confirmed = true, notes = answer(200, NOTES) } = {}) {
  const calls = [];
  const toasts = [];
  const asked = [];
  const box = element();
  const now = element();
  const pick = element();
  const card = element({ '#auto-update': box, '#update-when': pick, '#update-now': now }, {});
  card.hidden = true;
  const ctx = vm.createContext({
    ...words,
    state: { features },
    esc: (s) => String(s).replace(/</g, '&lt;'),
    toast: (text, bad = false) => toasts.push([text, bad]), flashSaved() {},
    askFirst: async (text) => { asked.push(text); return confirmed; },
    setTimeout: () => 0, clearTimeout: () => {},
    $: (sel, root) => (sel === '#update-card' ? card : root ? root.querySelector(sel) : null),
    fetch: async (url, opts) => {
      calls.push([url, opts]);
      if (url === '/front-door/session') return answer(200, session)();
      if (url === '/front-door/update/notes') return notes();
      if (opts?.method === 'POST') {
        const sent = JSON.parse(opts.body);
        return (after || answer(200, { ...update, autoUpdate: sent.autoUpdate ?? update.autoUpdate, ...(sent.when ? { when: sent.when, autoUpdate: sent.when !== 'manual' } : {}) }))();
      }
      return answer(200, update)();
    },
  });
  vm.runInContext(`${read('whats-new.js')}
    ${cut('const CHEV = ', '// A change on a settings screen saves by itself')}
    ${cut('// ---------- when this account switches to a new version ----------', '// ---------- signing out everywhere ----------')}
    Object.assign(this, { loadUpdateCard, drawUpdateCard, updateCardText });`, ctx);
  return { ctx, calls, toasts, asked, card, box, now, pick };
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

test("web: the switch is its own label, and no line follows while nothing waits", async () => {
  const { ctx, card } = page({ update: { autoUpdate: true, asked: false, canUpdate: false, ready: null, last: null } });
  await ctx.loadUpdateCard();
  // No tooltip or lines under it: "Update automatically" says it (#635, plain words).
  assert.match(card.innerHTML, /<label class="bs-row"><b>Update automatically<\/b>/);
  assert.doesNotMatch(card.innerHTML, /title="On:/);
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

// The three-way "When" (ADR 271, #1691): drawn only when the answer has `when`, else the switch above, unchanged.
const DAY = new Date(READY.ready.deadline).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' });
const WHEN = (when, more = {}) => ({ ...READY, when, autoUpdate: when !== 'manual', ...more });

test('web: an answer with `when` draws the three-way choice, not the switch', async () => {
  for (const [when, name] of [['ready', "As soon as it's ready"], ['night', 'At night, when idle'], ['manual', 'When I say']]) {
    const { ctx, card } = page({ update: WHEN(when) });
    await ctx.loadUpdateCard();
    assert.doesNotMatch(card.innerHTML, /id="auto-update"|Update automatically/, 'no switch');
    assert.match(card.innerHTML, /<b>When<\/b><select id="update-when" aria-label="When">/);
    assert.deepEqual([...card.innerHTML.matchAll(/<option value="(\w+)"( selected)?>([^<]*)</g)].map((m) => [m[1], !!m[2], m[3]]),
      [['ready', when === 'ready', "As soon as it's ready"], ['night', when === 'night', 'At night, when idle'], ['manual', when === 'manual', 'When I say']]);
    assert.match(card.innerHTML, new RegExp(`<summary><b>Updates</b><span class="bs-val">New version</span>`), 'a version waits: the row says so, not the choice');
    const idle = page({ update: WHEN(when, { ready: null }) });
    await idle.ctx.loadUpdateCard();
    assert.ok(idle.card.innerHTML.includes(`<span class="bs-val">${name}</span>`), 'nothing waits: the row names the choice');
  }
});

test('web: a waiting version still says "New version" on the closed row when the answer has `when`', async () => {
  for (const when of ['ready', 'night', 'manual']) {
    const { ctx, card } = page({ update: WHEN(when) });
    await ctx.loadUpdateCard();
    assert.match(card.innerHTML, /<summary><b>Updates<\/b><span class="bs-val">New version<\/span>/, `${when}: the waiting version, not the choice's name`);
  }
  const { ctx, card } = page({ update: WHEN('night', { ready: null }) });
  await ctx.loadUpdateCard();
  assert.match(card.innerHTML, /<span class="bs-val">At night, when idle<\/span>/, 'nothing waits: the row names the choice');
});

test('web: the text under the choice says when the waiting version moves, and the deadline', async () => {
  const said = async (when) => {
    const { ctx, card } = page({ update: WHEN(when) });
    await ctx.loadUpdateCard();
    return card.innerHTML.match(/id="update-said">([^<]*)</)[1];
  };
  assert.equal(await said('ready'), `A new version (abc1234) is ready. Your account moves to it as soon as your bots are idle.`);
  assert.match(await said('night'), /^A new version \(abc1234\) is ready\. Your account moves to it at night, when your bots are idle\.$/);
  assert.match(await said('manual'), /^A new version \(abc1234\) is ready\. Your account moves to it when you say, or by itself from .+\.$/);
  const { ctx } = page();
  assert.match(ctx.updateCardText({ when: 'night', asked: true }), /^Moving to the new version/, 'moving and failing are said as before');
  assert.equal(ctx.updateCardText({ when: 'night', last: null, ready: null }), '', 'nothing waits: the choice says it all');
  const none = page({ update: WHEN('night', { ready: null, canUpdate: false }) });
  await none.ctx.loadUpdateCard();
  assert.doesNotMatch(none.card.innerHTML, /id="update-said"/);
});

test('web: choosing sends { when } at once, and a refusal puts the old choice back', async () => {
  const { ctx, calls, card, pick } = page({ update: WHEN('night') });
  await ctx.loadUpdateCard();
  pick.value = 'manual';
  await pick.onchange();
  const [url, opts] = calls.at(-1);
  assert.equal(url, '/front-door/update');
  assert.equal(opts.headers['X-Bot-Dot'], '1');
  assert.deepEqual(JSON.parse(opts.body), { when: 'manual' });
  assert.match(card.innerHTML, /<option value="manual" selected>/, 'drawn again from its answer');

  const no = page({ update: WHEN('night'), after: answer(503, { error: 'Your account is paused by the admin.' }) });
  await no.ctx.loadUpdateCard();
  no.pick.value = 'ready';
  await no.pick.onchange();
  assert.deepEqual(no.toasts, [['Your account is paused by the admin.', true]]);
  assert.equal(no.pick.value, 'night');
  assert.equal(no.pick.disabled, false);
});

test('web: an answer without `when` keeps the switch, whatever else it says', async () => {
  const { ctx, card } = page({ update: { ...READY, busy: true } });
  await ctx.loadUpdateCard();
  assert.match(card.innerHTML, /id="auto-update"/);
  assert.doesNotMatch(card.innerHTML, /id="update-when"/);
  assert.match(card.innerHTML, /by itself on/, "today's line");
});

test('web: "Update now" warns that work stops only when the answer says the account is busy', async () => {
  const warning = /work still running stops/;
  for (const [more, warns] of [[{ busy: true }, true], [{ busy: false }, false], [{}, true]]) {
    const { ctx, now, asked } = page({ update: WHEN('manual', more) });
    await ctx.loadUpdateCard();
    await now.onclick();
    assert.equal(asked.length, 1);
    assert.equal(warning.test(asked[0]), warns, JSON.stringify(more));
    assert.match(asked[0], /^Update now\?/);
  }
  const old = page();
  await old.ctx.loadUpdateCard();
  await old.now.onclick();
  assert.match(old.asked[0], warning, 'an older front door: today\'s confirm');
});

test('web: the waiting sentence follows the owner\'s `when` and "Tonight", and keeps the deadline for an older front door', () => {
  const { ctx } = page();
  const waiting = (more) => ctx.updateCardText({ autoUpdate: false, asked: false, last: null, ready: READY.ready, ...more });
  assert.equal(waiting({ when: 'ready' }), 'A new version (abc1234) is ready. Your account moves to it as soon as your bots are idle.');
  assert.equal(waiting({ when: 'night' }), 'A new version (abc1234) is ready. Your account moves to it at night, when your bots are idle.');
  assert.match(waiting({ when: 'manual' }), /^A new version \(abc1234\) is ready\. Your account moves to it when you say, or by itself from .*28/);
  assert.equal(waiting({ when: 'manual', plan: 'night' }), 'A new version (abc1234) is ready. Your account moves to it at night, when your bots are idle.', 'Tonight is night');
  assert.equal(waiting({ when: 'ready', plan: 'night' }), 'A new version (abc1234) is ready. Your account moves to it as soon as your bots are idle.', 'ready still moves first');
  assert.match(waiting({}), /^A new version \(abc1234\) is ready\. Your account moves to it by itself on .*28.*, or now if you choose\.$/, 'no `when`: an older front door, as before');
  assert.match(waiting({ when: 'sometimes' }), /by itself on /, 'not one of the three: as before');
  assert.match(waiting({ when: 'night', asked: true }), /^Moving to the new version/, 'moving is said as before');
});

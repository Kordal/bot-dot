// Who carries on after the owner's OK, on the web page (OK-004; docs/api.md, "What follows a yes"): the page's own
// code for the cards (test/need-cards.js) against asks, jobs and tiles that have and lack the server's fields.
// No card says who carries on before the yes: the server still sends `then`, and the page draws none of it.
// After a yes whose answer has `carriesOn` the faded card and the line left in the chat say so after
// the page's own word. The buttons keep their words, and against a botdot server without `ask-continues`
// every card and label is the one of Milestone 5. The real page is walked in test/browser/carries-on.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, feedStandIns } = require('./web-page');
const { page, plain, metaOf, thenOf, buttonsOf, CODER, PERMISSION, BAD } = require('./need-cards');

const css = read('style.css');
const REQUEST = { who: 'bot', text: 'It carries on with “Check why the backup failed last night.” when you allow it.' };
const CHIEFS = { who: 'chief', chatId: 'c1', text: 'The Chief carries on in “Morning tech news” when you allow it.', here: 'The Chief carries on in this chat when you allow it.' };
const SKILL = { id: 's1', kind: 'skill', botId: null, bot: null, url: 'https://github.com/a/skill', skill: { name: 'tidy', description: 'Tidies.' }, forBots: [CODER], reason: 'For the weekly clean-up.', at: '2026-10-05T09:00:00.000Z' };
const JOB = { id: 'j1', name: 'Morning news', when: 'Every day at 7:00', kind: 'ai', prompt: 'Read the tech news.', approved: false, changedBy: 'chief' };
const TILE = { id: 't1', title: 'Disk space', bot: 'coder', changedBy: 'chief', read: { type: 'script', script: 'df -h' } };
const TILE_KEY = 'tile:t1:5';
const withJob = (job = JOB) => [{ ...CODER, jobs: [job] }];

// The card of a permission as the page of Milestone 5 drew it, whole.
const cardOf5 = (a, { open = false } = {}) => `
    <div class="${open ? 'card need-card open' : 'card need-card'}" data-need="ask:${a.id}" title="Click to see it all">
      <div class="need-who"><svg class="fig fig-small"></svg>${esc(a.bot.name)}</div>
      <div class="need-title">Let it ${esc(a.what.label)}?</div>
      <div class="need-meta">${esc(a.reason)}</div>
      <div class="need-body"><div class="nb">${esc(a.what.hint.replace(/^./, (c) => c.toUpperCase()))}. It can't until you allow it; you can change this in its settings.</div></div>
      <div class="req-error" role="alert" hidden></div>
      <div class="need-actions"><button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Allow</button></div>
    </div>`;

test('web: no card says who carries on before the yes, whatever `then` the server sends', () => {
  const tile = { ...TILE, then: CHIEFS };
  const fed = { jobs: [{ botId: 'coder', jobId: 'j1', jobName: 'Morning news', then: CHIEFS }], tiles: [], memory: 0, memoryChanges: [] };
  const p = page({ state: { asks: [{ ...PERMISSION, then: REQUEST }, { ...SKILL, then: CHIEFS }], bots: withJob({ ...JOB, then: REQUEST }), approvals: fed, dash: { pending: [tile], suggestions: [] } } });
  for (const key of ['ask:p1', 'ask:s1', 'job:j1', TILE_KEY]) {
    for (const here of [undefined, null, 'c1', 'c2']) {
      const html = p.needCardHTML(p.item(key), here);
      assert.equal(thenOf(html), null, `${key} in ${here}`);
      assert.doesNotMatch(html, /when you allow it/, `${key} in ${here}`);
    }
  }
  // The card of a permission is the one of Milestone 5, with and without `then`.
  assert.equal(p.needCardHTML(p.item('ask:p1')), cardOf5(PERMISSION));
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item(TILE_KEY))), ['Decline', 'Approve']);
  assert.deepEqual(buttonsOf(p.needCardHTML(p.item('job:j1'))), ['Decline', 'Always approve', 'Approve']);
  // In a chat and on the Needs you page alike.
  const chief = p.thread('c1');
  p.updateChatNeeds(chief.thread, 'chief');
  assert.doesNotMatch(chief.box.innerHTML, /need-then|when you allow it/);
  p.renderNeeds();
  assert.doesNotMatch(p.needsPage.innerHTML, /need-then|when you allow it/);
  assert.doesNotMatch(app, /need-then|thenLine/, 'the page has no such line');
  assert.doesNotMatch(css, /need-then/);
});

test('web: the page keeps the feed\'s list of what waits, from its first message and from each change', () => {
  const state = {};
  const feeds = [];
  const ctx = vm.createContext({
    ...feedStandIns(), window: { EventSource: true }, state, setTimeout: () => 0, clearTimeout() {}, setAway() {},
    EventSource: class { constructor() { this.on = {}; feeds.push(this); } addEventListener(type, fn) { (this.on[type] ||= []).push(fn); } },
  });
  vm.runInContext(`${cut('function followFeed()', '// ---------- boot ----------')}\nfollowFeed();`, ctx);
  const say = (type, data) => feeds[0].on[type].forEach((fn) => fn({ data: typeof data === 'string' ? data : JSON.stringify(data) }));
  const waits = { jobs: [{ botId: 'coder', jobId: 'j1', then: CHIEFS }], tiles: [], memory: 0, memoryChanges: [] };
  say('hello', { lastEventId: 4, running: [], approvals: waits, asks: { waiting: 0, list: [] } });
  assert.deepEqual(plain(state.approvals), waits, 'where things stand when the feed opens');
  say('approvals', { jobs: [], tiles: [], memory: 0, memoryChanges: [] });
  assert.deepEqual(plain(state.approvals.jobs), [], 'the job was answered, or its `then` went');
  say('approvals', waits);
  say('approvals', 'not JSON');
  assert.deepEqual(plain(state.approvals), waits, 'what cannot be read changes nothing');
  say('hello', { lastEventId: 9 });
  assert.equal(state.approvals, null, 'a server that lists nothing');
  // The refresh that follows an `approvals` event draws it: the page already listens to it for that.
  assert.match(app, /\['run_started', 'run_finished', 'run_waits', 'bot_message', 'waiting', 'chief_reply', 'chief_suggestion', 'approvals', 'asks', 'bots', 'reset'\]\.forEach\(\(t\) => es\.addEventListener\(t, soon\)\);/);
});

test('web: after a yes whose answer has `carriesOn`, the faded card says the label, " · " and who carries on', async () => {
  const cases = [
    ['a permission', { asks: [{ ...PERMISSION, then: REQUEST }] }, 'ask:p1', { ok: true, carriesOn: { who: 'bot', text: 'it carries on' } }, 'Allowed · it carries on', ['/asks/p1', 'POST', { yes: true, always: false }]],
    ['a permission, the bot busy', { asks: [PERMISSION] }, 'ask:p1', { ok: true, carriesOn: { who: 'bot', text: 'it carries on when it is free' } }, 'Allowed · it carries on when it is free', null],
    ['a skill', { asks: [SKILL] }, 'ask:s1', { ok: true, carriesOn: { who: 'chief', text: 'the Chief carries on' } }, 'Installed · the Chief carries on', null],
    ['a job', { bots: withJob() }, 'job:j1', { ...JOB, approved: true, carriesOn: { who: 'chief', text: 'the Chief carries on' } }, 'Approved · the Chief carries on', ['/bots/coder/jobs/j1/approve', 'POST', { approve: true, always: false }]],
    ['a tile', { bots: [CODER], dash: { pending: [TILE], suggestions: [] } }, TILE_KEY, { ok: true, carriesOn: { who: 'chief', text: 'the Chief carries on' } }, 'Approved · the Chief carries on', ['/dashboard/tiles/t1/approve', 'POST', { approve: true }]],
  ];
  for (const [what, state, key, answer, label, call] of cases) {
    const p = page({ state, answer: () => answer });
    const card = p.show(key);
    await p.decide(p.item(key), true);
    assert.equal(card.actions.innerHTML, `<span class="muted">${label}</span>`, what);
    assert.ok(card.classList.contains('done'), `${what}: the card fades`);
    assert.equal(p.needsDone.get(key), card.outerHTML, `${what}: it stays on the page, faded`);
    assert.deepEqual(p.toasts, [], what);
    assert.equal(p.refreshed(), 1, what);
    if (call) assert.deepEqual(plain(p.calls), [call], what);
  }
  // "Always approve" on a job counts as a yes.
  const always = page({ state: { bots: withJob() }, answer: () => ({ ...JOB, approved: true, carriesOn: { who: 'chief', text: 'the Chief carries on' } }) });
  const card = always.show('job:j1');
  await always.decide(always.item('job:j1'), true, true, true);
  assert.equal(card.actions.innerHTML, '<span class="muted">Always approved · the Chief carries on</span>');
  assert.deepEqual(plain(always.calls), [['/bots/coder/jobs/j1/approve', 'POST', { approve: true, always: true }]]);
});

test('web: the line left in a chat says it too, in every place the card stood', async () => {
  const p = page({ state: { asks: [{ ...PERMISSION, then: REQUEST }] }, answer: () => ({ ok: true, carriesOn: { who: 'bot', text: 'it carries on' } }) });
  const inChat = p.show('ask:p1', 'coder', 'Let it run commands?');
  const onPage = p.show('ask:p1', null, 'Let it run commands?');
  await p.decide(p.item('ask:p1'), true);
  assert.deepEqual(plain([...p.chatDecided.values()]), [{ scope: 'coder', title: 'Let it run commands?', label: 'Allowed · it carries on' }]);
  assert.equal(p.needsDone.get('ask:p1'), onPage.outerHTML);
  for (const card of [inChat, onPage]) assert.equal(card.actions.innerHTML, '<span class="muted">Allowed · it carries on</span>');
  // The chat draws that line: "Let it run commands? · Allowed · it carries on".
  const chat = p.thread();
  p.state.asks = [];
  p.updateChatNeeds(chat.thread, 'coder');
  assert.equal(chat.box.innerHTML, '<div class="chat-decided">Let it run commands? · Allowed · it carries on</div>');
});

test('web: without `carriesOn` the label stands alone, as it did', async () => {
  const labels = [
    ['ask:p1', { asks: [PERMISSION] }, true, 'Allowed'],
    ['ask:s1', { asks: [SKILL] }, true, 'Installed'],
    ['job:j1', { bots: withJob() }, true, 'Approved'],
    [TILE_KEY, { bots: [CODER], dash: { pending: [TILE], suggestions: [] } }, true, 'Approved'],
    ['ask:p1', { asks: [PERMISSION] }, false, 'Declined'],
  ];
  for (const [key, state, yes, label] of labels) {
    for (const answer of [{ ok: true }, {}, { ok: true, carriesOn: null }, { ok: true, carriesOn: {} }, { ok: true, carriesOn: { who: 'bot' } }, { ok: true, carriesOn: { text: '  ' } }, { ok: true, carriesOn: { text: 7 } }, { ok: true, carriesOn: 'it carries on' }]) {
      const p = page({ state, answer: () => answer });
      const card = p.show(key, 'coder', 'T');
      await p.decide(p.item(key), yes);
      assert.equal(card.actions.innerHTML, `<span class="muted">${label}</span>`, `${key} ${JSON.stringify(answer)}`);
      assert.equal([...p.chatDecided.values()][0].label, label);
    }
  }
  // A no starts nothing, whatever the answer holds.
  const no = page({ state: { asks: [PERMISSION] }, answer: () => ({ ok: true, declined: true, carriesOn: { who: 'bot', text: 'it carries on' } }) });
  const card = no.show('ask:p1');
  await no.decide(no.item('ask:p1'), false);
  assert.equal(card.actions.innerHTML, '<span class="muted">Declined</span>');
});

test('web: a request that fails leaves the card with its buttons and one line that says why', async () => {
  for (const said of ['That request was already answered.', "Can't reach botdot."]) {
    const p = page({ state: { asks: [{ ...PERMISSION, then: REQUEST }] }, answer: () => new Error(said) });
    const card = p.show('ask:p1', 'coder');
    const buttons = card.actions.innerHTML;
    await p.decide(p.item('ask:p1'), true);
    assert.deepEqual(p.toasts, [[said, true]]);
    assert.ok(!card.classList.contains('done'), 'not faded');
    assert.equal(card.actions.innerHTML, buttons, 'its buttons stay');
    assert.equal(p.needsDone.size + p.chatDecided.size, 0);
    assert.equal(p.refreshed(), 0);
  }
});

test('web: what the server says is text on the card and in the chat, never markup', async () => {
  const p = page({ state: { asks: [{ ...PERMISSION, then: { who: 'chief', chatId: 'c1', text: BAD, here: `here ${BAD}` } }] }, answer: () => ({ ok: true, carriesOn: { who: 'bot', text: BAD } }) });
  for (const here of [null, 'c1']) {
    const html = p.needCardHTML(p.item('ask:p1'), here);
    assert.equal(thenOf(html), null);
    assert.doesNotMatch(html, /<img|<script|onerror="/);
    assert.deepEqual([...new Set(html.match(/<[a-z]+/g))].sort(), ['<button', '<div', '<svg'], 'only the card\'s own tags');
  }
  const card = p.show('ask:p1', 'coder', 'Let it run commands?');
  await p.decide(p.item('ask:p1'), true);
  assert.equal(card.actions.innerHTML, `<span class="muted">${esc(`Allowed · ${BAD}`)}</span>`);
  assert.doesNotMatch(card.actions.innerHTML, /<img|<script|onerror="/);
  // The chat keeps the words as they are and escapes them where it draws them.
  assert.equal([...p.chatDecided.values()][0].label, `Allowed · ${BAD}`);
  const chat = p.thread();
  p.state.asks = [];
  p.updateChatNeeds(chat.thread, 'coder');
  assert.equal(chat.box.innerHTML, `<div class="chat-decided">Let it run commands? · ${esc(`Allowed · ${BAD}`)}</div>`);
  assert.match(cut('async function decide(x, yes', 'async function refreshNeeds() {'), /innerHTML = `<span class="muted">\$\{esc\(label\)\}<\/span>`;/);
});

test('web: against a botdot server without `ask-continues` every card and label is the one of Milestone 5', async () => {
  // Its asks, jobs and tiles have none of the fields, and its answers no `carriesOn`.
  const p = page({ state: { asks: [PERMISSION, SKILL], bots: withJob(), dash: { pending: [TILE], suggestions: [] } }, answer: () => ({ ok: true, bot: CODER }) });
  assert.equal(p.needCardHTML(p.item('ask:p1')), cardOf5(PERMISSION));
  for (const key of ['ask:p1', 'ask:s1', 'job:j1', TILE_KEY]) assert.doesNotMatch(p.needCardHTML(p.item(key), 'c1'), /need-then|carries on/, key);
  const card = p.show('ask:p1', 'coder', 'Let it run commands?');
  await p.decide(p.item('ask:p1'), true);
  assert.equal(card.actions.innerHTML, '<span class="muted">Allowed</span>');
  assert.deepEqual(plain([...p.chatDecided.values()]), [{ scope: 'coder', title: 'Let it run commands?', label: 'Allowed' }]);
});

test('web: a closed card cuts the lines under its title to one, and keeps its width', () => {
  assert.match(css, /\.need-card:not\(\.open\) \.need-meta \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  // The card stays as wide as the prototype's at both widths: one column of 560 px at most in a chat, a grid on the page.
  assert.match(css, /\.chat-needs \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: var\(--sp-12\); max-width: 560px; \}/);
  assert.match(css, /\.need-grid \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(300px, 1fr\)\); gap: var\(--sp-16\); align-items: stretch; \}/);
});

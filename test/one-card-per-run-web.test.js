// One card per run (#277), on the web page: the page's own code for the cards (test/need-cards.js) against asks as the
// server sends them (test/one-card-per-run.test.js). The asks that share a `batch` are one card with Decline all and
// Allow all over each ask's own card; a Vault secret keeps its own yes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { page, plain, buttonsOf, CODER, BAD } = require('./need-cards');

const BATCH = { id: 'run-r1', title: 'Coder wants 2 things for “Fix the build”', count: 2 };
const WEB = { id: 'p1', kind: 'permission', botId: 'coder', bot: CODER, permission: 'web', what: { label: 'browse the web', hint: 'search, and read web pages' }, reason: 'docs', text: 'Asks to browse the web', at: '2026-10-22T09:00:00.000Z', batch: BATCH };
const LIFT = { id: 'o1', kind: 'override', botId: 'coder', bot: CODER, title: 'Let Coder do this, though its rules say no?', parts: [], yes: 'Allow once', always: 'Allow always for this bot', text: 'Asks to lift a rule: x', at: '2026-10-22T09:01:00.000Z', batch: BATCH };
const SWITCH = { id: 's1', kind: 'vault-switch', botId: 'coder', bot: CODER, title: 'Let Coder use “Bridge” in its computer?', parts: [], yes: 'Allow', text: 'Asks to turn on …', at: '2026-10-22T09:02:00.000Z', batch: { ...BATCH, count: 3, own: true } };
const ALONE = { id: 'p2', kind: 'permission', botId: 'news', bot: { id: 'news', name: 'News', color: '#e0703a' }, permission: 'web', what: { label: 'browse the web' }, text: 'Asks to browse the web', at: '2026-10-22T08:00:00.000Z' };

test('web: the asks of one run are one card, where the first stood, with each ask under it', () => {
  const p = page({ state: { asks: [ALONE, WEB, LIFT] } });
  const shown = p.batched(p.needsItems().filter((x) => x.kind === 'ask'));
  assert.deepEqual(plain(shown.map((x) => x.key)), ['ask:p2', 'batch:run-r1']);
  const html = p.needCardHTML(shown[1]);
  assert.match(html, /<div class="need-title">Coder wants 2 things for “Fix the build”<\/div>/);
  assert.match(html, /data-batch-no>Decline all<\/button><button class="btn sm primary" data-batch-yes>Allow all<\/button>/);
  assert.deepEqual(buttonsOf(html), ['Decline', 'Allow', 'Decline', 'Allow always for this bot', 'Allow once'], "each ask keeps its own buttons");
  assert.doesNotMatch(html, /need-own/);
});

test('web: one ask left of a batch on the page is its own card again', () => {
  const p = page({ state: { asks: [WEB] } });
  assert.deepEqual(plain(p.batched(p.needsItems()).map((x) => x.kind)), ['ask']);
});

test('web: a Vault secret is named as one Allow all leaves to its own Allow', () => {
  const p = page({ state: { asks: [{ ...WEB, batch: { ...BATCH, count: 3 } }, { ...LIFT, batch: { ...BATCH, count: 3 } }, SWITCH] } });
  const [card] = p.batched(p.needsItems());
  const html = p.needCardHTML(card);
  assert.match(html, /<div class="need-meta need-own">Allow all leaves “Let Coder use “Bridge” in its computer\?” to its own Allow\.<\/div>/);
  assert.match(html, /Allow all/);
});

test('web: Allow all asks the server once and each card reads its own answer; one that failed says why', async () => {
  const p = page({
    state: { asks: [WEB, LIFT] },
    answer: () => ({ ok: true, answers: [{ id: 'p1', ok: true, bot: {} }, { id: 'o1', ok: false, status: 409, error: 'Coder has 10 lifted rules already.' }], left: [] }),
  });
  p.show('ask:p1', null, 'Let it browse the web?');
  const lift = p.show('ask:o1', null, 'Let Coder do this?');
  const [card] = p.batched(p.needsItems());
  await p.decideBatch(card, true);
  assert.deepEqual(plain(p.calls), [['/asks/batch/run-r1', 'POST', { yes: true, ids: ['p1', 'o1'] }]]);
  assert.ok(p.needsDone.has('ask:p1'));
  assert.ok(!p.needsDone.has('ask:o1'), 'the one that failed keeps its card');
  assert.match(lift.actions.innerHTML, /data-need-yes/);
  assert.deepEqual(plain(p.toasts), [['Coder has 10 lifted rules already.', true]]);
});

test('web: what the server says on the card of several is text', () => {
  const p = page({ state: { asks: [{ ...WEB, batch: { ...BATCH, title: BAD } }, { ...LIFT, batch: { ...BATCH, title: BAD } }] } });
  const html = p.needCardHTML(p.batched(p.needsItems())[0]);
  assert.doesNotMatch(html, /<img|<script/);
});

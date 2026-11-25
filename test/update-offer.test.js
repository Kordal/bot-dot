// A new version that waits for an account is said in its Chief's chat (#1690, lib/update-offer.js, ADR 271): the front door
// tells the account its update state; the account keeps one `update` card in Needs you (Now, Tonight) and says the version
// once, as a plain botdot note held through quiet hours that names the card (ADR 252). What was said is kept in a file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const asksLib = require('../lib/asks');
const offerLib = require('../lib/update-offer');

const HOUR = 3600_000;
// 2026-11-25 12:00 UTC: outside the quiet hours below; 23:00 is inside them.
const NOON = Date.parse('2026-11-25T12:00:00Z');
const NIGHT = Date.parse('2026-11-25T23:00:00Z');
const QUIET = { start: 22, end: 7, timeZone: 'UTC' };
const DEADLINE = '2026-12-02T10:00:00.000Z';

const ready = (over = {}) => ({ state: 'ready', version: 'abc1234', from: '0123456', when: 'night', plan: null, deadline: DEADLINE, notes: [{ title: 'Updates wait for idle' }, { title: 'Hats for every bot' }], ...over });

function setup(t, { lang = 'en' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-offer-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const posted = [];
  let at = NOON;
  const asks = asksLib.create(dataDir);
  const make = () => offerLib.create({ dataDir, asks, post: (m) => { posted.push(m); }, quietHours: () => QUIET, language: () => lang, now: () => at });
  const cards = () => asks.list().filter((a) => a.kind === 'update');
  const view = (a = cards()[0]) => asksLib.proposalView(a, undefined, { lang, now: at });
  return { offer: make(), again: make, asks, posted, dataDir, cards, view, set: (ms) => { at = ms; } };
}

test('a version that waits is one card with Now and Tonight, whose first is its act', (t) => {
  const s = setup(t);
  s.offer.tell(ready({ when: 'manual' }));
  assert.equal(s.cards().length, 1);
  const card = s.cards()[0];
  assert.equal(card.botId, null, "the Chief's, no bot");
  const v = s.view();
  assert.equal(v.title, 'A new version is ready');
  assert.deepEqual(v.act, { verb: 'update-now', label: 'Now' }, 'a card without an act falls into the skill card on the web');
  assert.deepEqual(v.acts, [{ verb: 'update-now', label: 'Now' }, { verb: 'update-tonight', label: 'Tonight' }]);
  assert.match(v.body, /^Your account moves to it when you say, or by itself on 2 December\.$/);
  assert.equal(v.no, undefined, 'nothing to say no to: it goes by itself once the account has moved');
});

test('Tonight is offered only for "When I say" with no plan, and the card says when it moves', (t) => {
  const s = setup(t);
  s.offer.tell(ready({ when: 'night' }));
  assert.deepEqual(s.view().acts.map((a) => a.verb), ['update-now']);
  assert.match(s.view().body, /^Your account moves to it tonight, when your bots are idle\.$/);
  s.offer.tell(ready({ when: 'ready' }));
  assert.deepEqual(s.view().acts.map((a) => a.verb), ['update-now']);
  assert.match(s.view().body, /^Your account moves to it as soon as your bots are idle\.$/);
  s.offer.tell(ready({ when: 'manual', plan: 'night' }));
  assert.deepEqual(s.view().acts.map((a) => a.verb), ['update-now'], 'Tonight was pressed');
  assert.match(s.view().body, /tonight, when your bots are idle/);
  s.offer.tell(ready({ when: 'manual' }));
  assert.deepEqual(s.view().acts.map((a) => a.verb), ['update-now', 'update-tonight']);
  assert.equal(s.cards().length, 1, 'one card through all of it');
});

test('from the deadline on the owner\'s choice no longer counts, and the card says so', (t) => {
  const s = setup(t);
  s.offer.tell(ready({ when: 'manual', deadline: '2026-11-24T10:00:00.000Z' }));
  assert.match(s.view().body, /^Your account moves to it as soon as your bots are idle\.$/);
  assert.deepEqual(s.view().acts.map((a) => a.verb), ['update-now'], 'Tonight no longer changes anything');
});

test('the card says Now asks first only when the front door said the account is busy', (t) => {
  const s = setup(t);
  s.offer.tell(ready());
  assert.equal('busy' in s.view(), false, 'no answer from the account, nothing said');
  assert.equal(s.cards()[0].busy, undefined);
  s.offer.tell(ready({ busy: true }));
  assert.equal(s.view().busy, true);
  s.offer.tell(ready({ busy: false }));
  assert.equal(s.view().busy, false);
});

test('the card is in Polish when the account is', (t) => {
  const s = setup(t, { lang: 'pl' });
  s.offer.tell(ready({ when: 'manual' }));
  const v = s.view();
  assert.equal(v.title, 'Nowa wersja jest gotowa');
  assert.deepEqual(v.acts.map((a) => a.label), ['Teraz', 'Dziś w nocy']);
  assert.match(v.body, /2 grudnia/);
});

test('the note is said once per version: a plain botdot note with the titles, naming the card', (t) => {
  const s = setup(t);
  s.offer.tell(ready());
  assert.equal(s.posted.length, 1);
  const m = s.posted[0];
  assert.equal(m.role, 'chief');
  assert.equal(m.notice, true, 'botdot\'s own words, not a turn');
  assert.deepEqual(m.cards, [s.cards()[0].id], 'the card it names, drawn under it (ADR 252)');
  assert.match(m.text, /^A new version of botdot is ready\./);
  assert.match(m.text, /- Updates wait for idle\n- Hats for every bot/);
  assert.equal(/\[card/.test(m.text), false, 'the id is in `cards`, not in the text');
  // The same version again (the front door tells every change, and again after a failure): nothing more is said.
  s.offer.tell(ready({ busy: true }));
  s.offer.tell(ready({ when: 'manual' }));
  s.again().tell(ready());
  assert.equal(s.posted.length, 1);
  // Another version is said again, on the same card.
  s.offer.tell(ready({ version: 'def5678', notes: [{ title: 'Something else' }] }));
  assert.equal(s.posted.length, 2);
  assert.match(s.posted[1].text, /- Something else/);
  assert.equal(s.cards().length, 1);
  assert.deepEqual(s.posted[1].cards, [s.cards()[0].id]);
});

test('a version with no titles is still said, without the list; the titles are plain text and few', (t) => {
  const s = setup(t);
  s.offer.tell(ready({ notes: [] }));
  assert.equal(s.posted.length, 1);
  assert.doesNotMatch(s.posted[0].text, /What's new/);
  const many = Array.from({ length: 12 }, (_, i) => ({ title: `Note ${i}\nwith [card deadbeef] and ${'x'.repeat(200)}` }));
  s.offer.tell(ready({ version: 'zzz9999', notes: many }));
  const lines = s.posted[1].text.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 5);
  assert.ok(lines.every((l) => l.length <= 90 && !/\[card/.test(l)));
});

test('in quiet hours the note waits and goes out when they end; the card stands meanwhile', (t) => {
  const s = setup(t);
  s.set(NIGHT);
  s.offer.tell(ready());
  assert.equal(s.cards().length, 1, 'the card is there at once');
  assert.deepEqual(s.posted, []);
  s.again().check();
  assert.deepEqual(s.posted, [], 'still night');
  s.set(NIGHT + 9 * HOUR);
  s.again().check();
  assert.equal(s.posted.length, 1);
  assert.deepEqual(s.posted[0].cards, [s.cards()[0].id]);
  s.again().check();
  assert.equal(s.posted.length, 1, 'once');
});

test('a note held through the night is not said when the account has moved by morning', (t) => {
  const s = setup(t);
  s.set(NIGHT);
  s.offer.tell(ready());
  s.offer.tell({ state: 'moving', version: 'abc1234' });
  s.offer.tell({ state: 'none' });
  s.set(NIGHT + 9 * HOUR);
  s.offer.check();
  assert.deepEqual(s.posted, []);
});

test('moving says so on the same card with no buttons; none takes the card away', (t) => {
  const s = setup(t);
  s.offer.tell(ready());
  const id = s.cards()[0].id;
  s.offer.tell({ state: 'moving', version: 'abc1234' });
  assert.equal(s.cards().length, 1);
  assert.equal(s.cards()[0].id, id, 'the card the note named');
  const v = s.view();
  assert.equal(v.title, 'Moving to the new version');
  assert.equal(v.body, 'Your bots restart in a minute or two.');
  assert.deepEqual(v.acts, []);
  assert.equal(v.act.verb, 'update-moving', 'an act the apps know, with no button');
  s.offer.tell({ state: 'none' });
  assert.deepEqual(s.cards(), []);
  assert.equal(s.posted.length, 1);
  // The same version waiting again after a switch that didn't happen: the note was said already.
  s.offer.tell(ready());
  assert.equal(s.posted.length, 1);
  assert.equal(s.cards().length, 1);
});

test('what was told and said is kept: a restart neither loses the card nor says it again', (t) => {
  const s = setup(t);
  s.offer.tell(ready());
  const again = s.again();
  assert.equal(again.current().state, 'ready');
  again.tell(ready());
  assert.equal(s.posted.length, 1);
  assert.equal(s.cards().length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'update-offer.json'), 'utf8')).offer.version, 'abc1234');
});

test('what the front door says is checked, and an entry that is wrong changes nothing', (t) => {
  const s = setup(t);
  for (const bad of [null, [], {}, { state: 'soon' }, ready({ deadline: 'never' }), ready({ deadline: undefined }), ready({ when: 'sometime' }), ready({ plan: 'day' }), ready({ notes: 'a' }), ready({ busy: 'yes' })]) {
    assert.throws(() => s.offer.tell(bad), (e) => e.status === 400 && typeof e.message === 'string', JSON.stringify(bad));
  }
  assert.deepEqual(s.cards(), []);
  assert.deepEqual(s.posted, []);
  // A version with no words, or notes without titles, is not wrong: it is said without them.
  s.offer.tell(ready({ version: null, from: null, notes: [{ id: 'x' }, 'a plain title', { title: '' }] }));
  assert.equal(s.cards().length, 1);
  assert.match(s.posted[0].text, /- a plain title/);
});

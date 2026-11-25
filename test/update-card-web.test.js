// The card of a new version that waits for the account on the web page (`update`, #1690, ADR 271): the server's title and
// when the account moves, with the buttons its `acts` name by verb. They call the front door's own routes with the owner's
// session, never the account's botdot server; Now asks first only when the card says the account is busy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./web-page');
const { page, plain, titleOf, metaOf, BAD } = require('./need-cards');

const NOW = { verb: 'update-now', label: 'Now' };
const TONIGHT = { verb: 'update-tonight', label: 'Tonight' };
const UPDATE = {
  id: 'u1', kind: 'update', botId: null, bot: null, title: 'A new version is ready', body: 'Your account moves to it when you say, or by itself on 2 December.',
  act: NOW, acts: [NOW, TONIGHT], text: 'A new version is ready', yesOn: 'card', at: '2026-11-25T09:00:00.000Z',
};
const buttons = (html) => [...html.matchAll(/<button class="btn sm( primary)?" data-need-update="([^"]+)"( disabled)?>(.*?)<\/button>/g)].map((m) => [m[2], m[4], !!m[1], !!m[3]]);

// The page with one update card; `asked`: the answers of its questions (askFirst), `doors`: what the front door's routes answer.
function updatePage(ask, { asked = [], fail = null, features = ['update-offer'] } = {}) {
  const questions = [], posts = [];
  const p = page({ state: { asks: [ask], bots: [], features }, extra: {
    askFirst: async (question, yes) => { questions.push([question, yes]); return asked.length ? asked.shift() : true; },
    frontDoorPost: async (path, body) => { posts.push([path, body]); if (fail) throw new Error(fail); return {}; },
  } });
  return { ...p, questions, posts, draw: () => p.needCardHTML(p.item(`ask:${ask.id}`)), press: (verb) => p.pressUpdate(p.item(`ask:${ask.id}`), verb) };
}

test('web: the card is the server\'s title, when it moves, and Now and Tonight, no Not now', () => {
  const html = updatePage(UPDATE).draw();
  assert.equal(titleOf(html), 'A new version is ready');
  assert.equal(metaOf(html), 'Your account moves to it when you say, or by itself on 2 December.');
  assert.deepEqual(buttons(html), [['update-now', 'Now', true, false], ['update-tonight', 'Tonight', false, false]]);
  assert.doesNotMatch(html, /data-need-no|data-need-yes|Install|skill/);
  assert.match(html, /need-update/);
});

test('web: Tonight is not there when the server does not offer it; moving has no button', () => {
  assert.deepEqual(buttons(updatePage({ ...UPDATE, acts: [NOW] }).draw()).map((b) => b[0]), ['update-now']);
  const moving = updatePage({ ...UPDATE, title: 'Moving to the new version', body: 'Your bots restart in a minute or two.', act: { verb: 'update-moving' }, acts: [] }).draw();
  assert.equal(titleOf(moving), 'Moving to the new version');
  assert.deepEqual(buttons(moving), []);
});

test('web: an act the page does not know draws no card, and what the server sent is text', () => {
  assert.equal(updatePage({ ...UPDATE, act: { verb: 'update-sing', label: 'Sing' } }).draw(), '', 'an older app draws no card whose verb it does not know');
  assert.deepEqual(buttons(updatePage({ ...UPDATE, acts: [NOW, { verb: 'update-sing', label: 'Sing' }, { verb: 'update-tonight', label: '' }] }).draw()).map((b) => b[0]), ['update-now']);
  const html = updatePage({ ...UPDATE, title: BAD, body: BAD, acts: [{ verb: 'update-now', label: BAD }] }).draw();
  assert.doesNotMatch(html, /<img|<script/);
});

test('web: Now goes to the front door with no question when the account is idle, and asks first when it is busy', async () => {
  const idle = updatePage({ ...UPDATE, busy: false });
  await idle.press('update-now');
  assert.deepEqual(idle.questions, []);
  assert.deepEqual(plain(idle.posts), [['/front-door/update/now', {}]]);
  assert.equal(idle.refreshed(), 1, 'the card looks again');
  const unknown = updatePage(UPDATE); // the front door could not ask: nothing to warn of
  await unknown.press('update-now');
  assert.deepEqual(unknown.questions, []);

  const busy = updatePage({ ...UPDATE, busy: true }, { asked: [false] });
  await busy.press('update-now');
  assert.equal(busy.questions.length, 1);
  assert.match(busy.questions[0][0], /^Update now\? Your account moves to the new version: your bots restart, and work still running stops\.$/);
  assert.equal(busy.questions[0][1], 'Update now');
  assert.deepEqual(plain(busy.posts), [], 'Cancel sends nothing');
  const sure = updatePage({ ...UPDATE, busy: true }, { asked: [true] });
  await sure.press('update-now');
  assert.deepEqual(plain(sure.posts), [['/front-door/update/now', {}]]);
});

test('web: Tonight is the owner\'s plan for this version, asked of the front door with no question', async () => {
  const p = updatePage({ ...UPDATE, busy: true });
  await p.press('update-tonight');
  assert.deepEqual(p.questions, []);
  assert.deepEqual(plain(p.posts), [['/front-door/update', { plan: 'night' }]]);
  assert.equal(p.calls.length, 0, 'never the account\'s botdot server');
});

test('web: a refusal stands in the card\'s own line, and the button works again', async () => {
  const p = updatePage(UPDATE, { fail: 'There is no new version to switch to.' });
  await p.press('update-now');
  assert.deepEqual(plain(p.toasts), [['There is no new version to switch to.', true]], 'the card is not on screen here: the toast');
  assert.equal(p.updating.has('u1'), false);
  await p.press('update-now');
  assert.equal(p.posts.length, 2);
});

test('web: a second press while the first is on its way sends nothing', async () => {
  const p = updatePage(UPDATE);
  const first = p.press('update-now');
  await p.press('update-now');
  await first;
  assert.equal(p.posts.length, 1);
});

test('web: it is the Chief\'s card: in the Chief\'s chat and no bot\'s, and the buttons are wired', () => {
  const p = updatePage(UPDATE);
  assert.deepEqual(plain(p.chatNeeds('chief').map((x) => x.key)), ['ask:u1']);
  assert.deepEqual(plain(p.chatNeeds('mail').map((x) => x.key)), []);
  assert.match(read('needs.js'), /\$\$\('\[data-need-update\]', el\)\.forEach\(\(b\) => \{ b\.onclick = \(\) => pressUpdate\(x, b\.dataset\.needUpdate\); \}\);/);
});

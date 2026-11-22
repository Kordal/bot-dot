// A managed machine's owner decides about Feedback to the developers for themselves (#1571, ADR 259): asked once at sign-in,
// beside the terms (also when no terms are set), changed in Settings. Yes shows Feedback and writes reports to the outbox
// of ADR 164; no, or no answer yet, shows no Feedback and writes nothing.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const SETUP_KEY = crypto.randomBytes(32).toString('base64url');
const TERMS = { FRONT_DOOR_TERMS_URL: 'https://botdot.example/terms', FRONT_DOOR_PRIVACY_URL: 'https://botdot.example/privacy', FRONT_DOOR_TERMS_VERSION: '2026-11' };
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn(); });

async function managed(env = {}) {
  const door = await startFrontDoor({ env: { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, ...env } });
  const stands = [await standIn(door, 'owner')];
  cleanups.push(async () => { await door.stop(); stands.forEach((s) => s.close()); });
  return { door, stands };
}
async function signUp(door, p, body) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, body);
  assert.equal(options.status, 200, options.text);
  const done = await b.post(p, { ...body, credential: key.register(options.data.publicKey) });
  return { b, key, done };
}
async function signIn(door, key) {
  const b = door.browser();
  const options = await b.post('/sign-in/options', {});
  return { b, r: await b.post('/sign-in', { credential: key.signIn(options.data.publicKey) }) };
}
const outbox = (door) => { const dir = path.join(door.data, 'outbox'); return fs.existsSync(dir) ? fs.readdirSync(dir) : []; };
const answerOf = (door, name) => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).accounts[name].feedback;

test('an account that has not answered shows no Feedback, is asked, and writes nothing to the outbox', async () => {
  const { door } = await managed();
  const { b, done } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  assert.equal(done.status, 201, done.text);
  const session = (await b.get('/front-door/session')).data;
  assert.deepEqual([session.feedback, session.feedbackTo, session.feedbackAsk, session.feedbackScreenshots], [false, null, true, false]);
  assert.equal((await b.post('/front-door/feedback', { kind: 'bug', text: 'Not yet' })).status, 404);
  assert.deepEqual(outbox(door), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).feedback, []);
});

test("yes shows Feedback to the developers and sends reports through the outbox, no hides it again, and the owner changes it in Settings", async () => {
  const { door } = await managed();
  const { b } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  assert.equal((await b.post('/front-door/feedback-to-developers', { on: true })).status, 200);
  let session = (await b.get('/front-door/session')).data;
  assert.deepEqual([session.feedback, session.feedbackTo, session.feedbackAsk], [true, 'developers', false]);
  const sent = await b.post('/front-door/feedback', { kind: 'bug', text: 'Goes to the console' });
  assert.equal(sent.status, 201, sent.text);
  assert.deepEqual(outbox(door), [`feedback-${sent.data.id}.json`]);
  assert.equal(answerOf(door, 'owner'), true);
  // No: the icon goes, and nothing more is written.
  assert.deepEqual((await b.post('/front-door/feedback-to-developers', { on: false })).data, { ok: true, on: false });
  session = (await b.get('/front-door/session')).data;
  assert.deepEqual([session.feedback, session.feedbackTo, session.feedbackAsk], [false, null, false], 'answered: not asked again');
  assert.equal((await b.post('/front-door/feedback', { kind: 'bug', text: 'Not any more' })).status, 404);
  assert.equal(outbox(door).length, 1);
  assert.equal(answerOf(door, 'owner'), false);
  const audit = fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.action === 'feedback-developers');
  assert.deepEqual(audit.map((e) => [e.account, e.detail]), [['owner', 'on · in Settings'], ['owner', 'off · in Settings']]);
});

test("the answer is the owner's own: no session, no header, no boolean, and an account's answer is not another's", async () => {
  const { door } = await managed();
  const { b } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  assert.equal((await door.browser().post('/front-door/feedback-to-developers', { on: true })).status, 401);
  assert.equal((await b.post('/front-door/feedback-to-developers', { on: true }, { 'X-Bot-Dot': '' })).status, 403);
  for (const on of ['yes', 1, null, undefined]) assert.equal((await b.post('/front-door/feedback-to-developers', { on })).status, 400, String(on));
  assert.equal(answerOf(door, 'owner'), undefined);
  // A second account, from the console's link, has its own answer.
  const made = await door.newLink();
  const cal = await signUp(door, made.path, { name: 'cal', feedback: false });
  assert.equal(cal.done.status, 201, cal.done.text);
  const calStand = await standIn(door, 'cal');
  cleanups.push(() => calStand.close());
  assert.equal(answerOf(door, 'cal'), false);
  assert.equal(answerOf(door, 'owner'), undefined);
  assert.equal((await cal.b.get('/front-door/session')).data.feedbackAsk, false);
  assert.equal((await b.get('/front-door/session')).data.feedbackAsk, true);
});

test('the sign-up page asks yes or no, neither chosen for the owner; a sign-up that answers keeps it, one that does not is asked at sign-in', async () => {
  const { door } = await managed();
  const page = (await door.browser().get(`/sign-up/${SETUP_KEY}`)).text;
  assert.match(page, /<legend>Send Feedback to botdot's developers\?<\/legend>/);
  assert.match(page, /<input type="radio" name="feedback" value="yes" required>/);
  assert.match(page, /<input type="radio" name="feedback" value="no" required>/);
  assert.doesNotMatch(page, /name="feedback"[^>]*checked/, 'no answer is chosen for them');
  assert.doesNotMatch(page, /id="agree"/, 'no terms set: no box for them');
  const { key, done } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner', feedback: true });
  assert.equal(done.status, 201, done.text);
  assert.equal(answerOf(door, 'owner'), true);
  const again = await signIn(door, key);
  assert.equal(again.r.status, 200, 'answered: no second question');
  assert.equal(again.r.data.agreement, undefined);
});

test('a sign-in of an account with no answer asks once, also when no terms are set, and only when it has none', async () => {
  const { door } = await managed();
  const { key } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  assert.match((await door.browser().get('/sign-in')).text, /<form id="agree-again" hidden>[\s\S]*<legend>Send Feedback to botdot's developers\?<\/legend>/);
  const first = await signIn(door, key);
  assert.equal(first.r.status, 200, first.r.text);
  assert.equal(first.r.data.ok, false);
  assert.deepEqual([first.r.data.terms, first.r.data.feedbackAsk], [null, true]);
  assert.equal((await first.b.get('/front-door/session')).status, 401, 'no session before the answer');
  assert.equal((await first.b.post('/sign-in/agree', { agreement: first.r.data.agreement })).status, 400, 'not answered');
  assert.equal((await first.b.post('/sign-in/agree', { agreement: first.r.data.agreement, feedback: 'yes' })).status, 400, 'not a boolean');
  const done = await first.b.post('/sign-in/agree', { agreement: first.r.data.agreement, feedback: false });
  assert.equal(done.status, 200, done.text);
  assert.equal((await first.b.get('/front-door/session')).data.feedbackAsk, false);
  assert.equal(answerOf(door, 'owner'), false);
  assert.equal((await first.b.post('/sign-in/agree', { agreement: first.r.data.agreement, feedback: true })).status, 401, 'used once');
  assert.equal((await signIn(door, key)).r.data.ok, true, 'answered: the next sign-in opens at once');
});

test('with terms set the sign-in page holds the agreement and the question, and a sign-in asks only for what the account has yet to give', async () => {
  const { door } = await managed(TERMS);
  const { key, done } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner', agree: true });
  assert.equal(done.status, 201, done.text);
  const page = (await door.browser().get('/sign-in')).text;
  assert.match(page, /id="agree"/);
  assert.match(page, /name="feedback"/);
  // Agreed at sign-up, not answered: only the question.
  const first = await signIn(door, key);
  assert.deepEqual([first.r.data.terms, first.r.data.feedbackAsk], [null, true]);
  assert.equal((await first.b.post('/sign-in/agree', { agreement: first.r.data.agreement, feedback: true })).status, 200);
});

test('the Settings of a managed machine say whether the owner has answered, and a self-hosted machine has no such answer', async () => {
  const { door } = await managed();
  const { b } = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner', feedback: false });
  assert.equal((await b.get('/front-door/session')).data.feedbackAsk, false, 'present on a managed machine: Settings shows the switch');
  const own = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  cleanups.push(() => own.stop());
  const first = own.browser();
  const key = passkey.create({ rpId: own.rpId, origin: own.origin });
  const options = await first.post(`${own.firstLink.path}/options`, { name: 'ann' });
  await first.post(own.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) });
  assert.equal('feedbackAsk' in (await first.get('/front-door/session')).data, false, 'a self-hosted machine does not ask');
  assert.equal((await first.post('/front-door/feedback-to-developers', { on: true })).status, 404);
  assert.doesNotMatch((await own.browser().get('/sign-in')).text, /name="feedback"/);
});

// The sign-in page's own script (lib/front-door/pages.js) against a stand-in document: the second step shows only what the
// account has yet to give, its button waits for it, and the answer goes with the agreement.
function stepPage(first) {
  const vm = require('vm');
  const sent = [];
  const listeners = {};
  const label = { hidden: false };
  const box = { checked: false, required: true, closest: () => label };
  const ask = { hidden: false, querySelectorAll: () => [radios.yes, radios.no] };
  const radios = { yes: { value: 'yes', checked: false, required: true }, no: { value: 'no', checked: false, required: true } };
  const button = { disabled: false };
  const again = {
    hidden: true, elements: { agree: box }, sync: null,
    querySelector: (sel) => (sel === '#feedback-ask' ? ask : sel === 'button' ? button : sel === 'input[name="feedback"]:checked' ? Object.values(radios).find((r) => r.checked) || null : null),
    addEventListener: (ev, fn) => { listeners['again-' + ev] = fn; },
  };
  const signInButton = { disabled: false, hidden: false, addEventListener: (ev, fn) => { listeners.signIn = fn; } };
  const els = { 'sign-in': signInButton, 'agree-again': again, said: { textContent: '' }, back: { hidden: true } };
  const went = [];
  const ctx = {
    location: { search: '', pathname: '/sign-in', hash: '', replace: (u) => went.push(u) }, URLSearchParams,
    document: { getElementById: (id) => els[id] || null },
    fetch: async (p, init) => {
      sent.push({ path: p, body: JSON.parse(init.body) });
      return { ok: true, json: async () => (p === '/sign-in/options' ? { publicKey: { challenge: 'AAAA' } } : p === '/sign-in' ? first : { ok: true, account: 'owner' }) };
    },
    navigator: { credentials: { get: async () => ({ id: 'k', rawId: new Uint8Array([1]).buffer, type: 'public-key', response: { clientDataJSON: new Uint8Array([2]).buffer } }) } },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    encodeURIComponent, Uint8Array, String, Object, Error,
  };
  vm.runInNewContext(require('../lib/front-door/pages').SCRIPT, ctx);
  const change = () => again.sync();
  return { sent, went, listeners, label, box, ask, radios, button, again, signInButton, change };
}

test('the sign-in step asks only for the answer when the terms are agreed, and its button waits for the choice', async () => {
  const p = stepPage({ ok: false, agreement: 'A'.repeat(43), terms: null, feedbackAsk: true });
  await p.listeners.signIn();
  assert.equal(p.again.hidden, false);
  assert.equal(p.signInButton.hidden, true);
  assert.equal(p.label.hidden, true, 'the terms are agreed: no box');
  assert.equal(p.box.required, false);
  assert.equal(p.ask.hidden, false);
  assert.equal(p.button.disabled, true, 'neither chosen: waits');
  p.radios.no.checked = true;
  p.change();
  assert.equal(p.button.disabled, false);
  await p.listeners['again-submit']({ preventDefault() {} });
  const agree = p.sent.find((s) => s.path === '/sign-in/agree');
  assert.deepEqual(agree.body, { agreement: 'A'.repeat(43), feedback: false }, 'the answer, and no tick of a box that was not shown');
});

test('the sign-in step asks only for the agreement when the account has answered, and for both when it owes both', async () => {
  const termsOnly = stepPage({ ok: false, agreement: 'B'.repeat(43), terms: { terms: 'https://a/t', privacy: 'https://a/p', version: '2' }, feedbackAsk: false });
  await termsOnly.listeners.signIn();
  assert.equal(termsOnly.label.hidden, false);
  assert.equal(termsOnly.box.required, true);
  assert.equal(termsOnly.ask.hidden, true, 'answered already: not asked again');
  assert.equal(termsOnly.button.disabled, true, 'the box is not ticked');
  termsOnly.box.checked = true;
  termsOnly.change();
  assert.equal(termsOnly.button.disabled, false, 'no choice needed: the question is hidden');
  await termsOnly.listeners['again-submit']({ preventDefault() {} });
  assert.deepEqual(termsOnly.sent.find((s) => s.path === '/sign-in/agree').body, { agreement: 'B'.repeat(43), agree: true });
  const both = stepPage({ ok: false, agreement: 'C'.repeat(43), terms: { terms: 'https://a/t', privacy: 'https://a/p', version: '2' }, feedbackAsk: true });
  await both.listeners.signIn();
  both.box.checked = true;
  both.change();
  assert.equal(both.button.disabled, true, 'the box alone is not enough');
  both.radios.yes.checked = true;
  both.change();
  assert.equal(both.button.disabled, false);
  await both.listeners['again-submit']({ preventDefault() {} });
  assert.deepEqual(both.sent.find((s) => s.path === '/sign-in/agree').body, { agreement: 'C'.repeat(43), agree: true, feedback: true });
});

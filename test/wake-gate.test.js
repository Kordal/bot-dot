// Whether a note from another bot or a call of a job needs a run now (ADR 083): rules first, then one short question
// to a small model whose answer is checked and never trusted; anything unsure, failed or late runs, as without the
// gate. The first tests are of lib/wake-gate.js alone; the others against a real botdot server and the stand-in for
// Claude (test/fixtures/fake-claude.js answers the gate's question with $FAKE_OUT/gate.txt).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const gate = require('../lib/wake-gate');
const router = require('../lib/group-router');
const { startServer, makeBot, heldRun, self, waitFor, sleep } = require('./helpers');
const { turnOn, call } = require('./call-helpers');

const BOT = { name: 'Infra Admin', description: 'Keeps the servers up.', prompt: 'Run the VPS.' };
const NOTE = { bot: BOT, what: { kind: 'note', from: 'QA Tester' }, text: 'Thanks, got it.' };

test('a question, an approval, a time or the owner always runs, without asking', () => {
  for (const [text, why] of [['Could you add swap?', 'question'], ['Is it up? I think not', 'question'], ['Approved, merge it.', 'approval'], ['[[choices: a | b]]', 'approval'],
    ['Due tomorrow.', 'time'], ['Send it by 5pm', 'time'], ['Down since 14:02', 'time'], ['Before Friday please', 'time'], ['urgent: disk', 'time']]) {
    assert.equal(gate.rules({ text }), why, text);
  }
  assert.equal(gate.rules({ text: 'ok', fromOwner: true }), 'owner');
  for (const text of ['Thanks, got it.', '{"status":"ok","at":"2026-10-23T14:02:11Z"}', 'See https://x.dev/a?b=1', 'Done: 14 flows pass.']) assert.equal(gate.rules({ text }), null, text);
});

test('the answer is run or later: wait and save are both later, anything else is none', () => {
  assert.equal(gate.parse('{"decision":"run"}'), 'run');
  assert.equal(gate.parse('Sure: {"decision": "wait"}'), 'later');
  assert.equal(gate.parse('{"decision":"save"}'), 'later');
  for (const bad of ['', 'save', '{"decision":"later"}', '{"decision":"skip"}', '{"decision":"constructor"}', '{"decision":1}', '{oops}']) assert.equal(gate.parse(bad), null, bad);
  const q = gate.question({ ...NOTE, waiting: ['Backup OK.'] });
  assert.ok(q.includes('The bot: Infra Admin | Keeps the servers up. | job: Run the VPS.') && q.includes('- Backup OK.') && q.includes('A note from the bot QA Tester: Thanks, got it.'));
  assert.ok(q.indexOf('<message>') < q.indexOf('The bot:') && q.lastIndexOf('</message>') > q.indexOf('Thanks, got it.'), 'the text is inside the block');
  const c = gate.question({ bot: BOT, what: { kind: 'call', job: { name: 'Uptime', prompt: 'Check the site.' } }, text: '{"status":"up"}' });
  assert.ok(c.includes('A service called its job "Uptime". The job\'s instructions: Check the site.') && c.includes('What the call carried: {"status":"up"}'));
});

test('decide never throws, and runs on a rule, an unsure, failed or late answer', async () => {
  const decide = (ask, m = NOTE, ms = 200) => gate.create({ ask, ms }).decide(m);
  assert.equal((await decide(async () => '{"decision":"save"}')).decision, 'later');
  const ran = await decide(async () => '{"decision":"run"}');
  assert.deepEqual([ran.decision, ran.by], ['run', 'haiku']);
  assert.equal((await decide(async () => 'no idea')).why, 'unsure');
  assert.equal((await decide(async () => { throw new Error('overloaded'); })).why, 'failed');
  const late = await decide(() => new Promise(() => {}), NOTE, 50);
  assert.deepEqual([late.decision, late.why], ['run', 'late'], 'an ask that never answers is cut off');
  let asked = 0;
  const ruled = await decide(async () => { asked++; return '{"decision":"save"}'; }, { ...NOTE, text: 'Can you look?' });
  assert.deepEqual([ruled.decision, ruled.by, asked], ['run', 'rule', 0]);
  let opts;
  await decide(async (p, o) => { opts = o; return '{}'; });
  assert.deepEqual([opts.llm.model, opts.system], [gate.MODEL, gate.SYSTEM]);
  assert.equal(gate.on({}), false, 'off until switched on');
  assert.equal(gate.on({ BOT_DOT_WAKE_GATE: 'on' }), true);
  router.setConfig({ router: 'haiku', wakeGate: true });
  assert.equal(gate.on({}), true, 'the admin switched it on');
  router.setConfig({ router: 'haiku' });
  assert.equal(gate.on({}), false);
});

test('with Jev chosen, Jev decides from its likelihood of "act now"; when it fails Haiku does', async () => {
  const jev = { router: 'jev', key: 'sk-or-v1-testtesttest' };
  const body = gate.jevRequest(NOTE);
  assert.deepEqual(Object.keys(body.questions), ['now']);
  assert.equal(body.state.message, 'Thanks, got it.');
  assert.deepEqual(body.provider, { data_collection: 'deny' });
  let haiku = 0;
  const ask = async () => { haiku++; return '{"decision":"run"}'; };
  const answering = (p) => async () => ({ ok: true, status: 200, json: async () => ({ answers: { now: { type: 'noul', noul: p } } }) });
  const decide = (fetch, m = NOTE) => gate.create({ ask, config: () => jev, fetch }).decide(m);
  const later = await decide(answering(0.1));
  assert.deepEqual([later.decision, later.by, haiku], ['later', 'jev', 0]);
  const now = await decide(answering(0.5));
  assert.deepEqual([now.decision, now.by], ['run', 'jev']);
  const odd = await decide(answering('x'));
  assert.deepEqual([odd.decision, odd.by, odd.why], ['run', 'fell', 'unsure']);
  const down = await decide(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.deepEqual([down.decision, down.by, haiku], ['run', 'haiku', 1], 'Haiku when Jev fails');
  const ruled = await decide(answering(0.1), { ...NOTE, text: 'Done by Friday?' });
  assert.equal(ruled.by, 'rule', 'the rules come first, Jev too');
});

let srv, sender, target;
const isRunOf = (b) => (x) => !!x.self?.env && x.args.includes(`${b.emoji} ${b.name}`);
const runsOf = async (b) => (await srv.api(`/runs?botId=${b.id}`)).data;
const answer = (text) => fs.writeFileSync(path.join(srv.out, 'gate.txt'), text);
const asks = () => fs.readdirSync(srv.out).filter((f) => /^gate-\d/.test(f));
const clearInbox = () => fs.rmSync(path.join(srv.data, 'inbox'), { recursive: true, force: true });
const inbox = async (b) => (await srv.api(`/bots/${b.id}/inbox`)).data;

before(async () => {
  srv = await startServer({ env: { BOT_DOT_WAKE_GATE: 'on' } });
  target = await makeBot(srv, { name: 'Mail Bot', emoji: '📬', mayMessage: [] });
  sender = await makeBot(srv, { name: 'Web Surfer', emoji: '🏄', mayMessage: [target.id] });
});
after(async () => { srv.unhold(); await srv.stop(); });

// A note from the sender, priority: false; the sender's run ends.
async function leaveNote(text) {
  const { rec, run, token } = await heldRun(srv, sender);
  assert.equal((await self(srv, token, 'message', { to: target.id, message: text, priority: false })).data.ok, true);
  srv.release(rec);
  await srv.finished(run.id);
}

test('a note the gate holds stays waiting, marked, wakes nothing, and "Run now" starts the bot with it', async () => {
  clearInbox();
  answer('{"decision":"save"}');
  const count = (await runsOf(target)).length;
  const before = asks().length;
  await leaveNote('Thanks, got it.');
  const held = await waitFor(async () => (await inbox(target)).find((n) => n.later), { what: 'the note to be held' });
  assert.equal(held.text, 'Thanks, got it.');
  assert.equal(asks().length, before + 1, 'the gate was asked once');
  const asked = fs.readFileSync(path.join(srv.out, asks().sort().at(-1)), 'utf8');
  assert.match(asked, /A note from the bot Web Surfer: Thanks, got it\./);
  await sleep(400);
  assert.equal((await runsOf(target)).length, count, 'nothing woke it');
  // The owner's "Run now" starts it with the held note.
  srv.hold();
  assert.deepEqual((await srv.api(`/bots/${target.id}/inbox/run`, { method: 'POST' })).data, { status: 'started' });
  const woke = await srv.nextRun(isRunOf(target), 'Mail Bot started by Run now');
  assert.match(woke.stdin, /Thanks, got it\./);
  const run = (await runsOf(target))[0];
  assert.equal(run.inbox[0].later, true, 'the run keeps that it was held');
  srv.release(woke);
  await srv.finished(run.id);
  srv.unhold();
  assert.deepEqual(await inbox(target), []);
});

test('a held note is read by the bot\'s next run, whatever starts it', async () => {
  clearInbox();
  answer('{"decision":"wait"}');
  await leaveNote('The 1.3 release moved to next month.');
  await waitFor(async () => (await inbox(target)).some((n) => n.later), { what: 'the note to be held' });
  const { rec, run } = await heldRun(srv, target, 'Write the status.');
  assert.match(rec.stdin, /The 1\.3 release moved to next month\./);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

test('a note the gate says to run, or that asks a question, wakes the bot as always', async () => {
  for (const [text, gateSays] of [['Production is down, customers see errors.', '{"decision":"run"}'], ['Can you rotate the key?', '{"decision":"save"}'], ['Odd.', 'no idea']]) {
    clearInbox();
    answer(gateSays);
    srv.hold();
    await leaveNote(text);
    const woke = await srv.nextRun((x) => isRunOf(target)(x) && x.stdin.includes(text), `Mail Bot woken by "${text}"`);
    srv.release(woke);
    await waitFor(async () => (await runsOf(target)).every((x) => x.status !== 'running'), { what: 'Mail Bot to finish' });
    srv.unhold();
  }
});

test('a call of an AI job the gate holds starts no run: its next run reads it as a call', async () => {
  clearInbox();
  const job = (await srv.api(`/bots/${target.id}/jobs`, { method: 'POST', body: { name: 'Uptime', kind: 'ai', cron: '0 4 1 1 *', prompt: 'When the site is down, find out why.' } })).data;
  const key = await turnOn(srv, target, job);
  answer('{"decision":"save"}');
  const count = (await runsOf(target)).length;
  for (let i = 0; i < 7; i++) {
    const r = await call(srv, target, job, key, { body: `{"status":"up","n":${i}}` });
    assert.deepEqual([r.status, r.data], [202, { later: true }]);
  }
  await sleep(300);
  assert.equal((await runsOf(target)).length, count, 'no run started');
  const waiting = await inbox(target);
  assert.equal(waiting.length, 5, 'a job\'s newest five held calls wait');
  assert.deepEqual([waiting[0].from, waiting[0].call, waiting[0].later, waiting.at(-1).text], ['Uptime', true, true, '{"status":"up","n":6}']);
  const { rec, run } = await heldRun(srv, target, 'Anything new?');
  assert.match(rec.stdin, /<call job="Uptime" at="[^"]+">\n[^]*"n":6/);
  assert.deepEqual((await srv.api(`/runs/${run.id}`)).data.outside.includes('call'), true, 'what a call sent is outside content');
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
  // The gate says run: the job runs as always.
  answer('{"decision":"run"}');
  srv.hold();
  const r = await call(srv, target, job, key, { body: '{"status":"down"}' });
  assert.equal(r.status, 202);
  assert.ok(r.data.runId);
  const called = await srv.nextRun(isRunOf(target), 'the called run');
  srv.release(called);
  await srv.finished(r.data.runId);
  srv.unhold();
});

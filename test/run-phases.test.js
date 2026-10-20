// Where a reply's time goes (#204): every event of a run's log has `t`, in ms since the run started, and the run's
// record has `phases`, when each phase was reached; a Chief's reply has the same `phases`. A log from before has no
// `t` and reads as it did. The stand-in Claude streams its reply while $FAKE_OUT/stream.json exists
// (test/fixtures/fake-claude.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, seedRuns, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const streams = () => fs.writeFileSync(path.join(srv.out, 'stream.json'), JSON.stringify({ chunk: 4, everyMs: 5, endMs: 20 }));
const noStream = () => fs.rmSync(path.join(srv.out, 'stream.json'), { force: true });
const ORDER = ['spawned', 'init', 'firstToken', 'result', 'closed'];

// Each phase reached once, as a whole number of ms, in the order a start goes through them.
function inOrder(phases, what, { lookupFirst = true } = {}) {
  for (const name of ['lookup', ...ORDER]) assert.ok(Number.isInteger(phases[name]) && phases[name] >= 0, `${what}: ${name} (${JSON.stringify(phases)})`);
  for (let i = 1; i < ORDER.length; i++) assert.ok(phases[ORDER[i]] >= phases[ORDER[i - 1]], `${what}: ${ORDER[i]} after ${ORDER[i - 1]} (${JSON.stringify(phases)})`);
  // A bot's lookup is done before Claude Code starts; the Chief's is awaited while it starts (ADR 017).
  if (lookupFirst) assert.ok(phases.spawned >= phases.lookup, `${what}: Claude Code starts once the lookup is done`);
}

test("a bot's run logs when each event came, and keeps when it reached each phase", async () => {
  streams(); srv.reply('Free space on local-lvm is 41%.');
  const bot = await makeBot(srv, { name: 'Timer' });
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'How full is the disk?' } })).data;
  const ended = await srv.finished(run.id);
  noStream();
  assert.equal(ended.status, 'success');
  inOrder(ended.phases, 'the run');
  const ts = ended.events.map((e) => e.t);
  assert.ok(ts.length >= 4 && ts.every((t) => Number.isInteger(t) && t >= 0), `every event has t (${JSON.stringify(ts)})`);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] >= ts[i - 1], 'in the order they came');
  const at = (type) => ended.events.find((e) => e.type === type || e.subtype === type)?.t;
  assert.ok(at('run_start') <= ended.phases.spawned, 'the start comes first');
  assert.ok(at('init') >= ended.phases.init && at('result') >= ended.phases.result, 'an event is logged once its phase is reached');
  assert.deepEqual(ended.events.at(-1).meta.phases, ended.phases, 'the end of the log has the phases too');
  // The log on disk is what was sent.
  const logged = fs.readFileSync(path.join(srv.data, 'runs', `${run.id}.ndjson`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(logged.map((e) => e.t), ts);
});

test('a log from before the times reads as it did', async () => {
  const bot = await makeBot(srv, { name: 'Old Timer' });
  const [id] = seedRuns(srv, bot, [{}]);
  const events = [{ type: 'run_start', meta: { id } }, { type: 'system', subtype: 'init', session_id: 's' }, { type: 'result', subtype: 'success', result: 'An answer.' }];
  fs.writeFileSync(path.join(srv.data, 'runs', `${id}.ndjson`), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const run = (await srv.api(`/runs/${id}`)).data;
  assert.equal(run.result, 'An answer.');
  assert.deepEqual(run.events, events, 'its events as they were written, without t');
  assert.equal(run.phases, undefined, 'and no phases');
});

test("a Chief's reply keeps when its turn reached each phase", async () => {
  streams(); srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'How are my bots?' } });
  const reply = await waitFor(async () => { const m = (await srv.api(`/chief/chats/${chat.id}`)).data.messages.at(-1); return m.role === 'chief' && !m.pending ? m : null; }, { what: 'the reply' });
  noStream();
  assert.equal(reply.error, undefined);
  inOrder(reply.phases, 'the reply', { lookupFirst: false });
});

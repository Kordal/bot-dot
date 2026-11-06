// A working run says what it waits for (#1095): Claude's busy servers, the owner's login or card, or teammates.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, feed, waitFor } = require('./helpers');
const loginRequests = require('../lib/login-requests');
const { words } = require('../lib/working-line');

test('the line reads "Waiting for Claude\'s servers" while Claude Code retries, and the next step after it', async (t) => {
  const srv = await startServer({ env: { BOT_DOT_LINE_EVERY_MS: '20' } });
  t.after(() => srv.stop());
  const bot = await makeBot(srv, { name: 'News' });
  const f = await feed(srv);
  t.after(() => f.close());
  const { run, rec } = await heldRun(srv, bot, 'What is in the news?');
  const events = [];
  const play = (ev) => { events.push(ev); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); };
  const line = () => srv.api(`/runs/${run.id}?events=0`).then((r) => r.data.workingLine);
  play({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://www.nytimes.com/' } }] } });
  await f.wait('working_line', (d) => d.runId === run.id && d.text === 'Reading nytimes.com');
  play({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 30000, error_status: 529 });
  await f.wait('working_line', (d) => d.runId === run.id && d.text === "Waiting for Claude's servers");
  assert.equal(await line(), "Waiting for Claude's servers");
  play({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'WebSearch', input: { query: 'x' } }] } });
  await waitFor(async () => (await line()) === 'Searching the web', { what: 'the step after the retry' });
  srv.release(rec);
  await srv.finished(run.id);
  assert.equal(words({ phase: 'retry' }, { lang: 'pl' }), 'Czekam na serwery Claude');
});

test('a run\'s login or card request is a wait for the owner: run_waits on and off, once per run', () => {
  const seen = [];
  const off = loginRequests.onRunWaits((r, on) => seen.push([r.runId, on]));
  try {
    const a = loginRequests.create({ botId: 'b1', runId: 'r1', site: 'shop.example', name: 'Shop', from: 'bot' });
    const c = loginRequests.create({ botId: 'b1', runId: 'r1', site: 'shop.example', name: 'Card', from: 'bot', kind: 'card' });
    assert.equal(loginRequests.waitsFor('r1'), true);
    loginRequests.create({ botId: 'b1', site: 'mail.example', name: 'Mail', from: 'chief' }); // the Chief's: no run waits
    loginRequests.settle(a.id, 'done');
    assert.equal(loginRequests.waitsFor('r1'), true, 'the card still waits');
    loginRequests.settle(c.id, 'declined');
    assert.equal(loginRequests.waitsFor('r1'), false);
    assert.deepEqual(seen, [['r1', true], ['r1', true], ['r1', false]]);
  } finally { off(); }
});

test('the Chief sees whom a bot waits for and since when; the owner\'s apps don\'t', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const asker = await makeBot(srv, { name: 'Asker', emoji: '🙋' });
  const mate = await makeBot(srv, { name: 'Mate', emoji: '🧑' });
  const a = await heldRun(srv, asker, 'Collect the report.');
  assert.equal((await self(srv, a.token, 'message', { to: mate.id, message: 'Your report?', priority: true })).data.delivered, 'started');
  const m = await srv.nextRun((x) => x.args.includes(`${mate.emoji} ${mate.name}`), 'Mate to start');
  srv.release(a.rec);
  await srv.finished(a.run.id);
  const one = (await srv.asChief(`/bots/${asker.id}`)).data;
  assert.equal(one.waitsFor.length, 1);
  assert.equal(one.waitsFor[0].bot, 'Mate');
  assert.equal(one.waitsFor[0].id, mate.id);
  assert.ok(Date.parse(one.waitsFor[0].since) <= Date.now());
  const listed = (await srv.asChief('/bots')).data.find((b) => b.id === asker.id);
  assert.deepEqual(listed.waitsFor, one.waitsFor);
  assert.equal((await srv.asChief(`/bots/${mate.id}`)).data.waitsFor, undefined, 'a bot that waits for no one has no field');
  assert.equal((await srv.api(`/bots/${asker.id}`)).data.waitsFor, undefined, 'the owner\'s apps');
  srv.release(m);
});

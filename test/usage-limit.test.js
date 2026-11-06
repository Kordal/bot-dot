// Claude's usage limit holds the work until it resets, and the run that hit it carries on then (#1090).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, feed, waitFor, sleep } = require('./helpers');
const { USAGE_LIMIT, LIMIT_GUESS_MS, limitResetOf } = require('../lib/usage-limit');

test('Claude Code\'s words for the limit, and when it resets', () => {
  const now = Date.parse('2026-11-06T10:00:00');
  for (const said of ['Claude AI usage limit reached|1794000000', "You've hit your limit · resets 3pm", '5-hour limit reached ∙ resets 3pm', 'Your limit will reset at 3pm']) assert.ok(USAGE_LIMIT.test(said), said);
  for (const said of ['API Error: 429 rate_limit_error', 'API Error: 529 overloaded', 'Done.']) assert.equal(USAGE_LIMIT.test(said), false, said);
  assert.equal(limitResetOf('', now + 5000, now), now + 5000, 'the rate_limit_event\'s reset first');
  assert.equal(limitResetOf('Claude AI usage limit reached|1794000000', 0, now), 1794000000 * 1000);
  assert.equal(new Date(limitResetOf("You've hit your limit · resets 3pm", 0, now)).getHours(), 15);
  const early = limitResetOf('resets 9am', 0, now);
  assert.ok(early > now && new Date(early).getHours() === 9, 'a time gone by today is tomorrow');
  assert.equal(new Date(limitResetOf('limit will reset at 16:30', 0, now)).getMinutes(), 30);
  assert.equal(limitResetOf('Claude AI usage limit reached', 0, now), now + LIMIT_GUESS_MS, 'no time given: a guess');
});

test('a run that hits the limit holds what follows until the reset, then the waiting message and the run carry on', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const bot = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
  const f = await feed(srv);
  t.after(() => f.close());
  const resetSec = Math.ceil(Date.now() / 1000) + 4;
  const said = path.join(srv.out, 'error-result.txt');
  fs.writeFileSync(said, `Claude AI usage limit reached|${resetSec}`);
  const first = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Write the report.' } })).data;
  const ended = await srv.finished(first.id);
  fs.rmSync(said);
  assert.equal(ended.status, 'error');
  assert.equal(ended.carriesOnAfterLimit, true);
  assert.equal(ended.problem, "Claude's usage limit was reached, so I stopped. I'll carry on by myself once it resets.");
  const told = (await f.wait('claude', (d) => !!d.backAt)).data;
  assert.equal(Date.parse(told.backAt), resetSec * 1000);
  assert.equal(told.loggedIn, true);

  // Meanwhile a message waits, also to a bot with nothing going: it would only fail.
  const before = srv.runs().length;
  const waits = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'And the summary.' } })).data;
  assert.equal(waits.status, 'queued');
  // And the owner's message to the Chief, in a chat with nothing going.
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const sent = (await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Plan my week.' } })).data;
  assert.equal(sent.queued.length, 1, 'the Chief\'s message waits');
  await sleep(500);
  assert.equal(srv.runs().length, before, 'nothing started');

  // The reset: the line goes, and what waited starts, the owner's message first.
  await waitFor(() => f.events.some((e) => e.type === 'claude' && !e.data.backAt && e.data.loggedIn === true), { what: 'the claude event of the reset', timeout: 10_000 });
  const msg = await srv.nextRun((x) => x.stdin.includes('And the summary.'), 'the waiting message');
  assert.ok(msg);
  const carry = await srv.nextRun((x) => x.stdin.includes("stopped because Claude's usage limit was reached"), 'the run that hit the limit, carrying on');
  assert.match(carry.stdin, /Write the report\./);
  assert.ok(await srv.nextRun((x) => x.stdin.includes('Plan my week.'), 'the Chief\'s turn'));
});

// One card per run (#277, ADR 056): everything one bot run waits on is one card in Needs you, with "Allow all" and
// "Decline all" beside each ask's own buttons. Each answer is the one its own card gives; a Vault secret keeps its own yes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self, waitFor, feed } = require('./helpers');
const asksLib = require('../lib/asks');

let srv; let bot;
const ALL = '/asks?override=1&vault-switch=1&vault-remove=1&vault-file=1&chief-action=1';
const cards = async () => (await srv.api(ALL)).data;
const idle = () => waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.every((r) => !['running', 'queued'].includes(r.status)), { what: 'its runs to end' });
const override = (token, action) => self(srv, token, 'ask', { kind: 'override', rule: 'Never touch the config', action, reason: 'The owner asked.' });

before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Infra Admin', emoji: '🛠', allowedTools: ['Read'] });
});
after(async () => { srv.unhold(); await srv.stop(); });

test('what one run waits on shares one card, and an ask that comes later joins it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('ask-batches'));
  const { token, rec } = await heldRun(srv, bot, 'Tidy the server');
  await self(srv, token, 'ask', { kind: 'permission', permission: 'web', reason: 'To read the docs.' });
  let list = await cards();
  assert.equal(list.length, 1);
  assert.equal(list[0].batch, undefined, 'an ask alone is drawn as before');

  await override(token, 'Edit /etc/app.conf');
  list = await cards();
  assert.equal(list.length, 2);
  const [first] = list;
  assert.ok(first.batch, JSON.stringify(first));
  assert.equal(first.batch.count, 2);
  assert.equal(first.batch.title, 'Infra Admin wants 2 things for “Tidy the server”');
  assert.ok(list.every((a) => a.batch.id === first.batch.id), 'one card');

  // The feed's entries say it too, so that a phone rings once for the card (lib/push.js).
  const events = await feed(srv);
  await override(token, 'Restart the app');
  const fed = await events.wait('asks', (d) => d.list?.length === 3);
  events.close();
  assert.ok(fed.data.list.every((a) => a.batch?.id === first.batch.id && a.batch.count === 3), JSON.stringify(fed.data));
  list = await cards();
  assert.equal(list.length, 3);
  assert.ok(list.every((a) => a.batch.id === first.batch.id && a.batch.count === 3), 'the late ask joins the card');
  assert.ok(list.every((a) => !a.batch.own), 'Allow all covers each of them');

  // An app that does not ask for every kind gets the card of what it is sent: here the permission alone.
  const older = (await srv.api('/asks')).data;
  assert.equal(older.length, 1);
  assert.equal(older[0].batch, undefined);

  // Only the owner answers it.
  assert.equal((await srv.asChief(`/asks/batch/${first.batch.id}`, { method: 'POST', body: { yes: true } })).status, 403);

  // Answered one by one, from its own buttons: the rest stays one card.
  const one = list.find((a) => a.action === 'Restart the app');
  assert.equal((await srv.api(`/asks/${one.id}`, { method: 'POST', body: { yes: false } })).status, 200);
  list = await cards();
  assert.ok(list.every((a) => a.batch?.count === 2));

  // Allow all: each yes is the one its own card gives, and the run carries on once.
  srv.release(rec);
  await idle();
  srv.unhold();
  const all = await srv.api(`/asks/batch/${first.batch.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.equal(all.data.answers.length, 2);
  assert.ok(all.data.answers.every((x) => x.ok), JSON.stringify(all.data));
  assert.deepEqual(all.data.left, []);
  assert.equal(all.data.answers.filter((x) => x.carriesOn).length, 1, 'the run carries on after the last answer, once');
  assert.deepEqual(await cards(), []);
  const now = (await srv.api(`/bots/${bot.id}`)).data;
  assert.ok(now.allowedTools.includes('WebSearch'), 'the permission is given');
  const next = await srv.nextRun((x) => x.args.includes('🛠 Infra Admin') && /The owner allowed you to/.test(x.stdin), 'the run that carries on');
  assert.match(next.stdin, /browse the web/);
  assert.match(next.stdin, /Edit \/etc\/app\.conf, once/);
  assert.match(next.stdin, /declined[\s\S]*Restart the app|Restart the app[\s\S]*declined/i);
  await idle();
  assert.equal((await srv.api(`/asks/batch/${first.batch.id}`, { method: 'POST', body: { yes: true } })).status, 404, 'answered already');
});

test('Decline all says no to each it shows, and nothing carries on', async () => {
  const { token, rec } = await heldRun(srv, bot, 'Tidy again');
  await override(token, 'Edit /etc/other.conf');
  await override(token, 'Delete /tmp/cache');
  const list = await cards();
  assert.equal(list.length, 2);
  srv.release(rec);
  await idle();
  srv.unhold();
  // An app answers what its card shows (`ids`): an ask it did not draw stays.
  const no = await srv.api(`/asks/batch/${list[0].batch.id}`, { method: 'POST', body: { yes: false, ids: [list[1].id] } });
  assert.equal(no.status, 200);
  assert.deepEqual(no.data.answers.map((x) => [x.id, x.ok, x.declined, !!x.carriesOn]), [[list[1].id, true, true, false]]);
  const rest = await cards();
  assert.deepEqual(rest.map((a) => [a.id, a.batch]), [[list[0].id, undefined]], 'one left: its own card again');
  const all = await srv.api(`/asks/batch/${list[0].batch.id}`, { method: 'POST', body: { yes: false } });
  assert.equal(all.status, 404, 'no card of several any more');
  assert.equal((await srv.api(`/asks/${list[0].id}`, { method: 'POST', body: { yes: false } })).status, 200);
  assert.deepEqual(await cards(), []);
  // A no blocks the same ask for a week, as on its own card.
  const again = await heldRun(srv, bot, 'Once more');
  assert.match(JSON.stringify((await override(again.token, 'Delete /tmp/cache')).data), /said no/i);
  srv.release(again.rec);
  await idle();
  srv.unhold();
});

test('the card of several: where it was asked, its title, and which yes Allow all leaves to its own card', () => {
  const runOf = (a) => a.runId || a.runs?.at(-1)?.id || null;
  const title = (key, list) => `${key}:${list.length}`;
  const list = [
    { id: 'a', kind: 'permission', botId: 'b1', runs: [{ id: 'r1' }] },
    { id: 'b', kind: 'vault-switch', botId: 'b1', runs: [{ id: 'r1' }] },
    { id: 'c', kind: 'connector-action', botId: 'b1', runId: 'r1', arguments: { to: 'x@y.z' } },
    { id: 'd', kind: 'connector-action', botId: 'b1', runId: 'r1', arguments: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`a${i}`, i])) },
    { id: 'e', kind: 'permission', botId: 'b2', runs: [{ id: 'r2' }] },
    { id: 'f', kind: 'chief-action', botId: null, chatId: 'c1', body: {} },
    { id: 'g', kind: 'skill', botId: null, chatId: 'c1' },
    { id: 'h', kind: 'bot-change', botId: 'b2', by: 'chief', chatId: 'c1' },
    { id: 'i', kind: 'skill', botId: null },
  ];
  const out = asksLib.batchesOf(list, { runOf, title });
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c', 'd', 'f', 'g', 'h']);
  assert.deepEqual(out.a, { id: 'run-r1', title: 'run-r1:4', count: 4 });
  assert.equal(out.b.own, true, 'a Vault secret keeps its own yes');
  assert.equal(out.c.own, undefined);
  assert.equal(out.d.own, true, 'an action too long to show in full is never allowed once');
  assert.equal(out.h.id, 'chat-c1', "the Chief's change to a bot is on the card of the Chief's chat");
  assert.equal(out.f.count, 3);

  assert.equal(asksLib.batchTitle('Scout', 3, 'Find a flat'), 'Scout wants 3 things for “Find a flat”');
  assert.equal(asksLib.batchTitle(null, 2, 'Trip'), 'The Chief wants 2 things in “Trip”');
  assert.equal(asksLib.batchTitle('Scout', 2, ''), 'Scout wants 2 things at once');
  assert.ok(asksLib.batchTitle('Scout', 2, 'x'.repeat(500)).length <= asksLib.TEXT_MAX);
});

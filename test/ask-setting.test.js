// A bot asks the owner to turn on a switched-off setting instead of saying it can't (#137): messaging a bot it
// may not message, or a computer. ask_permission makes a card of a changed bot (asks.js), whose yes changes only
// that setting, the way the bot's settings and the Chief's update_bot do; a no blocks the same ask for a week.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const asksOf = async (bot) => (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
async function ask(bot, body) {
  const h = await heldRun(srv, bot);
  const r = await self(srv, h.token, 'ask', body);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();
  return { r, rec: h.rec };
}

test('a bot that may message nobody is told who it may not message yet, and to ask instead of refusing', async () => {
  const proton = await makeBot(srv, { name: 'Proton Triage', emoji: '📬' });
  const rel = await makeBot(srv, { name: 'Relationship Agent', emoji: '💞', mayMessageAll: false, mayMessage: [] });
  const h = await heldRun(srv, rel);
  assert.equal(h.rec.self.env.SELF_TEAM, '0', 'no message_bot yet');
  assert.match(h.rec.system, /Bots you may not message yet: .*Proton Triage \(id [\w-]+\)/);
  assert.match(h.rec.system, /Switched off for you: messaging other bots.*your computer/);
  assert.match(h.rec.system, /ask_permission/);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();

  // It asks for Proton Triage: a card that names both bots, and Allow adds it to its list.
  const { r } = await ask(rel, { kind: 'permission', permission: 'message', bots: ['Proton Triage'], reason: 'To ask when you fly back' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  const [card] = await asksOf(rel);
  assert.equal(card.kind, 'bot-change');
  assert.equal(card.title, 'Let Relationship Agent message Proton Triage?');
  assert.equal(card.yes, 'Allow');
  assert.equal(card.reason, 'To ask when you fly back');
  assert.match(card.text, /Asks to message Proton Triage/);
  assert.deepEqual(card.parts, [{ label: 'May message', now: 'Proton Triage' }]);
  const yes = (await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).data;
  assert.equal(yes.ok, true, JSON.stringify(yes));
  const now = (await srv.api(`/bots/${rel.id}`)).data;
  assert.deepEqual([now.mayMessageAll, now.mayMessage], [false, [proton.id]]);
  // The run that asked carries on with message_bot and Proton Triage listed.
  const next = await srv.nextRun((x) => x.self?.env && x.args.includes('💞 Relationship Agent'), 'the run that carries on');
  assert.equal(next.self.env.SELF_TEAM, '1');
  assert.match(next.system, /Teammates you may message with message_bot:\n- 📬 Proton Triage/);
  assert.doesNotMatch(next.system, /Bots you may not message yet/);
  srv.release(next);
});

test('a computer is asked for on a card whose Allow gives it one, and that says what it means for saved logins', async () => {
  const bot = await makeBot(srv, { name: 'Builder', emoji: '🧱' });
  const { r } = await ask(bot, { kind: 'permission', permission: 'computer', reason: 'To open the site in a browser' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  const [card] = await asksOf(bot);
  assert.equal(card.title, 'Let Builder have a computer?');
  assert.equal(card.yes, 'Allow');
  assert.deepEqual(card.parts.map((p) => p.label), ['Computer']);
  assert.match(card.parts[0].now, /account's computer, which every bot there shares.*a saved login used there, they can all read/);
  await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.computer, 'linux');
});

test('a no blocks the same ask for a week; another bot may still be asked for', async () => {
  const a = await makeBot(srv, { name: 'Mail Bot', emoji: '📮' });
  const b = await makeBot(srv, { name: 'Calendar Bot', emoji: '📅' });
  const asker = await makeBot(srv, { name: 'Asker', emoji: '❓', mayMessageAll: false, mayMessage: [] });
  await ask(asker, { kind: 'permission', permission: 'message', bots: [a.id], reason: 'To ask for the flight' });
  const [card] = await asksOf(asker);
  await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } });
  assert.deepEqual((await srv.api(`/bots/${asker.id}`)).data.mayMessage, []);
  const again = await ask(asker, { kind: 'permission', permission: 'message', bots: [a.id], reason: 'Please' });
  assert.match(again.r.data.error, /said no to this recently/);
  assert.equal((await asksOf(asker)).length, 0);
  const other = await ask(asker, { kind: 'permission', permission: 'message', bots: [b.id], reason: 'To ask for the dates' });
  assert.equal(other.r.data.ok, true);
  assert.equal((await asksOf(asker))[0].title, 'Let Asker message Calendar Bot?');
  // Another bot asked for while that card waits joins it: one card, whose yes gives both.
  const c = await makeBot(srv, { name: 'Notes Bot', emoji: '🗒️' });
  await ask(asker, { kind: 'permission', permission: 'message', bots: [c.id], reason: 'To ask for the notes' });
  const joined = await asksOf(asker);
  assert.deepEqual(joined.map((x) => x.title), ['Let Asker message Calendar Bot and Notes Bot?']);
  await srv.api(`/asks/${joined[0].id}`, { method: 'POST', body: { yes: true } });
  assert.deepEqual((await srv.api(`/bots/${asker.id}`)).data.mayMessage, [b.id, c.id]);
  const carried = await srv.nextRun((x) => x.self?.env && x.args.includes('❓ Asker'), 'the runs that carry on');
  srv.release(carried);
  // A computer declined is not asked for again either.
  await ask(asker, { kind: 'permission', permission: 'computer', reason: 'To browse' });
  const comp = (await asksOf(asker)).find((x) => x.title.includes('computer'));
  await srv.api(`/asks/${comp.id}`, { method: 'POST', body: { yes: false } });
  assert.match((await ask(asker, { kind: 'permission', permission: 'computer', reason: 'Again' })).r.data.error, /said no to this recently/);
});

test('a bot that may message every bot, or an unknown one, is told so', async () => {
  const all = await makeBot(srv, { name: 'Everyone', emoji: '🌐' });
  assert.match((await ask(all, { kind: 'permission', permission: 'message', bots: ['Asker'], reason: 'x' })).r.data.error, /already message/);
  const some = await makeBot(srv, { name: 'Some', emoji: '🔒', mayMessageAll: false, mayMessage: [] });
  assert.match((await ask(some, { kind: 'permission', permission: 'message', bots: ['Nobody Here'], reason: 'x' })).r.data.error, /No bot/);
});

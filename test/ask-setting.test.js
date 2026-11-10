// Every bot may message every other bot and has a computer (ADR 192): asking for either (#137) makes no card, and
// the bot is told it has them already. Its instructions name nothing of them as switched off.
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

test('a bot made with no teammates and no computer has both, and its instructions switch neither off', async () => {
  const proton = await makeBot(srv, { name: 'Proton Triage', emoji: '📬' });
  const rel = await makeBot(srv, { name: 'Relationship Agent', emoji: '💞', mayMessageAll: false, mayMessage: [], computer: 'none' });
  assert.deepEqual([rel.mayMessageAll, rel.mayMessage, rel.computer], [true, [], 'linux']);
  const h = await heldRun(srv, rel);
  assert.equal(h.rec.self.env.SELF_TEAM, '1');
  assert.match(h.rec.system, /Teammates you may message with message_bot:\n- 📬 Proton Triage/);
  assert.doesNotMatch(h.rec.system, /Bots you may not message yet/);
  assert.doesNotMatch(h.rec.system, /Switched off for you:[^\n]*(messaging|your computer|web access|changing files)/);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();
  assert.equal(proton.computer, 'linux');
});

test('asking for messaging or a computer is answered at once, with no card', async () => {
  const bot = await makeBot(srv, { name: 'Builder', emoji: '🧱' });
  assert.match((await ask(bot, { kind: 'permission', permission: 'message', bots: ['Proton Triage'], reason: 'To ask' })).r.data.error, /already message every bot/);
  assert.match((await ask(bot, { kind: 'permission', permission: 'computer', reason: 'To open the site in a browser' })).r.data.error, /already have a computer/);
  assert.match((await ask(bot, { kind: 'permission', permission: 'web', reason: 'To read the page' })).r.data.error, /already have/);
  assert.match((await ask(bot, { kind: 'permission', permission: 'files', reason: 'To write it down' })).r.data.error, /already have/);
  assert.deepEqual(await asksOf(bot), []);
});

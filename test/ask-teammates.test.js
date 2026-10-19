// Bots ask a teammate before giving up (#136): each teammate's line says what it reaches (its connected apps, the
// names of the saved logins shared with it, a computer, the web), written by botdot and never a secret; the prompt
// says to ask a teammate who could know before telling the owner something isn't there; the asked bot answers
// only what was asked; and "Other bots may ask it" off keeps a bot out of the others' lists and refuses message_bot.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self, fakeConnectedApp } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv, app;
before(async () => {
  app = await fakeConnectedApp(); // a connected app counts only once Composio is connected
  srv = await startServer({ env: app.env });
  await app.connect(srv);
});
after(async () => { await srv.stop(); app.close(); });

async function held(bot, fn) {
  const h = await heldRun(srv, bot);
  try { return await fn(h); } finally { srv.release(h.rec); await srv.finished(h.run.id); srv.unhold(); }
}

test("a teammate's line says what it reaches, with login names and never a secret value", async () => {
  const mail = await makeBot(srv, { name: 'Proton Triage', emoji: '📬', description: 'sorts my mail', connectors: ['gmail'], allowedTools: ['Read', 'WebSearch', 'WebFetch'] });
  const r = await srv.api('/vault', { method: 'POST', body: { name: 'Proton Mail', site: 'mail.proton.me', username: 'bart', password: 'hunter2-secret', allowedBots: [mail.id] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await srv.api('/vault', { method: 'POST', body: { name: 'Bank', site: 'bank.example.com', username: 'b', password: 'bank-secret', allowedBots: [] } });
  const plain = await makeBot(srv, { name: 'Plain Helper', emoji: '🙂', allowedTools: ['Read'] });
  const cal = await makeBot(srv, { name: 'Calendar Keeper', emoji: '📅' });
  await held(cal, async (h) => {
    const line = h.rec.system.split('\n').find((l) => l.includes('Proton Triage (id'));
    assert.equal(line, `- 📬 Proton Triage (id ${mail.id}): sorts my mail. Reaches: Gmail, Proton Mail (login), web.`);
    assert.equal(h.rec.system.split('\n').find((l) => l.includes('Plain Helper (id')), `- 🙂 Plain Helper (id ${plain.id})`, 'nothing to reach: no Reaches');
    assert.doesNotMatch(h.rec.system, /hunter2-secret|bank-secret|Bank \(login\)/);
    // The rule for an empty result, with its example.
    assert.match(h.rec.system, /Before telling the owner something isn't there or isn't known, ask \(priority: true\) a teammate whose description or reach covers where it might be/);
    assert.match(h.rec.system, /no return flight in the calendar/);
    // list_teammates says the same.
    const mates = (await self(srv, h.token, 'teammates')).data.teammates;
    assert.deepEqual(mates.find((b) => b.id === mail.id).reaches, ['Gmail', 'Proton Mail (login)', 'web']);
  });
  for (const b of [mail, plain, cal]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test('the asked bot is told to answer only what was asked, never a secret, and to say plainly when nothing is found', async () => {
  const mail = await makeBot(srv, { name: 'Mail Keeper', emoji: '📮' });
  const cal = await makeBot(srv, { name: 'Trip Planner', emoji: '🧳' });
  await held(cal, async (h) => {
    srv.hold();
    assert.equal((await self(srv, h.token, 'message', { to: mail.id, message: 'Is there a return flight booked for Lisbon?', priority: true })).data.ok, true);
    const asked = await srv.nextRun((x) => x.args.includes('📮 Mail Keeper'), 'Mail Keeper to start');
    assert.match(asked.system, /Share only what answers it \(for a flight, its date, time and number, not the whole email\), never a secret value, and say plainly when you found nothing\./);
    srv.release(asked);
  });
  for (const b of [mail, cal]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test('"Other bots may ask it" off: the bot is left out of the lists and message_bot to it is refused with the reason', async () => {
  const diary = await makeBot(srv, { name: 'Diary', emoji: '📓' });
  assert.equal(diary.othersMayAsk, true, 'on by default');
  const off = (await srv.api(`/bots/${diary.id}`, { method: 'PUT', body: { othersMayAsk: false } })).data;
  assert.equal(off.othersMayAsk, false);
  const asker = await makeBot(srv, { name: 'Nosy', emoji: '👀', mayMessageAll: false, mayMessage: [diary.id] });
  const open = await makeBot(srv, { name: 'Open', emoji: '🚪' });
  await held(open, async (h) => {
    assert.doesNotMatch(h.rec.system, /Diary \(id/);
    assert.ok(!(await self(srv, h.token, 'teammates')).data.teammates.some((b) => b.id === diary.id));
    assert.match((await self(srv, h.token, 'message', { to: diary.id, message: 'What did Bart write?', priority: true })).data.error, /Diary is kept to the owner: other bots may not ask it \(its setting "Other bots may ask it" is off\)\./);
  });
  // A list that names it changes nothing, and it is not offered for ask_permission either.
  await held(asker, async (h) => {
    assert.equal(h.rec.self.env.SELF_TEAM, '0');
    assert.doesNotMatch(h.rec.system, /Diary/);
    assert.match((await self(srv, h.token, 'message', { to: diary.id, message: 'hi', priority: false })).data.error, /kept to the owner/);
    assert.match((await self(srv, h.token, 'ask', { kind: 'permission', permission: 'message', bots: [diary.id], reason: 'To read it' })).data.error, /kept to the owner/);
  });
  // It may still message others itself, and be answered.
  await held(diary, async (h) => {
    assert.match(h.rec.system, /Nosy \(id/);
    assert.equal(h.rec.self.env.SELF_TEAM, '1');
  });
  // Back on, it is a teammate again.
  await srv.api(`/bots/${diary.id}`, { method: 'PUT', body: { othersMayAsk: true } });
  await held(open, async (h) => assert.match(h.rec.system, /Diary \(id/));
  for (const b of [diary, asker, open]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test("the Chief's update_bot turns the switch, and list_bots shows it", async (t) => {
  const call = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey }).json;
  const bot = await makeBot(srv, { name: 'Health Log', emoji: '🩺' });
  const off = await call('update_bot', { id: bot.id, othersMayAsk: false });
  assert.equal(off.othersMayAsk, false);
  assert.ok(!('waiting' in off), 'keeping a bot to the owner waits for nothing');
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.othersMayAsk, false);
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

// Bots ask a teammate before giving up (#136): each teammate's line says what it reaches (its connected apps, the
// names of the saved logins shared with it, a computer, the web), written by botdot and never a secret; the prompt
// says to ask a teammate who could know before telling the owner something isn't there; and the asked bot answers
// only what was asked. Every bot may ask every other (ADR 186): no setting keeps one out.
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
    assert.equal(line, `- 📬 Proton Triage (id ${mail.id}): sorts my mail. Reaches: Gmail, Proton Mail (login).`, 'a computer and the web are every bot\'s: not named');
    assert.equal(h.rec.system.split('\n').find((l) => l.includes('Plain Helper (id')), `- 🙂 Plain Helper (id ${plain.id})`, 'nothing to reach: no Reaches');
    assert.doesNotMatch(h.rec.system, /hunter2-secret|bank-secret|Bank \(login\)/);
    // The rule for an empty result, with its example.
    assert.match(h.rec.system, /Before telling the owner something isn't there or isn't known, ask \(priority: true\) a teammate whose description or reach covers where it might be/);
    assert.match(h.rec.system, /no return flight in the calendar/);
    // list_teammates says the same.
    const mates = (await self(srv, h.token, 'teammates')).data.teammates;
    assert.deepEqual(mates.find((b) => b.id === mail.id).reaches, ['Gmail', 'Proton Mail (login)']);
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

test('"Other bots may ask it" sent off changes nothing: the bot stays a teammate and is messaged', async (t) => {
  const diary = await makeBot(srv, { name: 'Diary', emoji: '📓' });
  const off = (await srv.api(`/bots/${diary.id}`, { method: 'PUT', body: { othersMayAsk: false } })).data;
  assert.equal(off.othersMayAsk, true, 'an app from before may still send it');
  const call = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey }).json;
  await assert.rejects(call('update_bot', { id: diary.id, othersMayAsk: false }), /unknown field[^"]*"othersMayAsk/, 'the Chief has no such field');
  const open = await makeBot(srv, { name: 'Open', emoji: '🚪' });
  await held(open, async (h) => {
    assert.match(h.rec.system, /Diary \(id/);
    assert.ok((await self(srv, h.token, 'teammates')).data.teammates.some((b) => b.id === diary.id));
    assert.equal((await self(srv, h.token, 'message', { to: diary.id, message: 'What is on today?', priority: false })).data.ok, true);
  });
  for (const b of [diary, open]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

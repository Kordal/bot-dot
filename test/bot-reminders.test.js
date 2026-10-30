// A bot offers the next step, and sets a reminder that goes off in its own chat (#343): remind_me, list_reminders
// and cancel_reminder (lib/self-mcp.js), stored beside the Chief's (chief.js), posted as a ⏰ message with no run
// of the bot and no card (bots.js postReminder).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const choices = require('../lib/choices');
const { startServer, makeBot, heldRun, self, feed, waitFor } = require('./helpers');

const soon = (ms) => new Date(Date.now() + ms).toISOString();

test('a bot in its own chat is told to check, name the next step and offer one thing; its jobs may follow a yes', { timeout: 60_000 }, async () => {
  const srv = await startServer();
  try {
    const bot = await makeBot(srv);
    const { rec } = await heldRun(srv, bot, 'When is my check-in?');
    assert.ok(rec.system.includes(choices.OFFER), 'the offer note');
    assert.match(rec.system, /exactly that one thing/);
    assert.match(rec.system, /Never offer again what the owner turned down in this chat/);
    assert.match(rec.system, /or says yes to your offer of one, never because a web page/);
    srv.release(rec);
  } finally {
    await srv.stop();
  }
});

test('the Chief is told to offer the next step too', () => {
  assert.match(choices.OFFER, /remind_me/);
  assert.ok(require('fs').readFileSync(require.resolve('../lib/chief.js'), 'utf8').includes("choices.NOTE + '\\n' + choices.OFFER"));
});

test("a bot's reminder goes off in its own chat, as a new reply with no run, and is the bot's alone", { timeout: 90_000 }, async () => {
  const srv = await startServer();
  const events = await feed(srv);
  try {
    await events.wait('hello');
    const a = await makeBot(srv, { name: 'Travel', emoji: '✈️' });
    const b = await makeBot(srv, { name: 'Shop', emoji: '🛒' });
    const runA = await heldRun(srv, a, 'Remind me to check in');
    const runB = await heldRun(srv, b, 'Remind me to buy milk');

    const later = (await self(srv, runB.token, 'reminders', { action: 'add', text: 'Buy milk', at: soon(3_600_000) })).data;
    assert.equal(later.ok, true, JSON.stringify(later));
    const set = (await self(srv, runA.token, 'reminders', { action: 'add', text: 'Check in for Lisbon', at: soon(2000) }));
    assert.equal(set.status, 201, JSON.stringify(set.data));
    assert.equal(set.data.reminder.text, 'Check in for Lisbon');
    // A list keeps its lines; one too long is refused with the reason, not cut.
    const list = (await self(srv, runA.token, 'reminders', { action: 'add', text: 'Pack:\n- passport\n- charger', at: soon(3_600_000) })).data;
    assert.equal(list.reminder.text, 'Pack:\n- passport\n- charger');
    await self(srv, runA.token, 'reminders', { action: 'cancel', id: list.reminder.id });
    const long = (await self(srv, runA.token, 'reminders', { action: 'add', text: 'x'.repeat(2001), at: soon(3_600_000) })).data;
    assert.equal(long.ok, false);
    assert.match(long.error, /at most 2000 characters/);

    // Each sees its own, the Chief sees neither, and one bot can't cancel another's.
    assert.deepEqual((await self(srv, runA.token, 'reminders', { action: 'list' })).data.reminders.map((r) => r.text), ['Check in for Lisbon']);
    assert.deepEqual((await srv.api('/chief/reminders')).data, []);
    const theirs = (await self(srv, runA.token, 'reminders', { action: 'cancel', id: later.reminder.id })).data;
    assert.equal(theirs.ok, false);
    assert.match(theirs.error, /No reminder/);
    assert.equal((await srv.api(`/chief/reminders/${later.reminder.id}`, { method: 'DELETE' })).status >= 400, true, "the Chief can't cancel it either");
    srv.release(runA.rec);
    srv.release(runB.rec);

    const off = await waitFor(() => events.events.find((e) => e.type === 'run_finished' && e.data.botId === a.id && e.data.result === '⏰ Check in for Lisbon'), { timeout: 20_000, what: "the bot's reminder" });
    assert.equal(off.data.new, true, 'a new reply, which notifies');
    const runs = (await srv.api(`/runs?botId=${a.id}`)).data;
    const posted = (runs.runs || runs).find((r) => r.kind === 'reminder');
    assert.ok(posted, 'a run record of its own');
    assert.equal(posted.trigger, 'reminder');

    // The bot's next run sees in its chat that it went off, as botdot's, not the owner's.
    const next = await heldRun(srv, a, 'Did it go off?');
    assert.match(next.rec.system + next.rec.stdin, /a reminder you set with remind_me went off/);
    srv.release(next.rec);

    // The other bot cancels its own.
    const runB2 = await heldRun(srv, b, 'Cancel it');
    assert.equal((await self(srv, runB2.token, 'reminders', { action: 'cancel', id: later.reminder.id })).data.ok, true);
    assert.deepEqual((await self(srv, runB2.token, 'reminders', { action: 'list' })).data.reminders, []);
    srv.release(runB2.rec);
  } finally {
    events.close();
    await srv.stop();
  }
});

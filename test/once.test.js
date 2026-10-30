// Things that happen once (lib/jobs.js "at", chief.js reminders): a one-time job for a bot, and a reminder
// the Chief sets for the owner, which goes off in its chat.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, feed, waitFor } = require('./helpers');

let srv, bot;
before(async () => { srv = await startServer(); bot = await makeBot(srv, { name: 'Coder', emoji: '💻' }); });
after(() => srv.stop());

// The test server runs on UTC, so its local time is UTC.
const local = (d) => d.toISOString().slice(0, 16);
const later = new Date(Date.now() + 3 * 864e5);
later.setUTCHours(7, 30, 0, 0);

test('a one-time job keeps its date, and a new schedule makes it a repeating one', async () => {
  const add = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Check the PRs', kind: 'ai', at: local(later), assessment: 'Needs AI' } });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  const job = add.data;
  assert.equal(job.cron, `30 7 ${later.getUTCDate()} ${later.getUTCMonth() + 1} *`);
  assert.equal(job.at, later.toISOString());
  assert.equal(job.nextRunAt, later.toISOString());
  assert.equal(job.approved, true, "the Chief's AI jobs need no OK");
  // Other changes keep the date (the web editor sends the cron as it is).
  const renamed = (await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { name: 'PRs', cron: job.cron } })).data;
  assert.equal(renamed.at, job.at);
  // Another time makes it repeat.
  const daily = (await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { cron: '0 9 * * *' } })).data;
  assert.equal(daily.at, null);
  assert.equal(daily.cron, '0 9 * * *');
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'DELETE' });
});

test('a date in the past is refused', async () => {
  const r = await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Too late', kind: 'ai', at: '2020-01-01T07:00', assessment: 'x' } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /already passed/);
});

test('a reminder goes off in the chat it was set in, as a ⏰ message the Chief then reads', async () => {
  const events = await feed(srv);
  await events.wait('hello'); // listening before it goes off
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const r = await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Renew the GitHub token', at: local(new Date()), chatId: chat.id } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const bell = await events.wait('chief_reply', (d) => d.chatId === chat.id);
  assert.equal(bell.data.text, '⏰ Renew the GitHub token');
  const last = (await srv.api(`/chief/chats/${chat.id}`)).data.messages.at(-1);
  assert.equal(last.role, 'chief');
  assert.equal(last.text, '⏰ Renew the GitHub token');
  assert.deepEqual((await srv.api('/chief/reminders')).data, [], 'gone once it went off');
  // The Chief learns it went off with the owner's next message.
  srv.reply('OK.');
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'done' } });
  const chief = await srv.nextRun((x) => x.args.includes('🧭 Chief of Staff'), 'the Chief');
  assert.match(chief.stdin, /reminder you set for me went off in our chat: "Renew the GitHub token"/);
  assert.match(chief.system, /Now: \w+day \d{4}-\d\d-\d\dT\d\d:\d\d local time/);
  events.close();
});

test('reminders can be listed and cancelled', async () => {
  const r = (await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Call mum', at: local(later) } })).data;
  assert.deepEqual((await srv.api('/chief/reminders')).data.map((x) => x.text), ['Call mum']);
  assert.equal((await srv.api(`/chief/reminders/${r.id}`, { method: 'DELETE' })).data.ok, true);
  assert.deepEqual((await srv.api('/chief/reminders')).data, []);
});

test('a long list keeps every line, and a reminder too long is refused, never cut', async () => {
  // The witness's list from the owner's report: it was cut at 300 characters and its lines were joined.
  const items = ['Rings', 'Speech', 'Phone numbers of the drivers', 'Plan for the way back', ...Array.from({ length: 30 }, (_, i) => `Item ${i + 1}  of   the list`)];
  const text = `Witness:\n\n\n${items.map((t) => `- ${t}`).join('\n')}`;
  const r = await srv.api('/chief/reminders', { method: 'POST', body: { text, at: local(later) } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.text.length > 300);
  assert.equal(r.data.text, `Witness:\n\n${items.map((t) => `- ${t.replace(/\s+/g, ' ')}`).join('\n')}`);
  assert.equal((await srv.api('/chief/reminders')).data[0].text, r.data.text, 'kept as set');
  await srv.api(`/chief/reminders/${r.data.id}`, { method: 'DELETE' });

  const long = await srv.api('/chief/reminders', { method: 'POST', body: { text: 'x'.repeat(2001), at: local(later) } });
  assert.equal(long.status, 400);
  assert.match(long.data.error, /^Not set: a reminder holds at most 2000 characters, and this one has 2001\. Shorten it or split it/);
  assert.deepEqual((await srv.api('/chief/reminders')).data, []);
});

// The scheduler's question each minute (bots.js tick), asked here with a given time: no test waits for that minute.
test('a one-time job is due in its own minute of its own year, and in no other', () => {
  const { normalizeJob, dueAt } = require('../lib/jobs');
  const when = new Date(Date.now() + 3 * 864e5);
  when.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const job = normalizeJob({ name: 'Once', at: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}` });
  assert.equal(job.at, when.toISOString());
  const shifted = (ms) => new Date(when.getTime() + ms);
  assert.equal(dueAt(job, when), true);
  assert.equal(dueAt(job, shifted(59_000)), true, 'any second of that minute');
  for (const ms of [-60_000, 60_000, 3600e3, 864e5]) assert.equal(dueAt(job, shifted(ms)), false, `${ms} ms away`);
  const nextYear = new Date(when);
  nextYear.setFullYear(when.getFullYear() + 1);
  assert.equal(dueAt(job, nextYear), false, 'its cron comes round every year; the job does not');
  // Moved by the owner, it is due at its new time only.
  const later = shifted(2 * 864e5 + 3600e3);
  const moved = normalizeJob({ at: later.toISOString() }, job);
  assert.deepEqual([dueAt(moved, when), dueAt(moved, later)], [false, true]);
  // A repeating job has no year to it.
  const daily = normalizeJob({ name: 'Daily', cron: `${when.getMinutes()} ${when.getHours()} * * *` });
  assert.deepEqual([dueAt(daily, when), dueAt(daily, nextYear), dueAt(daily, shifted(60_000))], [true, true, false]);
});

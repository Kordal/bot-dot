// Mail and calendar as signals (ADR 175, P7): the server reads the owner's new mail and next meetings from their
// connected apps, without a model, at most every few minutes and never in quiet hours, and hands them to attention.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const appSignals = require('../lib/app-signals');
const attention = require('../lib/attention');

const NOW = new Date('2026-10-14T09:00:00Z');
const answers = {
  GMAIL_FETCH_EMAILS: { messages: [{ messageId: '18f1a', sender: 'Anna Kowalska <anna@example.com>', subject: 'The quote, signed' }, { messageId: 'bad id!', sender: 'x', subject: 'y' }] },
  GOOGLECALENDAR_EVENTS_LIST: { response_data: { items: [
    { id: 'ev1', summary: 'Call with the printer', start: { dateTime: new Date(NOW.getTime() + 40 * 60000).toISOString() } },
    { id: 'ev2', summary: 'Review', start: { dateTime: new Date(NOW.getTime() + 100 * 60000).toISOString() } },
    { id: 'ev3', summary: 'All day', start: { date: '2026-10-14' } },
    { id: 'ev4', summary: 'Gone', status: 'cancelled', start: { dateTime: new Date(NOW.getTime() + 30 * 60000).toISOString() } },
  ] } },
};
const make = (over = {}) => {
  const calls = [];
  const s = appSignals.create({ connected: () => ['gmail', 'googlecalendar'], execute: async (app, tool, args) => { calls.push({ app, tool, args }); return answers[tool]; }, log: () => {}, ...over });
  return { s, calls };
};

test('new mail and the next meetings become signals: a meeting within the hour needs the owner now', async () => {
  const { s, calls } = make();
  await s.read(NOW);
  assert.deepEqual(calls.map((c) => c.tool), ['GMAIL_FETCH_EMAILS', 'GOOGLECALENDAR_EVENTS_LIST'], 'two read actions, nothing else');
  assert.equal(calls[0].args.query, appSignals.MAIL_QUERY);
  const found = s.signals(NOW);
  assert.deepEqual(found.map((f) => [f.kind, f.weight]), [['calendar', 3], ['calendar', 2], ['mail', 2]]);
  assert.match(found[0].text, /^Calendar: "Call with the printer" starts at \d\d:\d\d, in 40 min$/);
  assert.equal(found[2].text, 'New mail from Anna Kowalska: "The quote, signed"');
  // On the agenda a mail is put to Jev as any weight-2 item is; a meeting within the hour starts a look.
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'botdot-agenda-'));
  const a = attention.create({ dataDir: dir, config: () => ({ router: 'haiku' }) });
  a.refresh(found, NOW);
  assert.equal((await a.wake({ now: NOW })).kind, 'calendar');
  require('fs').rmSync(dir, { recursive: true, force: true });
});

test('read at most every few minutes, not in quiet hours, and only the apps that are connected; a failure keeps what was read', async () => {
  let fail = false;
  let apps = ['gmail'];
  let night = false;
  const { s, calls } = make({ connected: () => apps, quiet: () => night, execute: async (app, tool) => { calls.push({ tool }); if (fail) throw new Error('signed out'); return answers[tool]; } });
  await s.read(NOW);
  await s.read(new Date(NOW.getTime() + 60_000));
  assert.equal(calls.length, 1, 'once in five minutes, and no calendar that is not connected');
  fail = true;
  await s.read(new Date(NOW.getTime() + appSignals.EVERY_MS));
  assert.equal(s.signals(NOW).length, 1, 'the mail read before is kept');
  night = true;
  await s.read(new Date(NOW.getTime() + 2 * appSignals.EVERY_MS));
  assert.equal(calls.length, 2, 'nothing read in quiet hours');
  night = false; apps = [];
  await s.read(new Date(NOW.getTime() + 3 * appSignals.EVERY_MS));
  assert.deepEqual(s.signals(NOW), [], 'an app no longer connected says nothing');
});

test('a sender is named as people know them', () => {
  assert.equal(appSignals.senderOf('"Kowalska, Anna" <anna@example.com>'), 'Kowalska, Anna');
  assert.equal(appSignals.senderOf('anna@example.com'), 'anna@example.com');
});

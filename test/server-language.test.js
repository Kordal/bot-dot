// The server's own words in the account's language (#649, ADR 108): a card in Needs you, an error, a notification,
// the checkup's `when` and the model pickers are Polish once the owner chose Polski. What the Chief and the bots read
// stays English, and so does what a bot or the Chief wrote.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot } = require('./helpers');
const asksLib = require('../lib/asks');
const push = require('../lib/push');
const checkup = require('../lib/checkup');
const learning = require('../lib/learning');

test('a card is drawn in the language asked for, and keeps what the bot wrote as it was', () => {
  const override = { kind: 'override', botId: 'b1', rule: 'Never email anyone', action: 'Email the landlord', reason: '' };
  const en = asksLib.proposalView(override, 'Scout');
  assert.equal(en.title, 'Let Scout do this, though its rules say no?');
  assert.equal(en.yes, 'Allow once');
  const pl = asksLib.proposalView(override, 'Scout', { lang: 'pl' });
  assert.equal(pl.title, 'Czy Scout może to zrobić, choć jego zasady mówią nie?');
  assert.deepEqual([pl.yes, pl.always], ['Zezwól raz', 'Zezwalaj zawsze temu botowi']);
  assert.deepEqual(pl.parts.map((p) => p.now), ['Never email anyone', 'Email the landlord'], "the bot's own words stay");
  assert.match(pl.warning, /^Tylko ty możesz znieść zasadę\. Przy „Zezwalaj zawsze temu botowi” Scout/);

  const change = { kind: 'bot-change', botId: 'b1', by: 'bot', changes: { allowedTools: ['Read', 'WebSearch', 'WebFetch'] }, before: { allowedTools: ['Read'] } };
  assert.equal(asksLib.proposalView(change, 'Scout').title, 'Let Scout browse the web?');
  assert.equal(asksLib.proposalView(change, 'Scout', { lang: 'pl' }).title, 'Czy Scout może przeglądać internet?');
  assert.equal(asksLib.askText(change, { lang: 'pl' }), 'Chce zmienić co może robić');
  assert.equal(asksLib.askText({ kind: 'permission', permission: 'web' }, { lang: 'pl' }), 'Prosi, by móc przeglądać internet');
  assert.equal(asksLib.batchTitle('Scout', 3, 'Reply to the landlord', 'pl'), 'Scout chce rzeczy (3) do „Reply to the landlord”');
  assert.equal(asksLib.listed(['A', 'B', 'C'], 'pl'), 'A, B i C');
  assert.equal(asksLib.listed(['A', 'B', 'C']), 'A, B and C');
  // What a bot reads of the owner's yes stays English whatever the account's language.
  assert.deepEqual(asksLib.grantWords({ ...change, by: 'chief' }), ['browse the web']);
});

test('the checkup, a memory card and a notification say their words in Polish', () => {
  assert.equal(checkup.when({ days: [1, 2, 3, 4, 5], time: '08:00' }), 'Weekdays at 08:00');
  assert.equal(checkup.when({ days: [1, 2, 3, 4, 5], time: '08:00' }, 'pl'), 'W dni robocze o 08:00');
  assert.equal(checkup.when({ days: [1, 4], time: '07:30' }, 'pl'), 'Poniedziałki i Czwartki o 07:30');
  assert.deepEqual(learning.cardOf({ action: 'add' }, 'pl'), { title: 'Dodaj do wspólnej pamięci', meta: 'z przeglądu jego pamięci', yes: 'Zatwierdź', no: 'Odrzuć' });

  const f = push.follower({ rung: new Set(), language: () => 'pl' });
  const [signedOut] = f.take({ type: 'claude', data: { loggedIn: false } }).notices;
  assert.equal(signedOut.body, 'Claude jest wylogowany: boty nie mogą pracować.');
  const [failed] = f.take({ type: 'run_finished', data: { new: true, botId: 'b1', botName: 'Scout', status: 'error', error: 'timeout' } }).notices;
  assert.equal(failed.body, 'Nie skończył: timeout');
  const [done] = f.take({ type: 'run_finished', data: { new: true, botId: 'b1', botName: 'Scout', status: 'success', result: 'All good' } }).notices;
  assert.equal(done.body, 'All good', "a bot's reply is never translated");
});

test('with Polski chosen, the owner gets Polish cards and errors; the Chief gets English', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const bot = await makeBot(s, { name: 'Scout', allowedTools: ['Read'] });
  fs.writeFileSync(path.join(s.data, 'asks.json'), JSON.stringify([{ id: 'p1', kind: 'permission', botId: bot.id, permission: 'web', reason: 'To read the news', at: new Date().toISOString() }]));
  assert.equal((await s.api('/asks')).data[0].text, 'Asks to browse the web', 'English to start with');
  assert.equal((await s.api('/bots/nope')).data.error, 'Bot not found');

  assert.equal((await s.api('/settings', { method: 'PUT', body: { language: 'pl' } })).status, 200);
  const [card] = (await s.api('/asks')).data;
  assert.equal(card.text, 'Prosi, by móc przeglądać internet');
  assert.equal(card.what.label, 'przeglądać internet');
  assert.equal(card.reason, 'To read the news', "the bot's reason stays as it wrote it");
  assert.equal((await s.api('/bots/nope')).data.error, 'Nie znaleziono bota');
  const settings = (await s.api('/settings')).data;
  assert.equal(settings.efforts.find((e) => e.id === 'high')?.label, 'Wysoki');
  assert.equal((await s.api('/settings/checkup')).data.checkup.when, 'W dni robocze o 08:00');

  assert.equal((await s.asChief('/bots/nope')).data.error, 'Bot not found');
  assert.equal((await s.asChief('/settings/checkup')).data.checkup.when, 'Weekdays at 08:00');
});

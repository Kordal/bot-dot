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

test("a job the Chief asks to add reads as words on its card: when it runs and what kind it is, never the cron expression", () => {
  const ask = { kind: 'chief-action', botId: null, chatId: 'c1', method: 'POST', path: 'bots/b1/jobs', title: 'Add the job “Parts” to Hunter',
    body: { name: 'New Honda parts', kind: 'ai', cron: '0 8 * * *', assessment: 'Reading listings needs AI.' } };
  const rows = (lang) => asksLib.proposalView(ask, 'Hunter', { lang }).rows.map((r) => [r.label, r.value]);
  assert.deepEqual(rows('en'), [['Name', 'New Honda parts'], ['Kind', 'A run of the bot, with AI'], ['When', 'Daily at 08:00'], ['Why this kind', 'Reading listings needs AI.']]);
  assert.deepEqual(rows('pl'), [['Nazwa', 'New Honda parts'], ['Rodzaj', 'Uruchomienie bota, z AI'], ['Kiedy', 'Codziennie o 08:00'], ['Dlaczego ten rodzaj', 'Reading listings needs AI.']]);
  // A script job, a one-time job of the Chief's own, and a change: the same words.
  const script = { ...ask, path: 'bots/b1/jobs/j1', method: 'PUT', body: { kind: 'script', cron: '*/15 8-18 * * 1-5', aiWhen: 'output' } };
  assert.deepEqual(asksLib.proposalView(script, 'Hunter', { lang: 'pl' }).rows.map((r) => r.value), ['Skrypt, bez AI', 'Co 15 min, od 08:00 do 18:45, od poniedziałku do piątku', 'Tylko gdy coś wypisze']);
  const once = { ...ask, path: 'chief/jobs', body: { name: 'Check', task: 'Look it up', at: '2026-11-02T09:30' } };
  assert.deepEqual(asksLib.proposalView(once, 'Hunter').rows.map((r) => [r.label, r.value]), [['Name', 'Check'], ['Task', 'Look it up'], ['When', '2 Nov at 09:30']]);
  // What is no job's keeps the fields as they were sent, and the yes still sends exactly the body.
  const other = { ...ask, path: 'bots', body: { name: 'Leaker', cron: '0 8 * * *' } };
  assert.deepEqual(asksLib.proposalView(other, 'Hunter').rows.map((r) => [r.label, r.value]), [['Name', 'Leaker'], ['Cron', '0 8 * * *']]);
  assert.equal(JSON.parse(asksLib.proposalView(ask, 'Hunter').details).cron, '0 8 * * *');
});

test("a job's schedule in Polish words, as an app in Polish shows `when`; the Chief and the bots keep English", () => {
  const { describe } = require('../lib/cron-words');
  const jobs = require('../lib/jobs');
  for (const [expr, words] of [
    ['0 8 * * *', 'Codziennie o 08:00'], ['0 9 * * 1-5', 'W dni robocze o 09:00'], ['0 9 * * 2,4', 'We wtorki i czwartki o 09:00'],
    ['0 9 * * 1-3', 'Od poniedziałku do środy o 09:00'], ['0 8-18 * * 1-5', 'Co godzinę, od 08:00 do 18:00, od poniedziałku do piątku'],
    ['0 9 * 6-8 *', 'Codziennie o 09:00, od czerwca do sierpnia'], ['0 8 1,15 1,7 *', 'Co miesiąc dni 1 i 15 o 08:00, w styczniu i lipcu'],
    ['0 8 13 * 5', 'Co miesiąc dnia 13, tylko gdy to piątek, o 08:00'], ['0 7 28 9 *', '28 września o 07:00'],
    ['0 0 31 2 *', 'Nigdy się nie uruchamia'], ['5-50/7 * * * *', 'Własny harmonogram'], ['foo', 'Nieprawidłowy harmonogram'],
  ]) assert.equal(describe(expr, 'pl'), words, expr);
  assert.equal(describe('0 8 * * *'), 'Daily at 08:00');
  assert.equal(jobs.whenWords({ cron: '0 8 * * *' }, 'pl'), 'Codziennie o 08:00');
  assert.equal(jobs.whenWords({ cron: '0 8 * * *', call: true }, 'pl'), 'Codziennie o 08:00 oraz gdy zostanie wywołane');
  assert.equal(jobs.whenWords({ cron: '0 0 31 2 *', call: true }, 'pl'), 'Gdy zostanie wywołane');
  assert.equal(jobs.whenWords({ cron: '0 8 * * *', call: true }), 'Daily at 08:00, and when called');
  // The web page's "When" list names its times with the same words in Polish.
  const pl = require('../lib/i18n').load('pl');
  for (const [en, expr] of [['Every 30 min', '*/30 * * * *'], ['Hourly', '0 * * * *'], ['Daily at 09:00', '0 9 * * *'], ['Weekdays at 09:00', '0 9 * * 1-5'], ['Weekdays at 18:00', '0 18 * * 1-5'], ['Nightly at 02:00', '0 2 * * *'], ['Mondays at 10:00', '0 10 * * 1']]) {
    assert.equal(describe(expr), en);
    assert.equal(describe(expr, 'pl'), pl[en], en);
  }
});

test("with Polski chosen, a bot's jobs say when they run in Polish to the owner, and in English to the Chief", async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const bot = await makeBot(s, { name: 'Scout' });
  await s.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Morning', kind: 'ai', cron: '0 8 * * 1-5' } });
  await s.api('/settings', { method: 'PUT', body: { language: 'pl' } });
  assert.equal((await s.api(`/bots/${bot.id}/jobs`)).data[0].when, 'W dni robocze o 08:00');
  assert.equal((await s.api(`/bots/${bot.id}`)).data.jobs[0].when, 'W dni robocze o 08:00');
  assert.equal((await s.asChief(`/bots/${bot.id}`)).data.jobs[0].when, 'Weekdays at 08:00');
  assert.equal((await s.api('/cron/preview', { method: 'POST', body: { expr: '0 9 * * *' } })).data.when, 'Codziennie o 09:00');
});

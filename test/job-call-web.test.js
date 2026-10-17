// What the apps show of a job that runs when called (ADR 026): the server's words for when it runs, and a called
// run as "⏰ <job>, called". The server's words through a real server; the web page's own code cut out of
// public/app.js and run against stand-ins.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { startServer, makeBot } = require('./helpers');
const { turnOn } = require('./call-helpers');
const { read, cut, esc } = require('./web-page');
const { whenWords } = require('../lib/jobs');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('the server\'s words for a callable job end with ", and when called", or are "When called"', async () => {
  const bot = await makeBot(srv, { name: 'Door Watch' });
  const add = async (name, cron) => (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name, kind: 'script', cron, script: 'cat' } })).data;
  const daily = await add('Daily', '0 8 * * *');
  const never = await add('Never', '0 4 31 2 *'); // 31 February: its schedule never comes round
  assert.equal(daily.when, 'Daily at 08:00', 'not callable yet');
  // While the call waits for the owner's OK the change says what the job would be.
  await srv.asChief(`/bots/${bot.id}/jobs/${daily.id}`, { method: 'PUT', body: { call: true, summary: 'Runs on a call.' } });
  const waiting = (await srv.api(`/bots/${bot.id}/jobs`)).data.find((j) => j.id === daily.id);
  assert.deepEqual([waiting.when, waiting.change.when], ['Daily at 08:00', 'Daily at 08:00, and when called']);
  await srv.api(`/bots/${bot.id}/jobs/${daily.id}/approve`, { method: 'POST', body: { approve: true } });
  await turnOn(srv, bot, never);
  const jobs = (await srv.api(`/bots/${bot.id}/jobs`)).data;
  assert.equal(jobs.find((j) => j.id === daily.id).when, 'Daily at 08:00, and when called');
  assert.equal(jobs.find((j) => j.id === never.id).when, 'When called');
  assert.equal(whenWords({ cron: '0 8 * * *' }), 'Daily at 08:00');
});

test('web: a called run reads "⏰ <job>, called" above its reply and in its details', () => {
  const lib = vm.createContext({});
  vm.runInContext(read('unread.js'), lib);
  const ctx = vm.createContext({
    esc, Unread: lib.Unread, state: { keepOpen: null }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: () => '11:40', dur: () => '2 s',
    notesFoldHTML: () => '', filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '',
    escMentions: (t) => esc(t), md: (t) => esc(t), learnedChips: () => '', choicesHTML: () => '', questionsHTML: () => '',
    fmtTime: () => '11:40', runFigure: () => '', statusPill: () => '',
  });
  vm.runInContext(`${cut('const ENDED_BY = {', 'function detailsInfo(meta) {')}\n${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// The notes other bots left for a bot')}\nObject.assign(this, { botThreadHTML, runHeader });`, ctx);
  const run = (trigger) => ({ id: `r-${trigger}`, botId: 'door', trigger, jobId: 'j1', jobName: 'Motion', prompt: 'Look.', customPrompt: true, status: 'success', result: 'A cat.', startedAt: '2026-10-14T09:40:00.000Z', endedAt: '2026-10-14T09:41:00.000Z' });
  const thread = (r) => ctx.botThreadHTML({ id: 'door', name: 'Door Watch', color: '#2f9e77' }, [r]);
  assert.match(thread(run('call')), /<span class="chip">⏰ Motion, called · 11:40<\/span>/);
  assert.match(thread(run('schedule')), /<span class="chip">⏰ Motion · 11:40<\/span>/);
  assert.match(ctx.runHeader(run('call')), /⏰ Motion, called 11:40/);
  assert.match(ctx.runHeader(run('schedule')), /⏰ Motion, scheduled 11:40/);
  assert.match(ctx.runHeader(run('manual')), /⏰ Motion, started 11:40/);
});

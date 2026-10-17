// What a change to an approved job changes, in one sentence of whoever proposed it (`change.summary`, the feature
// `change-summary`; docs/api.md, "A change that waits"). Through the API and through the Chief's own tools.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const SCRIPT = { name: 'Disk check', kind: 'script', cron: '0 * * * *', script: 'df -h', assessment: 'A clear rule: no AI needed.' };
const SAYS = 'Checks /data instead of the whole disk.';

test('a change that waits carries the sentence of whoever proposed it, and nothing else does', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('change-summary'));
  const bot = await makeBot(srv, { name: 'Disk Keeper' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { ...SCRIPT, summary: 'A new job.' } })).data;
  assert.deepEqual([job.summary, job.change], [undefined, undefined], 'a job that is added has none');
  const at = `/bots/${bot.id}/jobs/${job.id}`;

  // One line of plain text, clipped: it is drawn as it comes.
  const waits = (await srv.asChief(at, { method: 'PUT', body: { script: 'df -h /data', summary: `  Checks /data\n instead of the whole disk.  ${'x'.repeat(400)}` } })).data;
  assert.equal(waits.change.summary, `Checks /data instead of the whole disk. ${'x'.repeat(400)}`.slice(0, 300));
  assert.equal(waits.summary, undefined, 'on the change, not on the job');

  // An edit that needs no OK leaves it, and the same change asked for again takes the newer sentence.
  const renamed = (await srv.asChief(at, { method: 'PUT', body: { name: 'Data disk check' } })).data;
  assert.equal(renamed.change.summary, waits.change.summary);
  const again = (await srv.asChief(at, { method: 'PUT', body: { script: 'df -h /data', summary: SAYS } })).data;
  assert.deepEqual([again.change.summary, again.change.at], [SAYS, waits.change.at], 'the change waits since when it did');

  // Another change without one has none: the sentence of the change it replaces says nothing of it.
  const other = (await srv.asChief(at, { method: 'PUT', body: { script: 'df -h /var', summary: 7 } })).data;
  assert.deepEqual([other.change.script, 'summary' in other.change], ['df -h /var', false]);

  // After the yes the job is the approved one, with no sentence left on it.
  await srv.asChief(at, { method: 'PUT', body: { script: 'df -h /data', summary: SAYS } });
  const approved = (await srv.api(`${at}/approve`, { method: 'POST', body: { approve: true } })).data;
  const [kept] = (await srv.api(`/bots/${bot.id}/jobs`)).data;
  assert.deepEqual([kept.script, kept.change, kept.summary, approved.summary], ['df -h /data', undefined, undefined, undefined]);
});

test("the Chief's update_job asks for the sentence when the edit changes what the job does", async (t) => {
  const bot = await makeBot(srv, { name: 'Log Keeper' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: SCRIPT })).data;
  const tools = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const update = (await tools.request('tools/list')).tools.find((x) => x.name === 'update_job');
  const add = (await tools.request('tools/list')).tools.find((x) => x.name === 'add_job');
  assert.deepEqual([!!update.inputSchema.properties.summary, !!add.inputSchema.properties.summary], [true, false]);

  const refused = await tools.call('update_job', { botId: bot.id, jobId: job.id, script: 'df -h /data' });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /Say in "summary"/);
  assert.equal((await srv.api(`/bots/${bot.id}/jobs`)).data[0].change, undefined, 'and nothing waits');

  await tools.text('update_job', { botId: bot.id, jobId: job.id, enabled: false }); // what needs no OK needs no sentence
  await tools.text('update_job', { botId: bot.id, jobId: job.id, script: 'df -h /data', summary: SAYS });
  const [waiting] = (await srv.api(`/bots/${bot.id}/jobs`)).data;
  assert.deepEqual([waiting.enabled, waiting.script, waiting.change.script, waiting.change.summary], [false, 'df -h', 'df -h /data', SAYS]);
});

// A shadow run (ADR 100): a script beside an AI job for a week, compared after each of its runs, and the swap
// proposed only when every run said the same. Here lib/shadow.js alone, with its clock and its model handed in.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const shadowLib = require('../lib/shadow');

const bot = { id: 'b1' };
const job = { id: 'j1', name: 'Open issues', kind: 'ai', prompt: 'Count the open issues', cron: '0 8 * * *', approved: true };
const ok = (output) => ({ exitCode: 0, output, timedOut: false, error: null });

function make({ answer = '{"same":true}' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-'));
  let t = Date.parse('2026-10-20T08:00:00Z');
  const asked = [];
  const s = shadowLib.create(dir, {
    now: () => new Date(t),
    ask: async (prompt, opts) => { asked.push({ prompt, opts }); if (answer instanceof Error) throw answer; return answer; },
    weekMs: 7 * 864e5, minRuns: 3,
  });
  return { s, dir, asked, later: (ms) => { t += ms; } };
}

test('a shadow runs beside an approved, repeating AI job only, with a script', () => {
  const { s } = make();
  assert.throws(() => s.start({ bot, job: { ...job, kind: 'script' }, script: 'echo 1' }), /beside an AI job/);
  assert.throws(() => s.start({ bot, job: { ...job, approved: false }, script: 'echo 1' }), /waits for the owner/);
  assert.throws(() => s.start({ bot, job: { ...job, at: '2026-10-21T08:00:00Z' }, script: 'echo 1' }), /one-time/);
  assert.throws(() => s.start({ bot, job, script: '  ' }), /Write the script/);
  assert.throws(() => s.start({ bot, job, script: 'x', logins: Array.from({ length: 9 }, (_, i) => `L${i}`) }), /up to 8 logins/);
  const v = s.start({ bot, job, script: 'echo 3', logins: [' GitHub '], aiWhen: 'bogus' });
  assert.deepEqual([v.shadow.compared, v.shadow.matched, v.shadow.logins], [0, 0, ['GitHub']]);
  assert.equal(s.get('j1').aiWhen, 'never');
  assert.ok(s.going(job));
  assert.equal(s.going({ ...job, prompt: 'Something else' }), null, 'a changed AI job has no shadow going');
});

test('the rules answer before any model: both quiet is the same, a failed script or one side quiet differs', () => {
  assert.deepEqual(shadowLib.rule('Nothing new.', ok('')), { match: true, why: 'both quiet' });
  assert.equal(shadowLib.rule('3 open issues', ok('')).match, false);
  assert.equal(shadowLib.rule('Nothing new', ok('3 open')).match, false);
  assert.equal(shadowLib.rule('3 open', { exitCode: 1, output: '3 open', timedOut: false }).match, false);
  assert.equal(shadowLib.rule('3 open', { exitCode: null, output: '', timedOut: true }).match, false);
  assert.equal(shadowLib.rule('3 open issues', ok('open: 3')), null, 'both said something: the model compares');
});

test('the model compares two reports; its texts are inside blocks; unsure, failed or garbled is "differs"', async () => {
  const q = shadowLib.question({ job, aiText: 'There are 3 open issues.', output: 'open=3' });
  assert.match(q, /<ai-report>\nThere are 3 open issues\.\n<\/ai-report>/);
  assert.match(q, /<script-report>\nopen=3\n<\/script-report>/);
  assert.deepEqual(shadowLib.parse('{"same":true}'), { match: true, why: 'same' });
  assert.deepEqual(shadowLib.parse('ok {"same":false,"why":"4 vs 3"}'), { match: false, why: '4 vs 3' });
  assert.equal(shadowLib.parse('yes'), null);
  for (const answer of ['maybe', new Error('down')]) {
    const { s } = make({ answer });
    s.start({ bot, job, script: 'echo' });
    assert.equal((await s.compare(job, '3 open issues', ok('open=3'))).match, false);
    assert.equal(s.get('j1').ended.why, 'differed');
  }
});

test('a run that differs ends the shadow at once and keeps both sides; the AI job stays', async () => {
  const { s } = make({ answer: '{"same":false,"why":"4 vs 3"}' });
  s.start({ bot, job, script: 'echo' });
  const v = await s.compare(job, '3 open issues', ok('open=4'), 'r1');
  assert.deepEqual(v, { match: false, why: '4 vs 3' });
  const d = s.detail('j1');
  assert.deepEqual([d.ended.why, d.ended.said, d.ended.ai, d.ended.script], ['differed', '4 vs 3', '3 open issues', 'open=4']);
  assert.equal(await s.compare(job, 'x', ok('y')), null, 'nothing is compared after it ended');
  assert.deepEqual(s.view('j1').shadow.ended, { at: d.ended.at, why: 'differed', said: '4 vs 3' });
  assert.equal(s.due().length, 0);
});

test('a week of the same answers is ready; fewer than three runs are too few', async () => {
  const { s, later, asked } = make();
  s.start({ bot, job, script: 'echo' });
  for (let i = 0; i < 3; i++) { later(864e5); assert.equal((await s.compare(job, '3 open issues', ok('open=3'))).match, true); }
  assert.equal(asked.length, 3);
  assert.equal(asked[0].opts.llm.model, shadowLib.MODEL);
  assert.equal(s.due().length, 0, 'the week is not over');
  later(4 * 864e5);
  const [d] = s.due();
  assert.deepEqual([d.ready, d.few], [true, false]);
  assert.equal(shadowLib.summaryOf(3), 'Same answers 3 of 3 in 7 days: runs as a script, without AI.');

  const two = make();
  two.s.start({ bot, job, script: 'echo' });
  await two.s.compare(job, 'Nothing new', ok(''));
  two.later(7 * 864e5);
  assert.deepEqual(two.s.due().map((x) => [x.ready, x.few]), [[false, true]]);
});

test('a proposed swap is promoted once the job runs the script, and goes back to the AI job exactly', async () => {
  const { s } = make();
  s.start({ bot, job, script: 'echo 3', logins: ['GitHub'] });
  const from = { kind: 'ai', prompt: job.prompt, cron: job.cron };
  s.proposed('j1', from);
  assert.equal(s.settle({ ...job, change: { job: {} } }), null, 'the card still waits');
  assert.equal(s.settle({ ...job, kind: 'script', script: 'echo 3' }), 'promoted');
  assert.equal(s.get('j1'), null);
  assert.equal(s.view('j1').promoted.matched, 0);
  assert.deepEqual(s.backTo('j1'), from);
  assert.equal(s.promotedOf('j1'), null);
  assert.equal(s.backTo('j1'), null);
});

test('a proposed swap the owner said no to is declined; a removed job forgets all of it', () => {
  const { s, dir } = make();
  s.start({ bot, job, script: 'echo' });
  s.proposed('j1', {});
  assert.equal(s.settle(job), 'declined');
  assert.equal(s.get('j1').ended.why, 'declined');
  s.prune(new Set(['j1']));
  assert.ok(s.get('j1'), 'a job that is still there keeps it');
  s.prune(new Set());
  assert.equal(s.view('j1'), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'shadows.json'), 'utf8')), { shadows: {}, promoted: {} });
});

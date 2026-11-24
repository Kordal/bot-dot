// An eval of answer views (#1625, ADR 264): six prompts (test/live/ui-eval-cases.js) go to a real bot (the Claude CLI,
// signed in as you) on a scratch botdot server each: two where a view is right (compare three options, a time
// series), the four-field form (inputs are wave 2, so a view or a written list will do for now) and three where prose
// is right (a one-line fact, an apology, a yes or no). Each is scored from the run's tool calls and the reply
// (test/live/ui-scoring.js): whether the bot loaded kit:ui, and whether every ```ui fence it wrote passes the
// validator of the apps (public/answer-view.js). No model judges; a short report says pass or fail per case.
//
// Not part of npm test (it needs a Claude login and spends real model usage: a case is one bot turn, a minute or
// two):
//
//   make ui-eval
//
// It skips, saying why, when no Claude login is available (no `claude auth status` that says signed in, no
// CLAUDE_CODE_OAUTH_TOKEN, no ANTHROPIC_API_KEY). The servers' data is in the system's temporary folder (TMPDIR), which
// must lie outside any checkout, because Claude Code loads a CLAUDE.md that stands above a bot's folder.
//
// BOT_DOT_TEST_LIVE_ONLY: case ids, comma separated. BOT_DOT_TEST_LIVE_PARALLEL (default 3): cases at once.
// BOT_DOT_TEST_LIVE_REPEAT (default 1): runs of each case; whether a model picks a skill varies, so 3 or more says more.
// BOT_DOT_TEST_LIVE_OUT: folder for results.json and report.md (default: a temp folder).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, waitFor } = require('../helpers');
const { CASES } = require('./ui-eval-cases');
const { skillPicked, score, report } = require('./ui-scoring');

const ONLY = (process.env.BOT_DOT_TEST_LIVE_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const PARALLEL = Math.max(1, Number(process.env.BOT_DOT_TEST_LIVE_PARALLEL) || 3);
const REPEAT = Math.max(1, Number(process.env.BOT_DOT_TEST_LIVE_REPEAT) || 1);
const RUN_TIMEOUT = 10 * 60_000;

// A plain bot that answers what the owner asks: no job, no data, nothing that favours a view or prose but the skill.
const BOT = { name: 'Helper', emoji: '🙂', prompt: 'You answer the owner\'s questions and help with what they ask. You never act on the world without asking first. Voice: friendly and short. Wake: only when I ask.' };

function realClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const p of [path.join(os.homedir(), '.local', 'bin', 'claude'), path.join(os.homedir(), '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) if (fs.existsSync(p)) return p;
  return 'claude';
}

// Why this suite cannot run now, or null.
function whyNot() {
  // Its own flag, not the memory suite's BOT_DOT_TEST_LIVE_CLAUDE: `npm run test:live` with that one must not run these cases too.
  if (process.env.BOT_DOT_TEST_UI_EVAL !== '1') return 'it spends real model usage: run it with make ui-eval';
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY) return null;
  try {
    const out = execFileSync(realClaude(), ['auth', 'status'], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out).loggedIn === true ? null : 'no Claude login: `claude auth status` says it is not signed in (run `claude auth login`)';
  } catch (e) {
    return `no Claude login: could not read \`claude auth status\` (${String(e.message).split('\n')[0]})`;
  }
}

// Claude CLIs starting at once can trip over refreshing the same sign-in ("Not logged in"): that is not the bot's
// doing, so such a case is run again, up to twice.
const signInRace = (text) => /not logged in|please run \/login/i.test(String(text || ''));

async function runCase(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-test-ui-eval-'));
  // USER too: on a Mac Claude Code finds its sign-in in the Keychain by it, and a server's own environment has none.
  const env = { CLAUDE_BIN: realClaude(), HOME: os.homedir(), USER: process.env.USER || os.userInfo().username, ...Object.fromEntries(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
  const srv = await startServer({ dir, env });
  try {
    const made = await srv.api('/bots', { method: 'POST', body: BOT });
    if (made.status !== 201) throw new Error(`could not make the bot: ${JSON.stringify(made.data)}`);
    const started = await srv.api(`/bots/${made.data.id}/run`, { method: 'POST', body: { prompt: c.says } });
    if (!started.data?.id) throw new Error(`could not start the bot: ${JSON.stringify(started.data)}`);
    const run = await waitFor(async () => {
      const r = (await srv.api(`/runs/${started.data.id}`)).data;
      return r.status && !['running', 'queued'].includes(r.status) ? r : null;
    }, { timeout: RUN_TIMEOUT, every: 1000, what: `${c.id}: the bot to answer` });
    const reply = run.result || '';
    if (run.status !== 'success' || signInRace(reply || run.error)) return { retry: signInRace(reply || run.error), error: `the run ended ${run.status}: ${String(run.error || reply).slice(0, 200)}` };
    const seen = { picked: skillPicked(run.events), reply, model: run.modelUsed || null };
    return { seen, score: score(c, seen) };
  } finally {
    await srv.stop();
  }
}

async function runCaseRetrying(c, n) {
  const t0 = Date.now();
  const meta = { id: REPEAT > 1 ? `${c.id}#${n + 1}` : c.id, case: c.id, says: c.says, view: c.view, wave: c.wave };
  for (let i = 0; ; i++) {
    try {
      const r = await runCase(c);
      if (r.retry && i < 2) { await new Promise((res) => setTimeout(res, 15_000)); continue; }
      return { ...meta, retries: i, durationMs: Date.now() - t0, ...r };
    } catch (e) {
      return { ...meta, error: e.message, durationMs: Date.now() - t0 };
    }
  }
}

const skip = whyNot();

test('answer views: a bot draws one where it is clearer than text, and every view passes the validator (#1625)', { skip: skip || false, timeout: 2 * 60 * 60_000 }, async (t) => {
  const cases = CASES.filter((c) => !ONLY.length || ONLY.includes(c.id));
  assert.ok(cases.length, `no case is named ${ONLY.join(', ')}`);
  const jobs = cases.flatMap((c) => Array.from({ length: REPEAT }, (_, n) => [c, n]));
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await runCaseRetrying(...jobs[i]);
      t.diagnostic(`${results[i].id}: ${results[i].error ? `error: ${results[i].error}` : results[i].score.pass ? 'pass' : 'FAIL'}`);
    }
  }));

  const out = process.env.BOT_DOT_TEST_LIVE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-ui-eval-'));
  fs.mkdirSync(out, { recursive: true });
  const model = [...new Set(results.map((r) => r.seen?.model).filter(Boolean))].join(', ') || null;
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const md = report(results, { date: new Date().toISOString().slice(0, 10), model, commit });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'report.md'), md);
  console.log(`\n${md}\nEvidence: ${path.join(out, 'results.json')}\n`);

  // One result per case, so the run fails on the cases that failed, by name.
  for (const r of results) {
    await t.test(r.id, () => {
      assert.ok(!r.error, `did not finish: ${r.error}`);
      const failed = r.score.checks.filter((x) => x.ok === false);
      assert.deepEqual(failed.map((x) => `${x.id}: ${x.detail}`), []);
    });
  }
});

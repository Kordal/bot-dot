// An eval of the bots the Chief of Staff makes (#1544): 13 typical requests (test/live/chief-eval-cases.js) go to
// the real Chief (the Claude CLI, signed in as you) on a scratch botdot server each, and the bots that come out are
// scored from what was saved and said (test/live/chief-scoring.js): the four parts in the task, at most two
// questions, a job when a schedule was asked for, a first run, no duplicate bot, the limits that fit the risk. No
// model judges; a short report says pass or fail per case. The regexes in test/chief-bot-design.test.js and
// test/bot-designer.test.js only match the instruction text: this measures what comes out of a conversation.
//
// Not part of npm test (it needs a Claude login and spends real model usage: a case is a Chief turn or two and the
// bot's first run, a few minutes):
//
//   make chief-eval
//
// It skips, saying why, when no Claude login is available (no `claude auth status` that says signed in, no
// CLAUDE_CODE_OAUTH_TOKEN, no ANTHROPIC_API_KEY). The bots' first runs are real: the requests name only made-up
// addresses (example.org, 203.0.113.10), and the servers' data is in the system's temporary folder (TMPDIR), which
// must lie outside any checkout, because Claude Code loads a CLAUDE.md that stands above a bot's folder.
//
// BOT_DOT_TEST_LIVE_ONLY: case ids, comma separated. BOT_DOT_TEST_LIVE_PARALLEL (default 2): cases at once.
// BOT_DOT_TEST_LIVE_OUT: folder for results.json and report.md (default: a temp folder). A model's answers vary,
// so a case that fails once is worth running again: BOT_DOT_TEST_LIVE_ONLY=<id> make chief-eval.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startServer, waitFor } = require('../helpers');
const { CASES } = require('./chief-eval-cases');
const { score, report } = require('./chief-scoring');

const ONLY = (process.env.BOT_DOT_TEST_LIVE_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const PARALLEL = Math.max(1, Number(process.env.BOT_DOT_TEST_LIVE_PARALLEL) || 2);
const CASE_TIMEOUT = 20 * 60_000;
// What the owner says when the Chief asks and has made nothing yet.
const GO_AHEAD = "I don't mind: decide for me and go ahead.";

function realClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const p of [path.join(os.homedir(), '.local', 'bin', 'claude'), path.join(os.homedir(), '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) if (fs.existsSync(p)) return p;
  return 'claude';
}

// Why this suite cannot run now, or null.
function whyNot() {
  // Its own flag, not the memory suite's BOT_DOT_TEST_LIVE_CLAUDE: `npm run test:live` with that one must not run these cases too.
  if (process.env.BOT_DOT_TEST_CHIEF_EVAL !== '1') return 'it spends real model usage: run it with make chief-eval';
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY) return null;
  try {
    const out = execFileSync(realClaude(), ['auth', 'status'], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out).loggedIn === true ? null : 'no Claude login: `claude auth status` says it is not signed in (run `claude auth login`)';
  } catch (e) {
    return `no Claude login: could not read \`claude auth status\` (${String(e.message).split('\n')[0]})`;
  }
}

// Claude CLIs starting at once can trip over refreshing the same sign-in ("Not logged in"): that is not the Chief's
// doing, so such a case is run again, up to twice.
const signInRace = (text) => /not logged in|please run \/login/i.test(String(text || ''));

// What the Chief said: its text, and the questions of the card under it (a reply with answer buttons has them in its text).
const chiefTexts = (chat) => chat.messages.filter((m) => m.role === 'chief' && !m.reminder && !m.pending)
  .map((m) => ({ text: m.text || m.error || '', questions: m.questions || [], choices: m.choices || [] })).filter((m) => m.text || m.questions.length);
const asks = (m) => !!m && (/\?/.test(m.text) || m.questions.length > 0 || m.choices.length > 0);

async function runCase(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-test-chief-eval-'));
  // USER too: on a Mac Claude Code finds its sign-in in the Keychain by it, and a server's own environment has none.
  const env = { CLAUDE_BIN: realClaude(), HOME: os.homedir(), USER: process.env.USER || os.userInfo().username, ...Object.fromEntries(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };
  const srv = await startServer({ dir, env });
  const bots = async () => (await srv.api('/bots')).data;
  try {
    for (const b of c.existing || []) {
      const r = await srv.api('/bots', { method: 'POST', body: { name: b.name, emoji: b.emoji, prompt: b.prompt } });
      if (r.status !== 201) throw new Error(`could not make ${b.name}: ${JSON.stringify(r.data)}`);
    }
    const existing = await bots();
    const known = new Set(existing.map((b) => b.id));

    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const say = (text) => srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
    // The Chief has replied and nothing goes on any more: its chat is idle, and each bot is idle or waits for the
    // owner (a card), on several looks in a row, since a bot's end starts a Chief turn of its own.
    let calm = 0;
    const settled = (turns) => waitFor(async () => {
      const [c2, all] = [(await srv.api(`/chief/chats/${chat.id}`)).data, await bots()];
      const quiet = !c2.busy && !(c2.queued || []).length && chiefTexts(c2).length >= turns && all.every((b) => !b.running || ['needs_you', 'waiting'].includes(b.state)) && all.every((b) => !(b.queued || []).length);
      calm = quiet ? calm + 1 : 0;
      return calm >= 4 ? c2 : null;
    }, { timeout: CASE_TIMEOUT, every: 2000, what: `${c.id}: the Chief and its bots to finish` });

    await say(c.says);
    let done = await settled(1);
    const first = chiefTexts(done)[0];
    if (signInRace(first?.text)) { await srv.stop(); return { retry: true }; }

    // It asked and made nothing: the owner leaves it to the Chief, once. Its questions count over the whole chat.
    const now = await bots();
    const taken = c.bots > 0 ? now.filter((b) => !known.has(b.id)).length >= c.bots : now.some((b) => known.has(b.id) && !existing.find((e) => e.id === b.id && e.prompt === b.prompt && (e.jobs || []).length === (b.jobs || []).length));
    if (!taken && asks(chiefTexts(done).at(-1))) {
      await say(GO_AHEAD);
      done = await settled(chiefTexts(done).length + 1);
    }

    const final = await bots();
    const runs = {};
    for (const b of final) runs[b.id] = (await srv.api(`/runs?botId=${b.id}&limit=50`)).data;
    const seen = { bots: final, runs, chief: chiefTexts(done), existing };
    return { seen, score: score(c, seen) };
  } finally {
    await srv.stop();
  }
}

async function runCaseRetrying(c) {
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    try {
      const r = await runCase(c);
      if (r.retry && i < 2) { await new Promise((res) => setTimeout(res, 15_000)); continue; }
      if (r.retry) return { id: c.id, says: c.says, error: 'the Claude sign-in was refused three times ("Not logged in")' };
      return { id: c.id, says: c.says, retries: i, durationMs: Date.now() - t0, ...r };
    } catch (e) {
      return { id: c.id, says: c.says, error: e.message, durationMs: Date.now() - t0 };
    }
  }
}

// What the report keeps of a case as evidence: the Chief's words, and each bot's task, jobs and runs.
function evidence(r) {
  if (!r.seen) return r;
  const { seen, ...rest } = r;
  return {
    ...rest,
    chief: seen.chief,
    bots: seen.bots.map((b) => ({ id: b.id, name: b.name, new: !seen.existing.some((e) => e.id === b.id), prompt: b.prompt, jobs: (b.jobs || []).map((j) => ({ name: j.name, kind: j.kind, cron: j.cron, at: j.at, enabled: j.enabled, approved: j.approved })), runs: (seen.runs[b.id] || []).map((x) => ({ id: x.id, trigger: x.trigger, startedBy: x.startedBy, jobId: x.jobId, status: x.status, result: String(x.result || x.error || '').slice(0, 400) })) })),
  };
}

const skip = whyNot();

test('the bots the Chief makes from typical requests (#1544)', { skip: skip || false, timeout: 3 * 60 * 60_000 }, async (t) => {
  const cases = CASES.filter((c) => !ONLY.length || ONLY.includes(c.id));
  assert.ok(cases.length, `no case is named ${ONLY.join(', ')}`);
  const results = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, cases.length) }, async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCaseRetrying(cases[i]);
      t.diagnostic(`${cases[i].id}: ${results[i].error ? `error: ${results[i].error}` : results[i].score.pass ? 'pass' : 'FAIL'}`);
    }
  }));

  const out = process.env.BOT_DOT_TEST_LIVE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-chief-eval-'));
  fs.mkdirSync(out, { recursive: true });
  // The model of the bots' runs, as botdot read it from Claude (the Chief's own turn is not recorded as a run).
  const model = [...new Set(results.flatMap((r) => Object.values(r.seen?.runs || {}).flat()).map((x) => x.modelUsed).filter(Boolean))].join(', ') || null;
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const md = report(results, { date: new Date().toISOString().slice(0, 10), model, commit });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results.map(evidence), null, 2));
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

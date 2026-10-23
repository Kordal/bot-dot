#!/usr/bin/env node
// Before and after the wake gate (lib/wake-gate.js), over the notes and calls of test/fixtures/wake-gate-cases.json:
// a note from another bot (priority: false) or a call of a job, and whether it needs a run now ("run"), at the next
// run ("wait") or never ("save").
//
//   node scripts/wake-gate-bench.js            the stand-in for the model (a few keywords): checks the script
//   node scripts/wake-gate-bench.js --live     Claude Haiku through the Claude Code CLI ($CLAUDE_BIN or `claude`)
//   node scripts/wake-gate-bench.js --jev      Jev (TypeSafe) on OpenRouter: $OPENROUTER_API_KEY, or the key in the
//                                              file $OPENROUTER_KEY_FILE. Two yes/no questions in one request: must
//                                              it act now, and should it know at all.
//   --at=<p>                                   Jev: "run" from this likelihood of "act now" on (0.5)
//   --json                                     the numbers as JSON
//
// Before: every one wakes a run (#225, ADR 026). After: rules first (lib/wake-gate.js rules()), then the model;
// "wait" and "save" start no run. A missed run is one the case expects to run that starts none: it must stay 0.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const gate = require('../lib/wake-gate');

const args = process.argv.slice(2);
const flag = (name, d) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.split('=')[1]) : d; };
const JEV = args.includes('--jev');
const LIVE = args.includes('--live') || JEV;
const AT = flag('at', 0.5);
const fixtures = path.join(__dirname, '..', 'test', 'fixtures');
const { teams } = JSON.parse(fs.readFileSync(path.join(fixtures, 'group-router-cases.json'), 'utf8'));
const { jobs, cases } = JSON.parse(fs.readFileSync(path.join(fixtures, 'wake-gate-cases.json'), 'utf8'));
const botsByName = Object.fromEntries(Object.values(teams).flat().map((b) => [b.name, b]));
const input = (c) => {
  if (c.job) return { bot: botsByName[jobs[c.job].bot], what: { kind: 'call', job: { name: c.job, prompt: jobs[c.job].prompt } }, text: c.text, waiting: c.waiting || [] };
  return { bot: botsByName[c.to], what: { kind: 'note', from: c.from }, text: c.text, waiting: c.waiting || [] };
};

let cost = 0; // USD, as the answers report it
// Claude Haiku, asked as lib/dresser.js askClaude asks it.
function live(prompt, { llm, ms, system }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
    delete env.CLAUDECODE;
    const child = spawn(process.env.CLAUDE_BIN || 'claude', ['-p', '--output-format', 'stream-json', '--verbose', '--model', llm.model, '--system-prompt', system, '--setting-sources', '', '--tools', '', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config', '--no-session-persistence'], { cwd: require('os').tmpdir(), env, stdio: ['pipe', 'pipe', 'ignore'] });
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('no answer in time')); }, ms);
    let buf = '';
    child.stdout.on('data', (c) => {
      buf += c;
      for (let nl; (nl = buf.indexOf('\n')) >= 0; buf = buf.slice(nl + 1)) {
        let ev; try { ev = JSON.parse(buf.slice(0, nl)); } catch { continue; }
        if (ev.type === 'result') { clearTimeout(t); child.kill(); cost += Number(ev.total_cost_usd) || 0; return ev.is_error ? reject(new Error(ev.result)) : resolve(ev.result); }
      }
    });
    child.on('close', () => { clearTimeout(t); reject(new Error('ended without an answer')); });
    child.stdin.end(prompt);
  });
}
// Jev on OpenRouter: it answers no free text, so the bench asks it directly and hands decide() an answer in the
// gate's own JSON.
const JEV_MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.14';
const openRouterKey = () => (process.env.OPENROUTER_API_KEY || (process.env.OPENROUTER_KEY_FILE ? fs.readFileSync(process.env.OPENROUTER_KEY_FILE, 'utf8') : '')).trim();
let now = null; // the case decide() is asked about: Jev reads it as data, not as the gate's prompt
let lastP = null;
async function jev(_prompt, { ms }) {
  const { bot, what, text, waiting } = now;
  const job = what.kind === 'call' ? `Its job "${what.job.name}": ${what.job.prompt}` : '';
  const questions = {
    now: { type: 'noul', instructions: `Must ${bot.name} run now to act on this message? ${job}`, criteria: { true: 'Something broke, failed or is down, work was handed to it, a fix or review to make, a customer waiting, or its job says to act on it.', false: 'An acknowledgement, a thanks, a repeat of a note already waiting, a success or heartbeat, or an update that can wait for its next run.' } },
    keep: { type: 'noul', instructions: `Should ${bot.name} know about this message at all at its next run? ${job}`, criteria: { true: 'An update its own work or reports depend on.', false: 'An acknowledgement, a thanks, a repeat of a note already waiting, or a success or heartbeat its job asks nothing for.' } },
  };
  const state = { bot: { name: bot.name, description: bot.description, job: bot.prompt }, came: what.kind === 'call' ? { call: what.job.name, instructions: what.job.prompt } : { noteFrom: what.from }, waiting, message: text };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${openRouterKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: JEV_MODEL, state, questions, provider: { data_collection: 'deny' } }) });
    const body = await res.json();
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    cost += Number(body.usage?.cost ?? body.cost) || 0;
    const a = body.answers || {};
    lastP = { now: a.now?.noul, keep: a.keep?.noul };
    if (typeof a.now?.noul !== 'number') return '';
    return JSON.stringify({ decision: a.now.noul >= AT ? 'run' : (a.keep?.noul ?? 1) >= 0.5 ? 'wait' : 'save' });
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'no answer in time' : e.message); } finally { clearTimeout(t); }
}
// The stand-in: a few words.
async function fake(prompt) {
  const text = prompt.split('\n').filter((l) => /^(A note from|What the call carried)/.test(l)).join(' ');
  if (/down|fail|crash|error|blocking|ready|opened|start|customer/i.test(text)) return '{"decision":"run"}';
  if (/thanks|ok 👍|success|"up"|"ok"|reminder/i.test(text)) return '{"decision":"save"}';
  return '{"decision":"wait"}';
}

(async () => {
  if (JEV && !openRouterKey()) { console.error('--jev needs OPENROUTER_API_KEY or OPENROUTER_KEY_FILE.'); process.exit(1); }
  const g = gate.create({ ask: JEV ? jev : LIVE ? live : fake, ms: Number(process.env.BOT_DOT_WAKE_GATE_MS) || (LIVE ? gate.MS : 1000) });
  const rows = [];
  for (const c of cases) {
    now = input(c);
    lastP = null;
    const d = await g.decide(now);
    rows.push({ text: c.text, to: c.job ? `${jobs[c.job].bot} (${c.job})` : `${c.to} (from ${c.from})`, expect: c.expect, ...d, ...(lastP ? { p: lastP } : {}) });
    if (!args.includes('--json')) process.stderr.write('.');
  }
  const n = rows.length;
  const runs = rows.filter((x) => x.decision === 'run').length;
  const asked = rows.filter((x) => x.by !== 'rule');
  const lat = asked.map((x) => x.ms).sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0;
  const total = {
    cases: n, mode: JEV ? `jev (${JEV_MODEL}, run at ${AT})` : LIVE ? `live (${gate.MODEL})` : 'stand-in',
    expected: Object.fromEntries(gate.DECISIONS.map((k) => [k, rows.filter((x) => x.expect === k).length])),
    runs: [n, runs],
    avoided: n - runs,
    missedRuns: rows.filter((x) => x.expect === 'run' && x.decision !== 'run').length,
    needlessRuns: rows.filter((x) => x.expect !== 'run' && x.decision === 'run').length,
    exact: rows.filter((x) => x.expect === x.decision).length,
    byRule: rows.filter((x) => x.by === 'rule').length,
    fellBack: rows.filter((x) => x.by === 'fell').length,
    ms: { median: pct(0.5), p90: pct(0.9), max: lat.at(-1) ?? 0 },
    costUsd: Number(cost.toFixed(5)),
  };
  if (args.includes('--json')) { console.log(JSON.stringify({ total, rows }, null, 2)); return; }
  console.log(`\n${n} cases, ${total.mode}; expected run ${total.expected.run}, wait ${total.expected.wait}, save ${total.expected.save}\n`);
  console.log('| | Before | After |\n| --- | --- | --- |');
  console.log(`| Runs | ${n} | ${runs} |`);
  console.log(`| Runs avoided | - | ${total.avoided} (${Math.round((100 * total.avoided) / n)}%) |`);
  console.log(`| Missed runs (must be 0) | 0 | ${total.missedRuns} |`);
  console.log(`| Needless runs | ${n - total.expected.run} | ${total.needlessRuns} |`);
  console.log(`| Exact decision | ${total.expected.run}/${n} | ${total.exact}/${n} |`);
  console.log(`| Sent to run by a rule / fell back | - | ${total.byRule} / ${total.fellBack} |`);
  console.log(`| Gate time (median / p90 / max) | - | ${total.ms.median} / ${total.ms.p90} / ${total.ms.max} ms |`);
  console.log(`| Cost of the gate | - | $${total.costUsd} |`);
  console.log('\nPer case:');
  for (const x of rows) {
    const mark = x.expect === 'run' && x.decision !== 'run' ? 'MISS' : x.expect === x.decision ? 'ok  ' : x.decision === 'run' ? 'xtra' : 'diff';
    console.log(`${mark} ${x.expect.padEnd(4)} -> ${x.decision.padEnd(4)} ${(x.by + (x.why ? `:${x.why}` : '')).padEnd(14)} ${String(x.ms).padStart(5)} ms ${x.p ? `now ${x.p.now?.toFixed(2)} keep ${x.p.keep?.toFixed(2)} ` : ''} ${x.to}: ${x.text.slice(0, 90)}`);
  }
})();

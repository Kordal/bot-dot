#!/usr/bin/env node
// Before and after the wake gate (lib/wake-gate.js), over the notes and calls of test/fixtures/wake-gate-cases.json:
// a note from another bot (priority: false) or a call of a job, and whether it needs a run now ("run"), or its next
// run is soon enough: the fixture says which of those it is, "wait" (it should know) or "save" (nothing to do).
//
//   node scripts/wake-gate-bench.js            the stand-in for the model (a few keywords): checks the script
//   node scripts/wake-gate-bench.js --live     Claude Haiku through the Claude Code CLI ($CLAUDE_BIN or `claude`)
//   node scripts/wake-gate-bench.js --jev      Jev (TypeSafe) on OpenRouter: $OPENROUTER_API_KEY, or the key in the
//                                              file $OPENROUTER_KEY_FILE, as the gate asks it with the admin's choice.
//   --json                                     the numbers as JSON
//
// Before: every one wakes a run (#225, ADR 026). After: rules first (lib/wake-gate.js rules()), then the model;
// "later" starts no run. A missed run is one the case expects to run that starts none: it must stay 0.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const gate = require('../lib/wake-gate');

const args = process.argv.slice(2);
const JEV = args.includes('--jev');
const LIVE = args.includes('--live') || JEV;
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
// Jev on OpenRouter, asked as the gate asks it when the admin chose Jev (lib/wake-gate.js jevRequest). The fetch
// keeps its likelihood and cost; no Haiku behind it here, so a failure shows as one.
const openRouterKey = () => (process.env.OPENROUTER_API_KEY || (process.env.OPENROUTER_KEY_FILE ? fs.readFileSync(process.env.OPENROUTER_KEY_FILE, 'utf8') : '')).trim();
let lastP = null;
async function jevFetch(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => null);
  cost += Number(body?.usage?.cost ?? body?.cost) || 0;
  lastP = { now: body?.answers?.now?.noul };
  return { ok: res.ok, status: res.status, json: async () => body };
}
const noHaiku = async () => { throw new Error('Jev only'); };
// The stand-in: a few words.
async function fake(prompt) {
  const text = prompt.split('\n').filter((l) => /^(A note from|What the call carried)/.test(l)).join(' ');
  if (/down|fail|crash|error|blocking|ready|opened|start|customer/i.test(text)) return '{"decision":"run"}';
  return '{"decision":"wait"}';
}

(async () => {
  if (JEV && !openRouterKey()) { console.error('--jev needs OPENROUTER_API_KEY or OPENROUTER_KEY_FILE.'); process.exit(1); }
  const key = JEV ? openRouterKey() : null;
  const g = gate.create({ ask: JEV ? noHaiku : LIVE ? live : fake, ms: Number(process.env.BOT_DOT_WAKE_GATE_MS) || (LIVE ? gate.MS : 1000), config: () => (JEV ? { router: 'jev', key } : { router: 'haiku', key: null }), fetch: jevFetch });
  const rows = [];
  for (const c of cases) {
    lastP = null;
    const d = await g.decide(input(c));
    rows.push({ text: c.text, to: c.job ? `${jobs[c.job].bot} (${c.job})` : `${c.to} (from ${c.from})`, expect: c.expect, ...d, ...(lastP ? { p: lastP } : {}) });
    if (!args.includes('--json')) process.stderr.write('.');
  }
  const n = rows.length;
  const runs = rows.filter((x) => x.decision === 'run').length;
  const asked = rows.filter((x) => x.by !== 'rule');
  const lat = asked.map((x) => x.ms).sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0;
  const total = {
    cases: n, mode: JEV ? `jev (${require('../lib/group-router').JEV_MODEL})` : LIVE ? `live (${gate.MODEL})` : 'stand-in',
    expected: Object.fromEntries(['run', 'wait', 'save'].map((k) => [k, rows.filter((x) => x.expect === k).length])),
    runs: [n, runs],
    avoided: n - runs,
    missedRuns: rows.filter((x) => x.expect === 'run' && x.decision !== 'run').length,
    needlessRuns: rows.filter((x) => x.expect !== 'run' && x.decision === 'run').length,
    exact: rows.filter((x) => (x.expect === 'run') === (x.decision === 'run')).length,
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
    const mark = x.expect === 'run' && x.decision !== 'run' ? 'MISS' : x.expect !== 'run' && x.decision === 'run' ? 'xtra' : 'ok  ';
    console.log(`${mark} ${x.expect.padEnd(4)} -> ${x.decision.padEnd(5)} ${(x.by + (x.why ? `:${x.why}` : '')).padEnd(14)} ${String(x.ms).padStart(5)} ms ${x.p ? `now ${x.p.now?.toFixed(2)} ` : ''} ${x.to}: ${x.text.slice(0, 90)}`);
  }
})();

#!/usr/bin/env node
// Before and after sorting the owner's messages to a bot at work (lib/follow-up.js), over
// test/fixtures/follow-up-cases.json: the runs of the owner's that go on, the chat's last lines, the message, and
// what it is ("steer:n", "ask" or "new"; a list when more than one is right).
//
//   node scripts/follow-up-bench.js            the stand-in for the model (a few keywords): checks the script
//   node scripts/follow-up-bench.js --live     Claude Haiku through the Claude Code CLI ($CLAUDE_BIN or `claude`)
//   node scripts/follow-up-bench.js --jev      Jev (TypeSafe) on OpenRouter: $OPENROUTER_API_KEY, or the key in the
//                                              file $OPENROUTER_KEY_FILE
//   --json                                     the numbers as JSON
//
// Before: every message starts a run of its own (ADR 062). A wrong steer (a task of its own steered into a run, or
// into the wrong run) is the harm to count: it must stay 0. A missed steer is today's behaviour.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const followUp = require('../lib/follow-up');

const args = process.argv.slice(2);
const JEV = args.includes('--jev');
const LIVE = args.includes('--live') || JEV;
const { bots, cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'follow-up-cases.json'), 'utf8'));
const NOW = Date.parse('2026-10-27T09:00:00Z');
const input = (c) => ({
  bot: { name: c.bot, description: bots[c.bot] },
  runs: c.runs.map((r) => ({ prompt: r.prompt, line: r.line, startedAt: new Date(NOW - (r.secs ?? r.mins * 60) * 1000).toISOString() })),
  recent: c.recent || [],
  text: c.text,
  files: c.files || 0,
  now: NOW,
});
const label = (d) => (d.decision === 'steer' ? `steer:${d.run + 1}` : d.decision);

let cost = 0;
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
const openRouterKey = () => (process.env.OPENROUTER_API_KEY || (process.env.OPENROUTER_KEY_FILE ? fs.readFileSync(process.env.OPENROUTER_KEY_FILE, 'utf8') : '')).trim();
let lastP = null;
async function jevFetch(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => null);
  cost += Number(body?.usage?.cost ?? body?.cost) || 0;
  lastP = Object.fromEntries(Object.entries(body?.answers || {}).map(([k, v]) => [k, v?.noul]));
  return { ok: res.ok, status: res.status, json: async () => body };
}
const noHaiku = async () => { throw new Error('Jev only'); };
async function fake(prompt) {
  const msg = (prompt.match(/^The message: (.*)$/m) || [])[1] || '';
  if (/\?$/.test(msg.trim()) && /jak|how|did|ile|które/i.test(msg)) return '{"decision":"ask"}';
  if (/again|jeszcze|też|too|also|stop|nie |not |wait|use |dodaj|bardziej/i.test(msg)) return '{"decision":"steer","run":1}';
  return '{"decision":"new"}';
}

(async () => {
  if (JEV && !openRouterKey()) { console.error('--jev needs OPENROUTER_API_KEY or OPENROUTER_KEY_FILE.'); process.exit(1); }
  const key = JEV ? openRouterKey() : null;
  const f = followUp.create({ ask: JEV ? noHaiku : LIVE ? live : fake, ms: Number(process.env.BOT_DOT_FOLLOW_UP_MS) || (LIVE ? followUp.MS : 1000), config: () => (JEV ? { router: 'jev', key } : { router: 'haiku', key: null }), fetch: jevFetch });
  const rows = [];
  for (const c of cases) {
    lastP = null;
    const d = await f.decide(input(c));
    const ok = [c.expect].flat();
    rows.push({ text: c.text, bot: c.bot, runs: c.runs.length, ok, got: label(d), ...d, ...(lastP ? { p: lastP } : {}) });
    if (!args.includes('--json')) process.stderr.write('.');
  }
  const n = rows.length;
  const right = (x) => x.ok.includes(x.got);
  const asked = rows.filter((x) => x.by !== 'rule');
  const lat = asked.map((x) => x.ms).sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0;
  const wantsSteer = rows.filter((x) => x.ok.every((o) => o.startsWith('steer')));
  const total = {
    cases: n, mode: JEV ? `jev (${require('../lib/group-router').JEV_MODEL})` : LIVE ? `live (${followUp.MODEL})` : 'stand-in',
    exact: rows.filter(right).length,
    exactBefore: rows.filter((x) => x.ok.includes('new')).length,
    steered: rows.filter((x) => x.got.startsWith('steer')).length,
    wrongSteer: rows.filter((x) => x.got.startsWith('steer') && !right(x)).length,
    missedSteer: wantsSteer.filter((x) => !x.got.startsWith('steer')).length,
    mustSteer: wantsSteer.length,
    askRight: rows.filter((x) => x.ok.includes('ask') && x.got === 'ask').length,
    mustAsk: rows.filter((x) => x.ok.includes('ask')).length,
    askWrong: rows.filter((x) => x.got === 'ask' && !x.ok.includes('ask')).length,
    newRuns: [n, rows.filter((x) => x.got === 'new').length],
    byRule: rows.filter((x) => x.by === 'rule').length,
    fellBack: rows.filter((x) => x.by === 'fell').length,
    ms: { median: pct(0.5), p90: pct(0.9), max: lat.at(-1) ?? 0 },
    costUsd: Number(cost.toFixed(5)),
  };
  if (args.includes('--json')) { console.log(JSON.stringify({ total, rows }, null, 2)); return; }
  console.log(`\n${n} cases, ${total.mode}\n`);
  console.log('| | Before | After |\n| --- | --- | --- |');
  console.log(`| Right decision | ${total.exactBefore}/${n} | ${total.exact}/${n} |`);
  console.log(`| Runs started | ${n} | ${total.newRuns[1]} |`);
  console.log(`| Steered right / must steer | 0/${total.mustSteer} | ${total.mustSteer - total.missedSteer}/${total.mustSteer} |`);
  console.log(`| Wrong steer (must be 0) | 0 | ${total.wrongSteer} |`);
  console.log(`| Questions answered aside / wrongly aside | 0/${total.mustAsk} / 0 | ${total.askRight}/${total.mustAsk} / ${total.askWrong} |`);
  console.log(`| By a rule / fell back | - | ${total.byRule} / ${total.fellBack} |`);
  console.log(`| Time (median / p90 / max) | - | ${total.ms.median} / ${total.ms.p90} / ${total.ms.max} ms |`);
  console.log(`| Cost | - | $${total.costUsd} |`);
  console.log('\nPer case:');
  for (const x of rows) {
    const mark = right(x) ? 'ok  ' : x.got.startsWith('steer') ? 'BAD ' : x.got === 'ask' ? 'ask?' : 'miss';
    const p = x.p ? Object.entries(x.p).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toFixed(2) : '-'}`).join(' ') : '';
    console.log(`${mark} ${x.ok.join('|').padEnd(13)} -> ${x.got.padEnd(8)} ${(x.by + (x.why ? `:${x.why}` : '')).padEnd(12)} ${String(x.ms).padStart(5)} ms ${p.padEnd(28)} ${x.bot}: ${x.text}`);
  }
})();

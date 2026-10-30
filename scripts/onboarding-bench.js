#!/usr/bin/env node
// The setup of a new project against ten asks (#805), over test/fixtures/onboarding-cases.json: each ask is read as
// POST /api/company/read reads it (lib/company-chief.js) and its team proposed as POST /api/company/proposal
// proposes it (lib/company-team.js), and checked: the shape fits the ask, 3 to 5 questions, a SWOT and stories only
// where they fit, and a team of as many bots as the ask needs.
//
//   node scripts/onboarding-bench.js          the stand-in for the model (a few keywords): checks the script
//   node scripts/onboarding-bench.js --live   the real models, through the Claude Code CLI ($CLAUDE_BIN or `claude`),
//                                             signed in as this machine is
//   --json                                    the rows as JSON
//
// It exits with 1 when a check fails.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chief = require('../lib/company-chief');
const team = require('../lib/company-team');
const { kindOf, nameFrom } = require('../lib/company');

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'onboarding-cases.json'), 'utf8'));

// The real model, asked as lib/dresser.js askClaude asks it.
function live(prompt, { llm, ms, system }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
    delete env.CLAUDECODE;
    const child = spawn(process.env.CLAUDE_BIN || 'claude', ['-p', '--output-format', 'stream-json', '--verbose', '--model', llm?.model || 'sonnet', '--system-prompt', system, '--setting-sources', '', '--tools', '', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config', '--no-session-persistence'], { cwd: require('os').tmpdir(), env, stdio: ['pipe', 'pipe', 'ignore'] });
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('no answer in time')); }, ms);
    let buf = '';
    child.stdout.on('data', (c) => {
      buf += c;
      for (let nl; (nl = buf.indexOf('\n')) >= 0; buf = buf.slice(nl + 1)) {
        let ev; try { ev = JSON.parse(buf.slice(0, nl)); } catch { continue; }
        if (ev.type === 'result') { clearTimeout(t); child.kill(); return ev.is_error ? reject(new Error(ev.result)) : resolve(ev.result); }
      }
    });
    child.on('close', () => { clearTimeout(t); reject(new Error('ended without an answer')); });
    child.stdin.end(prompt);
  });
}
// The stand-in: the shape from a few words, its own questions, and a team of its usual size.
async function fake(prompt, { system }) {
  const ask = (prompt.match(/(?:They started from|An existing company, at|A new project): (.*)/) || [])[1] || '';
  const shape = /homelab|proxmox|nas\b|flat|bills|library/i.test(ask) ? 'ops' : /wedding|fit\b|marathon|job/i.test(ask) ? 'goal' : 'venture';
  if (system === team.SYSTEM) {
    const n = /\.app\b/.test(ask) ? 3 : shape === 'venture' ? 3 : 1;
    return JSON.stringify({ bots: Array.from({ length: n }, (_, i) => ({ name: `Bot ${i + 1}`, description: 'One job', prompt: 'One job.', tools: ['Read'], team: 'Team' })) });
  }
  if (/existing company/.test(prompt)) return JSON.stringify({ name: 'Fernhill', about: 'Project management', serves: 'Agencies', today: '', questions: [], goal: [], never: [] });
  const s = chief.SHAPES[shape];
  return JSON.stringify({ name: 'X', shape, questions: s.questions.slice(0, 4), stories: s.stories, swot: s.swot, chips: {}, goal: [], never: [], time: [] });
}

(async () => {
  const ask = LIVE ? live : fake;
  const rows = [];
  for (const k of cases) {
    const kind = kindOf(k.ask);
    const c = { id: 'bench', kind, start: k.ask, name: nameFrom(kind, k.ask), phase: 'setup', about: [], stories: [], sources: [], never: [] };
    const help = chief.create({ ask, fetch: async () => k.page || null, workdir: '/nowhere' });
    const t0 = Date.now();
    const read = await help.read(c);
    const readMs = Date.now() - t0;
    const read2 = read ? { ...c, name: read.name || c.name, about: read.cards, ...(read.setup ? { setup: read.setup } : {}) } : c;
    const t1 = Date.now();
    let bots = 0;
    try { bots = (team.json(await ask(team.question(read2), { llm: { model: team.MODEL }, ms: 120_000, system: team.SYSTEM }))?.bots || []).slice(0, 5).length; } catch (e) { console.error(`team for "${k.ask}": ${e.message}`); }
    const teamMs = Date.now() - t1;
    const s = kind === 'site' ? null : read?.setup || null;
    const fails = [];
    if (!read) fails.push('no read');
    if (s) {
      if (!k.shape.includes(s.shape)) fails.push(`shape ${s.shape}`);
      if (s.questions.length < 3 || s.questions.length > 5) fails.push(`${s.questions.length} questions`);
      if (k.swot !== null && k.swot !== undefined && s.swot !== k.swot) fails.push(`swot ${s.swot}`);
      if (k.stories !== null && k.stories !== undefined && s.stories !== k.stories) fails.push(`stories ${s.stories}`);
    }
    if (bots < k.bots[0] || bots > k.bots[1]) fails.push(`${bots} bots`);
    rows.push({ ask: k.ask, shape: s?.shape || kind, questions: s?.questions || [], swot: s?.swot ?? null, stories: s?.stories ?? null, bots, readMs, teamMs, ok: !fails.length, fails });
    if (!args.includes('--json')) process.stderr.write('.');
  }
  const passed = rows.filter((r) => r.ok).length;
  if (args.includes('--json')) console.log(JSON.stringify({ mode: LIVE ? 'live' : 'stand-in', passed, of: rows.length, rows }, null, 2));
  else {
    console.log(`\n${passed}/${rows.length} asks pass, ${LIVE ? 'live' : 'stand-in'}\n`);
    console.log('| | Ask | Shape | Questions | SWOT | Stories | Bots | Read / team |\n| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) console.log(`| ${r.ok ? 'ok' : `FAIL: ${r.fails.join(', ')}`} | ${r.ask} | ${r.shape} | ${r.questions.join(', ')} | ${r.swot ?? '-'} | ${r.stories ?? '-'} | ${r.bots} | ${(r.readMs / 1000).toFixed(1)} / ${(r.teamMs / 1000).toFixed(1)} s |`);
  }
  process.exit(passed === rows.length ? 0 : 1);
})();

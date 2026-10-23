#!/usr/bin/env node
// Before and after the group router (ADR 081, #510), over the messages of test/fixtures/group-router-cases.json:
// a message of the owner's in a group, without a mention, and the members whose part it is to answer it.
//
//   node scripts/group-router-bench.js            the stand-in for the model (a few keywords): checks the script
//   node scripts/group-router-bench.js --live     the real model, through the Claude Code CLI ($CLAUDE_BIN or
//                                                 `claude`), signed in as this machine is
//   node scripts/group-router-bench.js --jev      Jev (TypeSafe) on OpenRouter instead, for comparison only:
//                                                 $OPENROUTER_API_KEY, or the key in the file $OPENROUTER_KEY_FILE.
//                                                 One yes/no question per member and one "for everyone", in one
//                                                 request; a member is picked at 0.5 or more, the two likeliest.
//   --pass=<s> --answer=<s>                       what a turn takes that passes, and one that answers (8 and 25)
//   --json                                        the numbers as JSON
//
// Before: every member has a turn, in the group's order (ADR 019). After: the members the router picked, best
// first, or every member when it picked none. A turn of a member that is neither expected nor fine to answer is a
// run that ends in a pass. The time to the first useful reply is the router's own time, the passes before the first
// member that answers, and that member's answer. A message whose expected member gets no turn is a miss: its time
// adds a second answer, the hand-on or the owner asking again.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const router = require('../lib/group-router');

const args = process.argv.slice(2);
const flag = (name, d) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.split('=')[1]) : d; };
const JEV = args.includes('--jev');
const LIVE = args.includes('--live') || JEV;
const T_PASS = flag('pass', 8);
const T_ANSWER = flag('answer', 25);
const { teams, cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'group-router-cases.json'), 'utf8'));
const membersOf = (team) => teams[team].map((b, i) => ({ id: `b${i}`, ...b }));

// The real model, asked as lib/dresser.js askClaude asks it for the router.
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
        if (ev.type === 'result') { clearTimeout(t); child.kill(); return ev.is_error ? reject(new Error(ev.result)) : resolve(ev.result); }
      }
    });
    child.on('close', () => { clearTimeout(t); reject(new Error('ended without an answer')); });
    child.stdin.end(prompt);
  });
}
// Jev on OpenRouter (https://openrouter.ai/docs/guides/community/jev). It answers no free text, so the bench asks it
// directly and hands route() an answer in the router's own JSON.
const JEV_MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.14';
const openRouterKey = () => (process.env.OPENROUTER_API_KEY || (process.env.OPENROUTER_KEY_FILE ? fs.readFileSync(process.env.OPENROUTER_KEY_FILE, 'utf8') : '')).trim();
let jevCase = null; // the message route() is asked about now: Jev reads it as data, not as the router's prompt
async function jev(_prompt, { ms }) {
  const { c, members } = jevCase;
  const about = (b) => [b.description, b.prompt && `Job: ${b.prompt}`, b.skills?.length && `Skills: ${b.skills.join(', ')}`].filter(Boolean).join(' ');
  const questions = { everyone: { type: 'noul', instructions: 'Is this message for every member of the group at once (a greeting, "everyone", a question each must answer for their own part)?', criteria: { true: 'Every member should answer.', false: 'It is the part of one or two members.' } } };
  members.forEach((b, i) => { questions[`m${i + 1}`] = { type: 'noul', instructions: `Is it the part of ${b.name} to answer this message? ${b.name}: ${about(b)}`, criteria: { true: `${b.name} should answer it.`, false: `It is another member's part, or ${b.name} would have nothing to add.` } }; });
  const state = { members: members.map((b) => ({ name: b.name, about: about(b) })), recent: c.recent || [], message: c.text };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${openRouterKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: JEV_MODEL, state, questions, provider: { data_collection: 'deny' } }) });
    const body = await res.json();
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    const a = body.answers || {};
    if ((a.everyone?.noul ?? 0) >= 0.5) return '{"members":[]}';
    const picked = members.map((_, i) => [i + 1, a[`m${i + 1}`]?.noul ?? 0]).filter(([, p]) => p >= 0.5).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([n]) => n);
    return JSON.stringify({ members: picked });
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'no answer in time' : e.message); } finally { clearTimeout(t); }
}
// The stand-in: a few words per member, and none for everyone.
const WORDS = { 'Infra Admin': /server|backup|disk|certificate|tls|deploy|memory|down|502/i, 'QA Tester': /test|reproduce|regression/i, 'Quotz Manager': /release|status|price|customer|acme|reply|hold/i, Coder: /implement|fix|crash|ci |build it/i, Reviewer: /review|security|have a look/i, Designer: /mockup|draw|button|empty state/i, 'Release Manager': /apk|ship|what's new|version/i };
async function fake(prompt) {
  const text = prompt.split('\n').find((l) => l.startsWith('The message: ')) || '';
  if (/everyone|everything|good morning/i.test(text)) return '{"members":[]}';
  const list = prompt.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, '').split(' | ')[0]);
  const hit = list.map((n, i) => (WORDS[n]?.test(text) ? i + 1 : 0)).filter(Boolean).slice(0, 2);
  return JSON.stringify({ members: hit });
}

// One message, as a line of turns: what it costs and when its first useful reply comes.
function measure(c, line, members, routerMs) {
  const name = (id) => members.find((b) => b.id === id).name;
  const fine = new Set([...c.expect, ...c.ok]);
  const passes = line.filter((id) => !fine.has(name(id))).length;
  const first = line.findIndex((id) => fine.has(name(id)));
  const missed = !c.expect.some((n) => line.map(name).includes(n));
  const t = routerMs / 1000 + (first < 0 ? line.length * T_PASS + 2 * T_ANSWER : first * T_PASS + T_ANSWER + (missed ? T_ANSWER : 0));
  return { runs: line.length, passes, first: t, hit: c.expect.every((n) => line.map(name).includes(n)), needless: line.some((id) => !fine.has(name(id))) };
}

(async () => {
  if (JEV && !openRouterKey()) { console.error('--jev needs OPENROUTER_API_KEY or OPENROUTER_KEY_FILE.'); process.exit(1); }
  const r = router.create({ ask: JEV ? jev : LIVE ? live : fake, ms: Number(process.env.BOT_DOT_GROUP_ROUTER_MS) || (LIVE ? router.MS : 1000) });
  const rows = [];
  for (const c of cases) {
    const members = membersOf(c.team);
    const all = members.map((b) => b.id);
    const before = measure(c, all, members, 0);
    jevCase = { c, members };
    const d = await r.route({ text: c.text, members, recent: c.recent || [] });
    const after = measure(c, d.picked || all, members, d.ms);
    rows.push({ text: c.text, team: c.team, picked: d.picked ? d.picked.map((id) => members.find((b) => b.id === id).name) : `all (${d.fell})`, ms: d.ms, before, after });
    if (!args.includes('--json')) process.stderr.write('.');
  }
  const sum = (k, side) => rows.reduce((s, x) => s + Number(x[side][k]), 0);
  const avg = (k, side) => sum(k, side) / rows.length;
  const lat = rows.map((x) => x.ms).sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
  const total = {
    messages: rows.length, mode: JEV ? `jev (${JEV_MODEL})` : LIVE ? 'live' : 'stand-in', tPass: T_PASS, tAnswer: T_ANSWER,
    runsPerMessage: [avg('runs', 'before'), avg('runs', 'after')],
    passRuns: [sum('passes', 'before'), sum('passes', 'after')],
    firstUsefulS: [avg('first', 'before'), avg('first', 'after')],
    routerMs: { median: pct(0.5), p90: pct(0.9), max: lat.at(-1) },
    rightIncluded: [sum('hit', 'before'), sum('hit', 'after')],
    noNeedless: [rows.length - sum('needless', 'before'), rows.length - sum('needless', 'after')],
    fellBack: rows.filter((x) => typeof x.picked === 'string').length,
  };
  if (args.includes('--json')) { console.log(JSON.stringify({ total, rows }, null, 2)); return; }
  const f = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  console.log(`\n${total.messages} messages, ${total.mode}; a pass takes ${T_PASS} s, an answer ${T_ANSWER} s\n`);
  console.log('| | Before | After |\n| --- | --- | --- |');
  console.log(`| Runs per message | ${f(total.runsPerMessage[0])} | ${f(total.runsPerMessage[1])} |`);
  console.log(`| Runs ending in PASS | ${total.passRuns[0]} | ${total.passRuns[1]} |`);
  console.log(`| First useful reply, average | ${f(total.firstUsefulS[0])} s | ${f(total.firstUsefulS[1])} s |`);
  console.log(`| Router time (median / p90 / max) | - | ${total.routerMs.median} / ${total.routerMs.p90} / ${total.routerMs.max} ms |`);
  console.log(`| Right member included | ${total.rightIncluded[0]}/${total.messages} | ${total.rightIncluded[1]}/${total.messages} |`);
  console.log(`| No needless member | ${total.noNeedless[0]}/${total.messages} | ${total.noNeedless[1]}/${total.messages} |`);
  console.log(`| Fell back to every member | - | ${total.fellBack} |`);
  console.log('\nPer message (after):');
  for (const x of rows) console.log(`${x.after.hit ? 'ok  ' : 'MISS'} ${x.after.needless ? '+extra ' : '       '}${String(x.ms).padStart(5)} ms  ${x.team}: ${x.text}  ->  ${Array.isArray(x.picked) ? x.picked.join(', ') : x.picked}`);
})();

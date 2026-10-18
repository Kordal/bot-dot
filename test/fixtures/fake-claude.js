#!/usr/bin/env node
// A stand-in for the Claude Code CLI, for the tests: no model, no cost. Each run writes what it was
// given to $FAKE_OUT/run-<n>.json, once its stdin has ended (arguments, the self tools' env, the system prompt read
// from its private file and that file's path and mode, the CLAUDE_CODE_ variables of its environment, stdin), then
// answers with $FAKE_OUT/result.txt (or "Done."), with the refused tools in $FAKE_OUT/denials.json, or fails with $FAKE_OUT/fail.txt on stderr, or ends with no result line at all while $FAKE_OUT/no-result exists. While $FAKE_OUT/hold exists, a run keeps going until
// $FAKE_OUT/done-<n> appears, so a test can use its run token meanwhile. A run ends when the process that started it is gone.
// One bot of several (a group's members): a file named for the bot goes before the one for all. The bot is named as a
// mention names it, its name without spaces and signs ("Issue Writer" is IssueWriter): result-<Bot>.txt is its
// reply, so "PASS" there makes it pass and "@Reviewer have a look" makes it name a member; fail-<Bot>.txt makes its
// run fail; and while hold-<Bot> exists its runs are held as `hold` holds every run.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
// Signed in, unless $FAKE_OUT/signed-out exists (a test writes and removes it). While $FAKE_OUT/auth-fails exists the
// check fails without a word, and while $FAKE_OUT/auth-unreadable exists a line stands before its answer.
// $FAKE_OUT/auth-fails-next lets one more check answer before the checks fail.
const has = (name) => !!process.env.FAKE_OUT && fs.existsSync(path.join(process.env.FAKE_OUT, name));
// `auth login` shows its sign-in link and ends once a code arrives on its stdin, as Claude Code does. Whether that
// signed it in is what the check says afterwards.
if (args[0] === 'auth' && args[1] === 'login') {
  console.log('Open https://claude.example/oauth/authorize?client=fake to sign in.');
  process.stdin.once('data', () => process.exit(0));
  return;
}
if (args[0] === 'auth' && has('auth-fails')) process.exit(1);
if (args[0] === 'auth' && args[1] === 'status' && has('auth-fails-next')) fs.renameSync(path.join(process.env.FAKE_OUT, 'auth-fails-next'), path.join(process.env.FAKE_OUT, 'auth-fails'));
if (args[0] === 'auth' && has('auth-unreadable')) console.log('Warning: a newer version of Claude Code is available.');
// A check that is late: when $FAKE_OUT/auth-late exists, the next check takes it as auth-late-held, sees the sign-in as
// it is then, and answers that only once the test removes auth-late-held.
if (args[0] === 'auth' && args[1] === 'status' && has('auth-late')) {
  const held = path.join(process.env.FAKE_OUT, 'auth-late-held');
  fs.renameSync(path.join(process.env.FAKE_OUT, 'auth-late'), held);
  const answer = JSON.stringify(has('signed-out') ? { loggedIn: false } : { loggedIn: true, email: 'test@example.com' });
  const t = setInterval(() => { if (!fs.existsSync(held)) { clearInterval(t); console.log(answer); } }, 10);
  return;
}
if (args[0] === 'auth') { console.log(JSON.stringify(process.env.FAKE_OUT && fs.existsSync(path.join(process.env.FAKE_OUT, 'signed-out')) ? { loggedIn: false } : { loggedIn: true, email: 'test@example.com' })); process.exit(0); }
if (args.includes('--version')) { console.log('2.1.280 (fake)'); process.exit(0); }
if (args.includes('--help')) { console.log('  --effort <level>  Effort (low, medium, high, xhigh, max)'); process.exit(0); }
// The appended prompt comes in a file (ADR 014). While $FAKE_OUT/old-claude exists this is a Claude Code from
// before that flag, and says what such a one says. A file that is not there is said as Claude Code says it: that
// is how botdot asks whether the flag is known (lib/setup.js claudeCode), with no stdin and no run.
const promptFile = args.includes('--append-system-prompt-file') ? args[args.indexOf('--append-system-prompt-file') + 1] : null;
if (promptFile !== null && has('old-claude')) { console.error("error: unknown option '--append-system-prompt-file'"); process.exit(1); }
if (promptFile !== null && !fs.existsSync(promptFile)) { console.error(`Error: Append system prompt file not found: ${promptFile}`); process.exit(1); }

const OUT = process.env.FAKE_OUT;
// The bot this run is of, from the session's name ("<emoji> <name>"), as a mention names it; '' when it has none.
const who = (() => { const i = args.indexOf('--name'); return i < 0 ? '' : String(args[i + 1] || '').replace(/^\S+\s+/, '').replace(/[^\p{L}\p{N}_-]/gu, ''); })();
const own = (name, ext = '') => (who && fs.existsSync(path.join(OUT, `${name}-${who}${ext}`)) ? `${name}-${who}${ext}` : `${name}${ext}`);
const n = `${Date.now()}-${process.pid}`;
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
let mcp = { mcpServers: {} };
try { const mc = val('--mcp-config'); mcp = JSON.parse(mc.trim().startsWith('{') ? mc : fs.readFileSync(mc, 'utf8')); } catch { /* none */ }
// system: the appended prompt, read now from its file: botdot removes the file when the run has ended.
const rec = { n, who, args, self: mcp.mcpServers.self || null, botdot: mcp.mcpServers.botdot || null, connectors: mcp.mcpServers.connectors || null, system: promptFile === null ? val('--append-system-prompt') : fs.readFileSync(promptFile, 'utf8'), stdin: '', at: Date.now() };
if (promptFile !== null) { const st = fs.statSync(promptFile); rec.promptFile = { path: promptFile, mode: st.mode & 0o777, uid: st.uid }; }
rec.env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('CLAUDE_CODE_'))); // Claude Code's own switches
rec.uid = process.getuid?.();
rec.cwd = process.cwd();
rec.path = process.env.PATH; // where its commands are looked for (a bot's installed tools come first)
// The skills of the plugins it was given (each --plugin-dir), as Claude Code lists them when it starts: "<plugin>:<skill>".
let skills = [];
const pluginDirs = args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1]] : []));
for (const dir of pluginDirs) {
  try {
    const plugin = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
    rec.pluginReadable = rec.pluginReadable !== false;
    skills.push(...fs.readdirSync(path.join(dir, 'skills')).filter((name) => fs.existsSync(path.join(dir, 'skills', name, 'SKILL.md'))).map((name) => `${plugin.name}:${name}`));
  } catch { rec.pluginReadable = false; }
}
skills.sort();
rec.skills = skills;
rec.keyNames = Object.keys(process.env).filter((k) => /_KEY$/i.test(k));
rec.procKeyNames = process.platform === 'linux' ? fs.readFileSync('/proc/self/environ', 'utf8').split('\0').map((v) => v.split('=')[0]).filter((k) => /_KEY$/i.test(k)) : [];
const save = () => fs.writeFileSync(path.join(OUT, `run-${n}.json`), JSON.stringify(rec));
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: `fake-${n}`, model: 'fake-model', skills }));

// A run whose server is gone (killed, or its test over) has nobody to answer: it ends, rather than hold for hours.
const parent = process.ppid;
setInterval(() => { if (process.ppid !== parent) process.exit(1); }, 50).unref();

let finished = false;
const finish = () => {
  if (finished) return;
  finished = true;
  try { process.stderr.write(fs.readFileSync(path.join(OUT, own('fail', '.txt')), 'utf8')); process.exit(1); } catch { /* it succeeds */ }
  if (fs.existsSync(path.join(OUT, 'no-result'))) process.exit(0); // like a Claude Code whose output botdot can't read
  let result = 'Done.';
  try { result = fs.readFileSync(path.join(OUT, own('result', '.txt')), 'utf8'); } catch { /* the default */ }
  let denials = []; // the tools its settings refused, as Claude Code reports them: $FAKE_OUT/denials.json
  try { denials = JSON.parse(fs.readFileSync(path.join(OUT, 'denials.json'), 'utf8')); } catch { /* none */ }
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, session_id: `fake-${n}`, total_cost_usd: 0.01, num_turns: 1, duration_ms: 5, permission_denials: denials }));
  process.exit(0);
};
const released = () => !(fs.existsSync(path.join(OUT, 'hold')) || (who && fs.existsSync(path.join(OUT, `hold-${who}`)))) || fs.existsSync(path.join(OUT, `done-${n}`));
// The record is written once the whole prompt is in, so a test never sees a run with its stdin missing.
process.stdin.on('data', (c) => { rec.stdin += c; });
process.stdin.on('end', () => {
  save();
  // Optional tool events, emitted before a held reply finishes.
  const eventsFile = path.join(OUT, 'events.json');
  if (fs.existsSync(eventsFile)) {
    for (const event of JSON.parse(fs.readFileSync(eventsFile, 'utf8'))) console.log(JSON.stringify(event));
  }
  let emitted = 0;
  const t = setInterval(() => {
    // Per-process append-only events let tests advance a held tool through its lifecycle.
    try {
      const events = JSON.parse(fs.readFileSync(path.join(OUT, `events-${n}.json`), 'utf8'));
      for (; emitted < events.length; emitted++) console.log(JSON.stringify(events[emitted]));
    } catch { /* no events yet */ }
    if (released()) { clearInterval(t); finish(); }
  }, 50);
});
// While $FAKE_OUT/ignore-term exists a run does not end when asked to (SIGTERM): botdot has to kill it.
process.on('SIGTERM', () => { if (!fs.existsSync(path.join(OUT, 'ignore-term'))) process.exit(143); });

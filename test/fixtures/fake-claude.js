#!/usr/bin/env node
// A stand-in for the Claude Code CLI, for the tests: no model, no cost. Each run writes what it was
// given to $FAKE_OUT/run-<n>.json, once its stdin has ended (arguments, the self tools' env, the system prompt read
// from its private file and that file's path and mode, the CLAUDE_CODE_ variables of its environment, stdin), then
// answers with $FAKE_OUT/result.txt (or "Done."), with the refused tools in $FAKE_OUT/denials.json (for which it asks with ask_permission, unless $FAKE_OUT/no-ask exists), or fails with $FAKE_OUT/fail.txt on stderr, or ends with no result line at all while $FAKE_OUT/no-result exists. While $FAKE_OUT/hold exists, a run keeps going until
// $FAKE_OUT/done-<n> appears, so a test can use its run token meanwhile. A run ends when the process that started it is gone.
// While $FAKE_OUT/linger exists, a run that wrote its result line stays on until the file is gone, as Claude Code takes
// a moment to exit (#207); $FAKE_OUT/error-result.txt makes the result line an error with that text (is_error), and
// $FAKE_OUT/error-result-once.txt the next run's only.
// One bot of several (a group's members): a file named for the bot goes before the one for all. The bot is named as a
// mention names it, its name without spaces and signs ("Issue Writer" is IssueWriter): result-<Bot>.txt is its
// reply, so "PASS" there makes it pass and "@Reviewer have a look" makes it name a member; fail-<Bot>.txt makes its
// run fail; and while hold-<Bot> exists its runs are held as `hold` holds every run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
// What every result line reports as used (Token usage, #301).
const USAGE = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 };
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
// The group router's question (lib/group-router.js, ADR 081), told by its own system prompt: no run. It writes what
// it was asked to $FAKE_OUT/route-<n>.txt, then answers $FAKE_OUT/route.txt (or '{"members":[]}'), after
// $FAKE_OUT/route-ms.txt ms when that exists, or fails when $FAKE_OUT/route-fails exists.
if (String(val('--system-prompt') || '').startsWith('You route messages')) {
  let asked = '';
  process.stdin.on('data', (c) => { asked += c; });
  process.stdin.on('end', () => {
    const at = `${Date.now()}-${process.pid}`;
    fs.writeFileSync(path.join(OUT, `route-${at}.txt`), asked);
    const read = (f, d) => { try { return fs.readFileSync(path.join(OUT, f), 'utf8'); } catch { return d; } };
    setTimeout(() => {
      if (has('route-fails')) { console.error('overloaded'); process.exit(1); }
      console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: read('route.txt', '{"members":[]}'), session_id: `route-${at}`, usage: { input_tokens: 300, output_tokens: 10 } }));
      process.exit(0);
    }, Number(read('route-ms.txt', '0')) || 0);
  });
  return;
}
// The wake gate's question (lib/wake-gate.js, ADR 083), told by its own system prompt: no run. It writes what it was
// asked to $FAKE_OUT/gate-<n>.txt and answers $FAKE_OUT/gate.txt (or '{"decision":"run"}').
if (String(val('--system-prompt') || '').startsWith('You decide whether a message to an AI bot')) {
  let asked = '';
  process.stdin.on('data', (c) => { asked += c; });
  process.stdin.on('end', () => {
    const at = `${Date.now()}-${process.pid}`;
    fs.writeFileSync(path.join(OUT, `gate-${at}.txt`), asked);
    let answer = '{"decision":"run"}';
    try { answer = fs.readFileSync(path.join(OUT, 'gate.txt'), 'utf8'); } catch { /* run */ }
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: `gate-${at}`, usage: { input_tokens: 300, output_tokens: 10 } }));
    process.exit(0);
  });
  return;
}
// A replay's judge (lib/replay.js, ADR 101), told by its own system prompt: no run. It writes what it was asked to
// $FAKE_OUT/judge-<n>.txt and picks the reply that holds the text of $FAKE_OUT/judge-picks.txt (or neither).
if (String(val('--system-prompt') || '').startsWith('You compare two replies')) {
  let asked = '';
  process.stdin.on('data', (c) => { asked += c; });
  process.stdin.on('end', () => {
    const at = `${Date.now()}-${process.pid}`;
    fs.writeFileSync(path.join(OUT, `judge-${at}.txt`), asked);
    let pick = '';
    try { pick = fs.readFileSync(path.join(OUT, 'judge-picks.txt'), 'utf8').trim(); } catch { /* neither */ }
    const reply = (k) => (asked.match(new RegExp(`<reply-${k}>([\\s\\S]*?)</reply-${k}>`)) || [])[1] || '';
    const better = !pick ? 0 : reply(1).includes(pick) ? 1 : reply(2).includes(pick) ? 2 : 0;
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ better, why: 'fake' }), session_id: `judge-${at}`, usage: { input_tokens: 300, output_tokens: 10 } }));
    process.exit(0);
  });
  return;
}
let mcp = { mcpServers: {} };
try { const mc = val('--mcp-config'); mcp = JSON.parse(mc.trim().startsWith('{') ? mc : fs.readFileSync(mc, 'utf8')); } catch { /* none */ }
// system: the appended prompt, read now from its file: botdot removes the file when the run has ended.
const rec = { n, who, args, self: mcp.mcpServers.self || null, botdot: mcp.mcpServers.botdot || null, connectors: mcp.mcpServers.connectors || null, system: promptFile === null ? val('--append-system-prompt') : fs.readFileSync(promptFile, 'utf8'), stdin: '', at: Date.now() };
if (promptFile !== null) { const st = fs.statSync(promptFile); rec.promptFile = { path: promptFile, mode: st.mode & 0o777, uid: st.uid }; }
// The settings it was given (--settings, a private file): botdot's hook for a steered message (ADR 040), and that file's mode.
const settingsArg = val('--settings');
if (settingsArg) { try { rec.settings = JSON.parse(fs.readFileSync(settingsArg, 'utf8')); rec.settingsMode = fs.statSync(settingsArg).mode & 0o777; } catch { rec.settings = null; } }
rec.env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('CLAUDE_CODE_'))); // Claude Code's own switches
rec.git = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(GIT_|SSH_AUTH_SOCK$|BOTDOT_)/.test(k))); // where git stops, whose identity it has and how it signs in (ADR 090)
rec.apiKey = process.env.ANTHROPIC_API_KEY || null; // the Anthropic API key it runs on, in API-key mode only (#35)
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
  // A run that has the library skill <name> answers $FAKE_OUT/result-with-<name>.txt when there is one (a replay's candidate, ADR 101).
  for (const k of skills) { try { result = fs.readFileSync(path.join(OUT, `result-with-${k.replace(/^[^:]*:/, '')}.txt`), 'utf8'); break; } catch { /* not this one */ } }
  let denials = []; // the tools its settings refused, as Claude Code reports them: $FAKE_OUT/denials.json
  try { denials = JSON.parse(fs.readFileSync(path.join(OUT, 'denials.json'), 'utf8')); } catch { /* none */ }
  let failed = null;
  try { failed = fs.readFileSync(path.join(OUT, 'error-result.txt'), 'utf8'); } catch { /* it succeeds */ }
  // $FAKE_OUT/error-result-once.txt: the same, for this run only (the file goes with it).
  try { failed = fs.readFileSync(path.join(OUT, 'error-result-once.txt'), 'utf8'); fs.rmSync(path.join(OUT, 'error-result-once.txt')); } catch { /* none */ }
  // A refused tool asks nobody by itself (#279): like a bot that follows its prompt, this one asks the owner for each
  // permission it was refused with ask_permission, once, before it ends; not while $FAKE_OUT/no-ask exists.
  // Its tool calls first, through the PreToolUse hooks its settings name, as Claude Code runs them (ADR 067).
  const hooked = preToolHooks();
  const asked = hooked.then(() => (denials.length && !fs.existsSync(path.join(OUT, 'no-ask')) ? askFor(denials) : undefined));
  const end = () => {
    console.log(JSON.stringify(failed === null
      ? { type: 'result', subtype: 'success', is_error: false, result, session_id: `fake-${n}`, total_cost_usd: 0.01, usage: USAGE, num_turns: 1, duration_ms: 5, permission_denials: denials }
      : { type: 'result', subtype: 'success', is_error: true, result: failed, session_id: `fake-${n}`, total_cost_usd: 0.01, usage: USAGE, num_turns: 1, duration_ms: 5 }));
    const gone = () => { if (!fs.existsSync(path.join(OUT, 'linger'))) process.exit(failed === null ? 0 : 1); };
    gone();
    setInterval(gone, 20);
  };
  let stream = null;
  try { stream = JSON.parse(fs.readFileSync(path.join(OUT, own('stream', '.json')), 'utf8')); } catch { /* the reply comes whole */ }
  asked.then(() => (stream ? streamed(stream, result, end) : end()));
};
// The tool calls of $FAKE_OUT/tool-calls.json ([{ tool_name, tool_input }]), each handed to every PreToolUse command
// hook of its settings on stdin, as Claude Code does: what each hook said is on the record, `hooks`: [{ tool, code,
// stderr }]. Exit 2 blocks the call; the fake makes no call either way.
function preToolHooks() {
  let calls = [];
  try { calls = JSON.parse(fs.readFileSync(path.join(OUT, 'tool-calls.json'), 'utf8')); } catch { return Promise.resolve(); }
  const commands = (rec.settings?.hooks?.PreToolUse || []).flatMap((m) => (m.hooks || []).filter((h) => h.type === 'command').map((h) => h.command));
  if (!commands.length) return Promise.resolve();
  rec.hooks = [];
  const one = (command, call) => new Promise((resolve) => {
    const child = require('child_process').spawn('sh', ['-c', command], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => { rec.hooks.push({ tool: call.tool_name, code, stderr: stderr.trim() }); save(); resolve(); });
    child.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', ...call }));
  });
  return calls.reduce((p, call) => p.then(() => commands.reduce((q, c) => q.then(() => one(c, call)), Promise.resolve())), Promise.resolve());
}
// What a bot's ask_permission sends for the tools it was refused (lib/self-mcp.js): one ask per permission, with what
// it tried as its reason. What botdot refuses (asked lately, declined this week) the bot is told, and it goes on.
const PERMISSION_OF = { Bash: 'commands', Edit: 'files', Write: 'files', MultiEdit: 'files', NotebookEdit: 'files', WebSearch: 'web', WebFetch: 'web', Agent: 'helpers', Task: 'helpers' };
async function askFor(denials) {
  const env = rec.self?.env;
  if (!env?.SELF_URL || !env.RUN_TOKEN || env.SELF_CAN_EDIT === '0') return; // not in the memory review, which keeps to its tools
  const seen = new Set();
  for (const d of denials) {
    const permission = PERMISSION_OF[d.tool_name];
    if (!permission || seen.has(permission)) continue;
    seen.add(permission);
    const what = d.tool_input?.description || d.tool_input?.command || d.tool_input?.url || d.tool_input?.query || d.tool_input?.file_path || '';
    const reason = what ? `It tried to: ${String(what).replace(/\s+/g, ' ').slice(0, 200)}` : '';
    try {
      await fetch(`${env.SELF_URL}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Run-Token': env.RUN_TOKEN }, body: JSON.stringify({ kind: 'permission', permission, reason }) });
    } catch { /* botdot is gone */ }
  }
}
// A reply written as Claude Code writes it with --include-partial-messages, while $FAKE_OUT/stream.json (or
// stream-<Bot>.json) exists: { chunk, everyMs, before: [text, …], partial, pauseAfter, endMs }. Each text of `before` is a
// message of its own that a tool call (Bash) follows, then the reply is a message whose text comes in `text_delta`s of
// `chunk` characters, `everyMs` apart, and ends its turn; each message then comes whole (`assistant`), as Claude Code
// sends it too. partial: false leaves the partial lines out (a Claude Code without the flag); after `pauseAfter`
// deltas the reply waits while $FAKE_OUT/stream-hold exists, and its result line comes `endMs` after its last line.
// The partial lines come only when botdot asked for them.
function streamed({ chunk = 8, everyMs = 20, before = [], partial = true, pauseAfter = -1, endMs = 250 }, reply, end) {
  const partials = partial && args.includes('--include-partial-messages');
  const line = (ev) => console.log(JSON.stringify({ ...ev, session_id: `fake-${n}`, parent_tool_use_id: null }));
  const say = (event) => { if (partials) line({ type: 'stream_event', event, uuid: crypto.randomUUID() }); };
  const steps = []; // what is written, in order: [what, how long to wait before it]; 'pause' waits for stream-hold
  const message = (text, tool) => {
    steps.push([() => say({ type: 'message_start', message: { role: 'assistant', content: [] } })]);
    steps.push([() => say({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })]);
    for (let i = 0; i < text.length; i += chunk) {
      const piece = text.slice(i, i + chunk);
      steps.push([() => say({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }), everyMs]);
      if (!tool && i / chunk + 1 === pauseAfter) steps.push(['pause']);
    }
    steps.push([() => say({ type: 'content_block_stop', index: 0 })]);
    const content = [{ type: 'text', text }];
    if (tool) {
      steps.push([() => say({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: tool, name: 'Bash', input: {} } })]);
      steps.push([() => say({ type: 'content_block_stop', index: 1 })]);
      content.push({ type: 'tool_use', id: tool, name: 'Bash', input: { command: 'true' } });
    }
    steps.push([() => say({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' } })]);
    steps.push([() => say({ type: 'message_stop' })]);
    steps.push([() => line({ type: 'assistant', message: { role: 'assistant', content } })]);
    if (tool) steps.push([() => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool, content: '' }] } })]);
  };
  before.forEach((text, i) => message(text, `tool-${i}`));
  message(reply, null);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    for (const [step, ms = 0] of steps) {
      if (step === 'pause') { while (fs.existsSync(path.join(OUT, 'stream-hold'))) await wait(20); continue; }
      if (ms) await wait(ms);
      step();
    }
    await wait(endMs);
    end();
  })();
}
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

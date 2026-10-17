// Live memory conversations: real bots and the real Chief (the Claude CLI, signed in as you) on isolated
// botdot servers with made-up data. Two sides of memory, measured and not asserted:
// - reading: whether they remember, correct and keep apart what they were told, across fresh conversations and
//   restarts (SCENARIOS below). Answers are graded from a last line "ANSWER: …" each question asks for. Every
//   question result keeps its prompt, answer, tool calls, the records recall returned, time taken and context used.
// - writing: what a bot saves after one short conversation (WRITE_SCENARIOS in grading.js), graded on the store
//   afterwards: a note or none, for whom, how many.
// Not part of npm test; costs real model usage.
//
//   BOT_DOT_TEST_LIVE_CLAUDE=1 npm run test:live
//
// BOT_DOT_TEST_LIVE_REPEAT (default 3): runs of each scenario. BOT_DOT_TEST_LIVE_ONLY: scenario names,
// comma separated. BOT_DOT_TEST_LIVE_OUT: folder for results.json and report.md (default: a temp folder).
// BOT_DOT_TEST_LIVE_PARALLEL (default 3): scenarios running at once.
//
// The baseline is test/live/baseline.json, with its report baseline.md. A later run next to it, with a verdict per
// question and per write-side scenario (better, the same, worse):
//   node test/live/report.js --compare test/live/baseline.json <out>/results.json
// A baseline holds for one Claude model. The servers' data is in the system's temporary folder (TMPDIR): keep that
// outside any checkout, because Claude Code loads a CLAUDE.md that stands above a bot's folder into its run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer, makeBot, waitFor } = require('../helpers');
const { DAYS } = require('../../lib/chat-history');
const { report } = require('./report');
const { conversationOf, heldIn, valuesOf, grade, WRITE_SCENARIOS, WRITER } = require('./grading');

const LIVE = process.env.BOT_DOT_TEST_LIVE_CLAUDE === '1';
const REPEAT = Math.max(1, Number(process.env.BOT_DOT_TEST_LIVE_REPEAT) || 3);
const PARALLEL = Math.max(1, Number(process.env.BOT_DOT_TEST_LIVE_PARALLEL) || 3);
const ONLY = (process.env.BOT_DOT_TEST_LIVE_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const RUN_TIMEOUT = 15 * 60_000;
// A bot is handed its chat of the last DAYS days with every message (lib/chat-history.js). An exchange older than
// that is outside the block: what was said in it has to be found in memory.
const FRESH = DAYS + 1;

// ---------- test data ----------

const digits = (n) => Array.from({ length: n }, (_, i) => crypto.randomInt(i ? 0 : 1, 10)).join('');
const letters = (n) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[crypto.randomInt(23)]).join('');
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
const ask = (q) => `${q}\n\nEnd your reply with one last line in exactly this form: ANSWER: <the answer>, or ANSWER: unknown if you don't know.`;
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const answerOf = (text) => [...String(text || '').matchAll(/ANSWER:\s*\**\s*(.+)/gi)].pop()?.[1].replace(/\*+/g, '').trim() ?? null;
const graded = (answer, expected) => (answer === null ? false : expected === 'unknown' ? /^unknown\b/i.test(answer) : norm(answer).includes(norm(expected)));

// ---------- a live server ----------

function realClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const p of [path.join(os.homedir(), '.local', 'bin', 'claude'), path.join(os.homedir(), '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) if (fs.existsSync(p)) return p;
  return 'claude';
}

// What botdot starts in place of Claude: a script that keeps the prompt botdot appended, one file per start in
// `prompts`, and then becomes the real Claude with the same arguments. The prompt comes as an argument, or as a
// file that is gone when the run has ended (MEM-002): either way it is what this run was really given.
function recorder(dir, claude) {
  const prompts = path.join(dir, 'prompts');
  fs.mkdirSync(prompts, { recursive: true });
  const quoted = (t) => `'${String(t).replace(/'/g, "'\\''")}'`;
  const bin = path.join(dir, 'claude-recorded');
  fs.writeFileSync(bin, `#!/bin/sh
prev=
for a in "$@"; do
  case "$prev" in
    --append-system-prompt) printf '%s' "$a" > ${quoted(prompts)}/$$-$(date +%s).txt ;;
    --append-system-prompt-file) cat "$a" > ${quoted(prompts)}/$$-$(date +%s).txt ;;
  esac
  prev=$a
done
exec ${quoted(claude)} "$@"
`, { mode: 0o755 });
  return { bin, prompts };
}

// A botdot server running the real Claude CLI with your own sign-in (your HOME), on scratch data.
// restart(): the same data on a fresh server process; age(botId, days): its runs as if made days ago, by default
// past the window of the conversation block, so that the next question is a fresh conversation; prompts: the
// folder of the prompts its runs were started with (recorder); close(): stop it.
async function liveServer(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const { bin, prompts } = recorder(dir, realClaude());
  const env = { CLAUDE_BIN: bin, HOME: os.homedir(), ...(process.env.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN } : {}) };
  const s = { srv: await startServer({ dir, env }), prompts };
  s.api = (...a) => s.srv.api(...a);
  s.data = s.srv.data;
  s.restart = async () => { await s.srv.stop(); s.srv = await startServer({ dir, env }); };
  s.age = async (botId, days = FRESH) => {
    await s.srv.stop();
    const runs = path.join(s.data, 'runs');
    for (const f of fs.readdirSync(runs).filter((x) => x.endsWith('.json'))) {
      const file = path.join(runs, f);
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (m.botId !== botId) continue;
      const shift = days * 864e5;
      for (const k of ['startedAt', 'endedAt']) if (m[k]) m[k] = new Date(Date.parse(m[k]) - shift).toISOString();
      fs.writeFileSync(file, JSON.stringify(m, null, 2));
    }
    s.srv = await startServer({ dir, env });
  };
  s.close = () => s.srv.stop();
  return s;
}

// A finished run written straight to the data folder, as if a bot made it days ago (the index picks it up
// on the next start). For facts that should live only in a past run: so never younger than FRESH days, or the
// conversation block would hand it to the bot that is asked about it.
function seedRun(data, bot, { prompt, result, days = FRESH }) {
  const at = daysAgo(days);
  const id = `${at.replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 6)}`;
  const meta = { id, botId: bot.id, botName: bot.name, botEmoji: bot.emoji, botColor: bot.color, prompt, customPrompt: true, trigger: 'manual', status: 'success', startedAt: at, endedAt: at, durationMs: 1000, numTurns: 1, result };
  fs.writeFileSync(path.join(data, 'runs', `${id}.json`), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(data, 'runs', `${id}.ndjson`), [{ type: 'run_start', meta }, { type: 'result', subtype: 'success', result }, { type: 'run_end', status: 'success', meta }].map((e) => JSON.stringify(e)).join('\n') + '\n');
  return id;
}

// ---------- what a conversation did ----------

// Tool calls, the records recall returned, and context used, from Claude's stream-json events.
function trace(events) {
  const calls = [];
  const byId = new Map();
  let context = 0;
  let output = 0;
  let model = null;
  for (const e of events) {
    const msg = e.message;
    if (e.type === 'assistant' && msg) {
      model ||= msg.model || null;
      const u = msg.usage;
      if (u) {
        context = Math.max(context, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0));
        output += u.output_tokens || 0;
      }
      for (const c of msg.content || []) {
        if (c.type !== 'tool_use') continue;
        const call = { name: c.name.replace(/^mcp__(self|botdot)__/, ''), input: c.input, result: null };
        calls.push(call);
        byId.set(c.id, call);
      }
    }
    if (e.type === 'user' && msg) {
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c.type !== 'tool_result' || !byId.has(c.tool_use_id)) continue;
        byId.get(c.tool_use_id).result = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('') : String(c.content || '');
      }
    }
  }
  const recalled = [];
  for (const c of calls.filter((x) => x.name === 'recall' && x.result)) {
    let json = null;
    try { json = JSON.parse(c.result); } catch { /* a bot's recall is text */ }
    if (json?.results) for (const r of json.results) recalled.push({ kind: r.kind, id: r.kind === 'run' ? r.runId : r.kind === 'old' ? r.noteId : r.id, text: r.text || r.excerpt || '' });
    else {
      for (const m of c.result.matchAll(/^- (earlier version of note|note) \[([\w-]+)\] \(.*?\): (.*)$/gm)) recalled.push({ kind: m[1] === 'note' ? 'note' : 'old', id: m[2], text: m[3] });
      for (const m of c.result.matchAll(/^- past run ([\w-]+) .*\n {2}(.*)$/gm)) recalled.push({ kind: 'run', id: m[1], text: m[2] });
    }
  }
  return { calls: calls.map(({ name, input }) => ({ name, input })), recalled, contextTokens: context, outputTokens: output, model };
}

// Claude CLIs starting at once can trip over refreshing the same sign-in ("Not logged in"). That's not
// memory at work: such a question is asked again, up to twice, and the retries are counted in the report.
const signInRace = (r) => r.status !== 'success' && /not logged in|please run \/login/i.test(r.text);
async function retried(fn) {
  for (let i = 0; ; i++) {
    const r = await fn();
    if (!signInRace(r) || i === 2) return { ...r, signInRetries: i };
    await new Promise((res) => setTimeout(res, 15_000));
  }
}

const runBot = (s, bot, prompt, attachments) => retried(() => runBotOnce(s, bot, prompt, attachments));
const askChief = (s, text) => retried(() => askChiefOnce(s, text));

// One message to a bot, and its reply. system: the prompt botdot appended for this run, as the recorder kept it
// (null when no Claude was started for it); learned: what the run's chips say it saved.
async function runBotOnce(s, bot, prompt, attachments = []) {
  const before = new Set(fs.readdirSync(s.prompts));
  const { data: run } = await s.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt, attachments } });
  if (!run?.id) throw new Error(`Couldn't start ${bot.name}: ${JSON.stringify(run)}`);
  const meta = await waitFor(async () => { const r = await s.api(`/runs/${run.id}`); return r.data.status && !['running', 'queued'].includes(r.data.status) ? r.data : null; }, { timeout: RUN_TIMEOUT, every: 1000, what: `${bot.name} to answer` });
  const events = fs.readFileSync(path.join(s.data, 'runs', `${run.id}.ndjson`), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  // Its own prompt among those recorded meanwhile: the one that names this bot (the Chief's turns are recorded too).
  const system = fs.readdirSync(s.prompts).filter((f) => !before.has(f)).map((f) => fs.readFileSync(path.join(s.prompts, f), 'utf8')).find((t) => t.includes(`You are ${bot.emoji} ${bot.name},`)) ?? null;
  return { runId: run.id, status: meta.status, text: meta.result || meta.error || '', durationMs: meta.durationMs, given: meta.relevant || [], learned: (meta.learned || []).map(({ kind, text }) => ({ kind, text })), system, ...trace(events) };
}

// A question put to a bot: q.result gets its answer. The scenario fails when what the question is about already
// stands in the conversation block of the asking run's prompt: the bot could read the answer off its chat, and
// the question would not exercise memory. Also when that prompt could not be read: then nothing is known.
async function put(s, bot, q) {
  const { system, ...result } = await runBot(s, bot, q.prompt);
  if (system === null && result.status === 'success') throw new Error(`${q.id}: the prompt of the asking run ${result.runId} was not recorded`);
  const block = conversationOf(system);
  const there = heldIn(block, valuesOf(q));
  q.result = { ...result, conversation: { chars: block.length, holds: there } };
  if (there.length) throw new Error(`${q.id}: ${there.join(', ')} is inside <conversation> in the prompt of the asking run ${result.runId}, so the answer needs no memory`);
  return q;
}

// A new Chief chat, one message, its reply. The Chief's tool calls come from its Claude session file.
async function askChiefOnce(s, text) {
  const chat = (await s.api('/chief/chats', { method: 'POST' })).data;
  await s.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const done = await waitFor(async () => {
    const c = (await s.api(`/chief/chats/${chat.id}`)).data;
    return !c.busy && c.messages.some((m) => m.role === 'chief' && !m.pending) ? c : null;
  }, { timeout: RUN_TIMEOUT, every: 1000, what: 'the Chief to answer' });
  const reply = done.messages.find((m) => m.role === 'chief' && !m.reminder);
  let events = [];
  const projects = path.join(os.homedir(), '.claude', 'projects');
  for (const p of fs.existsSync(projects) && done.sessionId ? fs.readdirSync(projects) : []) {
    const f = path.join(projects, p, `${done.sessionId}.jsonl`);
    if (fs.existsSync(f)) { events = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }); break; }
  }
  return { chatId: chat.id, status: reply.error && !reply.text ? 'error' : 'success', text: reply.text || reply.error || '', durationMs: Date.parse(reply.endedAt) - Date.parse(reply.at), ...trace(events) };
}

const noteWith = async (s, owner, needle) => {
  const m = (await s.api('/memory')).data;
  const notes = owner === '_shared' ? m.shared : m.bots.find((b) => b.id === owner)?.notes || [];
  return notes.find((n) => norm(n.text).includes(norm(needle))) || null;
};
// A note the bot pinned would be in its prompt, and recall wouldn't be tested: keep it searchable.
async function keepSearchable(s, note, setup) {
  if (note?.pinned) { await s.api(`/memory/notes/${note.id}`, { method: 'PUT', body: { pinned: false } }); setup.unpinnedByTest = true; }
}

// ---------- the scenarios ----------
// Each gets a fresh server and fresh made-up facts, and returns { setup, questions }. A question:
// { id, prompt, expected, outdated: values no longer true, offLimits: values it must not see (another
// bot's, a run left out), related: values that belong with the answer (the current one, when asked what
// it was before), result }. What recall returned is sorted by which of these values each record holds.

const SCENARIOS = {
  // A fact taught in chat, saved as a searchable note, asked in a later conversation.
  async 'recall-taught-fact'(s) {
    const code = digits(4);
    const bot = await makeBot(s.srv, { name: 'Home Helper', emoji: '🏠', prompt: "Help the owner with things around the house. Answer the owner's questions." });
    const setup = {};
    const teach = await runBot(s, bot, `Please remember this for later, as a searchable note (don't pin it): the code for the bike lock in the garage is ${code}.`);
    setup.teach = { runId: teach.runId, calls: teach.calls };
    const note = await noteWith(s, bot.id, code);
    setup.saved = !!note;
    await keepSearchable(s, note, setup);
    await s.age(bot.id);
    const q = { id: 'bike-lock', prompt: ask("What's the code for the bike lock in the garage?"), expected: code };
    await put(s, bot, q);
    return { setup, questions: [q] };
  },

  // A fact corrected later: the current value in fresh conversations and after restarts, and the old one on request.
  async 'correction-and-history'(s) {
    const [before, after] = [`${letters(4)}-${digits(4)}`, `${letters(4)}-${digits(4)}`];
    const bot = await makeBot(s.srv, { name: 'Home Helper', emoji: '🏠', prompt: "Help the owner with things around the house. Answer the owner's questions." });
    const setup = {};
    const teach = await runBot(s, bot, `Please remember this for later, as a searchable note (don't pin it): the guest Wi-Fi password is ${before}.`);
    const note = await noteWith(s, bot.id, before);
    setup.saved = !!note;
    await keepSearchable(s, note, setup);
    await s.age(bot.id);
    const fix = await runBot(s, bot, `The guest Wi-Fi password changed: it's ${after} now. Please update your memory.`);
    setup.teach = [{ runId: teach.runId, calls: teach.calls }, { runId: fix.runId, calls: fix.calls }];
    const current = await noteWith(s, bot.id, after);
    setup.corrected = !!current;
    setup.correctedSameNote = !!current && current.id === note?.id;
    await keepSearchable(s, current, setup);
    const questions = [];
    for (const id of ['current', 'current-after-restart']) {
      await s.age(bot.id); // also a restart
      const x = { id, prompt: ask("What's the guest Wi-Fi password?"), expected: after, outdated: [before] };
      questions.push(await put(s, bot, x));
    }
    await s.age(bot.id);
    const old = { id: 'previous', prompt: ask('What was the guest Wi-Fi password before it last changed?'), expected: before, related: [after] };
    questions.push(await put(s, bot, old));
    return { setup, questions };
  },

  // A bot finds the shared memory, never another bot's own notes.
  async 'shared-vs-private'(s) {
    const [plot, flyer] = [digits(3), `FF${digits(7)}`];
    const garden = await makeBot(s.srv, { name: 'Garden Bot', emoji: '🌱', prompt: 'Help the owner with their garden.' });
    const travel = await makeBot(s.srv, { name: 'Travel Bot', emoji: '✈️', prompt: "Help the owner plan trips. Answer the owner's questions." });
    const priv = (await s.api('/memory/notes', { method: 'POST', body: { owner: garden.id, text: `The owner's allotment plot number is ${plot}.`, pinned: false } })).data.note;
    const shared = (await s.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: `The owner's frequent-flyer number is ${flyer}.`, pinned: false } })).data.note;
    const a = { id: 'shared', prompt: ask("What's my frequent-flyer number?"), expected: flyer, offLimits: [plot] };
    await put(s, travel, a);
    const b = { id: 'private-of-another-bot', prompt: ask("What's my allotment plot number?"), expected: 'unknown', offLimits: [plot] };
    await put(s, travel, b);
    return { setup: { privateNote: priv.id, sharedNote: shared.id }, questions: [a, b] };
  },

  // A run the owner left out of recall isn't used; one that wasn't left out is.
  async 'excluded-run'(s) {
    const [plumber, electrician] = [`0${digits(3)} ${digits(3)} ${digits(3)}`, `0${digits(3)} ${digits(3)} ${digits(3)}`];
    const bot = await makeBot(s.srv, { name: 'Handy Bot', emoji: '🔧', prompt: "Find tradespeople for the owner. Answer the owner's questions." });
    await s.srv.stop();
    const hidden = seedRun(s.data, bot, { prompt: 'Find a plumber for the leaking kitchen tap.', result: `I found a plumber for the kitchen tap. The plumber's phone number is ${plumber}.`, days: FRESH + 1 });
    const kept = seedRun(s.data, bot, { prompt: 'Find an electrician for the garden lights.', result: `I found an electrician for the garden lights. The electrician's phone number is ${electrician}.`, days: FRESH });
    await s.restart();
    await s.api(`/memory/runs/${hidden}`, { method: 'PUT', body: { excluded: true } });
    const a = { id: 'kept-run', prompt: ask("What's the electrician's phone number you found?"), expected: electrician, offLimits: [plumber] };
    await put(s, bot, a);
    const b = { id: 'left-out-run', prompt: ask("What's the plumber's phone number you found?"), expected: 'unknown', offLimits: [plumber] };
    await put(s, bot, b);
    return { setup: { hidden, kept }, questions: [a, b] };
  },

  // The answer sits at the end of a long earlier reply, past what search keeps and past one read_run part.
  async 'long-answer'(s) {
    const part = `BX-${digits(5)}`;
    const bot = await makeBot(s.srv, { name: 'Boiler Bot', emoji: '🔥', prompt: "Look after the owner's heating. Answer the owner's questions." });
    await s.srv.stop();
    const checks = ['burner', 'flue', 'pressure gauge', 'expansion vessel', 'condensate trap', 'heat exchanger', 'pump', 'valves', 'thermostat', 'wiring'];
    const lines = Array.from({ length: 260 }, (_, i) => `${i + 1}. The ${checks[i % checks.length]} was checked (reading ${100 + (i * 37) % 900}); no fault found and nothing to replace at this point of the inspection.`);
    const result = `Boiler inspection report\n\n${lines.join('\n')}\n\nFinal verdict: the boiler needs a new ignition electrode, part number ${part}.`;
    const run = seedRun(s.data, bot, { prompt: 'Write the full inspection report for the boiler.', result });
    await s.restart();
    const q = { id: 'part-number-at-the-end', prompt: ask('In the boiler inspection report you wrote, what part number did the final verdict give?'), expected: part };
    await put(s, bot, q);
    return { setup: { run, replyChars: result.length }, questions: [q] };
  },

  // Nothing about it anywhere: the bot says it doesn't know.
  async 'unknown-fact'(s) {
    const bot = await makeBot(s.srv, { name: 'Home Helper', emoji: '🏠', prompt: "Help the owner with things around the house. Answer the owner's questions." });
    await s.api('/memory/notes', { method: 'POST', body: { owner: bot.id, text: 'The owner prefers the heating at 20 °C.', pinned: false } });
    const q = { id: 'dentist', prompt: ask("What's the name of my dentist?"), expected: 'unknown' };
    await put(s, bot, q);
    return { setup: {}, questions: [q] };
  },

  // A crowded memory: ~210 searchable notes and 120 past runs full of near misses (the same thing at
  // another place, the same place for another thing, a plumber for another job), some facts corrected.
  // Tests ranking: the right record among many that look like it.
  async 'crowded-memory'(s) {
    const bot = await makeBot(s.srv, { name: 'House Keeper', emoji: '🗝️', prompt: "Keep track of the owner's houses, accounts and contacts. Answer the owner's questions." });
    const code = () => digits(4);
    const wifi = () => `${letters(4)}-${digits(4)}`;
    const phone = () => `0${digits(3)} ${digits(3)} ${digits(3)}`;
    const member = () => `M-${digits(6)}`;
    const notes = []; // [text, topic]
    const things = ['bike lock', 'garage door', 'safe', 'gate', 'alarm', 'locker', 'padlock', 'key box'];
    const places = ['the garage', 'the cottage', 'the office', "grandma's flat", 'the boat', 'the allotment', 'the gym', 'the shed'];
    const codes = new Map();
    for (const t of things) for (const p of places) if (!(t === 'safe' && p === 'the boat')) codes.set(`${t}|${p}`, code()); // no safe on the boat: asked about, unknown
    for (const [k, v] of codes) { const [t, p] = k.split('|'); notes.push([`The code for the ${t} at ${p} is ${v}.`, 'codes']); }
    const wifiPlaces = ['the office', 'the cottage', 'home', "grandma's flat", 'the boat', 'the studio', "Marta's flat", 'the lake house', 'the workshop', 'the clinic'];
    const wifis = new Map();
    for (const p of wifiPlaces) for (const g of ['', 'guest ']) { const v = wifi(); wifis.set(`${g}${p}`, v); notes.push([`The ${g}Wi-Fi password at ${p} is ${v}.`, 'wifi']); }
    const towns = ['Gdynia', 'Gdańsk', 'Sopot', 'Kraków', 'Poznań', 'Wrocław', 'Toruń', 'Lublin'];
    const members = new Map();
    for (const town of towns) for (const club of ['gym', 'swimming pool', 'library']) { const v = member(); members.set(`${club}|${town}`, v); notes.push([`My membership number at the ${club} in ${town} is ${v}.`, 'memberships']); }
    const trades = [['plumber', 'the boiler service'], ['plumber', 'the outside tap'], ['electrician', 'the garden lights'], ['electrician', 'the fuse box'], ['roofer', 'the cottage roof'], ['locksmith', 'the office door'], ['gardener', 'the allotment'], ['chimney sweep', 'the cottage'], ['window cleaner', 'home'], ['vet', 'the cat'], ['tiler', 'the kitchen'], ['painter', 'the hallway']];
    for (const [who, job] of trades) notes.push([`The ${who} for ${job} can be reached on ${phone()}.`, 'contacts']);
    const plants = ['basil', 'fern', 'orchid', 'cactus', 'monstera', 'ficus', 'rosemary', 'mint', 'aloe', 'peace lily', 'palm', 'ivy', 'begonia', 'lavender', 'bonsai'];
    const rooms = ['kitchen', 'living room', 'bedroom', 'office', 'balcony', 'hallway'];
    for (const pl of plants) for (const r of rooms) notes.push([`The ${pl} in the ${r} needs water every ${crypto.randomInt(2, 15)} days.`, 'plants']);
    // Add them (searchable, not pinned), then correct some: their old values stay in the notes' history.
    const ids = new Map();
    for (const [text, topic] of notes) ids.set(text, (await s.api('/memory/notes', { method: 'POST', body: { owner: bot.id, text, topic, pinned: false } })).data.note.id);
    const correct = async (text, next) => s.api(`/memory/notes/${ids.get(text)}`, { method: 'PUT', body: { text: next } });
    const guestOffice = wifis.get('guest the office');
    const guestOfficeNow = wifi();
    await correct(`The guest Wi-Fi password at the office is ${guestOffice}.`, `The guest Wi-Fi password at the office is ${guestOfficeNow}.`);
    const boatAlarm = codes.get('alarm|the boat');
    const boatAlarmNow = code();
    await correct(`The code for the alarm at the boat is ${boatAlarm}.`, `The code for the alarm at the boat is ${boatAlarmNow}.`);
    for (const k of [...codes.keys()].filter((k) => !['alarm|the boat', 'key box|the cottage'].includes(k)).slice(0, 20)) {
      const [t, p] = k.split('|');
      await correct(`The code for the ${t} at ${p} is ${codes.get(k)}.`, `The code for the ${t} at ${p} is ${code()}.`);
    }
    // Past runs: jobs for tradespeople (one bathroom plumber, only in a run), code changes, weather and shopping.
    await s.srv.stop();
    const bathroomPlumber = phone();
    const runs = [
      { prompt: 'Find a plumber for the bathroom leak.', result: `I found a plumber for the bathroom leak: Jan from AquaFix, who can come on Tuesday. His phone number is ${bathroomPlumber}.`, days: 40 },
      { prompt: 'Find a plumber for the kitchen tap.', result: `The plumber for the kitchen tap is Ola from Kran Serwis; her phone number is ${phone()}.`, days: 70 },
      { prompt: 'Find a plumber for the radiator in the bedroom.', result: `Booked a plumber for the bedroom radiator, Tomasz, phone ${phone()}.`, days: 120 },
      { prompt: 'Ask the plumber about the bathroom tiles.', result: `The plumber said the bathroom tiles are fine; he can't help with tiling. Call a tiler instead.`, days: 35 },
      { prompt: 'Set up the guest Wi-Fi at the office.', result: `The guest Wi-Fi at the office is set up. The password is ${guestOffice}.`, days: 90 },
      { prompt: 'The boat alarm keeps going off. Reset it.', result: `I reset the boat alarm. Its code is still ${boatAlarm}.`, days: 60 },
    ];
    for (let i = 0; i < 50; i++) runs.push({ prompt: `What's the weather in ${towns[i % towns.length]} this weekend?`, result: `This weekend in ${towns[i % towns.length]}: ${crypto.randomInt(5, 25)} °C, ${['sunny', 'cloudy', 'rain on Sunday', 'windy'][i % 4]}.`, days: FRESH + i * 3 });
    for (let i = 0; i < 40; i++) runs.push({ prompt: `Order more ${plants[i % plants.length]} fertiliser.`, result: `Ordered ${1 + (i % 3)} bags of fertiliser for the ${plants[i % plants.length]}; order number ${digits(8)}, arriving in ${2 + (i % 4)} days.`, days: FRESH + 1 + i * 4 });
    for (let i = 0; i < 24; i++) { const [t, p] = [...codes.keys()][i * 2].split('|'); runs.push({ prompt: `Check the ${t} at ${p}.`, result: `The ${t} at ${p} works fine. I used the code from my notes.`, days: FRESH + 3 + i * 7 }); }
    for (const r of runs) seedRun(s.data, bot, r);
    await s.restart();
    const questions = [
      { id: 'code-among-many', prompt: ask("What's the code for the key box at the cottage?"), expected: codes.get('key box|the cottage') },
      { id: 'corrected-among-many', prompt: ask("What's the guest Wi-Fi password at the office?"), expected: guestOfficeNow, outdated: [guestOffice] },
      { id: 'only-in-a-past-run', prompt: ask("What's the phone number of the plumber who came for the bathroom leak?"), expected: bathroomPlumber },
      { id: 'previous-among-many', prompt: ask('What was the alarm code at the boat before it was changed?'), expected: boatAlarm, related: [boatAlarmNow] },
      { id: 'membership-among-many', prompt: ask("What's my membership number at the gym in Gdynia?"), expected: members.get('gym|Gdynia') },
      { id: 'near-miss-unknown', prompt: ask("What's the code for the safe at the boat?"), expected: 'unknown' },
    ];
    for (const q of questions) await put(s, bot, q);
    return { setup: { notes: notes.length, runs: runs.length }, questions };
  },

  // The Chief: a bot's earlier result, its own earlier chat, and both after a restart.
  async chief(s) {
    const [rain, reg] = [String(crypto.randomInt(11, 49)), `KR ${digits(4)}${letters(2)}`];
    const weather = await makeBot(s.srv, { name: 'Weather Watcher', emoji: '🌦️', prompt: 'Check the weather forecast for Kraków.' });
    await s.srv.stop();
    const report = seedRun(s.data, weather, { prompt: "Check next week's forecast for Kraków.", result: `Next week in Kraków: mostly cloudy, with ${rain} mm of rain expected in total, most of it on Thursday.`, days: 4 });
    await s.restart();
    const setup = { report };
    const teach = await askChief(s, `Please remember this for later: my car's registration number is ${reg}.`);
    setup.teach = { chatId: teach.chatId, calls: teach.calls };
    const shared = await noteWith(s, '_shared', reg);
    setup.sharedNote = shared?.id || null;
    setup.saved = !!shared;
    await keepSearchable(s, shared, setup); // a pinned shared note would put the answer in its prompt
    const questions = [];
    const q = (id, prompt, expected) => ({ id, prompt: ask(prompt), expected });
    const botResult = "How much rain did Weather Watcher report for Kraków next week? Answer from what it already reported; don't run it again.";
    const a = q('bot-result', botResult, rain);
    a.result = await askChief(s, a.prompt);
    const b = q('own-earlier-chat', "What's my car's registration number?", reg);
    b.result = await askChief(s, b.prompt);
    questions.push(a, b);
    await s.restart();
    for (const [id, text, expected] of [['bot-result-after-restart', botResult, rain], ['own-earlier-chat-after-restart', "What's my car's registration number?", reg]]) {
      const x = q(id, text, expected);
      x.result = await askChief(s, x.prompt);
      questions.push(x);
    }
    return { setup, questions };
  },
};

// ---------- scoring and the report ----------

// What each record recall returned holds, read in full (search results show only an excerpt).
async function classify(s, q, records = q.result.recalled) {
  const m = (await s.api('/memory')).data;
  const notes = new Map([...m.shared, ...m.bots.flatMap((b) => b.notes)].map((n) => [n.id, n.text]));
  const has = (text, values = []) => values.some((v) => norm(text).includes(norm(v)));
  const out = [];
  for (const r of records) {
    let text = r.text;
    if (r.kind === 'note') text = notes.get(r.id) ?? r.text;
    if (r.kind === 'run') { const x = (await s.api(`/memory/runs/${encodeURIComponent(r.id)}`)).data; text = `${x.asked || ''}\n${x.reply || ''}`; }
    const holds = has(text, q.offLimits) ? 'off-limits' : q.expected !== 'unknown' && has(text, [q.expected]) ? 'answer'
      : has(text, q.outdated) ? 'outdated' : has(text, q.related) ? 'related' : 'irrelevant';
    out.push({ kind: r.kind, id: r.id, holds });
  }
  return out;
}

function score(q) {
  const r = q.result;
  const answer = answerOf(r.text);
  const count = (h) => q.records.filter((x) => x.holds === h).length;
  return {
    answer,
    correct: r.status === 'success' && graded(answer, q.expected),
    usedRecall: r.calls.some((c) => c.name === 'recall'),
    searches: r.calls.filter((c) => c.name === 'recall').length,
    readRun: r.calls.filter((c) => c.name === 'read_run' || c.name === 'get_run').length,
    foundAnswer: q.expected === 'unknown' ? null : count('answer') > 0,
    outdated: count('outdated'),
    offLimits: count('off-limits'),
    irrelevant: count('irrelevant'),
    recalled: q.records.length,
    given: (q.givenRecords || []).length,
    givenAnswer: q.expected === 'unknown' ? null : (q.givenRecords || []).some((x) => x.holds === 'answer'),
    givenOffLimits: (q.givenRecords || []).filter((x) => x.holds === 'off-limits').length,
    givenExtra: (q.givenRecords || []).filter((x) => x.holds !== 'answer').length,
  };
}

// ---------- what a bot saved ----------

// One write-side scenario (grading.js): the conversation with a bot whose memory is empty, then what the store
// holds, and its grade. Nothing here fails on what the bot chose to save.
async function writeSide(s, scenario) {
  const bot = await makeBot(s.srv, WRITER);
  const turns = [];
  for (const turn of scenario.turns) {
    const files = [];
    if (turn.file) {
      const up = await s.api(`/uploads?to=bot:${bot.id}`, { method: 'POST', raw: Buffer.from(turn.file.text), headers: { 'X-File-Name': encodeURIComponent(turn.file.name) } });
      if (up.status !== 201) throw new Error(`Couldn't attach ${turn.file.name}: ${JSON.stringify(up.data)}`);
      files.push(up.data);
    }
    const { system, recalled, ...r } = await runBot(s, bot, turn.say, files);
    if (r.status !== 'success') throw new Error(`${bot.name} didn't answer "${turn.say}": ${r.text.split('\n')[0]}`);
    turns.push({ say: turn.say, ...(turn.file ? { file: turn.file.name } : {}), ...r });
  }
  const m = (await s.api('/memory')).data;
  const slim = (n) => ({ id: n.id, text: n.text, topic: n.topic, pinned: n.pinned, by: n.by, ...(n.source ? { source: n.source } : {}), ...(n.until ? { until: n.until } : {}) });
  const store = {
    own: (m.bots.find((b) => b.id === bot.id)?.notes || []).map(slim),
    shared: m.shared.map(slim),
    waiting: (await s.api('/memory/pending?guarded=1')).data.map((p) => ({ id: p.id, action: p.action, text: p.text, topic: p.topic, ...(p.until ? { until: p.until } : {}) })),
  };
  return { says: scenario.says, turns, store, grade: grade(scenario, store, turns) };
}

// ---------- the run ----------

test('live memory conversations (real Claude)', { skip: !LIVE && 'set BOT_DOT_TEST_LIVE_CLAUDE=1 to run live conversations', timeout: 6 * 3600_000 }, async (t) => {
  const writers = new Map(WRITE_SCENARIOS.map((w) => [w.name, w]));
  const names = ONLY.length ? ONLY : [...Object.keys(SCENARIOS), ...writers.keys()];
  for (const n of names) assert.ok(SCENARIOS[n] || writers.has(n), `no scenario called ${n}`);
  const outDir = process.env.BOT_DOT_TEST_LIVE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-live-results-'));
  fs.mkdirSync(outDir, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-live-'));
  const jobs = [];
  for (let rep = 1; rep <= REPEAT; rep++) for (const scenario of names) jobs.push({ scenario, rep });
  const results = []; // reading: the questions of each scenario
  const writes = []; // writing: what the store held after each conversation
  const work = async () => {
    for (let job; (job = jobs.shift());) {
      const dir = path.join(scratch, `${job.scenario}-${job.rep}`);
      const started = Date.now();
      const into = writers.has(job.scenario) ? writes : results;
      let s;
      try {
        s = await liveServer(dir);
        if (writers.has(job.scenario)) {
          const w = await writeSide(s, writers.get(job.scenario));
          writes.push({ ...job, ...w, ms: Date.now() - started });
          t.diagnostic(`${job.scenario} #${job.rep}: ${w.grade.saved ? `saved (the bot's ${w.grade.own}, shared ${w.grade.shared}, waiting ${w.grade.waiting})` : 'nothing saved'}`);
          continue;
        }
        const { setup, questions } = await SCENARIOS[job.scenario](s);
        for (const q of questions) { q.records = await classify(s, q); q.givenRecords = await classify(s, q, q.result.given || []); Object.assign(q, { scenario: job.scenario, rep: job.rep, score: score(q) }); }
        results.push({ ...job, setup, questions, ms: Date.now() - started });
        t.diagnostic(`${job.scenario} #${job.rep}: ${questions.map((q) => `${q.id} ${q.score.correct ? 'right' : 'wrong'}`).join(', ')}`);
      } catch (e) {
        into.push({ ...job, error: e.message.split('\n')[0], ms: Date.now() - started });
        t.diagnostic(`${job.scenario} #${job.rep}: failed: ${e.message.split('\n')[0]}`);
      } finally { await s?.close().catch(() => {}); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, work));
  let commit = 'unknown';
  try {
    const git = (...a) => require('child_process').execFileSync('git', a, { encoding: 'utf8' }).trim();
    commit = git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--', 'lib', 'server.js') ? ' with uncommitted changes' : '');
  } catch { /* not a checkout */ }
  const models = [...new Set([...results.flatMap((r) => (r.questions || []).map((q) => q.result.model)), ...writes.flatMap((w) => (w.turns || []).map((x) => x.model))].filter(Boolean))];
  const meta = { date: new Date().toISOString().slice(0, 10), commit, repeat: REPEAT, models };
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ ...meta, results, writes }, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.md'), report(results, meta, writes));
  t.diagnostic(`results in ${outDir}`);
  // The servers' data, and the Claude session files their runs left in ~/.claude/projects.
  fs.rmSync(scratch, { recursive: true, force: true });
  const projects = path.join(os.homedir(), '.claude', 'projects');
  for (const p of fs.existsSync(projects) ? fs.readdirSync(projects) : []) if (p.includes(path.basename(scratch))) fs.rmSync(path.join(projects, p), { recursive: true, force: true });
  // Wrong answers and what a bot chose to save are results. A scenario that couldn't run, or a question asked
  // with its answer in the conversation block, is a failure of the test itself.
  assert.deepEqual([...results, ...writes].filter((r) => r.error).map((r) => `${r.scenario} #${r.rep}: ${r.error}`), []);
});

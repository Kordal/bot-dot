// A look (lib/look.js, ADR 006): when one starts, what it is told, what it may use and what its answer means.
// Nothing runs here but the code: the clock, Claude and the chat are stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const look = require('../lib/look');
const { ROOT } = require('./helpers');

const at = (iso) => new Date(iso);

// The looks of a botdot server started at `started`, with a clock the test sets.
function make({ started = '2026-10-05T06:00:00Z', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-look-')), answer = 'Your backup check never finished. Want me to run it again?' } = {}) {
  const w = {
    dir, clock: at(started), busy: false, answer, posted: [], ids: [], offered: [], inputs: [], runs: 0, log: [],
    settings: { unaskedPerDay: 3, quietHours: { start: 22, end: 7, timeZone: 'UTC' } },
  };
  w.looks = look.create({
    dataDir: dir, settings: { get: () => w.settings }, busy: () => w.busy, now: () => w.clock, log: (l) => w.log.push(l),
    input: ({ raised }) => { w.inputs.push(raised); return { system: 's', prompt: 'p' }; },
    run: async () => { w.runs++; if (w.answer instanceof Error) throw w.answer; return typeof w.answer === 'function' ? w.answer() : w.answer; },
    post: (text, id, asked) => { w.posted.push(text); w.ids.push(id); w.offered.push(asked); return 'chat-1'; },
  });
  w.tickAt = (iso) => { w.clock = at(iso); return w.looks.tick(); };
  return w;
}

test('looks start at four spread-out times outside quiet hours, which follow the quiet hours', () => {
  const hhmm = (q) => look.times(q).map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  assert.deepEqual(hhmm({ start: 22, end: 7, timeZone: 'UTC' }), ['08:53', '12:38', '16:23', '20:08']);
  assert.deepEqual(hhmm({ start: 2, end: 10, timeZone: 'UTC' }), ['12:00', '16:00', '20:00', '00:00'], 'a day that ends after midnight');
  assert.deepEqual(hhmm({ start: 0, end: 0, timeZone: 'UTC' }), ['03:00', '09:00', '15:00', '21:00'], 'no quiet hours: the whole day');
  // The owner's time zone decides, not the server's.
  assert.equal(look.dueLook(at('2026-10-05T06:53:00Z'), { start: 22, end: 7, timeZone: 'Europe/Warsaw' }) !== null, true);
  assert.equal(look.dueLook(at('2026-10-05T08:53:00Z'), { start: 22, end: 7, timeZone: 'Europe/Warsaw' }), null);
});

test('a look whose time has come posts its message, once', async () => {
  const w = make();
  assert.deepEqual(await w.tickAt('2026-10-05T08:52:00Z'), { looked: false, reason: 'not-time' });
  assert.deepEqual(await w.tickAt('2026-10-05T08:53:00Z'), { looked: true, posted: true, chatId: 'chat-1' });
  assert.deepEqual(w.posted, ['Your backup check never finished. Want me to run it again?']);
  assert.deepEqual(await w.tickAt('2026-10-05T08:54:00Z'), { looked: false, reason: 'taken' }, 'the same time starts no second look');
  assert.equal(w.runs, 1);
  assert.deepEqual(w.looks.status(), { perDay: 3, sentToday: 1 });
});

test('a time missed while botdot was off is not caught up', async () => {
  const w = make({ started: '2026-10-05T06:00:00Z' });
  assert.deepEqual(await w.tickAt('2026-10-05T09:08:00Z'), { looked: false, reason: 'not-time' }, 'fifteen minutes late is too late');
  assert.equal(w.runs, 0);
  assert.equal((await w.tickAt('2026-10-05T12:40:00Z')).posted, true, 'the next one runs at its own time');
});

test('no look in the first hour after a start, in quiet hours, while the Chief is busy, or when writing first is off; a skipped look is not put off', async () => {
  const early = make({ started: '2026-10-05T08:00:00Z' });
  assert.deepEqual(await early.tickAt('2026-10-05T08:53:00Z'), { looked: false, reason: 'first-hour' });
  assert.deepEqual(await early.tickAt('2026-10-05T09:01:00Z'), { looked: false, reason: 'taken' }, 'not started once the hour is over');
  assert.equal((await early.tickAt('2026-10-05T12:38:00Z')).posted, true);

  const busy = make();
  busy.busy = true;
  assert.deepEqual(await busy.tickAt('2026-10-05T08:53:00Z'), { looked: false, reason: 'busy' });
  busy.busy = false;
  assert.deepEqual(await busy.tickAt('2026-10-05T08:55:00Z'), { looked: false, reason: 'taken' }, 'skipped, not queued');

  const off = make();
  off.settings.unaskedPerDay = 0;
  assert.deepEqual(await off.tickAt('2026-10-05T08:53:00Z'), { looked: false, reason: 'off' });

  // A look's own times never lie in quiet hours; one started by hand in them is refused as well.
  const quiet = make();
  quiet.clock = at('2026-10-05T23:10:00Z');
  assert.deepEqual(await quiet.looks.onDemand(), { looked: false, reason: 'quiet-hours' });
  for (const w of [early, busy, off, quiet]) assert.equal(w.runs, w === early ? 1 : 0);
});

test('NOTHING, an empty answer and a failed turn post nothing and are not counted', async () => {
  const w = make({ answer: 'NOTHING' });
  assert.deepEqual(await w.tickAt('2026-10-05T08:53:00Z'), { looked: true, posted: false });
  w.answer = '';
  assert.deepEqual(await w.tickAt('2026-10-05T12:38:00Z'), { looked: true, posted: false });
  w.answer = new Error('Claude is not signed in');
  assert.deepEqual(await w.tickAt('2026-10-05T16:23:00Z'), { looked: true, posted: false, failed: true });
  assert.deepEqual(w.log, ['[look] Claude is not signed in'], "the failure is in the server's log");
  assert.deepEqual([w.posted, w.runs, w.looks.status().sentToday], [[], 3, 0]);
  w.answer = 'A message after all.';
  assert.equal((await w.tickAt('2026-10-05T20:08:00Z')).posted, true, 'the day still has all three');

  for (const nothing of ['NOTHING', ' nothing. ', '"NOTHING"', '**NOTHING**', '`NOTHING`\n', '', '  \n']) assert.equal(look.messageOf(nothing), '', JSON.stringify(nothing));
  // The first word decides, in any case and dress, whatever follows it (as walked on a test server).
  for (const nothing of ['NOTHING.\n\nNothing new since the last look.', 'NOTHING — nothing clears the bar', 'Nothing worth saying today.', '**Nothing** today.', 'nothing: the backup ran fine']) assert.equal(look.messageOf(nothing), '', JSON.stringify(nothing));
  // An answer that only says there is nothing new (reporting.js noNews).
  for (const nothing of ['No updates.', 'All quiet!', 'Nothing to report', 'Bez zmian.']) assert.equal(look.messageOf(nothing), '', nothing);
  // A message that has the word further on is a message, and so is one whose first word only starts with it.
  assert.equal(look.messageOf('  Your disk has nothing new, but the backup is late.\n'), 'Your disk has nothing new, but the backup is late.');
  assert.equal(look.messageOf('No updates from Fleet Doctor since Tuesday: want me to check why?'), 'No updates from Fleet Doctor since Tuesday: want me to check why?');
  assert.equal(look.messageOf('Nothingness is a fine name for your quiet-hours bot.'), 'Nothingness is a fine name for your quiet-hours bot.');
});

test('a last line [[choices: …]] becomes answer buttons: the message and its record are the text without it (#341)', async () => {
  const w = make({ answer: 'Three of your jobs failed this week. Want a daily summary of job failures?\n[[choices: Yes | Not now]]' });
  assert.deepEqual(await w.tickAt('2026-10-05T08:53:00Z'), { looked: true, posted: true, chatId: 'chat-1' });
  assert.deepEqual(w.posted, ['Three of your jobs failed this week. Want a daily summary of job failures?']);
  assert.deepEqual(w.offered, [{ choices: ['Yes', 'Not now'], questions: null }]);
  assert.equal(w.looks.raised()[0].text, 'Three of your jobs failed this week. Want a daily summary of job failures?');
  // A message with no such line has none; one that is only the line is no message.
  w.answer = 'Your backup check never finished.';
  await w.tickAt('2026-10-05T12:38:00Z');
  assert.deepEqual(w.offered[1], { choices: null, questions: null });
  w.answer = '[[choices: Yes | No]]';
  assert.deepEqual(await w.tickAt('2026-10-05T16:23:00Z'), { looked: true, posted: false });
  assert.match(look.systemPrompt(), /end it with one last line \[\[choices: Yes \| No\]\]/);
});

test('a "nothing" with a sentence after it posts nothing and is not counted', async () => {
  const w = make({ answer: 'NOTHING.\n\nNothing new since the last look.' });
  assert.deepEqual(await w.tickAt('2026-10-05T08:53:00Z'), { looked: true, posted: false });
  w.answer = 'Nothing worth saying today.';
  assert.deepEqual(await w.tickAt('2026-10-05T12:38:00Z'), { looked: true, posted: false });
  assert.deepEqual([w.posted, w.looks.status().sentToday, w.looks.raised()], [[], 0, []]);
});

test('at most three a day by the owner\'s day, fewer when set so; the count survives a restart', async () => {
  const w = make();
  for (const t of ['08:53', '12:38', '16:23']) assert.equal((await w.tickAt(`2026-10-05T${t}:00Z`)).posted, true);
  assert.deepEqual(await w.tickAt('2026-10-05T20:08:00Z'), { looked: false, reason: 'limit' });
  assert.equal(w.runs, 3, 'no look starts once three were sent');

  const again = make({ dir: w.dir, started: '2026-10-05T20:20:00Z' }); // botdot restarted
  assert.deepEqual(again.looks.status(), { perDay: 3, sentToday: 3 });
  assert.deepEqual(await again.looks.onDemand(), { looked: false, reason: 'limit' });
  assert.equal((await again.tickAt('2026-10-06T08:53:00Z')).posted, true, 'the next day they start again');
  assert.deepEqual(again.looks.status(), { perDay: 3, sentToday: 1 });

  again.settings.unaskedPerDay = 1;
  assert.deepEqual(await again.tickAt('2026-10-06T12:38:00Z'), { looked: false, reason: 'limit' }, 'one a day, when the owner asked for that');

  // The owner's day, not the server's: 23:30 UTC on the 5th is the 6th in Warsaw.
  const warsaw = make();
  warsaw.settings.quietHours = { start: 3, end: 3, timeZone: 'Europe/Warsaw' };
  warsaw.clock = at('2026-10-05T23:30:00Z');
  for (let i = 0; i < 3; i++) assert.equal((await warsaw.looks.onDemand()).posted, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(warsaw.dir, 'looks.json'), 'utf8')).day, '2026-10-06');
});

test('the owner said stop while the Chief was looking: the message is dropped', async () => {
  const w = make();
  w.answer = () => { w.settings.unaskedPerDay = 0; return 'Too late.'; };
  assert.deepEqual(await w.tickAt('2026-10-05T08:53:00Z'), { looked: true, posted: false });
  assert.deepEqual(w.posted, []);
});

test("a look's input holds the digest of the chats and the record of what it raised, newest first, the last 60 days", () => {
  const chats = [
    { id: 'a', title: 'Recipes', updatedAt: '2026-10-02T10:00:00Z', messages: [
      { role: 'user', text: 'Check recipes.example.com for duplicate ingredients', at: '2026-10-01T09:00:00Z' },
      { role: 'chief', text: 'Recipe Keeper is on it.', at: '2026-10-01T09:00:10Z' },
      { role: 'chief', unasked: true, rating: 'up', text: 'Your duplicate check never finished. Want me to start it again?', at: '2026-10-02T09:00:00Z' },
      { role: 'report', from: { name: 'Recipe Keeper' }, text: 'Three duplicates found.', at: '2026-10-02T09:30:00Z' },
      { role: 'user', text: 'yes, start it again', at: '2026-10-02T10:00:00Z' },
      { role: 'chief', text: '', pending: true, at: '2026-10-02T10:00:00Z' },
    ] },
    { id: 'b', title: 'Homelab', updatedAt: '2026-10-03T10:00:00Z', messages: [
      { role: 'user', text: 'Is the Proxmox token still valid?', at: '2026-10-03T08:00:00Z' },
      { role: 'chief', unasked: true, rating: 'down', text: 'A joke about tokens.', at: '2026-10-03T09:00:00Z' },
      { role: 'chief', unasked: true, text: 'Proxmox 9 is out.', at: '2026-10-03T10:00:00Z' },
      { role: 'suggestion', from: { name: 'Bot Designer' }, text: 'Build me a bot', status: 'pending', at: '2026-10-03T10:00:00Z' },
    ] },
  ];
  // A chat's unasked messages as entries of the record, for the ones posted before botdot kept it.
  assert.deepEqual(look.unaskedIn(chats[0]), [{ index: 2, chatId: 'a', at: '2026-10-02T09:00:00Z', text: 'Your duplicate check never finished. Want me to start it again?', rating: 'up', answer: 'yes, start it again' }]);
  assert.deepEqual(look.unaskedIn(chats[1]).map((r) => [r.index, r.rating, r.answer]), [[1, 'down', null], [2, null, null]]);

  const raised = [
    ...chats.flatMap(look.unaskedIn),
    { chatId: 'gone', at: '2026-09-20T09:00:00Z', text: 'Your Fleet Doctor checks the wrong disk.', rating: 'up', answer: 'fix it' }, // its chat was deleted
    { chatId: 'gone', at: '2026-07-01T09:00:00Z', text: 'An old tip from July.', rating: null, answer: null }, // more than 60 days ago
  ];
  const p = look.prompt({ now: at('2026-10-05T08:53:00Z'), timeZone: 'UTC', memory: 'The owner lives in Warsaw.', bots: [{ name: 'Recipe Keeper', description: 'Keeps the recipes tidy' }], chats, raised });
  assert.match(p, /Now: Monday 2026-10-05 08:53 \(UTC\)/);
  assert.match(p, /<shared-memory>\nThe owner lives in Warsaw\.\n<\/shared-memory>/);
  assert.match(p, /- Recipe Keeper: Keeps the recipes tidy/);
  assert.match(p, /Chat "Recipes" \(2026-10-02\):\nOwner: Check recipes\.example\.com for duplicate ingredients\nYou: Recipe Keeper is on it\.\nYou, unasked: Your duplicate check/);
  assert.match(p, /Recipe Keeper \(a bot\): Three duplicates found\./);
  assert.doesNotMatch(p, /Build me a bot/, "a bot's waiting plan is not the owner's words");
  const before = p.slice(p.indexOf('Already raised'));
  assert.match(before, /^Already raised \(your unasked messages of the last 60 days, newest first/);
  assert.deepEqual(before.split('\n').filter((l) => l.startsWith('- ')), [
    '- 2026-10-03, not rated, no answer: Proxmox 9 is out.',
    '- 2026-10-03, rated down, no answer: A joke about tokens.',
    '- 2026-10-02, rated up, the owner answered "yes, start it again": Your duplicate check never finished. Want me to start it again?',
    '- 2026-09-20, rated up, the owner answered "fix it": Your Fleet Doctor checks the wrong disk.',
  ], 'newest first, a deleted chat\'s message too, nothing older than 60 days');
  assert.ok(p.trim().endsWith('Your message, or NOTHING:'));

  assert.match(look.prompt({ now: at('2026-10-05T08:53:00Z'), timeZone: 'UTC' }), /Already raised[^\n]*\n\(nothing yet\)/);
  assert.match(look.systemPrompt({ rules: 'Never joke.' }), /answer exactly NOTHING[\s\S]*<user-rules>\nNever joke\.\n<\/user-rules>/);
  assert.match(look.systemPrompt(), /change nothing and start nothing/);
  assert.match(look.systemPrompt(), /Never say what anything cost/);
});

test('every message a look posted is kept in its record with its rating and answer, across a restart; the next look reads it', async () => {
  const w = make();
  assert.equal((await w.tickAt('2026-10-05T08:53:00Z')).posted, true);
  assert.deepEqual(w.inputs, [[]], 'the first look had nothing raised before it');
  const [first] = w.looks.raised();
  assert.deepEqual(first, { id: w.ids[0], chatId: 'chat-1', at: '2026-10-05T08:53:00.000Z', text: 'Your backup check never finished. Want me to run it again?', rating: null, answer: null });
  assert.equal(w.looks.rated(first.id, 'up'), true);
  assert.equal(w.looks.answered(first.id, 'yes please'), true);
  assert.equal(w.looks.rated('no-such-id', 'down'), false);
  assert.equal(w.looks.rated(undefined, 'down'), false);
  w.looks.rated(first.id, 'sideways'); // not a rating: none
  assert.equal(w.looks.raised()[0].rating, null);
  w.looks.rated(first.id, 'down');

  // Messages posted before the record: adopted with what their chat says, each with an id of its own.
  const ids = w.looks.adopt([{ index: 4, chatId: 'old', at: '2026-09-30T09:00:00Z', text: 'An older tip.', rating: 'up', answer: null }]);
  assert.equal(ids.length, 1);
  assert.deepEqual(w.looks.adopt([]), []);

  const again = make({ dir: w.dir, started: '2026-10-05T10:00:00Z' }); // botdot restarted
  assert.deepEqual(again.looks.raised(), [
    { ...first, rating: 'down', answer: 'yes please' },
    { id: ids[0], chatId: 'old', at: '2026-09-30T09:00:00Z', text: 'An older tip.', rating: 'up', answer: null },
  ]);
  again.answer = 'A second tip.';
  assert.equal((await again.tickAt('2026-10-05T12:38:00Z')).posted, true);
  assert.deepEqual(again.inputs[0].map((r) => r.text), ['Your backup check never finished. Want me to run it again?', 'An older tip.'], 'the next look is told what was raised');
  assert.equal(again.looks.raised().length, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.dir, 'looks.json'), 'utf8')).raised.map((r) => r.text), ['Your backup check never finished. Want me to run it again?', 'An older tip.', 'A second tip.'], 'in looks.json, which a backup carries');
});

// ---------- the tools ----------

// The Chief's tools server as a look gets it (BOT_DOT_LOOK=1) or as a chat's turn does, against a stand-in
// botdot that records every request.
async function toolsServer(t, lookMode) {
  const requests = [];
  const api = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { requests.push({ method: req.method, url: req.url, body }); res.setHeader('Content-Type', 'application/json'); res.end(req.url.startsWith('/api/runs?') || req.url.startsWith('/api/bots') && !/bots\//.test(req.url) ? '[]' : '{}'); });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const child = spawn(process.execPath, ['lib/mcp-server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, BOT_DOT_URL: `http://127.0.0.1:${api.address().port}`, ...(lookMode ? { BOT_DOT_LOOK: '1' } : {}) }, stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => { child.kill(); api.close(); });
  const waiting = new Map();
  let buf = '';
  child.stdout.on('data', (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); waiting.get(msg.id)?.(msg); }
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve) => { waiting.set(++id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return { requests, call };
}

test("a look's tools are web search and botdot's reading tools only; none of them changes anything or fetches a URL", async (t) => {
  assert.deepEqual(look.TOOLS, ['WebSearch', 'mcp__botdot__recall', 'mcp__botdot__list_bots', 'mcp__botdot__get_bot', 'mcp__botdot__list_runs', 'mcp__botdot__get_run']);
  // Its prompt holds the owner's data: a tool that fetches a URL of its choosing could send that data anywhere.
  assert.deepEqual(look.WEB_TOOLS, ['WebSearch']);
  for (const fetches of ['WebFetch', 'Fetch', 'Bash', 'mcp__botdot__fetch']) assert.ok(!look.TOOLS.includes(fetches), fetches);
  const s = await toolsServer(t, true);
  const offered = (await s.call('tools/list')).result.tools.map((x) => x.name);
  assert.deepEqual(offered.sort(), [...look.READING_TOOLS].sort(), 'the tools server offers a look nothing else');
  assert.deepEqual(look.TOOLS, [...look.WEB_TOOLS, ...look.READING_TOOLS.map((n) => `mcp__botdot__${n}`)]);

  // Every tool a look has, called: botdot is only ever read (GET), and a run is not marked as seen by the Chief.
  const ARGS = { recall: { query: 'backup', history: true }, list_bots: {}, get_bot: { id: 'b1' }, list_runs: { botId: 'b1', limit: 5 }, get_run: { runId: 'r1' } };
  assert.deepEqual(Object.keys(ARGS).sort(), [...look.READING_TOOLS].sort(), 'a tool added to a look is called here too');
  for (const name of look.READING_TOOLS) {
    const before = s.requests.length;
    const r = await s.call('tools/call', { name, arguments: ARGS[name] });
    assert.ok(!r.result.isError, `${name}: ${r.result.content[0].text}`);
    assert.ok(s.requests.length > before, `${name} asked botdot`);
  }
  await s.call('tools/call', { name: 'get_run', arguments: { runId: 'chief-chat-3' } }); // one of the Chief's own replies
  for (const q of s.requests) {
    assert.equal(q.method, 'GET', `${q.method} ${q.url}`);
    assert.equal(q.body, '');
    assert.doesNotMatch(q.url, /seen=/, 'reading a run leaves no mark');
  }

  // Tools that change something are not there for a look, also when it asks for them by name.
  for (const name of ['create_bot', 'update_bot', 'delete_bot', 'run_bot', 'run_job', 'add_job', 'remember', 'update_note', 'remove_note', 'restore_note', 'forget', 'list_notes', 'remind_me', 'writing_first', 'set_quiet_hours', 'stop_run', 'wait_for_run']) {
    const before = s.requests.length;
    const r = await s.call('tools/call', { name, arguments: {} });
    assert.match(r.error?.message || '', /Unknown tool/, name);
    assert.equal(s.requests.length, before);
  }
});

test('the Chief has one tool to read and change writing first', async (t) => {
  const s = await toolsServer(t, false);
  const tools = (await s.call('tools/list')).result.tools;
  const tool = tools.find((x) => x.name === 'writing_first');
  assert.ok(tool && tools.some((x) => x.name === 'create_bot'));
  assert.match(tool.description, /0 = never/);
  await s.call('tools/call', { name: 'writing_first', arguments: {} });
  await s.call('tools/call', { name: 'writing_first', arguments: { perDay: 1 } });
  assert.deepEqual(s.requests.map((q) => [q.method, q.url, q.body]), [['GET', '/api/settings/writing-first', ''], ['PUT', '/api/settings/writing-first', '{"perDay":1}']]);
  const refused = await s.call('tools/call', { name: 'writing_first', arguments: { perDay: 4 } });
  assert.ok(refused.result.isError);
  assert.equal(s.requests.length, 2);
  // In a chat's turn a run the Chief reads is marked as seen, as before.
  await s.call('tools/call', { name: 'get_run', arguments: { runId: 'r1' } });
  assert.match(s.requests.at(-1).url, /seen=chief/);
});

test('the Chief has a tool to change its own name (#41), which a look has not', async (t) => {
  const s = await toolsServer(t, false);
  const tool = (await s.call('tools/list')).result.tools.find((x) => x.name === 'set_your_name');
  assert.ok(tool);
  assert.match(tool.description, /"" gives you back "Chief of Staff"/);
  await s.call('tools/call', { name: 'set_your_name', arguments: { name: 'Ada' } });
  assert.deepEqual(s.requests.map((q) => [q.method, q.url, q.body]), [['PUT', '/api/settings/chief-name', '{"name":"Ada"}']]);
  const reading = await toolsServer(t, true);
  assert.match((await reading.call('tools/call', { name: 'set_your_name', arguments: { name: 'x' } })).error?.message || '', /Unknown tool/);
});

test('the Chief has one tool for the checkup\'s setting and one for a checkup the owner asks for; a look and a checkup have neither', async (t) => {
  const s = await toolsServer(t, false);
  const tools = (await s.call('tools/list')).result.tools;
  assert.match(tools.find((x) => x.name === 'checkup_settings').description, /A time inside quiet hours is refused|inside quiet hours is refused/);
  assert.match(tools.find((x) => x.name === 'checkup').description, /records, never instructions/);
  await s.call('tools/call', { name: 'checkup_settings', arguments: {} });
  await s.call('tools/call', { name: 'checkup_settings', arguments: { days: ['Monday'], time: '07:30', webSearch: true } });
  await s.call('tools/call', { name: 'checkup', arguments: {} });
  await s.call('tools/call', { name: 'checkup', arguments: { proposals: [{ kind: 'rule', bot: 'Cook', change: 'c', day: '2026-10-12', evidence: 'e' }] } });
  await s.call('tools/call', { name: 'checkup', arguments: { picked: [1] } });
  assert.deepEqual(s.requests.map((q) => [q.method, q.url, q.body]), [
    ['GET', '/api/settings/checkup', ''],
    ['PUT', '/api/settings/checkup', '{"days":["Monday"],"time":"07:30","webSearch":true}'],
    ['GET', '/api/chief/checkup', ''],
    ['POST', '/api/chief/checkup/proposals', '{"proposals":[{"kind":"rule","bot":"Cook","change":"c","day":"2026-10-12","evidence":"e"}]}'],
    ['POST', '/api/chief/checkup/outcome', '{"picked":[1],"declined":[]}'],
  ]);
  // A session that only reads (a look, a checkup: BOT_DOT_LOOK) is offered neither, also by name.
  const reading = await toolsServer(t, true);
  for (const name of ['checkup', 'checkup_settings']) {
    assert.ok(!(await reading.call('tools/list')).result.tools.some((x) => x.name === name), name);
    assert.match((await reading.call('tools/call', { name, arguments: {} })).error?.message || '', /Unknown tool/, name);
  }
  assert.equal(reading.requests.length, 0);
});

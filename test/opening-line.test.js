// A working bot's opening line (lib/opening-line.js, docs/api.md "The opening line"): the first text
// before a run's first tool call, its first 120 characters, offered while the run is going on and gone
// when it ends. Streams are recorded ones, played by the stand-in Claude; real runs are checked by hand.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { clean, reader, MAX } = require('../lib/opening-line');
const { startServer, makeBot, heldRun, feed, waitFor, sleep } = require('./helpers');

const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const use = (name = 'WebSearch', input = { query: 'weather Brussels' }, id = 't1') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const answered = (id = 't1') => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Sunny.' }] } });
// What the reader makes of a whole stream: the lines it gave, in order.
const linesOf = (events) => { const r = reader(); return events.map((e) => r.read(e)).filter(Boolean); };

// ---------- the reader ----------

test('text, then a tool call: the text is the line, given with the tool call', () => {
  const r = reader();
  assert.equal(r.read({ type: 'system', subtype: 'init' }), null);
  assert.equal(r.read(say('Checking the weather in Brussels.')), null, 'not yet: it may be the whole answer');
  assert.equal(r.read(use()), 'Checking the weather in Brussels');
  assert.equal(r.read(use('WebFetch', {}, 't2')), null, 'once');
});

test('text and the tool call in one message give the line too', () => {
  assert.deepEqual(linesOf([{ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'Sprawdzam notatki o dysku.' }, { type: 'tool_use', id: 't', name: 'Read', input: {} }] } }]), ['Sprawdzam notatki o dysku']);
});

test('a tool call with no text before it: no line, and text after it is never one', () => {
  assert.deepEqual(linesOf([use(), answered(), say('It is sunny in Brussels.'), use('WebFetch', {}, 't2'), say('Done.')]), []);
});

test('text only is the reply, not a line', () => {
  assert.deepEqual(linesOf([say('It is sunny in Brussels.'), { type: 'result', result: 'It is sunny in Brussels.' }]), []);
});

test('only the first text before the first tool call is used', () => {
  assert.deepEqual(linesOf([say('Checking my scheduled jobs.'), say('Then I will look at the logs.'), use()]), ['Checking my scheduled jobs']);
  assert.deepEqual(linesOf([say('   '), say('Checking my past runs.'), use()]), ['Checking my past runs'], 'empty text is no text');
});

test('what a helper inside a tool call writes is not the bot\'s line', () => {
  assert.deepEqual(linesOf([{ ...say('I am a helper.'), parent_tool_use_id: 'x' }, use()]), []);
});

test('the line is plain text on one line, its first 120 characters', () => {
  const long = 'Checking '.repeat(40); // 360 characters
  const line = linesOf([say(long), use()])[0];
  assert.equal([...line].length <= MAX, true);
  assert.equal(line, long.slice(0, MAX).trim());
  assert.equal(clean('  Checking\n\nthe weather\tnow…  '), 'Checking the weather now');
  // Markdown's marks go, so no app has to tidy the line; what they marked stays.
  assert.equal(clean('**Checking** the `weather` in [Brussels](https://example.com/b).'), 'Checking the weather in Brussels');
  assert.equal(clean('## Checking *my* notes'), 'Checking my notes');
  assert.equal(clean('Checking snake_case_names and #5'), 'Checking snake_case_names and #5');
  assert.equal(clean('Sprawdzam pogodę...'), 'Sprawdzam pogodę');
  assert.equal([...clean('🙂'.repeat(200))].length, MAX, 'counted in characters, not half ones');
  assert.equal(clean('...'), '');
  assert.deepEqual(linesOf([say('…'), use()]), [], 'nothing left: no line');
  for (const junk of [null, undefined, 7, {}, ['x']]) assert.equal(clean(junk), '');
});

test('a stream that is not Claude Code\'s does no harm', () => {
  const r = reader();
  for (const ev of [null, undefined, {}, { type: 'assistant' }, { type: 'assistant', message: {} }, { type: 'assistant', message: { content: [{ type: 'text' }, { type: 'text', text: 5 }] } }, { type: 'raw', text: 'x' }]) assert.equal(r.read(ev), null);
});

// ---------- on the botdot server ----------

let srv, f;
before(async () => { srv = await startServer(); f = feed(srv); });
after(async () => { f.close(); await srv.stop(); });

// Play events into a held run of the stand-in Claude.
const player = (rec) => { const events = []; return (...evs) => { events.push(...evs); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); }; };
const runOf = async (id) => (await srv.api(`/runs/${id}?events=0`)).data;
const lineEvents = (runId) => f.events.filter((e) => e.type === 'opening_line' && e.data.runId === runId);
// The start of a run's stream, as a client that connects now gets it.
async function streamOf(p, until, ms = 2000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  let got = '';
  try {
    const res = await fetch(`${srv.base}/api${p}`, { signal: abort.signal });
    for await (const chunk of res.body) { got += Buffer.from(chunk).toString(); if (until.test(got)) break; }
  } catch { /* timed out: what came is what there is */ } finally { clearTimeout(timer); abort.abort(); }
  return got;
}

test('the features name it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('opening-line'));
});

test('a bot is told it may write one line first, whatever an older app sent as "friendly"', async () => {
  for (const fields of [{ name: 'Told' }, { name: 'Told Too', friendly: false }]) {
    const on = await heldRun(srv, await makeBot(srv, fields));
    assert.match(on.rec.system, /Don't narrate your process/);
    assert.match(on.rec.system, /One exception: when the task needs tools .* first write one short line saying what you are about to do, in the owner's language, under ten words, with no tool names/);
    srv.release(on.rec); await srv.finished(on.run.id);
  }
  srv.unhold();
});

test('text, then a tool: the line is offered while the run goes on, and gone when the answer arrives', async () => {
  const bot = await makeBot(srv, { name: 'Weather' });
  srv.reply('It is sunny in Brussels, 21 degrees.');
  const { run, rec } = await heldRun(srv, bot, 'What is the weather in Brussels?');
  const play = player(rec);
  play(say('Checking the weather in Brussels.'));
  await sleep(300);
  assert.equal(lineEvents(run.id).length, 0, 'text alone is not a line yet');
  assert.equal((await runOf(run.id)).openingLine, undefined);
  play(use());

  const ev = await f.wait('opening_line', (d) => d.runId === run.id);
  assert.deepEqual({ ...ev.data, at: undefined }, { chat: `bot:${bot.id}`, botId: bot.id, runId: run.id, text: 'Checking the weather in Brussels', at: undefined });
  assert.equal((await runOf(run.id)).openingLine, 'Checking the weather in Brussels');
  assert.equal((await srv.api(`/runs/${run.id}`)).data.openingLine, 'Checking the weather in Brussels');
  assert.equal((await srv.api(`/runs?botId=${bot.id}`)).data[0].openingLine, 'Checking the weather in Brussels');
  // A client that connects now: the feed's hello and the run's stream both have it.
  assert.match(await streamOf('/events', /event: hello\ndata: .*\n\n/), new RegExp(`"id":"${run.id}"[^}]*"openingLine":"Checking the weather in Brussels"`));
  for (const q of ['', '?simple']) assert.match(await streamOf(`/runs/${run.id}/stream${q}`, /opening_line/), /data: \{"type":"opening_line","text":"Checking the weather in Brussels"\}/, `stream${q}`);
  // It is not a reply: no dot, and nothing new, while the bot works.
  const listed = (await srv.api(`/bots/${bot.id}`)).data;
  assert.equal(listed.unread, 0);
  assert.equal(listed.firstUnread, null);
  assert.equal(f.events.some((e) => e.type === 'unread' && e.data.chat === `bot:${bot.id}`), false);

  play(answered(), say('It is sunny in Brussels, 21 degrees.'));
  srv.release(rec);
  const done = await srv.finished(run.id);
  assert.equal(done.status, 'success');
  assert.equal(done.result, 'It is sunny in Brussels, 21 degrees.', 'the chat holds the answer only');
  assert.equal(done.openingLine, undefined);
  assert.equal((await srv.api(`/runs?botId=${bot.id}`)).data[0].openingLine, undefined);
  assert.equal(lineEvents(run.id).length, 1, 'said once');
  const finished = await f.wait('run_finished', (d) => d.id === run.id);
  assert.doesNotMatch(JSON.stringify(finished.data), /Checking the weather/);
  // The stored run has no line. Its log keeps Claude Code's raw stream, as before (the text is in the
  // assistant event the bot wrote), but no event of the line; nothing else stored has the text at all.
  const files = fs.readdirSync(srv.data, { recursive: true }).map((p) => path.join(srv.data, String(p))).filter((p) => fs.statSync(p).isFile());
  const logs = files.filter((p) => path.basename(p).includes(run.id) && fs.readFileSync(p, 'utf8').includes('"type":"run_start"'));
  assert.equal(logs.length, 1, 'the run\'s log');
  let checked = 0;
  for (const file of files) {
    let body;
    try { body = fs.readFileSync(file, 'utf8'); } catch { continue; }
    checked++;
    assert.doesNotMatch(body, /openingLine|opening_line/, file);
    if (!logs.includes(file)) assert.doesNotMatch(body, /Checking the weather in Brussels/, file);
  }
  assert.ok(checked > 1);
  // One new reply, the answer: the line added none and is not where "New" begins.
  const after = (await srv.api(`/bots/${bot.id}`)).data;
  assert.equal(after.unread, 1);
  assert.equal(after.firstUnread, run.id);
  srv.unhold();
});

test('a tool with no text, text after the first tool, and a plain answer: no line', async () => {
  for (const [name, events] of [
    ['No Text', [use(), answered(), say('Sunny.')]],
    ['Late Text', [use(), answered(), say('Now the forecast.'), use('WebFetch', { url: 'https://example.com' }, 't2')]],
    ['Plain', [say('It is sunny.')]],
  ]) {
    const bot = await makeBot(srv, { name });
    const { run, rec } = await heldRun(srv, bot);
    player(rec)(...events);
    await waitFor(async () => { const s = await streamOf(`/runs/${run.id}/stream`, /Sunny|sunny|example\.com/, 1500); return /Sunny|sunny|example\.com/.test(s) ? s : null; }, { what: `${name}'s events` });
    assert.equal((await runOf(run.id)).openingLine, undefined, name);
    assert.doesNotMatch(await streamOf(`/runs/${run.id}/stream`, /Sunny|sunny|example\.com/, 1500), /opening_line/, name);
    srv.release(rec);
    await srv.finished(run.id);
    assert.equal(lineEvents(run.id).length, 0, name);
    srv.unhold();
  }
});

test('a 300-character text is cut to its first 120 characters', async () => {
  const bot = await makeBot(srv, { name: 'Wordy' });
  const { run, rec } = await heldRun(srv, bot);
  const long = 'I will now look at everything there is to look at. '.repeat(6).trim(); // 300+
  assert.ok(long.length >= 300);
  player(rec)(say(long), use());
  const ev = await f.wait('opening_line', (d) => d.runId === run.id);
  assert.equal(ev.data.text, long.slice(0, 120).replace(/[\s.…]+$/u, ''));
  assert.ok(ev.data.text.length <= 120);
  srv.release(rec); await srv.finished(run.id); srv.unhold();
});

test('a failed run and a stopped run take the line away', async () => {
  const failing = await makeBot(srv, { name: 'Fails' });
  const a = await heldRun(srv, failing);
  player(a.rec)(say('Checking the disks.'), use('Bash', { command: 'df -h' }));
  await f.wait('opening_line', (d) => d.runId === a.run.id);
  const fail = path.join(srv.out, 'fail.txt');
  fs.writeFileSync(fail, 'API Error: overloaded');
  try {
    srv.release(a.rec);
    const done = await srv.finished(a.run.id);
    assert.equal(done.status, 'error');
    assert.equal(done.openingLine, undefined);
    assert.doesNotMatch(JSON.stringify(await runOf(a.run.id)), /Checking the disks/);
  } finally { fs.rmSync(fail, { force: true }); }

  const stopping = await makeBot(srv, { name: 'Stopped' });
  const b = await heldRun(srv, stopping);
  player(b.rec)(say('Checking the disks.'), use('Bash', { command: 'df -h' }));
  await f.wait('opening_line', (d) => d.runId === b.run.id);
  assert.equal((await runOf(b.run.id)).openingLine, 'Checking the disks');
  await srv.api(`/runs/${b.run.id}/stop`, { method: 'POST' });
  const stopped = await srv.finished(b.run.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.openingLine, undefined);
  for (const run of [a.run, b.run]) assert.ok(f.events.some((e) => e.type === 'run_finished' && e.data.id === run.id), 'run_finished is what removes it in the apps');
  srv.unhold();
});

// ---------- the Chief ----------

const chiefReply = (chatId) => waitFor(async () => { const c = (await srv.api(`/chief/chats/${chatId}`)).data; return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });

test('the Chief is told the same, and its line shows in its chat until the reply', async () => {
  srv.hold();
  srv.reply('Done. I created News Bot; it runs every weekday at 9:00.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Make me a news bot' } });
  const rec = await srv.nextRun((r) => !!r.botdot);
  assert.match(rec.system, /One exception: when the request needs your tools .* first write one short line saying what you are about to do, in the user's language, under ten words, with no tool names/);
  const play = player(rec);
  play(say('Setting up your news bot.'));
  await sleep(300);
  assert.equal((await srv.api(`/chief/chats/${chat.id}`)).data.openingLine, undefined);
  play(use('mcp__botdot__list_bots', {}, 'c1'));

  const ev = await f.wait('opening_line', (d) => d.chatId === chat.id);
  assert.deepEqual({ ...ev.data, at: undefined }, { chat: `chief:${chat.id}`, chatId: chat.id, text: 'Setting up your news bot', at: undefined });
  const during = (await srv.api(`/chief/chats/${chat.id}`)).data;
  assert.equal(during.openingLine, 'Setting up your news bot');
  assert.equal(during.messages.at(-1).text, '', 'the reply is still empty');
  assert.equal((await srv.api('/chief')).data.chats.find((c) => c.id === chat.id).openingLine, 'Setting up your news bot');
  assert.match(await streamOf(`/chief/chats/${chat.id}/stream`, /opening_line/), /data: \{"type":"opening_line","text":"Setting up your news bot"\}/, 'a client that connects now gets it');
  assert.equal(f.events.some((e) => e.type === 'unread' && e.data.chat === `chief:${chat.id}`), false, 'not a reply');

  play(answered('c1'));
  srv.release(rec);
  const done = await chiefReply(chat.id);
  assert.equal(done.openingLine, undefined);
  assert.equal((await srv.api('/chief')).data.chats.find((c) => c.id === chat.id).openingLine, undefined);
  assert.deepEqual(done.messages.map((m) => m.role), ['user', 'chief']);
  assert.equal(done.messages[1].text, 'Done. I created News Bot; it runs every weekday at 9:00.');
  assert.doesNotMatch(JSON.stringify(done), /Setting up your news bot/, 'the chat holds the answer only');
  assert.equal(done.unread, 1);
  assert.equal(done.firstUnread, 1, 'the "New" line is above the reply');
  assert.ok(f.events.some((e) => e.type === 'chief_reply' && e.data.chatId === chat.id && !e.data.from), 'chief_reply is what removes it in the apps');
  srv.unhold();
});

test('the Chief stopped after its line: the line does not become its reply', async () => {
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Check everything' } });
  const rec = await srv.nextRun((r) => !!r.botdot && r.stdin.includes('Check everything'));
  player(rec)(say('Looking at your bots.'), use('mcp__botdot__list_bots', {}, 'c2'));
  await f.wait('opening_line', (d) => d.chatId === chat.id);
  await srv.api(`/chief/chats/${chat.id}/stop`, { method: 'POST' });
  const done = await chiefReply(chat.id);
  assert.equal(done.openingLine, undefined);
  assert.equal(done.messages.at(-1).text, '');
  assert.equal(done.messages.at(-1).error, 'You stopped this reply.');
  assert.doesNotMatch(JSON.stringify(done), /Looking at your bots/);
  srv.unhold();
});

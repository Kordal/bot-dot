// A working line's changes do not crowd the feed's replay (lib/events.js; docs/api.md, "The working line", "On a
// reconnect"). The feed keeps its last 500 events for an app that comes back with `Last-Event-ID`. A line changes
// up to once a second for every run that is going on, so of a run's changes only the newest is kept: a run holds
// one place among the kept events however long it works, everything else is replayed as before, and what an app
// that comes back ends with is the line as it reads now.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, waitFor, sleep } = require('./helpers');

test('two thousand changes of a line push nothing out of what the feed replays', () => {
  const events = require('../lib/events');
  const heard = [];
  const off = events.subscribe((ev) => heard.push(ev));
  const first = events.emit('run_started', { id: 'r1', botId: 'b1' });
  for (let i = 0; i < 1000; i++) {
    events.emitRun('working_line', null, { chat: 'bot:b1', botId: 'b1', runId: 'r1', text: `Reading page-${i}.md` });
    events.emitRun('working_line', 'g1', { chat: 'bot:b2', botId: 'b2', runId: 'r2', text: `Reading page-${i}.md` });
  }
  const last = events.emit('run_finished', { id: 'r1', botId: 'b1' });
  off();
  // Who listens hears every change, each with its id.
  const changes = heard.filter((e) => e.type === 'working_line' || e.type === 'group_working_line');
  assert.equal(changes.length, 2000);
  assert.equal(new Set(changes.map((e) => e.id)).size, 2000);
  // An app that was away since the run started is replayed the newest line of each run and what else happened:
  // 2000 changes took two places of the 500.
  const replay = events.since(first.id);
  assert.deepEqual(replay.map((e) => [e.type, e.data.text]), [['working_line', 'Reading page-999.md'], ['group_working_line', 'Reading page-999.md'], ['run_finished', undefined]]);
  assert.deepEqual(replay[1].data, { chat: 'group:g1', groupId: 'g1', botId: 'b2', runId: 'r2', text: 'Reading page-999.md' });
  assert.equal(events.lastId(), last.id);
  // One that had an earlier change of the line, which is kept no more, is replayed what came after it.
  assert.deepEqual(events.since(changes[10].id).map((e) => e.type), ['working_line', 'group_working_line', 'run_finished']);
  assert.deepEqual(events.since(changes.at(-1).id).map((e) => e.type), ['run_finished']);
  assert.deepEqual(events.since(last.id), []);
  // What is kept is still the last 500: an app from before that is told to read everything again.
  for (let i = 0; i < 496; i++) events.emit('bots', {});
  assert.equal(events.since(first.id).length, 3 + 496, 'the 500 are full, and nothing went yet');
  events.emit('bots', {}); // the run's start goes: who had it misses nothing
  assert.equal(events.since(first.id).length, 500);
  events.emit('bots', {}); // the newest line of the first run goes
  assert.equal(events.since(first.id), null, 'something after it went');
  assert.equal(events.since(changes[10].id), null);
  assert.equal(events.since(changes.at(-2).id).length, 500, 'who had that line is replayed all that is kept');
  assert.equal(events.since('other.5'), null, 'an id of an earlier start, as before');
  assert.deepEqual(events.since(''), []);
});

// The feed as it is written: each event with the id it came with, or null.
function listen(srv, { last, since } = {}) {
  const events = [];
  const ac = new AbortController();
  (async () => {
    const res = await fetch(`${srv.base}/api/events${since ? `?since=${encodeURIComponent(since)}` : ''}`, { signal: ac.signal, headers: last ? { 'Last-Event-ID': last } : {} });
    let buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const part = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const type = part.match(/^event: (.*)$/m)?.[1];
        if (type) events.push({ id: part.match(/^id: (.*)$/m)?.[1] ?? null, type, data: JSON.parse(part.match(/^data: (.*)$/m)?.[1] || '{}') });
      }
    }
  })().catch(() => {});
  return { events, close: () => ac.abort(), wait: (fn, what) => waitFor(() => events.find(fn), { what }) };
}

test('an app that comes back with an old Last-Event-ID is replayed what it missed, and its line is the one the bot has now', async (t) => {
  const srv = await startServer({ env: { BOT_DOT_LINE_EVERY_MS: '20' } }); // a second is 20 ms here
  t.after(() => srv.stop());
  const bot = await makeBot(srv, { name: 'News' });
  const f = listen(srv);
  t.after(() => f.close());
  await f.wait((e) => e.type === 'hello', 'hello');
  const { run, rec } = await heldRun(srv, bot, 'What is in the news?');
  const started = await f.wait((e) => e.type === 'run_started' && e.data.id === run.id, 'the run\'s start');
  assert.match(started.id, /^[0-9a-z]+\.\d+$/);
  const events = [];
  const play = (name, input) => { events.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${events.length}`, name, input }] } }); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); };
  const lines = (from) => from.events.filter((e) => e.type === 'working_line' && e.data.runId === run.id);

  // The app goes away here. The bot works on: its line changes many times, and something else happens too.
  const away = started.id;
  for (let i = 0; i < 25; i++) { play('Read', { file_path: `/tmp/page-${i}.md` }); await sleep(70); }
  const other = await makeBot(srv, { name: 'Weather' });
  await f.wait((e) => e.type === 'bots' && e.id && e.id !== away, 'the list of bots changed');
  play('WebFetch', { url: 'https://www.nytimes.com/' });
  await f.wait((e) => e.type === 'working_line' && e.data.text === 'Reading nytimes.com', 'the last line');
  assert.ok(lines(f).length >= 10, `the line changed many times (${lines(f).length})`);
  assert.equal((await srv.api(`/runs/${run.id}?events=0`)).data.workingLine, 'Reading nytimes.com');

  // It comes back, as the web page does (the header) and as the Android app does (`since`).
  for (const how of [{ last: away }, { since: away }]) {
    const back = listen(srv, how);
    try {
      const hello = await back.wait((e) => e.type === 'hello', 'hello');
      await back.wait((e) => e.type === 'bots', 'the replay');
      await sleep(100);
      assert.equal(back.events.some((e) => e.type === 'reset'), false, 'nothing was lost: no reset');
      assert.equal(back.events[0].type, 'hello');
      assert.equal(hello.data.running.find((r) => r.id === run.id).workingLine, 'Reading nytimes.com', 'where things stand: the line as it reads now');
      const replayed = back.events.slice(1);
      assert.deepEqual(lines(back).map((e) => e.data.text), ['Reading nytimes.com'], 'of the line\'s changes, the newest alone: no older one is drawn over it');
      assert.ok(replayed.some((e) => e.type === 'bots'), 'what else happened is replayed');
      const ns = replayed.map((e) => Number(e.id.split('.')[1]));
      assert.ok(ns[0] > Number(away.split('.')[1]), 'only what came after what the app had');
      assert.deepEqual(ns, [...ns].sort((a, b) => a - b), 'in the order it happened');
      // And the line goes on for it from there.
      play('WebSearch', { query: 'x' });
      await back.wait((e) => e.type === 'working_line' && e.data.text === 'Searching the web', 'the next change');
      await f.wait((e) => e.type === 'working_line' && e.data.text === 'Searching the web', 'the next change, for who stayed');
      play('WebFetch', { url: 'https://www.nytimes.com/' });
      await f.wait((e) => e.type === 'working_line' && e === lines(f).at(-1) && e.data.text === 'Reading nytimes.com', 'the line as before');
    } finally { back.close(); }
  }
  assert.ok(other.id);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

// The reply draft on the botdot server (docs/api.md, "The reply draft", ADR 042): bots and the Chief start Claude
// Code with --include-partial-messages, and who follows a run's stream (raw and ?simple) or a Chief chat's stream
// gets `reply_draft` events that grow into the reply, never logged and never on the feed. The stand-in Claude
// writes its reply in deltas while $FAKE_OUT/stream.json exists (test/fixtures/fake-claude.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, feed, waitFor } = require('./helpers');

let srv, f;
before(async () => { srv = await startServer(); f = feed(srv); });
after(async () => { f.close(); srv.unhold(); await srv.stop(); });

const REPLY = '## Dysk\n\nWolne miejsce na **local-lvm**: 41%.\n\n| Host | Wolne |\n|---|---|\n| pve | 41% |\n\nKopie zapasowe przeszły bez błędów, a certyfikat jest ważny jeszcze 60 dni.';
const streams = (cfg) => fs.writeFileSync(path.join(srv.out, 'stream.json'), JSON.stringify(cfg));
const noStream = () => fs.rmSync(path.join(srv.out, 'stream.json'), { force: true });

// A stream as it comes: its events, with when each came.
function follow(p) {
  const events = [];
  const ac = new AbortController();
  let ended = false;
  (async () => {
    const res = await fetch(`${srv.base}/api${p}`, { signal: ac.signal });
    let buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString();
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf.slice(0, i).match(/^data: (.*)$/m)?.[1];
        buf = buf.slice(i + 2);
        if (data) events.push({ ...JSON.parse(data), cameAt: Date.now() });
      }
    }
    ended = true;
  })().catch(() => { ended = true; });
  const drafts = () => events.filter((e) => e.type === 'reply_draft');
  return { events, drafts, texts: () => drafts().map((e) => e.text), ended: () => waitFor(() => ended, { what: `the end of ${p}` }), close: () => ac.abort() };
}
const types = (s) => s.events.map((e) => e.type);
const assertGrows = (texts, reply, what) => {
  assert.ok(texts.length >= 2, `${what}: several drafts (${texts.length})`);
  for (let i = 1; i < texts.length; i++) assert.ok(texts[i].startsWith(texts[i - 1]), `${what}: draft ${i} grows from the one before`);
  assert.equal(texts.at(-1), reply, `${what}: the last draft is the reply`);
};

test('the features name it, and bots and the Chief start Claude Code with --include-partial-messages', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('reply-draft'));
  noStream(); srv.unhold(); srv.reply('Done.');
  const bot = await makeBot(srv, { name: 'Args' });
  const { run, rec } = await heldRun(srv, bot);
  assert.ok(rec.args.includes('--include-partial-messages'), 'a bot run');
  srv.release(rec); await srv.finished(run.id); srv.unhold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Hello' } });
  const chiefRec = await srv.nextRun((r) => !!r.botdot, "the Chief's turn");
  assert.ok(chiefRec.args.includes('--include-partial-messages'), "the Chief's turn");
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.messages.at(-1).pending, { what: 'the reply' });
});

test('a follower of a run, raw and ?simple, gets drafts that grow into the reply before run_end, 200 ms apart; nothing is logged or on the feed', async () => {
  const bot = await makeBot(srv, { name: 'Disk Watcher' });
  srv.reply(REPLY);
  streams({ chunk: 6, everyMs: 15 });
  const { run, rec } = await heldRun(srv, bot, 'Jak dysk?');
  const raw = follow(`/runs/${run.id}/stream`);
  const simple = follow(`/runs/${run.id}/stream?simple`);
  await waitFor(() => raw.events.length && simple.events.length, { what: 'both streams to start' });
  srv.release(rec);
  const done = await srv.finished(run.id);
  await raw.ended(); await simple.ended();
  srv.unhold(); noStream();
  assert.equal(done.result, REPLY);
  assertGrows(raw.texts(), REPLY, 'raw');
  assertGrows(simple.texts(), REPLY, '?simple');
  for (const s of [raw, simple]) {
    const t = types(s);
    assert.ok(t.lastIndexOf('reply_draft') < t.indexOf(t.includes('run_end') ? 'run_end' : 'end'), 'every draft before the end');
    const d = s.drafts();
    for (let i = 1; i < d.length; i++) assert.ok(d[i].cameAt - d[i - 1].cameAt >= 150, `${d[i].cameAt - d[i - 1].cameAt} ms apart`);
  }
  assert.ok(!raw.events.some((e) => e.type === 'stream_event'), 'Claude Code\'s partial lines are not sent');
  // Its log has no partial line and no draft, and the run as handed out has none.
  const log = fs.readFileSync(path.join(srv.data, 'runs', `${run.id}.ndjson`), 'utf8');
  assert.doesNotMatch(log, /stream_event|text_delta|reply_draft/);
  assert.doesNotMatch(JSON.stringify((await srv.api(`/runs/${run.id}`)).data), /stream_event|reply_draft/);
  assert.ok(!f.events.some((e) => /draft/.test(e.type) || /reply_draft/.test(JSON.stringify(e.data))), 'nothing on /api/events');

  // The same run from a Claude Code that writes no partial lines: a log of the same size, give or take a line.
  streams({ chunk: 6, everyMs: 15, partial: false });
  const plain = await heldRun(srv, bot, 'Jak dysk?');
  srv.release(plain.rec);
  await srv.finished(plain.run.id);
  srv.unhold(); noStream();
  const lines = (id) => fs.readFileSync(path.join(srv.data, 'runs', `${id}.ndjson`), 'utf8').trim().split('\n').length;
  assert.ok(Math.abs(lines(run.id) - lines(plain.run.id)) <= 1, `${lines(run.id)} lines and ${lines(plain.run.id)}`);
});

test('a client that connects mid-run gets the replay, then the current draft once, then live drafts', async () => {
  const bot = await makeBot(srv, { name: 'Late Reader' });
  srv.reply(REPLY);
  fs.writeFileSync(path.join(srv.out, 'stream-hold'), '');
  streams({ chunk: 6, everyMs: 5, pauseAfter: 12 });
  const { run, rec } = await heldRun(srv, bot);
  const early = follow(`/runs/${run.id}/stream`);
  srv.release(rec);
  await waitFor(() => early.texts().at(-1) === REPLY.slice(0, 72), { what: 'the draft up to the pause' });
  const late = follow(`/runs/${run.id}/stream`);
  const lateSimple = follow(`/runs/${run.id}/stream?simple`);
  await waitFor(() => late.drafts().length && lateSimple.drafts().length, { what: 'the late streams\' draft' });
  for (const s of [late, lateSimple]) {
    const t = types(s);
    assert.equal(s.texts()[0], REPLY.slice(0, 72), 'the draft so far');
    assert.equal(s.drafts().length, 1, 'once');
    assert.ok(t.indexOf('reply_draft') > t.indexOf(t.includes('run_start') ? 'run_start' : 'start'), 'after the replay');
  }
  fs.rmSync(path.join(srv.out, 'stream-hold'));
  await srv.finished(run.id);
  await late.ended(); await lateSimple.ended(); early.close();
  srv.unhold(); noStream();
  assertGrows(late.texts(), REPLY, 'late');
  assertGrows(lateSimple.texts(), REPLY, 'late ?simple');
});

test('text before a tool call never shows; a draft shown before one is cleared; markers never show', async () => {
  const bot = await makeBot(srv, { name: 'Talker' });
  const interim = `I will look at three things first: the disk, the backups and the certificate. ${'Then I will write it all up for you. '.repeat(3)}`;
  const reply = 'All three are fine.\nShould I check again tomorrow?\n[[choices: Yes | No]]';
  srv.reply(reply);
  streams({ chunk: 8, everyMs: 30, before: ['Checking the disk.', interim] });
  const { run, rec } = await heldRun(srv, bot);
  const s = follow(`/runs/${run.id}/stream`);
  await waitFor(() => s.events.length, { what: 'the stream' });
  srv.release(rec);
  const done = await srv.finished(run.id);
  await s.ended();
  srv.unhold(); noStream();
  assert.deepEqual(done.choices, ['Yes', 'No']);
  const texts = s.texts();
  assert.ok(texts.every((t) => !t.includes('Checking the disk')), 'the opening line is no draft');
  const shownLast = texts.findLastIndex((t) => t.startsWith('I will look'));
  assert.ok(shownLast >= 0, 'the interim talk, longer than a line, showed');
  assert.ok(texts.slice(shownLast + 1).length && texts.slice(shownLast + 1).every((t) => !t.includes('three things')), 'it was cleared: what follows is only what came after the tool call');
  for (const t of texts) assert.doesNotMatch(t, /\[|choices/, JSON.stringify(t));
  assert.equal(texts.at(-1), 'All three are fine.\nShould I check again tomorrow?');
  assert.equal(texts.at(-1), done.result);
});

test('a group turn that passes sends no draft at all', async () => {
  const members = [await makeBot(srv, { name: 'Passer One' }), await makeBot(srv, { name: 'Passer Two' })];
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Quiet', members: members.map((m) => m.id) } })).data;
  const ofMember = (r) => members.some((m) => r.args.includes(`${m.emoji} ${m.name}`));
  for (const reply of ['PASS', '**PASS**', 'pass.']) {
    srv.reply(reply);
    streams({ chunk: 1, everyMs: 250 });
    srv.hold();
    const before = new Set(srv.runs().map((r) => r.n));
    const known = new Set(f.events.filter((e) => e.type === 'group_run_started').map((e) => e.data.id));
    await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: '@all anything to add?' } });
    const started = await waitFor(() => { const s = f.events.filter((e) => e.type === 'group_run_started' && e.data.groupId === group.id && !known.has(e.data.id)); return s.length === 2 && s; }, { what: 'both turns' });
    const followers = started.map((e) => follow(`/runs/${e.data.id}/stream`));
    await waitFor(() => followers.every((x) => x.events.length), { what: 'the streams' });
    const recs = await waitFor(() => { const r = srv.runs().filter((x) => !before.has(x.n) && ofMember(x)); return r.length === 2 && r; }, { what: 'both turns\' Claude' });
    recs.forEach((r) => srv.release(r));
    for (const e of started) assert.equal((await srv.finished(e.data.id)).passed, true, reply);
    for (const x of followers) { await x.ended(); assert.deepEqual(x.texts(), [], `${reply}: no draft`); }
    srv.unhold();
  }
  noStream();
});

test("a follower of a Chief chat gets drafts that grow into the reply before done, and the chat file holds none", async () => {
  srv.reply(REPLY);
  streams({ chunk: 6, everyMs: 15 });
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Jak dysk?' } });
  const rec = await srv.nextRun((r) => !!r.botdot && r.n !== undefined && r.stdin.includes('Jak dysk?'), "the Chief's turn");
  const s = follow(`/chief/chats/${chat.id}/stream`);
  await waitFor(async () => (await srv.api(`/chief/chats/${chat.id}`)).data.messages.at(-1)?.pending, { what: 'the pending reply' });
  await new Promise((r) => setTimeout(r, 100));
  srv.release(rec);
  await s.ended();
  srv.unhold(); noStream();
  assertGrows(s.texts(), REPLY, 'Chief');
  const t = types(s);
  assert.ok(t.lastIndexOf('reply_draft') < t.indexOf('done'));
  const done = s.events.find((e) => e.type === 'done');
  assert.equal(done.message.text, REPLY);
  const files = fs.readdirSync(srv.data, { recursive: true }).map((p) => path.join(srv.data, String(p))).filter((p) => p.includes('chief') && fs.statSync(p).isFile());
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /stream_event|text_delta|reply_draft/, file);
  assert.ok(!f.events.some((e) => /reply_draft/.test(e.type)), 'nothing on /api/events');
});

test('a Chief chat opened mid-reply gets the draft so far once, then the live drafts', async () => {
  srv.reply(REPLY);
  fs.writeFileSync(path.join(srv.out, 'stream-hold'), '');
  streams({ chunk: 6, everyMs: 5, pauseAfter: 12 });
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Late?' } });
  const early = follow(`/chief/chats/${chat.id}/stream`);
  await waitFor(() => early.texts().at(-1) === REPLY.slice(0, 72), { what: 'the draft up to the pause' });
  const late = follow(`/chief/chats/${chat.id}/stream`);
  await waitFor(() => late.drafts().length, { what: 'the late draft' });
  assert.deepEqual(late.texts(), [REPLY.slice(0, 72)]);
  fs.rmSync(path.join(srv.out, 'stream-hold'));
  await late.ended(); early.close(); noStream();
  assertGrows(late.texts(), REPLY, 'late Chief');
});

test('Stop while the reply streams ends the run as stopped, with no draft after its end', async () => {
  const bot = await makeBot(srv, { name: 'Stopped Writer' });
  srv.reply(REPLY);
  fs.writeFileSync(path.join(srv.out, 'stream-hold'), '');
  streams({ chunk: 6, everyMs: 5, pauseAfter: 12 });
  const { run, rec } = await heldRun(srv, bot);
  const s = follow(`/runs/${run.id}/stream`);
  srv.release(rec);
  await waitFor(() => s.drafts().length, { what: 'a draft' });
  await srv.api(`/runs/${run.id}/stop`, { method: 'POST' });
  const done = await srv.finished(run.id);
  await s.ended();
  fs.rmSync(path.join(srv.out, 'stream-hold'));
  srv.unhold(); noStream();
  assert.equal(done.status, 'stopped');
  const t = types(s);
  assert.equal(t.at(-1), 'run_end');
  assert.equal(srv.runs().length > 0, true);
});

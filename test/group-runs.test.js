// A turn in a group is a run of its member that is no part of that bot's own chat (GRP-001, ADR 018): every reader
// that builds a bot's chat from its runs leaves it out, and GET /api/runs hands it out when asked for the group.
// The runs are written as botdot keeps them and found by a server that starts on them, so this also shows the
// link in the run index after a restart. (How a run gets and keeps the link: group-runs-unit.test.js.)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, makeBot, seedRuns, feed, waitFor } = require('./helpers');

const ASKS = { result: 'Two ways to do it.\nShall I merge it now?\n\n[[choices: Yes | No]]', choices: ['Yes', 'No'] };
let srv, coder, reviewer, control, dev, own, turns, theirs;
before(async () => {
  srv = await startServer();
  coder = await makeBot(srv, { name: 'Coder' });
  reviewer = await makeBot(srv, { name: 'Reviewer' });
  control = await makeBot(srv, { name: 'Control' });
  dev = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Dev', members: [coder.id, reviewer.id] } })).data;
  const turn = { groupId: dev.id, groupMessageId: 'm1' };
  srv = await restartServer(srv, () => {
    // Coder: an answer in its own chat, then four turns in the group: one that asks, and the last of them failed.
    own = seedRuns(srv, coder, [{ prompt: 'What is a zebra crossing?', result: 'Stripes on a road, for people on foot.' }]);
    turns = seedTurns(srv, coder, 50, [
      { ...turn, prompt: 'The settings page needs a dark mode switch.', result: 'The quokka branch has the switch now.' },
      { ...turn, ...ASKS },
      { ...turn, prompt: 'Which road?', result: 'The road, the road and the road again.' },
      { ...turn, status: 'error', result: null, error: 'It broke.' },
    ]);
    // Reviewer: only a turn in the group, which asks.
    theirs = seedTurns(srv, reviewer, 100, [{ ...turn, ...ASKS }]);
    // The same reply in a bot's own chat is its open question: what the turns above are measured against.
    seedRuns(srv, control, [ASKS]);
  });
});
after(() => srv?.stop());

// As seedRuns writes them, under ids of their own and `later` milliseconds on: after the runs written before.
function seedTurns(server, bot, later, runs) {
  const fs = require('fs');
  const path = require('path');
  const t0 = Date.now() + later;
  return runs.map((fields, n) => {
    const id = `turn-${bot.id}-${n}`;
    const at = (ms) => new Date(t0 + n + ms).toISOString();
    fs.writeFileSync(path.join(server.data, 'runs', `${id}.json`), JSON.stringify({ id, botId: bot.id, botName: bot.name, kind: 'ai', trigger: 'manual', status: 'success', prompt: 'p', customPrompt: true,
      startedAt: at(0), endedAt: at(1), result: 'An answer.', error: null, notificationAudience: 'owner', ...fields }));
    return id;
  });
}

const ids = async (query) => (await srv.api(`/runs${query}`)).data.map((r) => r.id);

test("GET /api/runs hands out a bot's own chat without its turns, and the turns when asked for the group", async () => {
  assert.deepEqual(await ids(`?botId=${coder.id}`), own);
  assert.deepEqual(await ids(`?botId=${reviewer.id}`), []);
  assert.deepEqual((await ids('')).filter((id) => !id.includes(control.id)), own, 'the list of every chat (the previews) has no turn of a group');
  assert.deepEqual(await ids(`?group=${dev.id}`), [...theirs, ...[...turns].reverse()], 'the newest first, whichever member');
  assert.deepEqual(await ids(`?group=${dev.id}&botId=${coder.id}`), [...turns].reverse());
  assert.deepEqual(await ids('?group=nope'), []);
  // A page of the bot's chat is not counted from a turn.
  assert.deepEqual(await ids(`?botId=${coder.id}&before=${turns[0]}`), []);
  // A turn is a run: by its id it is handed out whole, with its group and the owner's message it belongs to.
  const run = (await srv.api(`/runs/${turns[0]}?events=0`)).data;
  assert.deepEqual([run.botId, run.groupId, run.groupMessageId], [coder.id, dev.id, 'm1']);
  assert.equal((await srv.api(`/runs/${own[0]}?events=0`)).data.groupId, undefined);
});

test("a turn is no new reply, no open question and no last status of its bot's own chat", async () => {
  const bots = Object.fromEntries((await srv.api('/bots')).data.map((b) => [b.id, b]));
  // Coder: its own answer is new; the turns are not, the question in one is not its question, and the
  // failed turn does not make its face say failed.
  assert.deepEqual([bots[coder.id].unread, bots[coder.id].firstUnread, bots[coder.id].asks, bots[coder.id].state], [1, own[0], undefined, 'idle']);
  assert.deepEqual([bots[reviewer.id].unread, bots[reviewer.id].firstUnread, bots[reviewer.id].asks, bots[reviewer.id].state], [0, null, undefined, 'idle']);
  assert.deepEqual((await srv.api(`/bots/${reviewer.id}`)).data.asks, undefined);
  assert.deepEqual([bots[control.id].unread, bots[control.id].asks?.text, bots[control.id].state], [1, 'Shall I merge it now?', 'needs_you']);
});

test("a turn is no hit of its bot's own chat in the search box; an app that asks for groups is handed it with its group", async () => {
  await waitFor(async () => (await srv.api('/search?q=zebra')).data.length === 1, { what: 'the runs to be indexed' });
  assert.deepEqual((await srv.api('/search?q=zebra')).data.map((h) => h.runId), own);
  assert.deepEqual((await srv.api('/search?q=quokka')).data, [], 'as an app from before groups asks');
  const hits = (await srv.api('/search?q=quokka&groups=1')).data;
  assert.deepEqual(hits.map((h) => [h.runId, h.bot.id, h.group]), [[turns[0], coder.id, { id: dev.id, name: 'Dev' }]]);
  assert.deepEqual((await srv.api('/search?q=zebra&groups=1')).data.map((h) => [h.runId, h.group]), [[own[0], undefined]]);
  // A turn that is left out takes no place of a hit: with one hit asked for, the bot's own run is still found
  // behind the turn that matches the same words.
  assert.deepEqual((await srv.api('/search?q=road&groups=1')).data.map((h) => h.runId), [turns[2], own[0]], 'the turn matches better');
  assert.deepEqual((await srv.api('/search?q=road&limit=1')).data.map((h) => h.runId), own);
});

test("a turn is not in the chat its bot is handed, and the bot's own message is no turn", async () => {
  const live = feed(srv);
  try {
    await live.wait('hello');
    const sent = (await srv.api(`/bots/${coder.id}/run`, { method: 'POST', body: { prompt: 'And a pelican crossing?' } })).data;
    const rec = await srv.nextRun((r) => r.stdin.includes('pelican'));
    assert.match(rec.system, /zebra crossing/, 'its own chat is there');
    assert.doesNotMatch(rec.system, /quokka|dark mode switch|Shall I merge/, 'and nothing of the group');
    const done = await srv.finished(sent.id);
    assert.equal(done.groupId, undefined);
    await live.wait('run_finished', (d) => d.id === sent.id);
    assert.deepEqual(await ids(`?group=${dev.id}`), [...theirs, ...[...turns].reverse()]);
  } finally { live.close(); }
});

test('with the group gone its turns are still runs of their bots, and still not in their own chats', async () => {
  assert.equal((await srv.api(`/group-chats/${dev.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await srv.api(`/runs/${turns[0]}?events=0`)).data.groupId, dev.id);
  assert.equal((await ids(`?botId=${coder.id}`)).some((id) => turns.includes(id)), false);
  assert.deepEqual((await srv.api('/search?q=quokka&groups=1')).data, [], 'a hit that could open nowhere is none');
});

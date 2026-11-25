// What a remote MCP server of the owner's reaches (ADR 266): a look gets none, and a replay of a bot's past task lets
// the tools that only read run for real and answers every other with what it would have done (ADR 102), with no card,
// also with "Always allow". Through the real server, the relay (lib/custom-mcp.js), the stand-in for Claude and a
// stand-in remote server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor, fakeConnectedApp, fakeMcpRemote } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const look = require('../lib/look');

const KEY = 'tok-reach-51c2e8a7d03b';
const said = (result) => result.content.map((c) => c.text).join('\n');
const flagged = (args, flag) => { const i = args.indexOf(flag) + 1; let j = i; while (j < args.length && !args[j].startsWith('--')) j++; return args.slice(i, j); };
const isLook = (x) => x.args.includes('🧭 Chief of Staff · look');
const isReplay = (x) => /This run is a replay/.test(x.system || '');

let app, remote, srv, server, bot;
before(async () => {
  app = await fakeConnectedApp({ connected: ['gmail'] });
  remote = await fakeMcpRemote({ key: KEY });
  srv = await startServer({ env: { ...app.env, BOT_DOT_MCP_ALLOW_LOCAL: '1', BOT_DOT_LOOK_ON_DEMAND: '1', BOT_DOT_REPLAYS_PER_HOUR: '60', BOT_DOT_REPLAY_GAP_MS: '0' } });
  await app.connect(srv);
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // the tests run at any hour
  server = (await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Notes', url: remote.url, key: KEY } })).data;
  assert.match(server.id, /^mcp-/);
  bot = await makeBot(srv, { name: 'Noter', description: 'Keeps the notes' });
});
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); app.close(); remote.close(); });

test("a look gets no remote server: no relay, no tool, and its token opens none", async (t) => {
  srv.hold();
  const looking = srv.api('/chief/look', { method: 'POST', body: { kind: 'look' } });
  const rec = await srv.nextRun(isLook, 'the look');
  assert.ok(rec.connectors, 'it has its mail');
  assert.equal(rec.remote, null, 'and no remote server');
  assert.ok(!flagged(rec.args, '--allowedTools').includes('mcp__remote'));
  assert.deepEqual(flagged(rec.args, '--allowedTools'), look.tools(true));
  assert.ok(!JSON.stringify([rec.mcpText, rec.envText, rec.args, rec.system, rec.stdin]).includes(KEY));
  const token = rec.connectors.env.RUN_TOKEN;
  const before = remote.calls.length;
  for (const [route, body] of [['custom-tools', { server: server.id }], ['custom-run', { server: server.id, tool: 'search_notes', arguments: {} }]]) {
    const r = await srv.api(`/connectors/session/${route}`, { method: 'POST', headers: { 'X-Run-Token': token }, body });
    assert.deepEqual([r.status, r.data.ok, r.data.error], [200, false, 'A look has no remote servers.'], route);
  }
  assert.equal(remote.calls.length, before, 'nothing reached the server, not even a read');
  assert.deepEqual((await srv.api('/asks')).data.filter((a) => a.kind === 'connector-action'), []);
  srv.reply('NOTHING');
  srv.unhold();
  srv.release(rec);
  await looking;
});

test('in a replay a tool that reads runs, and any other is not done, with no card and no call to the server', async (t) => {
  // A past task with an outcome, as the replays of a review need.
  srv.reply('Noted.');
  const asked = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Note that I need milk' } });
  await srv.finished(asked.data.id);
  await waitFor(async () => ((await srv.api(`/bots/${bot.id}/outcomes`)).data.outcomes.length ? true : null), { what: "the run's outcome" });
  const note = (await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'To note something: use the notes server.' } })).data.note.id;
  srv.hold();
  const going = setInterval(() => { for (const x of srv.runs()) if (!isReplay(x)) srv.release(x); }, 50);
  t.after(() => clearInterval(going));
  srv.reply(JSON.stringify({ proposals: [{ kind: 'skill', name: 'note-it', description: 'When the owner wants a note', instructions: 'Use the notes server.', bots: ['Noter'], replaces: [note], reason: 'A how-to.' }] }));
  const reviewing = srv.asChief('/memory/review/chief', { method: 'POST' });
  const rec = await srv.nextRun(isReplay, 'the replay');

  assert.ok(rec.remote, 'a replay has the relay');
  assert.deepEqual([rec.remote.env.CONNECTOR_CALLER, JSON.parse(rec.remote.env.CUSTOM_MCP_SERVERS)], ['replay', [{ id: server.id, name: 'Notes' }]]);
  assert.ok(flagged(rec.args, '--allowedTools').includes('mcp__remote'));
  assert.match(rec.system, /read in your connected apps \(Gmail, Notes\)/);
  assert.ok(!JSON.stringify([rec.mcpText, rec.envText, rec.args, rec.system, rec.stdin]).includes(KEY), 'no key in anything the replay gets');
  const tools = rpcClient(t, 'custom-mcp.js', rec.remote.env);
  const before = remote.calls.length;
  const read = await tools.call('remote_call', { server: server.id, tool: 'search_notes', arguments: { query: 'milk' } });
  assert.ok(!read.isError, said(read));
  assert.equal(said(read), 'search_notes done: {"query":"milk"}');
  // A write, and a tool whose hints disagree: not done, with what it would have sent, also with "Always allow".
  fs.writeFileSync(path.join(srv.data, 'connector-actions.json'), JSON.stringify({ [bot.id]: [`${server.id}:create_note`] }));
  for (const [tool, args] of [['create_note', { title: 'Milk' }], ['delete_note', { id: '1' }], ['peek_then_wipe', {}]]) {
    const out = await tools.call('remote_call', { server: server.id, tool, arguments: args });
    assert.ok(!out.isError, said(out));
    assert.match(said(out), /^dry run: not done\. This is a replay, so nothing was sent and no card was made\. It would have sent: /);
    assert.match(said(out), new RegExp(`"action":"${tool}"`));
  }
  assert.deepEqual(remote.calls.slice(before).map((c) => c.name), ['search_notes'], 'only the read reached the server');
  assert.deepEqual((await srv.api('/asks')).data.filter((a) => a.kind === 'connector-action'), [], 'no card');
  // Its token opens nothing of a bot's own run.
  assert.equal((await srv.api('/self/session/memory', { method: 'POST', headers: { 'X-Run-Token': rec.remote.env.RUN_TOKEN }, body: {} })).status, 403);

  srv.unhold();
  for (const x of srv.runs()) srv.release(x);
  assert.equal((await reviewing).status, 200);
  await waitFor(async () => ((await srv.api('/asks')).data.some((a) => a.kind === 'skill') ? true : null), { what: 'the card', timeout: 20_000 });
  const gone = await srv.api('/connectors/session/custom-run', { method: 'POST', headers: { 'X-Run-Token': rec.remote.env.RUN_TOKEN }, body: { server: server.id, tool: 'search_notes', arguments: {} } });
  assert.equal(gone.status, 403, 'the key goes with the replay');
});

test("what a remote server answers is outside content, as a connected app's answer is: the run says so, and a save after it is held the same way (ADR 015, ADR 266)", async (t) => {
  const events = new Map();
  const asked = async (rec, runId, name) => {
    const list = [...(events.get(rec.n) || []), { type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${rec.n}-${name}`, name, input: {} }] } }];
    events.set(rec.n, list);
    fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(list));
    await waitFor(async () => (((await srv.api(`/runs/${runId}`)).data.events || []).filter((e) => e.type === 'assistant').length >= list.length ? true : null), { what: `the run to have asked for ${name}` });
  };
  const seen = {};
  for (const tool of ['mcp__connectors__connector_run', 'mcp__remote__remote_call', 'mcp__remote__remote_tools']) {
    const b = await makeBot(srv, { name: `Reader ${Object.keys(seen).length}`, emoji: '📖', description: 'Reads' });
    srv.hold();
    const started = await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt: 'Note what I tell you.' } });
    const rec = await srv.nextRun((x) => x.self?.env && x.args.includes(`${b.emoji} ${b.name}`), `a run of ${b.name}`);
    const self = (what, body) => srv.api(`/self/session/${what}`, { method: 'POST', body, headers: { 'X-Run-Token': rec.self.env.RUN_TOKEN } }).then((r) => r.data);
    const job = (name) => self('jobs', { action: 'add', kind: 'ai', name, cron: '0 3 * * *', prompt: 'Check the notes.', assessment: 'Needs AI' });
    const first = await self('memory', { action: 'add', text: `Said before ${tool}`, quote: 'what I tell you' });
    assert.equal(first.note.source, 'owner', `before ${tool}`);
    const before = await job('Before');
    await asked(rec, started.data.id, tool);
    const second = await self('memory', { action: 'add', text: `Said after ${tool}`, quote: 'what I tell you' });
    const after = await job('After');
    seen[tool] = [second.note.source, before.needsApproval, after.needsApproval];
    srv.release(rec);
    const done = await srv.finished(started.data.id);
    srv.unhold();
    assert.deepEqual(done.outside, ['app'], `${tool}: the run's record says it read an app`);
  }
  assert.deepEqual(seen['mcp__connectors__connector_run'], ['outside', false, true], 'after a connected app: the note is outside and a job waits for the owner');
  assert.deepEqual(seen['mcp__remote__remote_call'], seen['mcp__connectors__connector_run']);
  assert.deepEqual(seen['mcp__remote__remote_tools'], seen['mcp__connectors__connector_run']);
});

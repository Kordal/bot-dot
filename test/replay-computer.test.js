// A replay's computer (#595, ADR 102): a bot with a computer is replayed with commands on a throwaway copy of it, a
// container made from the account's computer here or a fork of its External Virtual PC on boat.dev. The copy has no
// network, its commands never reach the bot's own computer, and it goes when the replay ends. lib/replay-computer.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fakeDocker } = require('./helpers');
const replay = require('../lib/replay');
const replayComputer = require('../lib/replay-computer');
const boatLib = require('../lib/boat');
const helper = require('../lib/docker-helper');

const ACCOUNT = 'botdot.account.computer';
const BOT = { id: 'b1', name: 'Cook' };
const ids = () => { let n = 0; return () => `${'0'.repeat(11)}${++n}`.slice(-12); };

// ---------- on this machine: a container made from the account's computer ----------

test("a replay's commands run on a copy of the account's computer, never on it, and the copy goes with its replay", async (t) => {
  const docker = fakeDocker();
  const PATH = process.env.PATH;
  process.env.PATH = `${docker.bin}${path.delimiter}${PATH}`;
  t.after(() => { process.env.PATH = PATH; docker.remove(); });
  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:1"');
  docker.answer('host.json', JSON.stringify({ images: [], containers: [] })); // no replay image yet
  const computers = require('../lib/computers');
  const rc = replayComputer.create({ local: computers, boat: { sweepForks: async () => {} }, kindOf: () => 'linux', draw: ids() });

  const sc = rc.scope();
  const copy = await rc.make(BOT, sc);
  assert.ok(copy, 'a copy is made');
  assert.equal(copy.botId, 'b1');
  assert.equal(rc.byKey(copy.key), copy, 'its key names it');
  await copy.runShell({ command: 'ls -la', timeoutSeconds: 30 });
  await copy.writeFile({ path: 'notes.txt', content: 'x' });
  await copy.close();
  await rc.endScope(sc);

  const calls = docker.calls().map((c) => c.args);
  const name = `${ACCOUNT}.replay-${'0'.repeat(11)}2`;
  const image = `${ACCOUNT}.replay:${'0'.repeat(11)}1`;
  const commit = calls.find((a) => a[0] === 'commit');
  assert.deepEqual(commit.slice(-2), [ACCOUNT, image], 'the account computer is committed, its bots not paused');
  assert.ok(commit.includes('--pause=false'));
  const run = calls.find((a) => a[0] === 'run');
  assert.equal(run[run.indexOf('--network') + 1], 'none', 'the copy has no network');
  assert.ok(!run.includes('-v'), 'none of the volumes: not /home/box, not the other bots\' folders, not the logins');
  assert.equal(run[run.indexOf('--name') + 1], name);
  assert.ok(calls.some((a) => a[0] === 'cp' && a[1] === `${ACCOUNT}:/workspace/b1`), "the bot's folder is copied in");
  const ran = calls.filter((a) => a[0] === 'exec' && a.includes('ls -la'));
  assert.equal(ran.length, 1);
  assert.ok(ran[0].includes(name) && !ran[0].includes(ACCOUNT), 'the command runs on the copy, never on the account\'s computer');
  assert.ok(!calls.some((a) => a[0] === 'exec' && a.includes(ACCOUNT)), 'nothing at all runs on the account\'s computer');
  assert.ok(calls.some((a) => a.join(' ') === `rm -f -v ${name}`), 'the copy is removed when its replay ends');
  assert.ok(calls.some((a) => a.join(' ') === `image rm -f ${image}`), 'its image when the scoring ends');
  assert.equal(rc.byKey(copy.key), null, 'its key answers no more');
});

test('without an account computer, or without one at all, a replay has no copy', async (t) => {
  const docker = fakeDocker();
  const PATH = process.env.PATH;
  process.env.PATH = `${docker.bin}${path.delimiter}${PATH}`;
  t.after(() => { process.env.PATH = PATH; docker.remove(); });
  const computers = require('../lib/computers');
  const rc = replayComputer.create({ local: computers, boat: { sweepForks: async () => {} }, kindOf: (b) => b.place, draw: ids() });
  assert.equal(await rc.make({ id: 'b1', name: 'Cook', place: 'linux' }, rc.scope()), null, 'docker says nothing of the computer');
  assert.ok(!docker.calls().some((c) => ['commit', 'run'].includes(c.args[0])));
  assert.equal(await rc.make({ id: 'b2', name: 'Note', place: 'none' }, rc.scope()), null);
});

test('the helper takes only botdot\'s own ids for a copy', () => {
  const id = 'a1b2c3d4e5f6';
  assert.ok(helper.validate('replayCopy', [id, id, 'b1']));
  assert.ok(helper.validate('replayShell', [id, 'b1', { command: 'ls', timeoutSeconds: 30 }]));
  assert.ok(helper.validate('replayRead', [id, 'b1', { path: 'a.txt' }]));
  assert.ok(helper.validate('replayWrite', [id, 'b1', { path: 'a.txt', content: '' }]));
  assert.ok(helper.validate('replayEnd', [id]));
  assert.ok(helper.validate('replayRemove', []) && helper.validate('replayRemove', [null]) && helper.validate('replayRemove', [id]));
  assert.ok(!helper.validate('replayCopy', ['botdot.account.computer', id, 'b1']), 'never a container\'s name');
  assert.ok(!helper.validate('replayEnd', ['../x']));
  assert.ok(!helper.validate('replayShell', [id, 'b1', { command: 'ls', seat: 1 }]));
});

// ---------- on boat.dev: a fork of the External Virtual PC ----------

const KEY = `boat_${'x'.repeat(16)}`; // no real key
function fakeBoat({ cut = 0, sealed = 0 } = {}) {
  const calls = [];
  const live = new Set(['bx_aaaaaaa1']);
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, { method = 'GET', headers, body } = {}) => {
    const p = new URL(url).pathname.replace(/^\/api\/v1/, '');
    const data = body ? JSON.parse(body) : null;
    calls.push({ method, path: p, body: data, headers });
    const m = p.match(/^\/sandboxes\/(bx_[a-z0-9]+)(?:\/(.+))?$/);
    if (!m || !live.has(m[1])) return reply(404, { ok: false, code: 'not_found' });
    if (m[2] === 'fork') { live.add('bx_aaaaaaa2'); return reply(202, { ok: true, sandbox: { id: 'bx_aaaaaaa2', state: 'provisioning' } }); }
    if (!m[2] && method === 'GET') return reply(200, { ok: true, sandbox: { id: m[1], state: 'ready' } });
    if (!m[2] && method === 'DELETE') { if (headers['X-Ascii-Confirm-Delete'] !== m[1]) return reply(409, { ok: false }); live.delete(m[1]); return reply(202, { ok: true }); }
    if (m[2] === 'commands') {
      const code = data.command.includes('iptables') ? cut : data.command.includes('create_connection') ? sealed : 0;
      return reply(200, { ok: true, exitCode: code, stdout: `ran: ${data.command}`, stderr: '', timedOut: false });
    }
    return reply(400, { ok: false });
  };
  return { fetch, calls, live };
}
function boatWith(fake) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-boat-replay-'));
  fs.writeFileSync(path.join(dir, 'boat-machines.json'), JSON.stringify({ '@account': { id: 'bx_aaaaaaa1', type: 'default', name: 'botdot' } }));
  boatLib.setKey(KEY);
  return { boat: boatLib.create(dir, { fetch: fake.fetch, ownOf: () => false, kitOnStart: false, sleep: async () => {} }), dir };
}

test("on boat.dev a replay's commands run on a fork, sealed off the internet, never on the External Virtual PC, and the fork is deleted", async (t) => {
  const fake = fakeBoat();
  const { boat, dir } = boatWith(fake);
  t.after(() => { boatLib.setKey(null); fs.rmSync(dir, { recursive: true, force: true }); });
  const rc = replayComputer.create({ local: { replayRemove: async () => true }, boat, kindOf: () => 'boat', draw: ids() });
  const sc = rc.scope();
  const copy = await rc.make(BOT, sc);
  assert.ok(copy);
  await copy.runShell({ command: 'git status' });
  await copy.close();
  await rc.endScope(sc);

  assert.deepEqual(fake.calls[0], { method: 'POST', path: '/sandboxes/bx_aaaaaaa1/fork', body: { ttlSeconds: 3600 }, headers: fake.calls[0].headers });
  const commands = fake.calls.filter((c) => c.path.endsWith('/commands'));
  assert.ok(commands.every((c) => c.path === '/sandboxes/bx_aaaaaaa2/commands'), 'every command goes to the fork');
  assert.match(commands[0].body.command, /iptables -I OUTPUT 1 -j DROP/, 'its network is cut first');
  assert.match(commands[1].body.command, /create_connection/, 'and botdot checks that nothing leaves it');
  assert.match(commands[2].body.command, /cd -- '\/home\/user\/workspace\/b1'[\s\S]*git status$/, "in the bot's folder");
  const del = fake.calls.find((c) => c.method === 'DELETE');
  assert.equal(del.path, '/sandboxes/bx_aaaaaaa2', 'the fork is deleted, never the machine itself');
  assert.equal(del.headers['X-Ascii-Confirm-Delete'], 'bx_aaaaaaa2');
  assert.ok(fake.live.has('bx_aaaaaaa1') && !fake.live.has('bx_aaaaaaa2'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'boat-replays.json'), 'utf8')), {}, 'nothing is left to sweep');
});

test('a fork whose network could not be cut, or that still reaches out, is deleted and the replay has no computer', async (t) => {
  for (const [what, opts] of [['no cut', { cut: 3 }], ['still online', { sealed: 1 }]]) {
    const fake = fakeBoat(opts);
    const { boat, dir } = boatWith(fake);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const rc = replayComputer.create({ local: { replayRemove: async () => true }, boat, kindOf: () => 'boat', draw: ids() });
    assert.equal(await rc.make(BOT, rc.scope()), null, what);
    assert.ok(fake.calls.some((c) => c.method === 'DELETE' && c.path === '/sandboxes/bx_aaaaaaa2'), `${what}: the fork is deleted`);
    assert.ok(!fake.calls.some((c) => c.path.endsWith('/commands') && !/iptables|create_connection/.test(c.body.command)), `${what}: no command of the bot's ran`);
  }
  boatLib.setKey(null);
});

test('a fork left by a botdot that stopped is deleted before the next copy', async (t) => {
  const fake = fakeBoat();
  fake.live.add('bx_aaaaaaa9');
  const { dir } = boatWith(fake);
  t.after(() => { boatLib.setKey(null); fs.rmSync(dir, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(dir, 'boat-replays.json'), JSON.stringify({ bx_aaaaaaa9: { dir: '/home/user/workspace/b1', at: '2026-10-26T00:00:00Z' } }));
  const again = boatLib.create(dir, { fetch: fake.fetch, ownOf: () => false, kitOnStart: false, sleep: async () => {} });
  assert.deepEqual(again.forksLeft(), ['bx_aaaaaaa9']);
  const rc = replayComputer.create({ local: { replayRemove: async () => true }, boat: again, kindOf: () => 'boat', draw: ids() });
  await (await rc.make(BOT, rc.scope())).close();
  assert.ok(!fake.live.has('bx_aaaaaaa9'));
  assert.deepEqual(again.forksLeft(), []);
});

// ---------- in the replay ----------

test('a replay with a copy has its one MCP server and is told the copy has no network', () => {
  const args = replay.args({ promptFile: '/p', flag: '--append-system-prompt-file', mcpFile: '/run/mcp.json', mcpTools: ['mcp__computer'] });
  assert.equal(args[args.indexOf('--mcp-config') + 1], '/run/mcp.json');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('mcp__computer'));
  assert.ok(!replay.args({ promptFile: '/p', flag: '-f', mcpTools: ['mcp__computer'] }).includes('mcp__computer'), 'no server, no tool');
  const text = replay.instructions({ bot: { name: 'Cook', prompt: 'Cook.' }, computer: true });
  assert.match(text, /run commands and read and write files on a copy of your computer made for this replay: it has no network, and it is removed when the replay ends/);
  assert.match(text, /You cannot use connected apps, saved logins, the screen or your memory tools, or message anyone/);
});

test("a scoring's copies share one scope, which ends when the scoring does, also when a replay fails", async () => {
  const scopes = [];
  const ended = [];
  const r = replay.create({
    tasks: () => [{ runId: 'a', request: 'task a', reply: '', notes: [], signal: null }],
    run: async (bot, task, candidate, sc) => { scopes.push(sc); if (candidate) throw new Error('no reply'); return 'old'; },
    ask: async () => '{"better":0}', perHour: () => 60, gapMs: 0, sleep: async () => {},
    scope: () => ({ id: 's1' }), endScope: async (sc) => { ended.push(sc.id); },
  });
  assert.deepEqual(await r.score({ bots: [BOT], candidate: { name: 'x' } }), { of: 1, better: 0, worse: 0, same: 0, failed: 1 });
  assert.deepEqual(scopes.map((s) => s.id), ['s1', 's1']);
  assert.deepEqual(ended, ['s1']);
});

test("the replay's computer tools ask botdot with the replay's key, for its copy alone", async (t) => {
  const http = require('node:http');
  const { spawn } = require('node:child_process');
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-replay-key'], body: JSON.parse(body) });
      res.end(JSON.stringify(req.url.endsWith('/shell') ? { ok: true, stdout: 'hi\n', stderr: '', exitCode: 0 } : { ok: true, content: 'text' }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const mcp = spawn(process.execPath, [path.join(__dirname, '..', 'lib', 'replay-computer-mcp.js')], { env: { ...process.env, REPLAY_URL: `http://127.0.0.1:${srv.address().port}/api/replay/session`, REPLAY_KEY: 'k1' } });
  t.after(() => mcp.kill());
  const answers = [];
  let buf = '';
  mcp.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { answers.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const ask = (id, method, params) => { mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); };
  const answer = async (id) => { for (let i = 0; i < 200; i++) { const a = answers.find((x) => x.id === id); if (a) return a; await new Promise((r) => setTimeout(r, 20)); } throw new Error('no answer'); };
  ask(1, 'tools/list', {});
  assert.deepEqual((await answer(1)).result.tools.map((x) => x.name), ['run_shell', 'read_file', 'write_file'], 'no screen, no login, nothing else');
  ask(2, 'tools/call', { name: 'run_shell', arguments: { command: 'echo hi' } });
  assert.match((await answer(2)).result.content[0].text, /stdout:\nhi[\s\S]*exit code: 0/);
  ask(3, 'tools/call', { name: 'read_file', arguments: { path: 'a.txt' } });
  assert.equal((await answer(3)).result.content[0].text, 'text');
  assert.deepEqual(seen.map((s) => [s.url, s.key]), [['/api/replay/session/shell', 'k1'], ['/api/replay/session/read', 'k1']]);
  assert.deepEqual(seen[0].body, { command: 'echo hi', timeoutSeconds: 120 });
});

// ---------- on a real botdot ----------

test("on a real botdot a replay's command goes to its copy through botdot, and the copy and its key are gone after", async (t) => {
  const { startServer, makeBot, waitFor } = require('./helpers');
  const docker = fakeDocker();
  t.after(() => docker.remove());
  docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:1"');
  docker.answer('host.json', JSON.stringify({ images: [], containers: [] }));
  docker.answer('exec.txt', 'replayed');
  const srv = await startServer({ env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}`, BOT_DOT_REPLAYS_PER_HOUR: '60', BOT_DOT_REPLAY_GAP_MS: '0' } });
  t.after(() => srv.stop());
  const cook = await makeBot(srv, { name: 'Cook', computer: 'linux' });
  const asked = await srv.api(`/bots/${cook.id}/run`, { method: 'POST', body: { prompt: 'How full is my disk?' } });
  await srv.finished(asked.data.id);
  await waitFor(async () => ((await srv.api(`/bots/${cook.id}/outcomes`)).data.outcomes.length ? true : null), { what: 'the run\'s outcome' });
  const before = docker.calls().length;

  fs.writeFileSync(path.join(srv.out, 'replay-command.txt'), 'df -h');
  const noteId = (await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'To check the disk: df -h.' } })).data.note.id;
  srv.reply(JSON.stringify({ proposals: [{ kind: 'skill', name: 'disk-check', description: 'When the owner asks about the disk', instructions: 'Run df -h.', bots: ['Cook'], replaces: [noteId], reason: 'A how-to.' }] }));
  assert.equal((await srv.asChief('/memory/review/chief', { method: 'POST' })).status, 200);
  await waitFor(async () => ((await srv.api('/asks')).data.some((a) => a.kind === 'skill') ? true : null), { what: 'the card', timeout: 20_000 });

  const replays = srv.runs().filter((x) => /This run is a replay/.test(x.system || ''));
  assert.equal(replays.length, 2);
  for (const r of replays) {
    assert.equal(r.computer.args[0], path.join(__dirname, '..', 'lib', 'replay-computer-mcp.js'), 'its one MCP server is the copy\'s');
    assert.equal(r.self, null);
    assert.ok(r.args.includes('mcp__computer'));
    assert.match(r.system, /a copy of your computer made for this replay/);
    assert.deepEqual([r.replayShell.status, r.replayShell.ok, r.replayShell.stdout, r.replayShell.exitCode], [200, true, 'replayed', 0]);
  }
  const calls = docker.calls().slice(before).map((c) => c.args);
  const ran = calls.filter((a) => a[0] === 'exec' && a.includes('df -h'));
  assert.equal(ran.length, 2);
  const copies = ran.map((a) => a.find((x) => x.startsWith(`${ACCOUNT}.replay-`)));
  assert.ok(copies.every(Boolean) && copies[0] !== copies[1], 'each replay on a copy of its own');
  assert.ok(!calls.some((a) => a[0] === 'exec' && a.includes(ACCOUNT)), 'nothing runs on the account\'s computer');
  for (const c of copies) assert.ok(calls.some((a) => a.join(' ') === `rm -f -v ${c}`), 'each copy is removed');
  assert.equal(calls.filter((a) => a[0] === 'commit').length, 1, 'one image for the scoring');
  assert.ok(calls.some((a) => a[0] === 'image' && a[1] === 'rm' && a.at(-1).startsWith(`${ACCOUNT}.replay:`)), 'and it goes when the scoring ends');

  const late = await fetch(`http://127.0.0.1:${srv.port}/api/replay/session/shell`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Replay-Key': replays[0].computer.env.REPLAY_KEY }, body: JSON.stringify({ command: 'df -h' }) });
  assert.notEqual(late.status, 200, 'the key of an ended replay opens nothing');
});

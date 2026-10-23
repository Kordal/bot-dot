// Test helpers: a real botdot server on a free port, with a scratch data folder, its own vault key
// and the stand-in Claude (fixtures/fake-claude.js). Nothing touches your real data or Keychain.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const frontDoorCalls = require('../lib/front-door/calls');

const ROOT = path.join(__dirname, '..');
const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The time zone every test server runs in. A test that expects a day the server wrote works it out with serverDay.
const SERVER_TZ = 'UTC';
// Today as the test server prints it (lib/prompt-text.js dayOf), whatever zone the tests run in.
function serverDay() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: SERVER_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function waitFor(fn, { timeout = 10_000, every = 50, what = 'the condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(every);
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.unref();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// Start a server. dir: reuse a scratch folder (to restart one). env: extra settings. wait: false returns it at once,
// without waiting for it to answer (a server that is not expected to). account: the account it serves; its socket is
// <dir>/fd/<account>/botdot.sock, where a real front door with FRONT_DOOR_SOCKETS=<dir>/fd looks for it.
async function startServer({ dir, env = {}, broker = false, wait = true, account = 'tester', tries = 3 } = {}) {
  dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-test-'));
  const data = path.join(dir, 'data');
  const out = path.join(dir, 'fake');
  const home = path.join(dir, 'home');
  for (const d of [data, out, home]) fs.mkdirSync(d, { recursive: true });
  if (broker) { fs.chmodSync(dir, 0o711); fs.chmodSync(out, 0o777); }
  // The front door's socket's folder: the server's own user (60000 under the broker) makes the socket in it.
  if (broker) {
    fs.mkdirSync(path.join(dir, 'fd', account), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(dir, 'fd'), 0o711);
    fs.chownSync(path.join(dir, 'fd', account), 60000, 60000);
  }
  const botdotPort = await freePort();
  // The front door's socket, in a folder of its own (a socket's path may be at most about 100 characters).
  const socket = path.join(dir, 'fd', account, 'botdot.sock');
  const chiefKey = crypto.randomBytes(24).toString('hex');
  const log = [];
  const child = spawn(process.execPath, [broker ? 'lib/privilege-broker.js' : 'server.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      TZ: SERVER_TZ,
      HOST: '127.0.0.1',
      PORT: String(botdotPort),
      BOT_DOT_FRONT_DOOR_SOCKET: socket,
      BOT_DOT_ACCOUNT: account,
      BOT_DOT_DATA: data,
      BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'config', 'vault.key'),
      CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_OUT: out,
      BW_BIN: path.join(dir, 'no-bitwarden'),
      EMBED_SERVER_BIN: path.join(dir, 'no-llama'),
      BOT_DOT_SEPARATE_USERS: '0',
      BOT_DOT_CHIEF_KEY: chiefKey,
      // Never reach the real Composio (it would create an account); tests pass a stand-in.
      COMPOSIO_API_URL: 'http://127.0.0.1:9',
      COMPOSIO_AGENTS_URL: 'http://127.0.0.1:9',
      // Nor Anthropic, to check an API key (lib/claude-key.js); its tests pass a stand-in.
      BOT_DOT_ANTHROPIC_API_URL: 'http://127.0.0.1:9',
      // The background dresser (lib/dresser.js) would start the stand-in Claude in every test; its own tests switch it on.
      BOT_DOT_DRESS_WAITS: 'off',
      // A new bot's first message (lib/hello.js) would be a run in every test that makes a bot; its own tests switch it on.
      BOT_DOT_HELLO_DELAY_MS: 'off',
      // The tests don't wait for the clock: srv.tick() runs the scheduler's next minute now (server.js test-tick),
      // reminders are looked at every second, not every 15, and a working line changes every 50 ms, not every
      // second (working-line.js pacer; the tests of the pace set their own).
      BOT_DOT_TEST_TICK: '1',
      BOT_DOT_REMINDERS_EVERY_MS: '1000',
      BOT_DOT_LINE_EVERY_MS: '50',
      // How many runs of one bot go at once (ADR 062): a test file of what waits behind a busy bot sets 1 for the
      // whole file, before it starts its server (oneRunAtATime).
      ...(process.env.BOT_DOT_RUNS_MAX ? { BOT_DOT_RUNS_MAX: process.env.BOT_DOT_RUNS_MAX } : {}),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => log.push(String(c)));
  child.stderr.on('data', (c) => log.push(String(c)));
  const exited = new Promise((r) => child.on('exit', r));
  // The tests reach botdot the way people do: through a front door, here a stand-in that passes every request
  // on to botdot's socket naming the account (frontDoorStandIn). srv.botdotPort is botdot's own port, which only
  // the Chief's and the bots' tools use.
  const door = await frontDoorStandIn(socket, account);
  exited.then(() => door.close()); // also when botdot stops by itself (a restore restarts it)
  const port = door.port;
  const base = `http://127.0.0.1:${port}`;

  // api('/bots', { method, body, raw, headers }) → { status, data } (data: parsed JSON, or a Buffer).
  async function api(p, { method = 'GET', body, raw, headers = {} } = {}) {
    const res = await fetch(`${base}/api${p}`, {
      method,
      headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', 'X-Bot-Dot': '1', ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let data = buf;
    try { data = JSON.parse(buf.toString('utf8')); } catch { /* not JSON */ }
    return { status: res.status, data };
  }

  // The stand-in Claude's runs, oldest first.
  const runs = () => fs.readdirSync(out).filter((f) => /^run-.*\.json$/.test(f))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')); } catch { return null; } })
    .filter(Boolean).sort((a, b) => a.at - b.at || a.n.localeCompare(b.n));
  const seen = new Set();
  // The next run the stand-in started (that this test hasn't looked at yet), optionally matching fn.
  const nextRun = (fn = () => true, what = 'a run') => waitFor(() => { const r = runs().find((x) => !seen.has(x.n) && fn(x)); if (r) seen.add(r.n); return r; }, { what });

  // The same, as the Chief's tools call it (with the Chief's key).
  const asChief = (p, opts = {}) => api(p, { ...opts, headers: { 'X-Chief-Key': chiefKey, ...opts.headers } });

  const srv = {
    base, port, botdotPort, socket, account, dir, data, out, chiefKey, api, asChief, runs, nextRun, log, pid: child.pid,
    hold: () => fs.writeFileSync(path.join(out, 'hold'), ''),
    unhold: () => fs.rmSync(path.join(out, 'hold'), { force: true }),
    release: (run) => fs.writeFileSync(path.join(out, `done-${run.n}`), ''),
    reply: (text) => fs.writeFileSync(path.join(out, 'result.txt'), text),
    // A run's final state, once it's done: also for one that still waits its turn ("queued", ADR 011) when asked.
    finished: (runId) => waitFor(async () => { const r = await api(`/runs/${runId}`); return r.data.status && !['running', 'queued'].includes(r.data.status) ? r.data : null; }, { what: `run ${runId} to finish` }),
    // The scheduler's next minute, now: a job due then ('* * * * *') starts as it would at that minute.
    tick: async () => (await api('/test-tick', { method: 'POST' })).data.at,
    exited,
    async stop() { if (child.exitCode === null) { child.kill('SIGTERM'); await exited; } },
  };
  if (!wait) return srv;
  // The free port was let go before botdot took it: under load another test's server can take it first. Then
  // botdot stops at once, and starts again on another port.
  const taken = () => child.exitCode !== null && /EADDRINUSE/.test(log.join(''));
  try {
    await waitFor(async () => {
      if (taken()) return true;
      try { return (await api('/version')).status === 200; } catch { return false; }
    }, { timeout: 15_000, what: 'botdot to start' });
  } catch (e) {
    child.kill('SIGKILL');
    door.close();
    throw new Error(`${e.message}\n${log.join('')}`);
  }
  if (taken()) {
    door.close();
    if (tries > 1) return startServer({ dir, env, broker, wait, account, tries: tries - 1 });
    throw new Error(`botdot's port was taken\n${log.join('')}`);
  }
  return srv;
}

// A stand-in front door (front-door.js, without its sign-in) on a free port: every request and WebSocket is passed
// on to botdot's socket as it came, with the account named, as the real one does for a signed-in session. A call
// (/call/<account>/<bot>/<job>) is passed on as the real one passes it (lib/front-door/calls.js), without its limits.
async function frontDoorStandIn(socketPath, account) {
  const headersOf = (req) => ({ ...req.headers, 'x-forwarded-proto': 'http', 'x-botdot-account': account });
  const server = http.createServer((req, res) => {
    const call = frontDoorCalls.callOf(new URL(req.url, 'http://x').pathname);
    if (call && call.account !== account) { req.resume(); res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"Wrong key."}'); }
    const to = call ? { path: call.path, headers: frontDoorCalls.callHeaders(req, account, frontDoorCalls.clientOf(req)) } : { path: req.url, headers: headersOf(req) };
    const up = http.request({ socketPath, agent: false, method: req.method, ...to }, (answer) => {
      const { connection, 'keep-alive': _, ...headers } = answer.headers;
      res.writeHead(answer.statusCode, req.complete ? headers : { ...headers, connection: 'close' }); // an answer before the whole body: this connection ends with it
      answer.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    frontDoorCalls.sendOn(req, up);
  });
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(socketPath, () => {
      const lines = Object.entries(headersOf(req)).map(([k, v]) => `${k}: ${v}`);
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up);
      up.pipe(socket);
    });
    const close = () => { socket.destroy(); up.destroy(); };
    up.on('error', close);
    socket.on('error', close);
    up.on('close', close);
    socket.on('close', close);
  });
  // An idle connection is closed by the tests' side, never by this one: one closed here after its keep-alive, while
  // a slow test held the tests' event loop, would be taken up again by fetch and fail ("other side closed").
  server.keepAliveTimeout = 0;
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return { port, close: () => { server.closeAllConnections(); server.close(); } };
}

// Stop botdot, change what it left in its data folder, start it again on the same folder.
// This is also how a test gets a one-time job that is due without waiting a minute of schedule: put the job's
// time into the past here (setJobs), and botdot runs it as it starts (bots.js catchUpOneTimeJobs).
// Runs that are held stay held: whoever wants them to end calls srv.unhold() before.
async function restartServer(srv, change = () => {}) {
  await srv.stop();
  change(srv.data);
  return startServer({ dir: srv.dir });
}
const readData = (data, file) => JSON.parse(fs.readFileSync(path.join(data, file), 'utf8'));
// A file of a server that may be running, written as botdot writes its own (lib/jsonfile.js): whole or not at all.
// A plain writeFileSync truncates the file first, and a server that reads it in that moment takes it for broken and
// moves it aside (`.broken-…`): a Chief chat would lose its runs, and a test what it set up (#300).
function writeData(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
// Jobs as bots.json keeps them, changed by id: setJobs(data, { [job.id]: { at, enabled } }).
function setJobs(data, changes) {
  const all = readData(data, 'bots.json').map((b) => ({ ...b, jobs: (b.jobs || []).map((j) => ({ ...j, ...changes[j.id] })) }));
  writeData(path.join(data, 'bots.json'), all);
}
// What waits in queue.json, changed in place: setQueue(data, (q) => { q.queues[bot.id] = [item]; }).
function setQueue(data, change) {
  const q = { queues: {}, oneTimeRetries: [], ...(fs.existsSync(path.join(data, 'queue.json')) ? readData(data, 'queue.json') : {}) };
  change(q);
  writeData(path.join(data, 'queue.json'), q);
}
// The work of a one-time job that came due at `at` and waits its turn, and of a "Run now" that waits, as botdot queues them.
const onceItem = (job, at) => ({ key: `once:${job.id}`, kind: 'job', jobId: job.id, trigger: 'schedule', at, queuedAt: at });
const runNowItem = (job) => ({ key: `job:${job.id}`, kind: 'job', jobId: job.id, trigger: 'manual', queuedAt: new Date().toISOString() });

// The live feed, as the phone reads it: collects events until close(). It is handed over once botdot has sent its
// hello, which botdot does right before it subscribes the feed: an event of whatever the test does next is never
// missed, as it could be while the feed was still being opened.
async function feed(srv) {
  const events = [];
  const ac = new AbortController();
  let open, fail;
  const opened = new Promise((resolve, reject) => { open = resolve; fail = reject; });
  (async () => {
    const res = await fetch(`${srv.base}/api/events`, { signal: ac.signal });
    const reader = res.body.getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString();
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const type = chunk.match(/^event: (.*)$/m)?.[1];
        const data = chunk.match(/^data: (.*)$/m)?.[1];
        if (type) events.push({ type, data: JSON.parse(data || '{}') });
        if (type === 'hello') open();
      }
    }
    fail(new Error('The feed ended before its hello'));
  })().catch(fail); // after the hello, a feed that ends (close(), its server stopped) says nothing
  await opened;
  return { events, close: () => ac.abort(), wait: (type, fn = () => true) => waitFor(() => events.find((e) => e.type === type && fn(e.data)), { what: `a ${type} event` }) };
}

// A small .zip (stored, not compressed), e.g. to make an .xlsx for the upload tests.
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// A secret botdot saved in its own vault, by the item's name (the test server's key is in its folder), or null.
function vaultSecret(srv, name) {
  const file = path.join(srv.data, 'vault.json');
  const entry = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).entries.find((e) => e.name === name) : null;
  if (!entry) return null;
  const key = Buffer.from(fs.readFileSync(path.join(srv.dir, 'config', 'vault.key'), 'utf8').trim(), 'hex');
  const box = entry.secret;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]).toString('utf8');
}

// A bot to test with.
async function makeBot(srv, fields = {}) {
  const r = await srv.api('/bots', { method: 'POST', body: { name: 'Test Bot', emoji: '🧪', prompt: 'Do the test task.', ...fields } });
  if (r.status !== 201) throw new Error(`Couldn't make a bot: ${JSON.stringify(r.data)}`);
  return r.data;
}

// Runs written as botdot keeps them (data/runs/<id>.json), for a server that is stopped: it finds them when it
// starts again, after the moment everything counted as read, so those meant for the owner are new replies.
// runs: oldest first, each the fields that differ from an answer to the owner; `times: n` writes n alike.
// Returns their ids, oldest first.
const QUIET_RUN = { trigger: 'schedule', notify: 'report-only', jobId: 'j1', jobName: 'Morning check', customPrompt: false, reporting: 'quiet', result: '' };
const BOT_TO_BOT_RUN = { trigger: 'bot', fromBot: { id: 'other', name: 'Fleet Doctor' }, notificationAudience: 'internal' };
function seedRuns(srv, bot, runs) {
  const dir = path.join(srv.data, 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const ids = [];
  for (const { times = 1, ...fields } of runs) {
    for (let i = 0; i < times; i++) {
      const n = ids.length;
      const id = `seed-${bot.id}-${String(n).padStart(4, '0')}`;
      const at = (ms) => new Date(t0 + n + ms).toISOString(); // a millisecond apart: all in the past once the server is up again
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, botId: bot.id, botName: bot.name, kind: 'ai', trigger: 'manual', status: 'success', prompt: 'p', customPrompt: true,
        startedAt: at(0), endedAt: at(1), result: 'An answer.', error: null, notificationAudience: 'owner', ...fields }));
      ids.push(id);
    }
  }
  return ids;
}

// Start a run of a bot (held, so its run token stays valid) and return { run, rec, token }.
async function heldRun(srv, bot, prompt = 'Test message') {
  srv.hold();
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  const rec = await srv.nextRun((x) => x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`), `a run of ${bot.name}`);
  return { run: r.data, rec, token: rec.self.env.RUN_TOKEN };
}

// A bot's own tools call botdot like this (lib/self-mcp.js), with its run token.
const self = (srv, token, what, body = {}) => srv.api(`/self/session/${what}`, { method: 'POST', body, headers: { 'X-Run-Token': token } });

// A shared note that is a bot's own conclusion (ADR 015): `bot` saves it in a run of a job of its own, started
// with "Run now": a run the owner did not start, which has read nothing. Returns the note. The server is left held.
async function sharedByBot(srv, bot, text) {
  srv.hold();
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Conclude', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Note what you concluded.' } })).data;
  const ran = (await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data;
  const rec = await srv.nextRun((x) => x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes('Note what you concluded.'), `a run of ${bot.name}'s job`);
  const saved = (await self(srv, rec.self.env.RUN_TOKEN, 'memory', { action: 'add', scope: 'shared', text })).data;
  srv.release(rec);
  await srv.finished(ran.run.id);
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'DELETE' });
  if (saved.note?.source !== 'bot') throw new Error(`Not a bot's own note: ${JSON.stringify(saved)}`);
  return saved.note;
}

// A stand-in for a connected app, as botdot reaches one through Composio: Gmail, with one action it may read
// with (GMAIL_READ), actions that write (any name that starts with GMAIL_SEND) and, by any other name, an action
// Composio describes with no hint at all, and GMAIL_FETCH_EMAILS, a read that needs the owner's connection. Start it before the server and hand `env` to startServer; then
// `await app.connect(srv)` gives the server its key. executed: what was run through it, oldest first, each
// { action, args }. Every action answers { done: true }. connected: the apps Composio lists as connected, by slug
// (none unless given; change the list to connect or disconnect one): what the Chief is given (ADR 047).
async function fakeConnectedApp({ connected = [] } = {}) {
  const executed = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/tools/execute/')) {
        executed.push({ action: req.url.split('/').at(-1), args: JSON.parse(body).arguments });
        return res.end(JSON.stringify({ successful: true, data: { done: true } }));
      }
      if (req.url.startsWith('/connected_accounts')) return res.end(JSON.stringify({ items: connected.map((slug) => ({ id: `ca_${slug}`, toolkit: { slug }, status: 'ACTIVE' })) }));
      if (req.url.startsWith('/tools/')) {
        const slug = req.url.split('/').at(-1);
        // GMAIL_FETCH_EMAILS reads with the owner's connection: it runs only while `connected` has gmail.
        if (slug === 'GMAIL_FETCH_EMAILS') return res.end(JSON.stringify({ slug, toolkit: { slug: 'gmail' }, no_auth: false, tags: ['readOnlyHint'] }));
        return res.end(JSON.stringify({ slug, toolkit: { slug: 'gmail' }, no_auth: true, tags: slug === 'GMAIL_READ' ? ['readOnlyHint'] : slug.startsWith('GMAIL_SEND') ? ['createHint'] : [] }));
      }
      res.end(JSON.stringify({ items: [] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    env: { COMPOSIO_API_URL: `http://127.0.0.1:${server.address().port}` },
    executed,
    connected,
    connect: async (srv) => { const r = await srv.api('/connectors/key', { method: 'PUT', body: { key: 'fixture-key' } }); if (r.status !== 200) throw new Error(`Couldn't connect the stand-in app: ${JSON.stringify(r.data)}`); },
    close: () => { server.closeAllConnections?.(); server.close(); },
  };
}
// What the bot's tools for connected apps are started with (lib/connectors-mcp.js), for a run with this token.
const connectorEnv = (srv, token) => ({ CONNECTORS_URL: `${srv.base}/api/connectors/session`, RUN_TOKEN: token, CONNECTOR_APPS: 'gmail' });

// A stand-in docker (fixtures/fake-docker.js) in a scratch folder: bin goes first on PATH, and
// calls() lists what it was asked, oldest first. answer(file, text) writes one of the files that steer it,
// and answer(file, null) takes it away.
function fakeDocker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-docker-'));
  const bin = path.join(dir, 'bin');
  const out = path.join(dir, 'out');
  fs.mkdirSync(bin);
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\nFAKE_DOCKER_OUT="${out}" exec "${process.execPath}" "${path.join(__dirname, 'fixtures', 'fake-docker.js')}" "$@"\n`, { mode: 0o755 });
  const calls = () => (fs.existsSync(path.join(out, 'calls.jsonl')) ? fs.readFileSync(path.join(out, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { bin, calls, answer: (file, text) => (text === null ? fs.rmSync(path.join(out, file), { force: true }) : fs.writeFileSync(path.join(out, file), text)), remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// One tool call's steer hook, as Claude Code runs an `http` hook (ADR 040): the call's details posted as JSON to its
// url with its headers. Answers the parsed body of a 2xx answer, or null (Claude Code then goes on as it was).
async function hookCall(settings, input = { hook_event_name: 'PostToolUse', tool_name: 'Read' }) {
  const hook = settings.hooks.PostToolUse[0].hooks[0];
  const res = await fetch(hook.url, { method: 'POST', headers: { ...hook.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  return res.ok ? res.json() : null;
}

module.exports = { vaultSecret, hookCall, startServer, freePort, restartServer, readData, writeData, setJobs, setQueue, onceItem, runNowItem, feed, zip, makeBot, seedRuns, QUIET_RUN, BOT_TO_BOT_RUN, heldRun, self, sharedByBot, waitFor, sleep, serverDay, fakeDocker, fakeConnectedApp, connectorEnv, ROOT };

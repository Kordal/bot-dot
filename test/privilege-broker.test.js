const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('configured isolation refuses a missing broker instead of running under the server identity', () => {
  const code = `const c=require('./lib/privilege-client'); try { c.callSync('prepare',{principal:'example'}); process.exit(41); } catch(e) { process.stdout.write(e.message); }`;
  const p = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, BOT_DOT_PRIVILEGE_SOCKET: '/nonexistent/botdot-broker.sock' }, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /broker|ENOENT/i);
});

test('broker rejects caller-selected root identity and paths outside principal storage', async (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const net = require('node:net');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-policy-'));
  const socket = path.join(dir, 'broker.sock');
  const server = require('../lib/privilege-broker').createBroker({ dataDir: dir, socket });
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = (message) => new Promise((resolve, reject) => {
    const client = net.createConnection(socket); let data = '';
    client.on('connect', () => client.write(JSON.stringify(message) + '\n'));
    client.on('data', (chunk) => { data += chunk; if (data.includes('\n')) { client.destroy(); resolve(JSON.parse(data.split('\n')[0])); } });
    client.on('error', reject);
  });
  assert.match((await call({ operation: 'prepare', principal: '../../root', uid: 0 })).error.message, /principal/i);
  assert.match((await call({ operation: 'spawn', principal: 'chief', command: '/bin/bash', cwd: '/root', args: ['-c', 'id'] })).error.message, /workspace|cwd/i);
  assert.match((await call({ operation: 'chown', principal: 'chief', path: '/root', uid: 0 })).error.message, /operation/i);
});

// Intentionally split a four-byte character across separate writes. Byte streams have no
// obligation to preserve character boundaries, even when their payload is line-delimited JSON.
async function fragmentedWrite(socket, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  const start = bytes.indexOf(Buffer.from('🙂'));
  assert.ok(start >= 0);
  socket.write(bytes.subarray(0, start + 1));
  for (const [from, to] of [[start + 1, start + 2], [start + 2, start + 3], [start + 3, bytes.length]]) {
    await new Promise(resolve => setTimeout(resolve, 20));
    socket.write(bytes.subarray(from, to));
  }
}

test('the privilege client preserves Unicode when a response splits UTF-8 characters', async (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const net = require('node:net');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-unicode-'));
  const socket = path.join(dir, 'broker.sock');
  const server = net.createServer(connection => {
    connection.once('data', () => fragmentedWrite(connection, { value: 'before🙂after' }).catch(e => connection.destroy(e)));
    connection.on('error', () => {});
  });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const client = require('node:child_process').spawn(process.execPath, [path.join(__dirname, '../lib/privilege-client.js'), 'call'], { env: { ...process.env, BOT_DOT_PRIVILEGE_SOCKET: socket }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let error = '';
  client.stdout.setEncoding('utf8'); client.stderr.setEncoding('utf8');
  client.stdout.on('data', text => { output += text; }); client.stderr.on('data', text => { error += text; });
  client.stdin.end(JSON.stringify({ operation: 'ping' }));
  const code = await new Promise((resolve, reject) => { client.on('close', resolve); client.on('error', reject); });
  assert.equal(code, 0, error);
  assert.equal(JSON.parse(output).value, 'before🙂after');
});

test('the broker preserves Unicode when a request splits UTF-8 characters', async (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const net = require('node:net');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-🙂-'));
  const socket = path.join(dir, 'broker.sock');
  const server = require('../lib/privilege-broker').createBroker({ dataDir: dir, socket });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const response = await new Promise((resolve, reject) => {
    const client = net.createConnection(socket); let data = '';
    client.setEncoding('utf8');
    client.on('connect', () => fragmentedWrite(client, { operation: 'spawn', principal: 'chief', command: '/bin/bash', cwd: path.join(dir, 'workspaces', '_chief'), args: null }).catch(reject));
    client.on('data', chunk => { data += chunk; if (data.includes('\n')) { client.destroy(); resolve(JSON.parse(data.split('\n')[0])); } });
    client.on('error', reject);
  });
  // Correct decoding passes the Unicode cwd check and reaches argument validation.
  assert.match(response.error.message, /Invalid process arguments/);
});

test('a principal named constructor never supplies inherited object properties as OS identities', () => {
  // Account writes are an OS boundary: redirect them in a separate process so the failing
  // implementation cannot append malformed records to the real machine's account database.
  const code = `
    const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), net=require('node:net');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'broker-account-'));
    for(const name of ['homes','workspaces','skill-packs'])fs.mkdirSync(path.join(dir,name));
    const read=fs.readFileSync, append=fs.appendFileSync, records=[];
    fs.readFileSync=function(p,...args){return p==='/etc/passwd'||p==='/etc/group'?'':read.call(this,p,...args)};
    fs.appendFileSync=function(p,text,...args){if(p==='/etc/passwd'||p==='/etc/group'){records.push({p,text});return;}return append.call(this,p,text,...args)};
    fs.fchownSync=()=>{}; process.getuid=()=>0;
    const socket=path.join(dir,'broker.sock');
    const server=require('./lib/privilege-broker').createBroker({dataDir:dir,socket});
    server.listen(socket,()=>{const c=net.createConnection(socket);c.on('connect',()=>c.write(JSON.stringify({operation:'prepare',principal:'constructor'})+'\\n'));c.once('data',()=>{c.destroy();server.close(()=>{console.log(JSON.stringify(records));fs.rmSync(dir,{recursive:true,force:true});})});});
  `;
  const result = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const records = JSON.parse(result.stdout);
  const account = records.find(row => row.p === '/etc/passwd');
  assert.ok(account);
  assert.match(account.text, /^botdot-61000:x:61000:61000:/);
});

test('a brokered process with ignored stdin receives EOF immediately', async (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const net = require('node:net');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-stdin-'));
  const socket = path.join(dir, 'broker.sock');
  const server = net.createServer(connection => {
    let buffer = ''; const timer = setTimeout(() => connection.end(JSON.stringify({ exit: 9 }) + '\n'), 500);
    connection.setEncoding('utf8'); connection.on('error', () => {}); connection.on('close', () => clearTimeout(timer));
    connection.on('data', chunk => { buffer += chunk; for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (message.end) { clearTimeout(timer); connection.end(JSON.stringify({ exit: 0 }) + '\n'); }
    } });
  });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const old = process.env.BOT_DOT_PRIVILEGE_SOCKET; process.env.BOT_DOT_PRIVILEGE_SOCKET = socket;
  let child;
  try { child = require('../lib/privilege-client').spawn('/bin/bash', ['-c', 'cat'], { botdotPrincipal: 'chief', stdio: ['ignore', 'pipe', 'pipe'] }); }
  finally { if (old === undefined) delete process.env.BOT_DOT_PRIVILEGE_SOCKET; else process.env.BOT_DOT_PRIVILEGE_SOCKET = old; }
  const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  assert.equal(code, 0, 'ignored stdin must be closed, not held open until the script timeout');
});

const ROOT_LINUX = process.platform === 'linux' && process.getuid?.() === 0;
test('a completed brokered shell releases pipes held by its background process group', { skip: !ROOT_LINUX && 'needs isolated Linux root', timeout: 10000 }, async (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const net = require('node:net');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-background-')); fs.chmodSync(dir, 0o755);
  for (const name of ['homes', 'workspaces', 'skill-packs']) fs.mkdirSync(path.join(dir, name), { mode: 0o755 });
  const socket = path.join(dir, 'broker.sock');
  const server = require('../lib/privilege-broker').createBroker({ dataDir: dir, socket });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { server.stopChildren(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const began = Date.now();
  const frames = await new Promise((resolve, reject) => {
    const client = net.createConnection(socket); let data = '';
    client.setEncoding('utf8');
    client.on('connect', () => client.write(JSON.stringify({ operation: 'spawn', principal: 'chief', command: '/bin/bash', cwd: path.join(dir, 'workspaces', '_chief'), args: ['-c', 'sleep 3 & printf done'], env: {} }) + '\n' + JSON.stringify({ end: true }) + '\n'));
    client.on('data', chunk => { data += chunk; }); client.on('error', reject);
    client.on('end', () => resolve(data.trim().split('\n').map(line => JSON.parse(line))));
  });
  assert.equal(frames.find(frame => frame.exit !== undefined)?.exit, 0, JSON.stringify(frames));
  assert.equal(frames.filter(frame => frame.stdout).map(frame => Buffer.from(frame.stdout, 'base64').toString()).join(''), 'done');
  assert.ok(Date.now() - began < 1500, 'shell completion must not wait for background children to close inherited pipes');
});

test('migration preserves a principal-owned FIFO and hardlinks without changing their targets', { skip: !ROOT_LINUX && 'needs isolated Linux root' }, (t) => {
  const fs = require('node:fs'); const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-migrate-')); fs.chmodSync(dir, 0o711);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = path.join(dir, 'data'), workspace = path.join(data, 'workspaces', '_chief');
  fs.mkdirSync(workspace, { recursive: true });
  const fifo = path.join(workspace, 'tool.pipe');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0); fs.chownSync(fifo, 60500, 60500);
  const original = path.join(workspace, 'original'), linked = path.join(workspace, 'linked');
  fs.writeFileSync(original, 'principal file'); fs.chownSync(original, 60500, 60500); fs.linkSync(original, linked);
  const retained = path.join(data, 'backups', 'replaced-20260929123456'); fs.mkdirSync(retained, { recursive: true });
  assert.equal(spawnSync('mkfifo', [path.join(retained, 'old.pipe')]).status, 0);
  const docker = path.join(dir, 'home', '.docker'); fs.mkdirSync(docker, { recursive: true });
  const credential = path.join(docker, 'config.json'); fs.writeFileSync(credential, '{"auths":{"registry.invalid":{"auth":"synthetic"}}}');
  const migrate = () => require('../lib/privilege-broker').migrate(data, path.join(dir, 'home'), path.join(dir, 'config'));
  migrate();
  assert.equal(fs.statSync(credential).uid, 0, 'legacy registry credentials stay root-owned');
  assert.equal(fs.statSync(docker).mode & 0o777, 0o700);
  assert.equal(spawnSync(process.execPath, ['-e', 'require("fs").readFileSync(process.argv[1])', credential], { uid: 60000, gid: 60000 }).status, 1, 'server cannot read legacy Docker credentials');
  const home = path.join(dir, 'home');
  assert.equal(fs.statSync(home).uid, 0); assert.equal(fs.statSync(home).gid, 60000); assert.equal(fs.statSync(home).mode & 0o7777, 0o1770);
  assert.equal(spawnSync(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1],"Claude state")', path.join(home, '.claude.json')], { uid: 60000, gid: 60000 }).status, 0, 'server can write normal home state');
  assert.equal(spawnSync(process.execPath, ['-e', 'require("fs").renameSync(process.argv[1],process.argv[2])', docker, path.join(home, 'renamed-docker')], { uid: 60000, gid: 60000 }).status, 1, 'server cannot rename the protected Docker directory');
  migrate(); assert.equal(fs.statSync(credential).uid, 0);
  assert.equal(spawnSync(process.execPath, ['-e', 'require("fs").readFileSync(process.argv[1])', credential], { uid: 60000, gid: 60000 }).status, 1, 'registry credentials stay inaccessible after another migration');
  assert.ok(fs.lstatSync(path.join(retained, 'old.pipe')).isFIFO());
  assert.ok(fs.lstatSync(fifo).isFIFO()); assert.equal(fs.lstatSync(fifo).uid, 60500);
  assert.equal(fs.statSync(original).ino, fs.statSync(linked).ino); assert.equal(fs.statSync(linked).uid, 60500);
  assert.equal(fs.readFileSync(linked, 'utf8'), 'principal file');
  const active = path.join(data, 'replaced-20260929123456'); fs.mkdirSync(active);
  assert.equal(spawnSync('mkfifo', [path.join(active, 'unsafe.pipe')]).status, 0);
  assert.throws(migrate, /Unsafe special file/, 'a snapshot-like name outside backups must not bypass active data validation');
});

// ---------- a bot's installed tools (ADR 007) ----------

const sha = (text) => require('node:crypto').createHash('sha256').update(text).digest('hex');
const pinned = (file, subdir = 'noarch') => ({ url: `https://conda.anaconda.org/conda-forge/${subdir}/${file}.conda`, sha256: sha(file) });
// One request to a broker, answered with its first line.
const ask = (socket, message) => new Promise((resolve, reject) => {
  const client = require('node:net').createConnection(socket); let data = '';
  client.setEncoding('utf8');
  client.on('connect', () => client.write(JSON.stringify(message) + '\n'));
  client.on('data', (chunk) => { data += chunk; });
  client.on('end', () => { try { resolve(JSON.parse(data.split('\n')[0])); } catch (e) { reject(e); } });
  client.on('error', reject);
});

test("the broker's tools operations take a bot, a tool and a list of registry packages, and nothing else", async (t) => {
  const fs = require('node:fs'); const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-tools-policy-'));
  const socket = path.join(dir, 'broker.sock');
  const server = require('../lib/privilege-broker').createBroker({ dataDir: dir, socket, micromambaBin: '/bin/false', toolsCache: path.join(dir, 'cache') });
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const install = { operation: 'toolInstall', principal: 'bot1', tool: 'tree', list: [pinned('tree-2.2.1-h1_0')], approvedAt: new Date().toISOString() };
  const refused = async (message, why) => assert.match((await ask(socket, message)).error.message, why, JSON.stringify(message));
  await refused({ ...install, principal: '../bot2' }, /principal/); // another principal's folder
  await refused({ ...install, principal: 'chief' }, /principal/);
  await refused({ ...install, tool: '../bot2/tree' }, /tool name/); // a path outside the bot's folder
  await refused({ ...install, tool: '../../../etc' }, /tool name/); // a path outside data/tools
  await refused({ ...install, tool: 'bin' }, /tool name/);
  await refused({ ...install, list: 'tree; rm -rf /' }, /must be a list/); // an argument that is not a list
  await refused({ ...install, list: [{ url: 'https://example.com/tree-2.2.1-h1_0.conda', sha256: sha('x') }] }, /not a package of the registry/);
  await refused({ ...install, list: [{ url: pinned('tree-2.2.1-h1_0').url }] }, /sha256/);
  await refused({ ...install, command: '/bin/bash', args: ['-c', 'id'] , list: null }, /must be a list/);
  await refused({ operation: 'toolRemove', principal: 'bot1', keep: '*' }, /must be a list/);
  await refused({ operation: 'toolRemove', principal: 'bot1', keep: ['tree'] }, /no list/);
  await refused({ operation: 'toolRemove', principal: 'bot1', keep: [{ tool: '../bot2', list: sha('x') }] }, /tool name/);
  await refused({ operation: 'toolRemove', principal: '../..', keep: [] }, /principal/);
  await refused({ operation: 'toolResolve', name: '-c' }, /tool name/);
  await refused({ operation: 'toolResolve', name: 'tree', version: '$(id)' }, /version/);
  await refused({ operation: 'toolRun', principal: 'bot1' }, /operation/);
  // A tool from a link: one https address, the command's name and, for an install, the sha256 the owner approved.
  const fromLink = { operation: 'toolInstallLink', principal: 'bot1', tool: 'stripe', command: 'stripe', url: 'https://example.com/releases/stripe_linux.tar.gz', sha256: sha('x'), approvedAt: new Date().toISOString() };
  await refused({ ...fromLink, url: 'http://example.com/releases/stripe_linux.tar.gz' }, /https address only/);
  await refused({ ...fromLink, url: 'file:///etc/shadow' }, /https address only/);
  await refused({ ...fromLink, url: 'https://root:secret@example.com/stripe' }, /carries a login/);
  await refused({ ...fromLink, url: 'https://example.com/install.sh' }, /is a script/);
  await refused({ ...fromLink, url: ['https://example.com/stripe'] }, /not a link/);
  await refused({ ...fromLink, principal: '../bot2' }, /principal/);
  await refused({ ...fromLink, principal: 'chief' }, /principal/);
  await refused({ ...fromLink, tool: '../bot2/stripe', command: '../bot2/stripe' }, /tool name/);
  await refused({ ...fromLink, tool: 'bin', command: 'bin' }, /tool name/);
  await refused({ ...fromLink, command: '../../bin/sh' }, /one command, of the tool's own name/);
  await refused({ ...fromLink, sha256: undefined }, /sha256/);
  await refused({ ...fromLink, sha256: '../x' }, /sha256/);
  await refused({ ...fromLink, approvedAt: 'now' }, /approval time/);
  await refused({ operation: 'toolFetch', url: 'http://example.com/stripe', command: 'stripe' }, /https address only/);
  await refused({ operation: 'toolFetch', url: 'https://example.com/stripe', command: '../stripe' }, /tool name/);
  await refused({ operation: 'toolFetch', url: 'https://example.com/stripe' }, /tool name/);
  // Nothing was made for any of them.
  assert.deepEqual(fs.readdirSync(dir).sort(), ['broker.sock']);
  if (process.getuid() !== 0) {
    await refused(install, /requires root/);
    await refused(fromLink, /requires root/);
    await refused({ operation: 'toolFetch', url: fromLink.url, command: 'stripe' }, /requires root/);
  }
});

test('a tools operation is asked without holding up the server, and is dropped when it takes too long', async (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const net = require('node:net');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-call-'));
  const socket = path.join(dir, 'broker.sock');
  let closed = 0; let slowAsked = 0;
  const server = net.createServer((connection) => {
    connection.setEncoding('utf8'); connection.on('error', () => {}); connection.on('close', () => { closed++; });
    connection.once('data', (line) => {
      const { operation, name } = JSON.parse(line.split('\n')[0]);
      if (name === 'slow') { slowAsked++; return; } // never answered
      connection.end(JSON.stringify(name === 'bad' ? { error: { message: 'Invalid tool name' } } : { value: { ok: true, operation, name } }) + '\n');
    });
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const old = process.env.BOT_DOT_PRIVILEGE_SOCKET; process.env.BOT_DOT_PRIVILEGE_SOCKET = socket;
  t.after(() => { if (old === undefined) delete process.env.BOT_DOT_PRIVILEGE_SOCKET; else process.env.BOT_DOT_PRIVILEGE_SOCKET = old; });
  const { call } = require('../lib/privilege-client');
  const pending = call('toolResolve', { name: 'jq' });
  assert.ok(pending instanceof Promise);
  assert.deepEqual(await pending, { ok: true, operation: 'toolResolve', name: 'jq' });
  await assert.rejects(call('toolResolve', { name: 'bad' }), /Invalid tool name/);
  const before = closed;
  // Long enough for the call's process to start and connect on a busy runner: dropped before it connects, it
  // leaves no connection to close and the test says nothing.
  await assert.rejects(call('toolResolve', { name: 'slow' }, { timeout: 3000 }), /took too long/);
  assert.equal(slowAsked, 1, 'the call reached the broker before it was dropped');
  for (let i = 0; i < 100 && closed <= before; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(closed > before, 'the connection is closed, which is what makes the broker stop the installer');
});

// ADR 007 has a separate user for the installer so that what it unpacks from the internet is nobody botdot
// answers. A connection from this machine by a user that is neither the Chief nor a bot is the owner's
// (identity.js); the tools user must not be among those.
test('the tools user is never the owner: a connection from it gets what a stranger gets', () => {
  const identity = require('../lib/identity');
  const { TOOLS_UID, CHIEF_UID } = require('../lib/privilege-broker');
  assert.equal(identity.TOOLS_UID, TOOLS_UID, "the broker's tools user is the one identity.js knows");
  const bots = { bot1: 61000 };
  assert.notEqual(identity.whoHas(TOOLS_UID, bots), 'owner');
  assert.equal(identity.whoHas(TOOLS_UID, bots), 'unknown', 'the same as a connection whose user cannot be told: refused');
  assert.equal(identity.whoHas(null, bots), 'unknown');
  // The others are who they were.
  assert.equal(identity.whoHas(CHIEF_UID, bots), 'chief');
  assert.deepEqual(identity.whoHas(61000, bots), { bot: 'bot1' });
  assert.deepEqual(identity.whoHas(61001, bots), { bot: '?' });
  assert.equal(identity.whoHas(1000, bots), 'owner', "the owner's own programs on the machine");
});

test("the tools user installs a bot's tool; the bot runs it and cannot change it; no other bot gets in", { skip: !ROOT_LINUX && 'needs isolated Linux root', timeout: 30000 }, async (t) => {
  const fs = require('node:fs'); const os = require('node:os');
  const { TOOLS_UID, SERVER_UID } = require('../lib/privilege-broker');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-tools-')); fs.chmodSync(dir, 0o755);
  const data = path.join(dir, 'data'), cache = path.join(dir, 'cache');
  fs.mkdirSync(data, { mode: 0o711 }); fs.chmodSync(data, 0o711);
  for (const name of ['homes', 'workspaces', 'skill-packs']) { fs.mkdirSync(path.join(data, name), { mode: 0o711 }); fs.chmodSync(path.join(data, name), 0o711); }
  // The stand-in for micromamba (fixtures/fake-micromamba.js), started as the real one is: one program.
  const micromamba = path.join(dir, 'micromamba');
  fs.writeFileSync(micromamba, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, 'fixtures', 'fake-micromamba.js')}" "$@"\n`); fs.chmodSync(micromamba, 0o755);
  const socket = path.join(dir, 'broker.sock');
  const server = require('../lib/privilege-broker').createBroker({ dataDir: data, socket, micromambaBin: micromamba, toolsCache: cache });
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(async () => { server.stopChildren(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const value = async (message) => { const r = await ask(socket, message); assert.ok(!r.error && !r.value?.error, JSON.stringify(r)); return r.value; };
  const as = (uid, script) => spawnSync('/bin/sh', ['-c', script], { uid, gid: uid, cwd: '/', encoding: 'utf8', env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });

  // Resolve: the registry's answer as a pinned list, found as the tools user with no secret around.
  const resolved = await value({ operation: 'toolResolve', name: 'tree' });
  assert.deepEqual({ version: resolved.version, list: resolved.list }, { version: '2.2.1', list: [pinned('tree-2.2.1-h1_0')] });

  // Install, for the first bot.
  const one = (await value({ operation: 'prepare', principal: 'bot1' })).uid;
  const two = (await value({ operation: 'prepare', principal: 'bot2' })).uid;
  const done = await value({ operation: 'toolInstall', principal: 'bot1', tool: 'tree', list: resolved.list, approvedAt: new Date().toISOString() });
  assert.deepEqual(done.commands, ['jq', 'ls', 'tree']);
  const calls = fs.readFileSync(path.join(cache, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.length === 2 && calls.every((c) => c.uid === TOOLS_UID), 'micromamba runs as the tools user');
  for (const c of calls) assert.deepEqual(Object.keys(c.env).filter((k) => !['PWD', 'OLDPWD', 'SHLVL', '_'].includes(k)).sort(), ['HOME', 'LANG', 'MAMBA_ROOT_PREFIX', 'PATH'], 'with no key, token or login');
  const folder = path.join(data, 'tools', 'bot1');
  const top = fs.statSync(path.join(data, 'tools'));
  assert.deepEqual([top.uid, top.gid, top.mode & 0o7777], [TOOLS_UID, TOOLS_UID, 0o755]);
  const st = fs.statSync(folder);
  assert.deepEqual([st.uid, st.gid, st.mode & 0o7777], [TOOLS_UID, one, 0o750], "the tools user's, with the bot's group, mode 0750");
  const file = fs.statSync(path.join(folder, 'tree', 'bin', 'tree'));
  assert.deepEqual([file.uid, file.gid, file.mode & 0o7777], [TOOLS_UID, TOOLS_UID, 0o755], 'only the top folder is the bot\'s group\'s');
  assert.equal(fs.statSync(cache).uid, TOOLS_UID); assert.equal(fs.statSync(cache).mode & 0o777, 0o700);

  // The bot runs it and cannot change it.
  const ran = as(one, `${folder}/bin/tree --version`);
  assert.equal(ran.stdout.trim(), 'tree of tree 2.2.1 (botdot test tool)', ran.stderr);
  for (const write of [`touch ${folder}/x`, `touch ${folder}/bin/x`, `echo x >> ${folder}/tree/bin/tree`, `rm ${folder}/tree/bin/tree`, `rm ${folder}/bin/tree`, `chmod 0777 ${folder}`, `mv ${folder}/tree ${folder}/tree2`]) {
    assert.notEqual(as(one, write).status, 0, `the bot must not be able to: ${write}`);
  }
  assert.equal(as(one, `${folder}/bin/tree --version`).stdout.trim(), 'tree of tree 2.2.1 (botdot test tool)', 'and it is unchanged');
  // Another bot cannot run it, read it or look into the folder.
  for (const reach of [`${folder}/bin/tree --version`, `${folder}/tree/bin/tree --version`, `cat ${folder}/tree/bin/tree`, `ls ${folder}`]) {
    assert.notEqual(as(two, reach).status, 0, `another bot must not be able to: ${reach}`);
  }
  // Nor can the server's own user write there.
  assert.notEqual(as(SERVER_UID, `touch ${data}/tools/x`).status, 0);
  assert.notEqual(spawnSync('/bin/sh', ['-c', `echo x >> ${folder}/tree/bin/tree`], { uid: SERVER_UID, gid: SERVER_UID }).status, 0);

  // A failed install leaves the folder as it was.
  fs.writeFileSync(path.join(cache, 'fake.json'), JSON.stringify({ fail: 'disk' })); fs.chownSync(path.join(cache, 'fake.json'), TOOLS_UID, TOOLS_UID);
  const failed = await ask(socket, { operation: 'toolInstall', principal: 'bot1', tool: 'gh', list: [pinned('gh-2.101.0-h0_0', 'linux-64')], approvedAt: new Date().toISOString() });
  assert.deepEqual(failed.value.error, { message: 'The disk is full.', cause: 'disk' });
  assert.deepEqual(fs.readdirSync(folder).sort(), ['bin', 'tree']);
  fs.rmSync(path.join(cache, 'fake.json'));

  // Remove: the tool and its commands are gone; with nothing to keep, so is the folder.
  await value({ operation: 'toolInstall', principal: 'bot1', tool: 'gh', list: [pinned('gh-2.101.0-h0_0', 'linux-64')], approvedAt: new Date().toISOString() });
  await value({ operation: 'toolRemove', principal: 'bot1', keep: [{ tool: 'gh', list: require('../lib/tools-worker').listHash([pinned('gh-2.101.0-h0_0', 'linux-64')]) }] });
  assert.deepEqual(fs.readdirSync(folder).sort(), ['bin', 'gh']);
  assert.deepEqual(fs.readdirSync(path.join(folder, 'bin')), ['gh']);
  await value({ operation: 'toolRemove', principal: 'bot1', keep: [] });
  assert.ok(!fs.existsSync(folder));
});

test("the tools user fetches and unpacks a tool from a link; what would leave the tool's folder is refused, as that user", { skip: !ROOT_LINUX && 'needs isolated Linux root', timeout: 30000 }, async (t) => {
  const fs = require('node:fs'); const os = require('node:os');
  const { TOOLS_UID } = require('../lib/privilege-broker');
  const { sha: shaOf, script, tarGz, zip, fileServer } = require('./link-helpers');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-link-')); fs.chmodSync(dir, 0o755);
  const data = path.join(dir, 'data'), cache = path.join(dir, 'cache'), open = path.join(dir, 'open');
  fs.mkdirSync(data, { mode: 0o711 }); fs.chmodSync(data, 0o711);
  for (const name of ['homes', 'workspaces', 'skill-packs']) { fs.mkdirSync(path.join(data, name), { mode: 0o711 }); fs.chmodSync(path.join(data, name), 0o711); }
  // A folder anyone may write: what an archive must not reach, although the tools user could.
  fs.mkdirSync(open); fs.chmodSync(open, 0o777);
  const files = await fileServer({ dir });
  const socket = path.join(dir, 'broker.sock');
  // linkCa: the certificate of the test's own file server; the product's broker has none.
  const server = require('../lib/privilege-broker').createBroker({ dataDir: data, socket, micromambaBin: '/bin/false', toolsCache: cache, linkCa: files.ca });
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(async () => { server.stopChildren(); files.close(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const value = async (message) => { const r = await ask(socket, message); assert.ok(!r.error && !r.value?.error, JSON.stringify(r)); return r.value; };
  const as = (uid, command) => spawnSync('/bin/sh', ['-c', command], { uid, gid: uid, cwd: '/', encoding: 'utf8', env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
  const approvedAt = new Date().toISOString();
  const one = (await value({ operation: 'prepare', principal: 'bot1' })).uid;
  const two = (await value({ operation: 'prepare', principal: 'bot2' })).uid;

  // The ask: fetched as the tools user, looked at, and not kept.
  const body = tarGz([{ name: 'pkg/', type: '5' }, { name: 'pkg/tool', data: script('tool 1.0'), mode: 0o4777 }, { name: 'pkg/notes.txt', data: 'notes', mode: 0o666 }]);
  const url = files.put('/releases/tool_linux.tar.gz', body);
  const got = await value({ operation: 'toolFetch', url, command: 'tool' });
  assert.deepEqual({ sha256: got.sha256, size: got.size, kind: got.kind, member: got.member }, { sha256: shaOf(body), size: body.length, kind: 'tar.gz', member: 'pkg/tool' });
  const links = fs.statSync(path.join(cache, 'links'));
  assert.deepEqual([links.uid, links.mode & 0o777, fs.readdirSync(path.join(cache, 'links'))], [TOOLS_UID, 0o700, []]);
  assert.ok(!fs.existsSync(path.join(data, 'tools', 'bot1')), 'nothing is installed by the ask');

  // Install: the bot's folder is the tools user's with the bot's group; every file in it is the tools user's,
  // and none may be written by anyone else or carries a mode of the archive's.
  const done = await value({ operation: 'toolInstallLink', principal: 'bot1', tool: 'tool', command: 'tool', url, sha256: got.sha256, approvedAt });
  assert.deepEqual(done.commands, ['tool']);
  const folder = path.join(data, 'tools', 'bot1');
  const st = fs.statSync(folder);
  assert.deepEqual([st.uid, st.gid, st.mode & 0o7777], [TOOLS_UID, one, 0o750]);
  const walk = (at) => fs.readdirSync(at, { withFileTypes: true }).flatMap((e) => [path.join(at, e.name), ...(e.isDirectory() ? walk(path.join(at, e.name)) : [])]);
  for (const file of walk(folder)) {
    const s = fs.lstatSync(file);
    assert.equal(s.uid, TOOLS_UID, file);
    if (!s.isSymbolicLink()) assert.equal(s.mode & 0o7022, 0, `${file} has mode ${(s.mode & 0o7777).toString(8)}`);
  }
  assert.equal(as(one, `${folder}/bin/tool`).stdout.trim(), 'tool 1.0 (botdot test tool)');
  for (const write of [`touch ${folder}/x`, `echo x >> ${folder}/tool/files/pkg/tool`, `rm ${folder}/bin/tool`, `rm -r ${folder}/tool/files`]) assert.notEqual(as(one, write).status, 0, `the bot must not be able to: ${write}`);
  for (const reach of [`${folder}/bin/tool`, `cat ${folder}/tool/files/pkg/notes.txt`, `ls ${folder}`]) assert.notEqual(as(two, reach).status, 0, `another bot must not be able to: ${reach}`);

  // A file that is not the approved one installs nothing and leaves the folder as it was.
  const before = walk(folder);
  files.put('/releases/tool_linux.tar.gz', tarGz([{ name: 'pkg/tool', data: script('tool 1.0, changed'), mode: 0o755 }]));
  const changed = await ask(socket, { operation: 'toolInstallLink', principal: 'bot1', tool: 'tool', command: 'tool', url, sha256: got.sha256, approvedAt });
  assert.deepEqual(changed.value.error, { message: 'The file behind the link is not the file that was approved: its checksum differs.', cause: 'checksum' });
  assert.deepEqual(walk(folder), before);
  assert.equal(as(one, `${folder}/bin/tool`).stdout.trim(), 'tool 1.0 (botdot test tool)');

  // The unpacking's path checks, as the tools user: each of these would put something into the open folder,
  // into another bot's tools, or make something that is no plain file.
  const good = { name: 'evil', data: script('evil 1.0'), mode: 0o755 };
  const up = '../'.repeat(12);
  const evil = [
    [tarGz([good, { name: `${up}${open.slice(1)}/escaped`, data: 'x' }]), /"\.\."/],
    [tarGz([good, { name: '../../bot2/planted', data: 'x' }]), /"\.\."/],
    [tarGz([good, { name: `${open}/absolute`, data: 'x' }]), /absolute path/],
    [tarGz([good, { name: 'out', type: '2', linkname: open }, { name: 'out/through', data: 'x' }]), /holds a link/],
    [tarGz([good, { name: 'same', type: '1', linkname: 'evil' }]), /holds a link/],
    [tarGz([good, { name: 'pipe', type: '6' }]), /special file/],
    [tarGz([good, { name: 'device', type: '3' }]), /special file/],
    [zip([{ name: 'evil', data: script('evil 1.0'), mode: 0o100755 }, { name: `${up}${open.slice(1)}/escaped`, data: 'x' }]), /"\.\."/],
    [zip([{ name: 'evil', data: script('evil 1.0'), mode: 0o100755 }, { name: 'out', data: open, mode: 0o120777, store: true }]), /holds a link/],
  ];
  for (const [i, [archive, why]] of evil.entries()) {
    const address = files.put(`/evil/${i}/evil_linux`, archive);
    for (const message of [{ operation: 'toolFetch', url: address, command: 'evil' }, { operation: 'toolInstallLink', principal: 'bot1', tool: 'evil', command: 'evil', url: address, sha256: shaOf(archive), approvedAt }]) {
      const r = await ask(socket, message);
      assert.match(r.value?.error?.message || '', why, `${message.operation} ${i}: ${JSON.stringify(r)}`);
      assert.deepEqual(fs.readdirSync(open), [], `${message.operation} ${i}: nothing reached the open folder`);
      assert.deepEqual(fs.readdirSync(path.join(data, 'tools')), ['bot1'], `${message.operation} ${i}: nothing was made for another bot`);
      assert.deepEqual(walk(folder), before, `${message.operation} ${i}: the bot's folder is as it was`);
    }
  }
  assert.deepEqual(fs.readdirSync(path.join(cache, 'links')), []);
});

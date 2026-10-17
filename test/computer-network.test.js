// Opt-in integration test: creates only uniquely named scratch computers and removes them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const docker = async (...args) => (await promisify(execFile)('docker', args, { timeout: 180000 })).stdout.trim();
test('internet desktop blocks private destinations and keeps its exec control channel', { skip: process.env.BOT_DOT_DOCKER_TEST !== '1', timeout: 240000 }, async (t) => {
  const id = `security-test-${process.pid}`;
  const computers = require('../lib/computers');
  t.after(async () => { await computers.reset(id); });
  const starting = computers.ensure(id, 'internet');
  let address = '';
  for (let n = 0; n < 60 && !address; n++) {
    address = await docker('inspect', `botdot-${id}`, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}').catch(() => '');
    if (!address) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(address, 'the computer has its address before its desktop starts');
  const observed = docker('run', '--rm', '--network', `botdot-${id}-network`, '--cap-drop', 'ALL', '--entrypoint', 'python3', computers.IMAGE, '-c',
    'import socket,sys,time\nfor n in range(20):\n for port in (8000,6080):\n  s=socket.socket();s.settimeout(.1)\n  try: s.connect((sys.argv[1],port));print("OPEN",flush=True)\n  except OSError: pass\n  finally: s.close()\n time.sleep(.1)\nprint("finished")', address);
  await starting;
  assert.equal(await observed, 'finished', 'another container cannot reach control or screen during startup');
  const probe = async (host) => docker('exec', computers.containerName(id), 'python3', '-c', 'import socket,sys\ns=socket.socket();s.settimeout(1)\ntry: s.connect((sys.argv[1],80));print("connected")\nexcept OSError: print("blocked")', host);
  for (const host of ['192.168.0.1', '10.0.0.1', '169.254.169.254']) assert.equal(await probe(host), 'blocked');
  const caps = await docker('inspect', computers.containerName(id), '--format', '{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{.HostConfig.NetworkMode}}');
  assert.match(caps, /ALL/i); assert.match(caps, /no-new-privileges/); assert.equal(caps.split('|')[2], `botdot-${id}-network`, 'it is on a network of its own (#475)');
  assert.equal((await computers.request(id, '/status')).ok, true);
  assert.match(await docker('exec', computers.containerName(id), 'python3', '-c', 'import socket;print(socket.gethostbyname("example.com"))'), /\d+\.\d+/);
  const listener = require('node:net').createServer((socket) => { socket.on('error', () => {}); socket.end('fixture'); }); // the probe may reset it
  await new Promise((r) => listener.listen(0, '0.0.0.0', r));
  t.after(() => listener.close());
  // host-gateway gives Linux's Docker Engine the name Docker Desktop has by itself.
  const host = await docker('run', '--rm', '--add-host', 'host.docker.internal:host-gateway', '--entrypoint', 'python3', computers.IMAGE, '-c', 'import socket;print(socket.gethostbyname("host.docker.internal"))');
  const reachable = () => docker('exec', computers.containerName(id), 'python3', '-c', 'import socket,sys\ns=socket.socket();s.settimeout(1)\ntry: s.connect((sys.argv[1],int(sys.argv[2])));print("connected")\nexcept OSError: print("blocked")', host, String(listener.address().port));
  assert.equal(await reachable(), 'blocked');
  await computers.ensure(id, 'lan');
  assert.equal(await reachable(), 'connected', 'owner LAN opt-in reaches the same live private service');
  await computers.ensure(id, 'internet');
  assert.equal(await reachable(), 'blocked', 'revoking LAN removes access again');

  await computers.reset(id);
  await computers.reconfigure(id, 'internet');
  assert.equal((await computers.inspect(id)).state, 'none', 'changing policy does not create an idle computer');
  const pendingLanStart = computers.ensure(id, 'lan');
  const revokeDuringStart = computers.reconfigure(id, 'internet');
  await Promise.all([pendingLanStart, revokeDuringStart]);
  assert.equal(await reachable(), 'blocked', 'revocation during creation wins over the pending LAN start');

  const pendingInternetStart = computers.ensure(id, 'internet');
  const queuedLan = computers.reconfigure(id, 'lan');
  const revokeQueuedLan = computers.reconfigure(id, 'internet');
  await Promise.all([pendingInternetStart, queuedLan, revokeQueuedLan]);
  assert.equal(await reachable(), 'blocked', 'a later revocation wins over a queued LAN grant');

});

// Opt-in integration test: creates only uniquely named scratch computers and removes them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const docker = async (...args) => (await promisify(execFile)('docker', args, { timeout: 180000 })).stdout.trim();
test('a desktop reaches the internet, the local network and its own loopback; nobody reaches its control channel', { skip: process.env.BOT_DOT_DOCKER_TEST !== '1', timeout: 240000 }, async (t) => {
  const id = `security-test-${process.pid}`;
  const computers = require('../lib/computers');
  t.after(async () => { await computers.reset(id); });
  const starting = computers.ensure(id);
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
  const caps = await docker('inspect', computers.containerName(id), '--format', '{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{.HostConfig.NetworkMode}}');
  assert.match(caps, /ALL/i); assert.match(caps, /no-new-privileges/); assert.equal(caps.split('|')[2], `botdot-${id}-network`, 'it is on a network of its own (#475)');
  assert.equal((await computers.request(id, '/status')).ok, true);
  assert.match(await docker('exec', computers.containerName(id), 'python3', '-c', 'import socket;print(socket.gethostbyname("example.com"))'), /\d+\.\d+/);
  const listener = require('node:net').createServer((socket) => { socket.on('error', () => {}); socket.end('fixture'); }); // the probe may reset it
  await new Promise((r) => listener.listen(0, '0.0.0.0', r));
  t.after(() => listener.close());
  // host-gateway gives Linux's Docker Engine the name Docker Desktop has by itself.
  const host = await docker('run', '--rm', '--add-host', 'host.docker.internal:host-gateway', '--entrypoint', 'python3', computers.IMAGE, '-c', 'import socket;print(socket.gethostbyname("host.docker.internal"))');
  const connect = 'import socket,sys\ns=socket.socket();s.settimeout(1)\ntry: s.connect((sys.argv[1],int(sys.argv[2])));print("connected")\nexcept OSError: print("blocked")';
  assert.equal(await docker('exec', computers.containerName(id), 'python3', '-c', connect, host, String(listener.address().port)), 'connected', 'a private service on the local network');
  // A program of the bot on its own loopback (a mail bridge on 127.0.0.1:1143), reached by another of its programs.
  const loopback = await docker('exec', computers.containerName(id), 'python3', '-c',
    'import socket,threading\nl=socket.socket();l.bind(("127.0.0.1",1143));l.listen()\nthreading.Thread(target=lambda:l.accept()[0].close(),daemon=True).start()\ns=socket.socket();s.settimeout(1)\ntry: s.connect(("127.0.0.1",1143));print("connected")\nexcept OSError: print("blocked")');
  assert.equal(loopback, 'connected', "a program on the computer's own loopback");
});

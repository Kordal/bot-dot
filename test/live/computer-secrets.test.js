// Opt-in live acceptance of #311 (BOT_DOT_DOCKER_TEST=1, with Docker and the desktop image): on a fresh scratch
// computer the bot works as a normal user, cannot replace what botdot types secrets through, and no program of
// it receives a secret, while the real bridge still types a password and a two-step code. Synthetic values only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('../helpers');

const live = { skip: process.env.BOT_DOT_DOCKER_TEST !== '1', timeout: 600_000 };
const SECRET = 'synthetic-311-secret';
const CODE = '311311';
// The page shows a hash of what was typed in its title, so its address, which the bot's own listener may get,
// holds no value. hash() is the page's own, for the test to compare.
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const PAGE = 'data:text/html,' + encodeURIComponent('<title>311</title><input type="password" autofocus oninput="document.title = `typed-${[...this.value].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}`">');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

test('the bot works as a normal user and cannot take the secret path of its computer (#311)', live, async (t) => {
  const computers = require('../../lib/computers');
  const id = `secrets-test-${process.pid}`;
  t.after(async () => { await computers.reset(id); });
  await computers.ensure(id);
  // /cmd answers as SSE ("data: {...}"), read like lib/computer-mcp.js does.
  const cmd = async (command, params) => {
    const { text } = await computers.request(id, '/cmd', { command, params });
    const line = text.split('\n').filter((l) => l.startsWith('data:')).pop();
    return JSON.parse(line ? line.slice(5) : text);
  };
  const shell = async (command) => cmd('run_command', { command, timeout: 30 });

  // The bot's tools run as a normal user.
  assert.notEqual((await shell('id -u')).stdout.trim(), '0', 'run_shell is not root');
  await computers.startProgram(id, 'id -u > /home/bot/started-as');
  await waitFor(async () => (await shell('cat /home/bot/started-as')).stdout.trim(), { timeout: 10_000, every: 500, what: 'the started program' });
  assert.notEqual((await shell('cat /home/bot/started-as')).stdout.trim(), '0', 'start_program is not root');
  await cmd('write_text', { path: '/home/bot/written', content: 'x' });
  assert.notEqual((await shell("stat -c %u /home/bot/written")).stdout.trim(), '0', 'write_file does not write as root');
  assert.equal((await cmd('read_text', { path: '/home/bot/written' })).content, 'x', 'read_file reads the bot\'s home');

  // Nothing the bot runs can change the launcher, the interpreter or their folders.
  for (const attempt of [
    'echo x >> /usr/local/bin/camoufox-browser', 'mv /usr/local/bin/camoufox-browser /tmp/x', 'rm -f /usr/local/bin/camoufox-browser',
    'touch /usr/local/bin/camoufox-browser2', 'echo x >> /usr/bin/python3', 'touch /run/botdot-browser/bridge.sock', 'ls /run/botdot-browser',
    'ls /home/browser',
  ]) assert.notEqual((await shell(`${attempt}; echo "exit $?"`)).stdout.trim().split('\n').pop(), 'exit 0', attempt);
  await assert.rejects(cmd('write_text', { path: '/usr/local/bin/camoufox-browser', content: 'x' }).then((r) => { if (r.success === false || r.error) throw new Error(r.error); }));
  await shell('pkill -f camoufox-browser; true');
  assert.notEqual((await shell('pgrep -u browser -f "camoufox-[b]rowser --serve"')).stdout.trim(), '', 'the bot cannot end the bridge');
  assert.notEqual((await shell('apt-get install -y cowsay >/dev/null 2>&1; echo $?')).stdout.trim(), '0', 'no root for apt');

  // A program of the bot that holds 127.0.0.1:47111, where the secret used to go, never gets one: with no bridge,
  // and with the bridge but no Camoufox (no page opens while the bot holds the port; with Camoufox open, the
  // bridge holds it). botdot ends the bridge first, as the bot cannot, so that the bot's program gets the port.
  const listen = "python3 -c \"import socket\ns=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)\ns.bind(('127.0.0.1',47111));s.listen()\nopen('/home/bot/fake.log','a').write('listening\\n')\nwhile True:\n c,_=s.accept();open('/home/bot/fake.log','a').write(c.recv(65536).decode('latin1'))\" >/dev/null 2>&1";
  const browserExec = (...args) => require('node:child_process').execFileSync('docker', ['exec', '-u', 'browser', computers.containerName(id), ...args], { encoding: 'utf8' });
  // The window's title is the page's: it shows the hash of what was typed (where xdotool is there to read it).
  const typedShows = async (value, what) => {
    if ((await shell('command -v xdotool')).stdout.trim() === '') return t.diagnostic(`no xdotool: did not check that ${what} arrived`);
    await waitFor(async () => (await shell(`DISPLAY=:1 xdotool search --name '^typed-${hash(value)}'`)).stdout.trim(), { timeout: 10_000, every: 500, what });
  };
  browserExec('sh', '-c', 'pkill -f "camoufox-[b]"; sleep 1; true');
  await computers.startProgram(id, listen);
  await waitFor(async () => (await shell('cat /home/bot/fake.log 2>/dev/null')).stdout.includes('listening'), { timeout: 10_000, every: 500, what: "the bot's listener" });
  const noBridge = await computers.typeSecret(id, { site: '', field: 'password', value: SECRET });
  assert.equal(noBridge.ok, false, 'no secret is typed with no bridge');
  assert.match(noBridge.error, /open_browser/);
  await computers.ensure(id); // the bridge starts again, beside the bot's listener
  const noBrowser = await computers.typeSecret(id, { site: '', field: 'password', value: SECRET });
  assert.equal(noBrowser.ok, false, 'no secret is typed with no browser open');
  // The bot's ask to open a page now reaches its own listener, so no browser opens and still nothing is typed.
  await computers.startProgram(id, `camoufox-browser ${shq(PAGE)}`);
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal((await computers.typeSecret(id, { site: '', field: 'password', value: SECRET })).ok, false, 'no secret is typed while the bot holds the port');
  assert.ok(!(await shell('cat /home/bot/fake.log')).stdout.includes(SECRET), 'no listener of the bot got the secret');
  browserExec('sh', '-c', 'pkill -f "camoufox-[b]"; sleep 1; true');
  await shell('pkill -f "socket.SO_[R]EUSEADDR"; true');
  await computers.ensure(id);

  // With the port the bridge's again, the real bridge types a password and a two-step code.
  await computers.startProgram(id, `camoufox-browser ${shq(PAGE)}`);
  try {
    await waitFor(async () => (await computers.typeSecret(id, { op: 'where' })).ok, { timeout: 60_000, every: 1000, what: 'Camoufox' });
  } catch (e) {
    let log;
    try { log = browserExec('tail', '-n', '40', '/home/browser/bridge.log'); } catch (err) { log = `(no bridge log: ${err.message})`; }
    t.diagnostic(`bridge.log:\n${log}`);
    throw new Error(`${e.message}\nbridge.log:\n${log}`);
  }
  assert.deepEqual(await computers.typeSecret(id, { site: '', field: 'password', value: SECRET }), { ok: true }, 'the real bridge types a password');
  await typedShows(SECRET, 'the password');
  assert.ok(!(await shell('cat /home/bot/fake.log')).stdout.includes(SECRET), 'no listener of the bot got the secret');
  await shell('pkill -f camoufox-bin; true');
  assert.notEqual((await shell('pgrep -u browser -f camoufox-[b]in')).stdout.trim(), '', 'the bot cannot end Camoufox');

  // The real bridge still types a two-step code; open_browser's way of opening a page still works.
  await computers.startProgram(id, `camoufox-browser ${shq(PAGE)}`);
  await new Promise((r) => setTimeout(r, 3000));
  assert.deepEqual(await computers.typeSecret(id, { site: '', field: 'totp', value: CODE }), { ok: true }, 'the real bridge types a code');
  await typedShows(CODE, 'the code');
  assert.notEqual((await shell('pgrep -u browser -f camoufox-[b]in')).stdout.trim(), '', 'Camoufox runs as the browser user');
  await computers.startProgram(id, 'xfce4-terminal');
  await waitFor(async () => (await shell('pgrep -u bot xfce4-terminal')).stdout.trim(), { timeout: 15_000, every: 500, what: 'xfce4-terminal' });
});

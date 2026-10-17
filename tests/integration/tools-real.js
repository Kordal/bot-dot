// Run by tools-real.sh as root in a container with botdot's restrictions. The privilege broker, started
// as at a real start, is asked what the server asks it: resolve jq, install it for one bot, remove it.
// Then the same install the second way (ADR 007, tools-worker.js install()): before a micromamba that refuses
// the copy onto the data folder, as a Mac's disk shared into Docker does, the real one hard-links from a cache
// on the data folder, and that cache is gone afterwards.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBroker, migrate, TOOLS_UID } = require('../../lib/privilege-broker');

const DATA = '/data';
const SOCKET = '/run/botdot-tools-real.sock';
const SOCKET_REFUSING = '/run/botdot-tools-real-refusing.sock';
const MICROMAMBA = '/usr/local/bin/micromamba';
const REFUSING = '/usr/local/bin/micromamba-refusing-copy';

// One request; resolves with its frames (a spawn sends several).
const ask = (message, socket = SOCKET) => new Promise((resolve, reject) => {
  const client = net.createConnection(socket);
  let data = '';
  client.setEncoding('utf8');
  client.on('connect', () => client.write(`${JSON.stringify(message)}\n${JSON.stringify({ end: true })}\n`));
  client.on('data', (chunk) => { data += chunk; });
  client.on('end', () => { try { resolve(data.trim().split('\n').map((line) => JSON.parse(line))); } catch (e) { reject(e); } });
  client.on('error', reject);
});
const value = async (message, socket) => {
  const [first] = await ask(message, socket);
  if (first.error) throw new Error(`${message.operation}: ${first.error.message}`);
  return first.value;
};
// A command as a bot, the way a bot's script job runs: { code, out }.
async function as(bot, script) {
  const frames = await ask({ operation: 'spawn', principal: bot, command: '/bin/bash', cwd: path.join(DATA, 'workspaces', bot), args: ['-c', script], env: {} });
  const text = (key) => frames.filter((f) => f[key] !== undefined).map((f) => Buffer.from(f[key], 'base64').toString()).join('');
  return { code: frames.find((f) => f.exit !== undefined)?.exit, out: text('stdout') + text('stderr') };
}

async function main() {
  process.umask(0o077);
  process.setgroups([]);
  migrate(DATA, '/root', '/config');
  const broker = createBroker({ dataDir: DATA, socket: SOCKET });
  await new Promise((resolve, reject) => { broker.once('error', reject); broker.listen(SOCKET, resolve); });
  // A second broker on the same data folder whose micromamba refuses the first way's copy with the words the
  // real one printed on a Mac-hosted botdot (2026-10-03), and is the real micromamba for everything else.
  fs.writeFileSync(REFUSING, `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "--always-copy" ]; then
    echo "critical libmamba filesystem error: cannot copy: Permission denied [$MAMBA_ROOT_PREFIX/pkgs/jq/bin/jq] [${DATA}/tools/bot1/jq/bin/jq]" >&2
    exit 1
  fi
done
exec ${MICROMAMBA} "$@"
`);
  fs.chmodSync(REFUSING, 0o755);
  const refusing = createBroker({ dataDir: DATA, socket: SOCKET_REFUSING, micromambaBin: REFUSING });
  await new Promise((resolve, reject) => { refusing.once('error', reject); refusing.listen(SOCKET_REFUSING, resolve); });
  try {
    await value({ operation: 'prepare', principal: 'bot1' });
    await value({ operation: 'prepare', principal: 'bot2' });

    const resolved = await value({ operation: 'toolResolve', name: 'jq' });
    assert.ok(!resolved.error, JSON.stringify(resolved.error));
    assert.ok(resolved.list.length >= 1 && resolved.list.every((p) => /^https:\/\/conda\.anaconda\.org\/conda-forge\//.test(p.url) && /^[0-9a-f]{64}$/.test(p.sha256)), 'a list of registry packages, each with its sha256');
    console.log(`resolved jq ${resolved.version}: ${resolved.list.length} packages, ${resolved.size} bytes to download`);

    // A wrong sha256 first, while nothing is cached: nothing is installed.
    const wrong = resolved.list.map((p) => ({ ...p, sha256: p.sha256.replace(/^./, (c) => (c === '0' ? '1' : '0')) }));
    const refused = await value({ operation: 'toolInstall', principal: 'bot2', tool: 'jq', list: wrong, approvedAt: new Date().toISOString() });
    assert.equal(refused.error?.cause, 'checksum', JSON.stringify(refused));
    assert.ok(!fs.existsSync(path.join(DATA, 'tools', 'bot2', 'jq')), 'nothing is left of an install with a wrong sha256');

    const done = await value({ operation: 'toolInstall', principal: 'bot1', tool: 'jq', list: resolved.list, approvedAt: new Date().toISOString() });
    assert.ok(!done.error, JSON.stringify(done.error));
    assert.ok(done.commands.includes('jq'), `its commands: ${done.commands}`);
    assert.equal(done.way, 'copy', 'a Docker volume takes the copy: the first way');
    assert.ok(!fs.existsSync(path.join(DATA, 'tools', '.cache')), 'the first way keeps no cache on the data folder');
    const folder = path.join(DATA, 'tools', 'bot1');
    const st = fs.statSync(folder);
    const { bots } = JSON.parse(fs.readFileSync(path.join(DATA, 'identities.json'), 'utf8'));
    assert.deepEqual([st.uid, st.gid, st.mode & 0o7777], [TOOLS_UID, bots.bot1, 0o750]);

    const ran = await as('bot1', `${folder}/bin/jq --version && echo '{"a": 41}' | ${folder}/bin/jq '.a + 1'`);
    assert.equal(ran.code, 0, ran.out);
    assert.match(ran.out, /^jq-[\d.]+\n42\n$/, ran.out);
    for (const write of [`touch ${folder}/x`, `echo x >> ${folder}/jq/bin/jq`, `rm ${folder}/bin/jq`]) assert.notEqual((await as('bot1', write)).code, 0, `the bot must not be able to: ${write}`);
    const other = await as('bot2', `${folder}/bin/jq --version`);
    assert.notEqual(other.code, 0, `another bot must not run it: ${other.out}`);

    await value({ operation: 'toolRemove', principal: 'bot1', keep: [] });
    assert.ok(!fs.existsSync(folder), 'removed');
    console.log(`the first way passed: jq ${resolved.version}, every file copied from the cache in the container`);

    // The second way. A wrong sha256 first: nothing is installed, and no cache stays on the data folder.
    const cacheOnData = path.join(DATA, 'tools', '.cache');
    const refusedAgain = await value({ operation: 'toolInstall', principal: 'bot1', tool: 'jq', list: wrong, approvedAt: new Date().toISOString() }, SOCKET_REFUSING);
    assert.equal(refusedAgain.error?.cause, 'checksum', JSON.stringify(refusedAgain));
    assert.ok(!fs.existsSync(path.join(folder, 'jq')), 'nothing is left of an install with a wrong sha256, the second way either');
    assert.ok(!fs.existsSync(cacheOnData), 'nor its cache');

    const linked = await value({ operation: 'toolInstall', principal: 'bot1', tool: 'jq', list: resolved.list, approvedAt: new Date().toISOString() }, SOCKET_REFUSING);
    assert.ok(!linked.error, JSON.stringify(linked.error));
    assert.equal(linked.way, 'links', 'after the refused copy: hard links from a cache on the data folder');
    assert.ok(linked.commands.includes('jq'), `its commands: ${linked.commands}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'jq', '.botdot-tool.json'), 'utf8')).way, 'links');
    assert.ok(!fs.existsSync(cacheOnData), 'the cache on the data folder is gone when the install ends');
    // With the cache gone no file of the tool is linked to anything: not to a cache, not to another bot's tool.
    const walk = (at) => fs.readdirSync(at, { withFileTypes: true }).flatMap((e) => [path.join(at, e.name), ...(e.isDirectory() ? walk(path.join(at, e.name)) : [])]);
    const files = walk(path.join(folder, 'jq')).map((file) => [file, fs.lstatSync(file)]).filter(([, s]) => s.isFile());
    assert.ok(files.length > 5, `the tool's files: ${files.length}`);
    for (const [file, s] of files) {
      assert.equal(s.nlink, 1, `${file} is still linked to another file`);
      assert.equal(s.uid, TOOLS_UID, file);
      assert.equal(s.mode & 0o022, 0, `${file} may be written by others: ${(s.mode & 0o7777).toString(8)}`);
    }
    const stAgain = fs.statSync(folder);
    assert.deepEqual([stAgain.uid, stAgain.gid, stAgain.mode & 0o7777], [TOOLS_UID, bots.bot1, 0o750]);
    const ranAgain = await as('bot1', `${folder}/bin/jq --version && echo '{"a": 41}' | ${folder}/bin/jq '.a + 1'`);
    assert.equal(ranAgain.code, 0, ranAgain.out);
    assert.match(ranAgain.out, /^jq-[\d.]+\n42\n$/, ranAgain.out);
    for (const write of [`touch ${folder}/x`, `echo x >> ${folder}/jq/bin/jq`, `rm ${folder}/bin/jq`]) assert.notEqual((await as('bot1', write)).code, 0, `the bot must not be able to: ${write}`);
    assert.notEqual((await as('bot2', `${folder}/bin/jq --version`)).code, 0, 'another bot must not run it');
    await value({ operation: 'toolRemove', principal: 'bot1', keep: [] });
    assert.ok(!fs.existsSync(folder), 'removed');
    console.log(`the second way passed: jq ${resolved.version}, hard-linked from a cache on the data folder that is gone afterwards`);

    console.log(`tools-real passed: jq ${resolved.version} for one bot on ${process.arch}, both ways, as user ${TOOLS_UID}`);
  } finally {
    for (const b of [broker, refusing]) {
      b.stopChildren();
      await new Promise((resolve) => b.close(resolve));
    }
  }
}
main().catch((e) => { console.error(`tools-real failed: ${e.stack || e.message}`); process.exit(1); });

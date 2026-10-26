// A bot's files copied when its computer moves between this machine and boat.dev (#556, ADR 091): packed on the old
// side, handed through botdot in pieces, unpacked on the new one; a failure is kept, with its reason, until tried again.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const moveLib = require('../lib/computer-move');
const boatLib = require('../lib/boat');
const helper = require('../lib/docker-helper');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-move-'));
const pieces = { linux: { readMax: 7, writeMax: 3 }, boat: { readMax: 5, writeMax: 4 } };

// One side of a copy: a packed folder and browser profile of its own (none: no profile), or the bytes it was handed,
// as each step leaves them.
function side(packed, { profile = Buffer.alloc(0), fail = null } = {}) {
  const own = { files: packed, profile };
  const got = { files: Buffer.alloc(0), profile: Buffer.alloc(0) };
  const s = { got: Buffer.alloc(0), unpacked: null, profileUnpacked: null, dropped: 0, steps: [] };
  s.moveFiles = async (botId, { op, part = 'files', offset, length, data }) => {
    s.steps.push(part === 'files' ? op : `${op} ${part}`);
    if (fail === op || fail === `${op} ${part}`) return { code: 1, stderr: 'tar: No space left on device\n' };
    if (op === 'pack') return { code: 0, size: own[part].length };
    if (op === 'read') return { code: 0, data: own[part].subarray(offset, offset + length).toString('base64') };
    if (op === 'write') {
      if (offset === 0) got[part] = Buffer.alloc(0); // the first piece starts the tar over, as on both sides
      if (offset !== got[part].length) return { code: 4, stderr: 'a piece came out of order' };
      got[part] = Buffer.concat([got[part], Buffer.from(data, 'base64')]);
      s.got = got.files;
      return { code: 0 };
    }
    if (op === 'unpack') { if (part === 'files') s.unpacked = got.files; else s.profileUnpacked = got.profile; return { code: 0 }; }
    if (op === 'drop') { if (part === 'files') s.dropped++; return { code: 0 }; }
    throw new Error(op);
  };
  return s;
}

test('a copy hands every byte of the old side to the new one, in order, and drops what it packed on both', async () => {
  const bytes = Buffer.from('a tar of the bot folder, gzipped, longer than any one piece');
  const linux = side(bytes);
  const boat = side(Buffer.alloc(0));
  const after = [];
  const changes = [];
  const moves = moveLib.create(dir(), { sides: { linux, boat }, pieces, onChange: (id) => changes.push(id), after: async (...a) => after.push(a), every: 0 });
  const running = moves.start('coder', 'linux', 'boat');
  assert.equal(moves.of('coder').state, 'copying');
  assert.ok(moves.copying('coder'));
  await running;
  assert.deepEqual(boat.unpacked, bytes);
  assert.equal(linux.dropped, 1, 'the old side drops its tar');
  assert.equal(moves.of('coder'), null, 'a finished copy leaves nothing');
  assert.equal(moves.copying('coder'), false);
  assert.deepEqual(after, [['coder', 'linux', 'boat']]);
  assert.ok(changes.length >= 2, 'the apps are told it started and ended');
});

test('a failed copy says why, keeps the old side whole and is tried again the same way', async () => {
  const bytes = Buffer.from('files on boat.dev');
  const boat = side(bytes);
  const linux = side(Buffer.alloc(0), { fail: 'unpack' });
  const data = dir();
  const after = [];
  const moves = moveLib.create(data, { sides: { linux, 'boat-own': boat }, pieces: { ...pieces, 'boat-own': pieces.boat }, after: async (...a) => after.push(a) });
  await moves.start('coder', 'boat-own', 'linux');
  const m = moves.of('coder');
  assert.equal(m.state, 'failed');
  assert.match(m.error, /couldn't unpack its files on this machine: tar: No space left on device/);
  assert.ok(moves.holdsBoat('coder'), 'its own boat.dev machine is still needed');
  assert.deepEqual(after, [], 'nothing lets its machine go');
  assert.equal(moveLib.create(data, { sides: { linux, 'boat-own': boat }, pieces: { ...pieces, 'boat-own': pieces.boat } }).of('coder').state, 'failed', 'kept across a restart');
  linux.moveFiles = side(Buffer.alloc(0)).moveFiles;
  await moves.retry('coder');
  assert.equal(moves.of('coder'), null);
  assert.deepEqual(after, [['coder', 'boat-own', 'linux']]);
  assert.equal(moves.retry('coder'), null, 'nothing to try again');
});

test('a copy botdot started again during is failed, and one over 2 GB is not started', async () => {
  const data = dir();
  fs.writeFileSync(path.join(data, 'computer-moves.json'), JSON.stringify({ coder: { from: 'linux', to: 'boat', state: 'copying', done: 10, total: 20, at: 1 } }));
  const moves = moveLib.create(data, { sides: {}, pieces });
  assert.equal(moves.of('coder').state, 'failed');
  assert.equal(moves.of('coder').error, moveLib.RESTARTED);
  moves.clear('coder');
  assert.equal(moves.of('coder'), null, 'a changed computer forgets it');

  const big = side(Buffer.alloc(0));
  big.moveFiles = async (id, { op }) => (op === 'pack' ? { code: 0, size: moveLib.MAX_BYTES + 1 } : { code: 0 });
  const other = side(Buffer.alloc(0));
  await moveLib.create(dir(), { sides: { linux: big, boat: other }, pieces }).start('coder', 'linux', 'boat');
  assert.deepEqual(other.steps, ['drop', 'drop profile'], 'nothing written');
});

test("the browser's profile goes after the files, counted in the same bytes; a side without one leaves the other's", async () => {
  const files = Buffer.from('the bot folder, packed');
  const profile = Buffer.from('cookies and local storage of the bot');
  const boat = side(files, { profile });
  const linux = side(Buffer.alloc(0));
  const seen = [];
  const moves = moveLib.create(dir(), { sides: { linux, 'boat-own': boat }, pieces: { ...pieces, 'boat-own': pieces.boat }, every: 0, onChange: (id) => seen.push(moves.of(id)) });
  await moves.start('coder', 'boat-own', 'linux');
  assert.deepEqual(linux.unpacked, files);
  assert.deepEqual(linux.profileUnpacked, profile, 'the browser stays signed in');
  assert.ok(linux.steps.indexOf('unpack') > linux.steps.lastIndexOf('write profile'), 'nothing is unpacked before every part is there');
  const totals = seen.filter(Boolean).map((m) => m.total).filter(Boolean);
  assert.ok(totals.every((t) => t === files.length + profile.length));
  const done = seen.filter(Boolean).map((m) => m.done);
  assert.deepEqual(done, [...done].sort((a, b) => a - b), 'what is done only grows');
  assert.ok(boat.steps.includes('drop profile'), 'the old side drops both tars');

  const back = side(Buffer.alloc(0));
  await moveLib.create(dir(), { sides: { linux: side(files), 'boat-own': back }, pieces: { ...pieces, 'boat-own': pieces.boat } }).start('coder', 'linux', 'boat-own');
  assert.deepEqual(back.unpacked, files);
  assert.equal(back.profileUnpacked, null, 'no profile on the old side: the new side keeps its own');
  assert.ok(!back.steps.some((x) => x === 'write profile' || x === 'unpack profile'));
});

test("a profile that can't be taken fails the copy with its reason, and leaves nothing", async () => {
  const boat = side(Buffer.from('files'), { profile: Buffer.from('profile') });
  const linux = side(Buffer.alloc(0), { fail: 'unpack profile' });
  const moves = moveLib.create(dir(), { sides: { linux, 'boat-own': boat }, pieces: { ...pieces, 'boat-own': pieces.boat } });
  await moves.start('coder', 'boat-own', 'linux');
  assert.match(moves.of('coder').error, /couldn't unpack its browser's profile on this machine: tar: No space left on device/);
  assert.ok(linux.steps.includes('drop profile') && boat.steps.includes('drop profile'));

  const refused = side(Buffer.alloc(0), { fail: 'write profile' });
  await moveLib.create(dir(), { sides: { linux: refused, 'boat-own': boat }, pieces: { ...pieces, 'boat-own': pieces.boat } }).start('coder', 'boat-own', 'linux');
  assert.equal(refused.unpacked, null, 'a profile that never arrived leaves the folder there as it was');
});

test("this machine's side packs a profile as the browser user, without its caches, and replaces the other's whole", { skip: process.platform !== 'linux' }, () => {
  const { execFileSync } = require('node:child_process');
  const { PROFILE_SCRIPTS } = require('../lib/computers');
  const run = (op, profiles, tar, ...rest) => execFileSync('sh', ['-c', PROFILE_SCRIPTS[op], 'sh', profiles, tar, ...rest], { encoding: 'utf8' });
  const a = dir();
  const b = dir();
  fs.mkdirSync(path.join(a, 'coder', 'cache2'), { recursive: true });
  fs.writeFileSync(path.join(a, 'coder', 'cookies.sqlite'), 'signed in');
  fs.writeFileSync(path.join(a, 'coder', 'cache2', 'entry'), 'cached');
  fs.writeFileSync(path.join(a, 'coder', '.parentlock'), '');
  const tar = path.join(a, 'out.tgz');
  const size = Number(run('pack', a, tar, '0', '0', 'coder'));
  assert.ok(size > 0);
  assert.equal(run('pack', a, path.join(a, 'none.tgz'), '0', '0', 'nobody').trim(), '0', 'no profile packs nothing');
  const piece = run('read', a, tar, '0', String(size), 'coder');
  fs.mkdirSync(path.join(b, 'coder'));
  fs.writeFileSync(path.join(b, 'coder', 'old.sqlite'), 'the other one');
  const into = path.join(b, 'in.tgz');
  execFileSync('sh', ['-c', PROFILE_SCRIPTS.write, 'sh', b, into, '0', '0', 'coder'], { input: Buffer.from(piece, 'base64') });
  run('unpack', b, into, '0', '0', 'coder');
  assert.equal(fs.readFileSync(path.join(b, 'coder', 'cookies.sqlite'), 'utf8'), 'signed in');
  assert.equal(fs.existsSync(path.join(b, 'coder', 'old.sqlite')), false, 'the old profile is replaced whole');
  assert.equal(fs.existsSync(path.join(b, 'coder', 'cache2')), false, 'its caches stay behind');
  assert.equal(fs.existsSync(path.join(b, 'coder', '.parentlock')), false);
  assert.equal(fs.existsSync(into), false);
  assert.throws(() => run('unpack', b, into, '0', '0', ''), 'no bot, no profile touched');

  const evil = dir();
  fs.mkdirSync(path.join(evil, 'p'));
  fs.symlinkSync('/etc', path.join(evil, 'p', 'etc'));
  const bad = path.join(evil, 'bad.tgz');
  execFileSync('tar', ['-czf', bad, '-C', path.join(evil, 'p'), '.']);
  assert.throws(() => execFileSync('sh', ['-c', PROFILE_SCRIPTS.unpack, 'sh', b, bad, '0', '0', 'coder'], { stdio: 'pipe' }), /holds links/);
  assert.equal(fs.readFileSync(path.join(b, 'coder', 'cookies.sqlite'), 'utf8'), 'signed in', 'a refused profile changes nothing');
});

test("a pack gone from the old side's /tmp mid-copy is packed again and copied over from its start, at most twice (#586)", async () => {
  const bytes = Buffer.from('a tar of the bot folder that outlives one machine start');
  const repacked = Buffer.from('the same folder packed again, a little longer this time');
  const old = side(bytes);
  const read = old.moveFiles;
  let gone = 1;
  let packs = 0;
  old.moveFiles = async (id, step) => {
    if (step.op === 'pack' && step.part === 'files' && ++packs > 1) return { code: 0, size: repacked.length };
    if (step.op === 'read' && step.offset >= 10 && gone > 0) { gone--; return { code: moveLib.GONE, stderr: moveLib.GONE_WORDS }; }
    if (step.op === 'read' && packs > 1) return { code: 0, data: repacked.subarray(step.offset, step.offset + step.length).toString('base64') };
    return read(id, step);
  };
  const boat = side(Buffer.alloc(0));
  const totals = [];
  const moves = moveLib.create(dir(), { sides: { linux: old, boat }, pieces, every: 0, onChange: (id) => totals.push(moves.of(id)?.total) });
  await moves.start('coder', 'linux', 'boat');
  assert.equal(moves.of('coder'), null, 'it finished');
  assert.ok(totals.includes(bytes.length) && totals.includes(repacked.length), 'its total follows the new pack, a number with no profile');
  assert.deepEqual(boat.unpacked, repacked, 'the new side holds the new pack alone, from its start');

  const lost = side(bytes);
  lost.moveFiles = async (id, step) => (step.op === 'read' ? { code: moveLib.GONE, stderr: moveLib.GONE_WORDS } : side(bytes).moveFiles(id, step));
  const failing = moveLib.create(dir(), { sides: { linux: lost, boat: side(Buffer.alloc(0)) }, pieces });
  await failing.start('coder', 'linux', 'boat');
  assert.match(failing.of('coder').error, /^couldn't read its files on this machine: its packed folder is gone$/);
});

test("this machine's read says its pack is gone instead of handing out nothing", { skip: process.platform !== 'linux' }, () => {
  const { execFileSync } = require('node:child_process');
  const { PROFILE_SCRIPTS } = require('../lib/computers');
  const r = (() => { try { execFileSync('sh', ['-c', PROFILE_SCRIPTS.read, 'sh', dir(), '/nonexistent/x.tgz', '0', '5', 'coder'], { stdio: 'pipe' }); return null; } catch (e) { return e; } })();
  assert.equal(r?.status, moveLib.GONE);
  assert.match(String(r.stderr), /its packed folder is gone/);
});

test('only a move between this machine and boat.dev copies', () => {
  assert.ok(moveLib.isMove('linux', 'boat'));
  assert.ok(moveLib.isMove('boat', 'linux'));
  assert.equal(moveLib.isMove('none', 'boat'), false);
  assert.equal(moveLib.isMove('linux', 'none'), false);
  assert.equal(moveLib.isMove('boat', 'boat'), false);
  assert.throws(() => moveLib.create(dir(), { sides: {}, pieces }).start('coder', 'none', 'boat'));
});

test("boat.dev's side packs /home/user without its caches, and takes pieces through the file API in order", async (t) => {
  const KEY = `boat_${'x'.repeat(16)}`;
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const commands = [];
  const files = new Map();
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, { method = 'GET', body } = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v1/, '');
    const d = body ? JSON.parse(body) : null;
    if (p === '/sandboxes' && method === 'POST') return reply(202, { ok: true, sandbox: { id: 'bx_aaaaaaaa' } });
    if (p === '/sandboxes/bx_aaaaaaaa' && method === 'GET') return reply(200, { ok: true, sandbox: { state: 'ready' } });
    if (p.endsWith('/files') && method === 'PUT') { files.set(d.path, d.content); return reply(200, { ok: true }); }
    if (p.endsWith('/files')) return reply(200, { ok: true, content: Buffer.from('piece').toString('base64') });
    if (p.endsWith('/commands')) { commands.push(d.command); return reply(200, { ok: true, exitCode: 0, stdout: d.command.endsWith('stat -c %s /tmp/botdot-move-coder.tgz') ? '1234\n' : '' }); }
    return reply(200, { ok: true });
  };
  const boat = boatLib.create(dir(), { kitOnStart: false, fetch, sleep: async () => {} });
  const packed = await boat.moveFiles('coder', { op: 'pack' });
  assert.equal(packed.code, 0);
  assert.equal(packed.size, 1234);
  assert.match(commands[0], /tar --ignore-failed-read -czf \/tmp\/botdot-move-coder\.tgz -C '\/home\/user' .*--exclude=\.\/\.cache/);
  const read = await boat.moveFiles('coder', { op: 'read', offset: 10, length: 5 });
  assert.equal(Buffer.from(read.data, 'base64').toString(), 'piece');
  assert.match(commands[1], /tail -c \+11 \/tmp\/botdot-move-coder\.tgz \| head -c 5/);
  const w = await boat.moveFiles('coder', { op: 'write', offset: 0, data: Buffer.from('abc').toString('base64') });
  assert.equal(w.code, 0);
  assert.equal(files.get('/tmp/botdot-move-coder.part'), Buffer.from('abc').toString('base64'));
  assert.match(commands[2], /^: > \/tmp\/botdot-move-coder\.tgz/, 'the first piece starts the tar');
  await boat.moveFiles('coder', { op: 'write', offset: 3, data: 'ZGVm' });
  assert.match(commands[3], /= 3 \]/, 'a later piece checks it comes in order');
  assert.doesNotMatch(commands[3], /^: >/);
  await boat.moveFiles('coder', { op: 'unpack' });
  assert.match(commands[4], /tar -xzf \/tmp\/botdot-move-coder\.tgz -C '\/home\/user' --no-same-owner/);

  commands.length = 0;
  await boat.moveFiles('coder', { op: 'pack', part: 'profile' });
  assert.match(commands[0], /P="\/home\/browser\/profiles\/\$b"/);
  assert.doesNotMatch(commands[0], /profiles\/coder/, 'the command never names the profile pkill looks for');
  assert.match(commands[0], /sudo -n pkill -u browser -f "\$P/, 'Camoufox closed first');
  assert.match(commands[0], /sudo -n tar --ignore-failed-read -czf \/tmp\/botdot-profile\.tgz -C "\$P" .*--exclude=\.\/cache2/);
  await boat.moveFiles('coder', { op: 'write', part: 'profile', offset: 0, data: 'YWJj' });
  assert.equal(files.get('/tmp/botdot-profile.part'), 'YWJj');
  await boat.moveFiles('coder', { op: 'unpack', part: 'profile' });
  assert.match(commands[2], /useradd --create-home --shell \/usr\/sbin\/nologin --groups user browser/, 'the browser user as the screen kit makes it');
  assert.match(commands[2], /chown -R browser:browser "\$P\.new" .*sudo -n rm -rf "\$P" && sudo -n mv "\$P\.new" "\$P"/);
  await boat.moveFiles('coder', { op: 'drop', part: 'profile' });
  assert.match(commands[3], /^sudo -n rm -f \/tmp\/botdot-profile\.tgz/);
  await assert.rejects(boat.moveFiles('coder', { op: 'pack', part: 'home' }), /No such step/);
});

test("the Docker helper takes a copy's steps on the bot's own folder only, a piece within 1 MB", () => {
  const seat = { bot: 'coder', screen: 1 };
  assert.ok(helper.validate('moveFiles', [seat, { op: 'pack' }]));
  assert.ok(helper.validate('moveFiles', [seat, { op: 'read', offset: 0, length: 3145728 }]));
  assert.ok(helper.validate('moveFiles', [seat, { op: 'write', offset: 5, data: 'YWJj' }]));
  assert.ok(helper.validate('moveFiles', [seat, { op: 'unpack', part: 'profile' }]));
  assert.equal(helper.validate('moveFiles', [seat, { op: 'pack', part: '/etc' }]), false);
  assert.equal(helper.validate('moveFiles', [seat, { op: 'rm' }]), false);
  assert.equal(helper.validate('moveFiles', [seat, { op: 'pack', path: '/etc' }]), false, 'no path of the caller');
  assert.equal(helper.validate('moveFiles', [seat, { op: 'write', offset: -1, data: '' }]), false);
  assert.equal(helper.validate('moveFiles', [seat, { op: 'write', offset: 0, data: 'x'.repeat(900_004) }]), false);
  assert.equal(helper.validate('moveFiles', [seat, { op: 'write', offset: 0, data: 'not base64!' }]), false);
});

test("while its files are copied, a bot's computer tools say so and reach no computer; the copy's own steps go to the account's computer", async () => {
  const screens = require('../lib/computer-screens');
  const got = [];
  const local = new Proxy({}, { get: (_, name) => async (...a) => { got.push(name); return name === 'moveFiles' ? { code: 0, seat: a[0] } : { code: 0 }; } });
  let copying = true;
  const f = screens.facade(local, screens.create(dir()), { kindOf: () => 'boat', moving: () => (copying ? moveLib.BUSY : null) });
  assert.equal((await f.runShell('coder', { command: 'ls' })).error, moveLib.BUSY);
  await assert.rejects(f.request('coder', '/cmd', {}), /being copied/);
  assert.deepEqual(got, []);
  const step = await f.moveFiles('coder', { op: 'pack' });
  assert.deepEqual(got, ['ensure', 'moveFiles'], "the account's computer is started first, whatever the bot's computer is now");
  assert.equal(step.seat.bot, 'coder');
  copying = false;
});

test('web and Android ask "Copy files" or "Start empty" between this machine and boat.dev, and show a copy that failed', () => {
  const { app, cut } = require('./web-page');
  const vm = require('node:vm');
  const ctx = vm.createContext({});
  vm.runInContext(`${cut('const COMPUTER_PLACE =', 'function askMoveFiles(')}${cut('const isComputerMove =', '// Its copy\'s line')}this.isComputerMove = isComputerMove;`, ctx);
  assert.ok(ctx.isComputerMove('linux', 'boat'));
  assert.ok(ctx.isComputerMove('boat', 'linux'));
  assert.equal(ctx.isComputerMove('none', 'boat'), false, 'a new computer asks nothing');
  assert.equal(ctx.isComputerMove('linux', 'none'), false);
  assert.match(app, /Copy files<\/button>/);
  assert.match(app, /Start empty<\/button>/);
  assert.match(app, /moveFiles: true/);
  assert.match(app, /computer\/move`, \{ method: 'POST' \}/);
  const kt = fs.readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/dev/botdot/app/ui/BotSettingsScreen.kt'), 'utf8');
  assert.match(kt, /"Copy files"/);
  assert.match(kt, /"Start empty"/);
  assert.match(kt, /put\("moveFiles", true\)/);
  assert.match(kt, /retryComputerMove/);
});

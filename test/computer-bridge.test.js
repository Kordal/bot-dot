// Files between a bot's two places (#545): its workspace on botdot and its folder on the account's computer, two
// disks. attach_file and message_bot take a path on the computer and bring the file out byte for byte; the files
// handed to the bot are copied to uploads/ of its folder there, once. No Docker needed: docker is a stand-in, and
// botdot's own script that reads a file there runs here in sh.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const bridge = require('../lib/computer-bridge');
const { startServer, makeBot, heldRun, self } = require('./helpers');

const SEAT = { bot: 'desk', screen: 1 };
const scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-bridge-')); after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// ---------- the docker calls (lib/computers.js) ----------

// computers.js takes execFile when it loads, so it loads once, with a stand-in that records each call.
let calls = [];
let reply = () => ({ stdout: '', stderr: '' });
function fakeExecFile(file, args, opts, cb) {
  const call = { file, args, opts, input: null };
  calls.push(call);
  setImmediate(() => { const r = reply(call); cb(r.error || null, r.stdout ?? '', r.stderr ?? ''); });
  return { stdin: { on() {}, end(data) { call.input = data; } } };
}
fakeExecFile[util.promisify.custom] = async (file, args, opts) => { calls.push({ file, args, opts }); return { stdout: '', stderr: '' }; };
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;
delete require.cache[require.resolve('../lib/computers')];

test('a file is brought out as box, by the script given, with room for 25 MB in base64', async () => {
  calls = [];
  reply = () => ({ stdout: 'ok 3 1760000000\nYWJj' });
  const r = await computers.bringOut(SEAT, { script: 'echo the script' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'ok 3 1760000000\nYWJj');
  const { args, opts } = calls[0];
  assert.deepEqual(args.slice(0, 3), ['exec', '-u', 'box']);
  assert.deepEqual(args.slice(-2), ['-c', 'echo the script']);
  assert.ok(opts.maxBuffer > Math.ceil((25 * 1024 * 1024) / 3) * 4, `${opts.maxBuffer}`);
});

test("uploads/ of the bot's folder there is listed, and a file is written whole under its saved name", async () => {
  calls = [];
  reply = () => ({ stdout: 'a.pdf\nb.png\n' });
  assert.equal((await computers.listUploads(SEAT)).stdout, 'a.pdf\nb.png\n');
  assert.deepEqual(calls[0].args.slice(-2), ['sh', '/workspace/desk']);
  const data = crypto.randomBytes(64);
  const r = await computers.putUpload(SEAT, { name: '20261025120000-ab12-cv.pdf', data });
  assert.equal(r.code, 0);
  const put = calls[1];
  assert.ok(put.args.includes('-i'), 'its bytes on stdin');
  assert.deepEqual(put.args.slice(-3), ['sh', '/workspace/desk', '20261025120000-ab12-cv.pdf']);
  assert.match(put.args.at(-4), /cat > "\.\$2\.part" && mv -f "\.\$2\.part" "\$2"/, 'written aside first, so a half file never has its name');
  assert.equal(put.input, data);
});

// ---------- which path is on the computer ----------

test('a path on the computer is in /workspace or /home/box; any other is in the workspace', () => {
  assert.equal(bridge.computerPath('/workspace/desk/out/report.pdf'), '/workspace/desk/out/report.pdf');
  assert.equal(bridge.computerPath(' /home/box/Downloads/invoice.pdf '), '/home/box/Downloads/invoice.pdf');
  assert.equal(bridge.computerPath('~/Downloads/a.pdf'), '/home/box/Downloads/a.pdf');
  assert.equal(bridge.computerPath('/workspace/desk/x/../y.pdf'), '/workspace/desk/y.pdf');
  for (const p of ['out/report.pdf', 'uploads/x.pdf', '/data/workspaces/desk/a.pdf', '/home/box/../../etc/passwd', '/workspaces/desk/a', '', null]) assert.equal(bridge.computerPath(p), null, String(p));
});

// ---------- bringing a file out (lib/computer-bridge.js), with botdot's own script run here ----------

// The bot's computer, as the facade answers by bot id: its script run in sh, here.
const here = () => ({ bringOut: async (botId, { script }) => { try { return { code: 0, stdout: childProcess.execFileSync('sh', ['-c', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }; } catch (e) { return { code: e.status, stdout: '', stderr: String(e.stderr) }; } } });

test('a file of its folder comes out byte for byte; a folder, a missing, empty or too big file, or one outside is refused', async () => {
  const dir = scratch();
  const own = path.join(dir, 'desk');
  const other = path.join(dir, 'other');
  fs.mkdirSync(path.join(own, 'out'), { recursive: true });
  fs.mkdirSync(other);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(300_000), Buffer.from([0, 255, 10, 13])]);
  fs.writeFileSync(path.join(own, 'out', 'report.pdf'), pdf);
  fs.writeFileSync(path.join(own, 'empty.txt'), '');
  fs.writeFileSync(path.join(other, 'theirs.txt'), 'not yours');
  fs.symlinkSync(path.join(other, 'theirs.txt'), path.join(own, 'link.txt'));
  const roots = [own];
  const got = await bridge.bringOut(here(), 'desk', path.join(own, 'out', 'report.pdf'), { roots });
  assert.equal(got.name, 'report.pdf');
  assert.ok(got.data.equals(pdf), 'every byte, a NUL and a CR too');

  const refused = (p) => bridge.bringOut(here(), 'desk', p, { roots }).then(() => assert.fail(`${p} came out`), (e) => e.message);
  assert.equal(await refused(path.join(own, 'out')), `${path.join(own, 'out')} is a folder, not a file.`);
  assert.equal(await refused(path.join(own, 'nothing.pdf')), `There's no file ${path.join(own, 'nothing.pdf')} on your computer.`);
  assert.equal(await refused(path.join(own, 'empty.txt')), `${path.join(own, 'empty.txt')} is empty.`);
  assert.match(await refused(path.join(other, 'theirs.txt')), /isn't in your folder on the computer, \/workspace\/desk, or in \/home\/box\.$/);
  assert.match(await refused(path.join(own, 'link.txt')), /isn't in your folder on the computer/, 'nor through a link');
  const big = path.join(own, 'big.bin');
  fs.writeFileSync(big, Buffer.alloc(25 * 1024 * 1024 + 1));
  assert.equal(await refused(big), `${big} is over 25 MB.`);
  const broken = { bringOut: async () => ({ code: null, stdout: '', stderr: '', error: "couldn't run it in the computer" }) };
  assert.equal(await bridge.bringOut(broken, 'desk', '/workspace/desk/a.pdf').catch((e) => e.message), "Couldn't read /workspace/desk/a.pdf on your computer: couldn't run it in the computer.");
});

// ---------- the files handed to the bot, on its computer too ----------

test('the files of uploads/ its computer lacks are copied there, whole; those it has are not sent again', async () => {
  const ws = scratch();
  fs.mkdirSync(path.join(ws, 'uploads'));
  const names = ['20261025120000-ab12-cv.pdf', '20261025110000-cd34-photo.png', '20261025100000-ef56-notes.md'];
  const bytes = names.map(() => crypto.randomBytes(1000));
  names.forEach((n, i) => fs.writeFileSync(path.join(ws, 'uploads', n), bytes[i]));
  const put = [];
  const pc = { listUploads: async () => ({ code: 0, stdout: `${names[1]}\n.x.part\n` }), putUpload: async (botId, f) => { put.push({ botId, ...f }); return { code: 0 }; } };
  const files = names.map((n) => ({ file: `uploads/${n}` }));
  assert.deepEqual(await bridge.copyUploads(pc, 'desk', ws, files, { fs }), [names[0], names[2]]);
  assert.deepEqual(put.map((p) => [p.botId, p.name]), [['desk', names[0]], ['desk', names[2]]]);
  assert.ok(put[0].data.equals(bytes[0]) && put[1].data.equals(bytes[2]));
  assert.deepEqual(await bridge.copyUploads({ listUploads: () => assert.fail('nothing to ask') }, 'desk', ws, [], { fs }), []);
  await assert.rejects(bridge.copyUploads({ ...pc, putUpload: async () => ({ code: 1, stderr: 'No space left on device' }) }, 'desk', ws, files, { fs }), /No space left on device/);
});

// ---------- the tools, as a bot calls them ----------

test("attach_file and message_bot say that they take a path on the computer, and read_file points there for a file that isn't text", () => {
  const selfMcp = fs.readFileSync(path.join(__dirname, '..', 'lib', 'self-mcp.js'), 'utf8');
  assert.match(selfMcp, /or its full path on your computer \(\/workspace\/… or \/home\/box\/…\)/);
  assert.match(selfMcp, /paths in your workspace or full paths on your computer \(\/workspace\/… or \/home\/box\/…\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'computer-mcp.js'), 'utf8'), /Read a text file from your computer\. For a PDF, an image or another file for the owner or a teammate, give its path to attach_file or message_bot instead\./);
});

test("a bot with no computer in its run is told its workspace has no such file; one whose computer can't start is told why", async () => {
  const srv = await startServer();
  after(() => srv.stop());
  const plain = await makeBot(srv, { name: 'Plain' });
  const desk = await makeBot(srv, { name: 'Desk', computer: 'linux' });
  let { token, rec } = await heldRun(srv, plain);
  const r = await self(srv, token, 'file', { path: '/workspace/plain/report.pdf' });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /no file \/workspace\/plain\/report\.pdf in your workspace|isn't in your workspace/);
  // A file brought out of the computer is botdot's own object: one a bot sends in its place reads nothing.
  const forged = await self(srv, token, 'message', { to: desk.id, message: 'x', priority: false, files: [{ abs: '/etc/hostname', name: 'host.txt' }] }).then((r) => r.data);
  assert.equal(forged.ok, false, JSON.stringify(forged));
  assert.match(forged.error, /in your workspace/);
  srv.release(rec);
  srv.unhold();

  ({ token, rec } = await heldRun(srv, desk));
  const ws = path.join(srv.data, 'workspaces', desk.id);
  fs.writeFileSync(path.join(ws, 'here.pdf'), '%PDF here');
  assert.equal((await self(srv, token, 'file', { path: 'here.pdf' })).data.ok, true, 'a file of its workspace as before');
  const off = await self(srv, token, 'file', { path: `/workspace/${desk.id}/out/report.pdf` });
  assert.equal(off.data.ok, false);
  assert.match(off.data.error, /Docker/, 'the stand-in server has no Docker: said in a sentence');
  const sent = await self(srv, token, 'message', { to: plain.id, message: 'x', priority: false, files: [`/workspace/${desk.id}/a.pdf`] });
  assert.equal(sent.data.ok, false);
  assert.match(sent.data.error, /Docker/, 'brought out before it is sent');
  srv.release(rec);
  srv.unhold();
});

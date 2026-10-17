// A tool from a link, the part that meets a stranger's file (lib/tools-link.js, ADR 007): the address, the
// download and the unpacking. Each refusal here has a file that is wrong in exactly that way, served by a
// file server of the test's own; no real network. What the Chief and the owner see of it is in tools-link.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const link = require('../lib/tools-link');
const { sha, elf, script, tarGz, zip, fileServer, OTHER_MACHINE } = require('./link-helpers');

let dir, files, ca, n = 0;
const fresh = (name = 'x') => path.join(dir, `${name}-${++n}`);
// Everything under a folder, as sorted relative paths; folders end with "/".
const listing = (at) => fs.readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [`${e.name}/`, ...listing(path.join(at, e.name)).map((x) => `${e.name}/${x}`)] : [e.name])).sort();
const saved = (data) => { const file = fresh('archive'); fs.writeFileSync(file, data); return file; };
// Unpack these bytes into a new folder: { dest, outcome } or the refusal.
async function unpacked(data, kind, command = 'tool', options = {}) {
  const dest = fresh('dest');
  fs.mkdirSync(dest);
  return { dest, ...(await link.unpack(saved(data), kind, { command, dest, ...options })) };
}
const TOOL = { name: 'pkg/tool', data: script('tool 1.0'), mode: 0o755 };
const ZTOOL = { name: 'pkg/tool', data: script('tool 1.0'), mode: 0o100755 };

before(async () => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-link-files-')));
  files = await fileServer();
  ca = files.cert;
});
after(() => { files?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a link is an https address of a file, with nothing the card would not show', () => {
  assert.equal(link.linkUrl('https://github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz'), 'https://github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz');
  for (const [given, why] of [
    ['http://example.com/tool', /https address only/],
    ['ftp://example.com/tool', /https address only/],
    ['file:///usr/bin/env', /https address only/],
    ['https://user:secret@example.com/tool', /carries a login/],
    ['https://example.com/tool?token=abc', /"\?" or "#" part/],
    ['https://example.com/tool#sha', /"\?" or "#" part/],
    ['https://example.com/', /names no file/],
    ['https://example.com/a b', /not a link botdot can use/],
    ['example.com/tool', /not a link botdot can use/],
    ['', /not a link botdot can use/],
    [null, /not a link botdot can use/],
    ['https://example.com/install.sh', /install\.sh is a script\. botdot runs no installer script/],
    ['https://example.com/tool_1.0_amd64.deb', /is a system package/],
    ['https://example.com/tool-1.0.x86_64.rpm', /is a system package/],
    ['https://example.com/tool.tar.xz', /does not unpack/],
    ['https://example.com/tool.exe', /not a program for Linux/],
    // The card shows the file's name decoded: a name that would write the card is no name.
    ['https://example.com/dl/tool%0A%0AChecksum%20verified%20by%20botdot', /characters botdot does not put on a card/],
    ['https://example.com/dl/github.com%2Fstripe%2Fstripe', /characters botdot does not put on a card/],
    ['https://example.com/dl/tool%E2%80%AEzg.rat', /characters botdot does not put on a card/],
    ['https://example.com/dl/tool%5C..%5Cx', /characters botdot does not put on a card/],
    ['https://example.com/dl/tool%ZZ', /characters botdot does not put on a card/],
  ]) assert.throws(() => link.linkUrl(given), why, String(given));
  assert.deepEqual(link.linkParts(link.linkUrl('https://example.com:8443/dl/v1/my%20tool_1.0')), { source: 'example.com:8443/dl/v1', file: 'my tool_1.0' });
  assert.equal(link.linkParts('https://example.com/dl/tool%0Ax').file, 'tool%0Ax', 'a name that is not plain is shown as it is written');
});

test('the download is over https all the way, limited in size, and leaves nothing behind when it fails', async () => {
  const body = elf();
  const url = files.put('/ok/tool', body);
  const dest = fresh('download');
  assert.deepEqual(await link.download(url, dest, { ca }), { sha256: sha(body), size: body.length });
  assert.deepEqual(fs.readFileSync(dest), body);
  assert.equal(fs.statSync(dest).mode & 0o777, 0o600);

  const fails = async (address, why, cause, options = {}) => {
    const to = fresh('download');
    await assert.rejects(link.download(address, to, { ca, ...options }), (e) => { assert.match(e.message, why); assert.equal(e.cause, cause, e.message); return true; });
    assert.ok(!fs.existsSync(to), 'no file is left');
  };
  // A redirect to another https address is followed; one away from https is not, and that address is never asked.
  assert.equal((await link.download(files.put('/moved/tool', '', { redirect: url }), fresh('download'), { ca })).sha256, sha(body));
  await fails(files.put('/away/tool', '', { redirect: `${files.plain}/tool` }), /redirects to an address that is not https/, 'other');
  assert.deepEqual(files.plainHits, [], 'nothing was asked over plain http');
  await fails(`${files.plain}/tool`, /https address only/, 'other');
  assert.deepEqual(files.plainHits, []);
  await fails(files.put('/nowhere/tool', '', { status: 302 }), /redirects nowhere/, 'network');
  assert.ok(!files.hits.some((url) => url.includes('undefined')), 'a redirect without an address is followed nowhere');
  files.put('/loop/tool', '', { redirect: `${files.origin}/loop/tool` });
  await fails(`${files.origin}/loop/tool`, /redirects too many times/, 'network');
  // An address that does not answer: no such file, no such server, a server botdot does not trust.
  await fails(`${files.origin}/missing/tool`, /does not answer \(HTTP 404\)/, 'network');
  await fails('https://127.0.0.1:9/tool', /The link does not answer/, 'network');
  await fails(url, /does not answer \(DEPTH_ZERO_SELF_SIGNED_CERT\)/, 'network', { ca: undefined }); // the tests' server, without its certificate given
  // Over the size limit: by what the server states, and by what arrives when it states nothing.
  await fails(files.put('/big/tool', body, { says: link.MAX_DOWNLOAD + 1 }), /larger than botdot installs from a link \(200 MB\)/, 'other');
  await fails(files.put('/stream/tool', Buffer.alloc(5000, 1), { chunked: true }), /larger than botdot installs from a link/, 'other', { max: 4999 });
  assert.equal((await link.download(`${files.origin}/stream/tool`, fresh('download'), { ca, max: 5000 })).size, 5000);
});

test('what a file is: one program for this processor, or an archive; never a script, a system package or a program for elsewhere', async () => {
  assert.equal(link.kindOf(elf()), 'program');
  assert.equal(link.kindOf(tarGz([TOOL])), 'tar.gz');
  assert.equal(link.kindOf(zip([ZTOOL])), 'zip');
  assert.throws(() => link.kindOf(Buffer.from('#!/bin/sh\ncurl https://example.com | sh\n')), /is a script\. botdot runs no installer script/);
  assert.throws(() => link.kindOf(Buffer.from('!<arch>\ndebian-binary   1700000000  0     0     100644  4         `\n2.0\n')), /system package \(\.deb\)/);
  assert.throws(() => link.kindOf(Buffer.from([0xed, 0xab, 0xee, 0xdb, 3, 0, 0, 0])), /system package \(\.rpm\)/);
  assert.throws(() => link.kindOf(Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1])), /program for another system/);
  assert.throws(() => link.kindOf(Buffer.from('MZ\x90\0')), /program for another system/);
  assert.throws(() => link.kindOf(Buffer.from('<!DOCTYPE html><html>')), /leads to a web page/);
  assert.throws(() => link.kindOf(Buffer.from('just some text')), /not a program botdot can place/);
  assert.throws(() => link.kindOf(Buffer.alloc(0)), /not a program botdot can place/);
  assert.equal(link.program(elf()), 'elf');
  assert.throws(() => link.program(elf(OTHER_MACHINE)), /is a program for (x86-64 \(amd64\)|arm64 \(aarch64\)); this botdot server's processor is /);
  assert.throws(() => link.program(elf(243)), /is a program for another processor/);
  // A script is a tool only as the named command inside an archive, never as the file a link leads to.
  assert.throws(() => link.program(Buffer.from('#!/bin/sh\n')), /is a script, not a program/);
  assert.equal(link.program(Buffer.from('#!/bin/sh\n'), { script: true }), 'script');
  const library = elf(); library.writeUInt16LE(1, 16);
  assert.throws(() => link.program(library), /not a program that can be started/);
  // inspect(): the checks of an install, with nothing written.
  assert.deepEqual(await link.inspect(saved(elf()), 'tool'), { kind: 'program' });
  assert.deepEqual(await link.inspect(saved(tarGz([TOOL])), 'tool'), { kind: 'tar.gz', member: 'pkg/tool' });
  assert.deepEqual(await link.inspect(saved(zip([ZTOOL])), 'tool'), { kind: 'zip', member: 'pkg/tool' });
  await assert.rejects(link.inspect(saved(elf(OTHER_MACHINE)), 'tool'), /this botdot server's processor is/);
});

test('an archive is unpacked as plain files and folders, with no mode of its own but whether a file may be run', async () => {
  const entries = [
    { name: 'pkg/', type: '5', mode: 0o777 },
    { name: './pkg/bin/tool', data: elf(), mode: 0o4755 }, // setuid in the archive
    { name: 'pkg/lib/helper', data: script('helper 1.0'), mode: 0o775 },
    { name: 'pkg/README.md', data: 'Read me.', mode: 0o666 },
    { name: 'pkg/empty', data: '' },
  ];
  const t = await unpacked(tarGz(entries), 'tar.gz');
  assert.equal(t.member, 'pkg/bin/tool');
  assert.deepEqual(listing(t.dest), ['pkg/', 'pkg/README.md', 'pkg/bin/', 'pkg/bin/tool', 'pkg/empty', 'pkg/lib/', 'pkg/lib/helper']);
  const mode = (rel) => fs.statSync(path.join(t.dest, rel)).mode & 0o7777;
  assert.deepEqual([mode('pkg'), mode('pkg/bin/tool'), mode('pkg/lib/helper'), mode('pkg/README.md')], [0o755, 0o755, 0o755, 0o644]);
  assert.deepEqual(fs.readFileSync(path.join(t.dest, 'pkg/bin/tool')), elf());

  const z = await unpacked(zip([
    { name: 'pkg/' },
    { name: 'pkg/bin/tool', data: elf(), mode: 0o104755 },
    { name: 'pkg/README.md', data: 'Read me.', store: true },
    { name: 'pkg/empty', data: '', store: true },
  ]), 'zip');
  assert.equal(z.member, 'pkg/bin/tool');
  assert.deepEqual(listing(z.dest), ['pkg/', 'pkg/README.md', 'pkg/bin/', 'pkg/bin/tool', 'pkg/empty']);
  assert.equal(fs.statSync(path.join(z.dest, 'pkg/bin/tool')).mode & 0o7777, 0o755);
  assert.equal(fs.readFileSync(path.join(z.dest, 'pkg/README.md'), 'utf8'), 'Read me.');

  // The named command: a regular file of that name that is a program here; the least deep one, in a bin first.
  const many = await unpacked(tarGz([{ name: 'pkg/share/completions/tool', data: 'complete -c tool' }, { name: 'pkg/extra/tool', data: script('x'), mode: 0o755 }, { name: 'pkg/bin/tool', data: script('y'), mode: 0o755 }, { name: 'pkg/tool/', type: '5' }]), 'tar.gz');
  assert.equal(many.member, 'pkg/bin/tool');
  await assert.rejects(unpacked(tarGz([{ name: 'pkg/other', data: elf(), mode: 0o755 }, { name: 'pkg/tool/', type: '5' }]), 'tar.gz'), /holds no file named tool\. It has: other\. Name the command as the archive has it\./);
  await assert.rejects(unpacked(zip([{ name: 'pkg/README.md', data: 'x' }]), 'zip'), /holds no file named tool\./);
  await assert.rejects(unpacked(tarGz([{ name: 'tool', data: elf(OTHER_MACHINE), mode: 0o755 }]), 'tar.gz'), /tool in the archive is a program for .*this botdot server's processor is/);
  await assert.rejects(unpacked(tarGz([{ name: 'tool', data: 'not a program at all', mode: 0o755 }]), 'tar.gz'), /tool in the archive is not a program for Linux/);
});

test('an archive made by the tar of this machine, with a long path, unpacks as it was packed', async () => {
  const from = fresh('real');
  const deep = path.join('pkg', 'a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60));
  fs.mkdirSync(path.join(from, deep), { recursive: true });
  fs.writeFileSync(path.join(from, deep, 'tool'), script('tool 1.0'), { mode: 0o755 });
  fs.writeFileSync(path.join(from, 'pkg', 'notes.txt'), 'x'.repeat(3000));
  const archive = fresh('real.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', from, 'pkg'], { env: { PATH: process.env.PATH, COPYFILE_DISABLE: '1' } });
  const dest = fresh('dest');
  fs.mkdirSync(dest);
  assert.equal((await link.unpack(archive, 'tar.gz', { command: 'tool', dest })).member, `${deep}/tool`);
  assert.equal(fs.readFileSync(path.join(dest, deep, 'tool'), 'utf8'), script('tool 1.0'));
  assert.equal(fs.readFileSync(path.join(dest, 'pkg', 'notes.txt'), 'utf8').length, 3000);
});

test("nothing of an archive leaves the tool's folder: a link, an absolute path, \"..\" and a special file refuse the whole file", async () => {
  const outside = fresh('outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'kept.txt'), 'untouched');
  // Refused, and nothing was made or changed outside the folder it was unpacked into.
  const around = () => JSON.stringify([listing(dir).filter((x) => !/^(dest|archive)-\d+/.test(x)), fs.readFileSync(path.join(outside, 'kept.txt'), 'utf8')]);
  const refuses = async (data, kind, why, what) => {
    const dest = fresh('dest');
    fs.mkdirSync(dest);
    const was = around();
    await assert.rejects(link.unpack(saved(data), kind, { command: 'tool', dest }), why, what);
    assert.equal(around(), was, `${what}: nothing outside its folder was made or changed`);
    // The same file is refused when it is only looked at, for the ask.
    await assert.rejects(link.unpack(saved(data), kind, { command: 'tool' }), why, `${what}, looked at`);
  };

  // A symbolic link, also one that a later entry would be written through.
  await refuses(tarGz([TOOL, { name: 'pkg/latest', type: '2', linkname: 'tool' }]), 'tar.gz', /holds a link/, 'a symbolic link');
  await refuses(tarGz([{ name: 'pkg/out', type: '2', linkname: outside }, { name: 'pkg/out/kept.txt', data: 'changed' }, TOOL]), 'tar.gz', /holds a link/, 'a file written through a link');
  await refuses(tarGz([TOOL, { name: 'pkg/same', type: '1', linkname: 'pkg/tool' }]), 'tar.gz', /holds a link/, 'a hard link');
  await refuses(zip([ZTOOL, { name: 'pkg/out', data: outside, mode: 0o120777, store: true }, { name: 'pkg/out/kept.txt', data: 'changed' }]), 'zip', /holds a link/, 'a symbolic link in a zip');
  // An absolute path.
  await refuses(tarGz([TOOL, { name: path.join(outside, 'kept.txt'), data: 'changed' }]), 'tar.gz', /holds an absolute path/, 'an absolute path');
  await refuses(zip([ZTOOL, { name: path.join(outside, 'new.txt'), data: 'new' }]), 'zip', /holds an absolute path/, 'an absolute path in a zip');
  // "..", at the start, in the middle, and as a folder.
  const up = `../${path.basename(outside)}/kept.txt`;
  await refuses(tarGz([TOOL, { name: up, data: 'changed' }]), 'tar.gz', /"\.\.", which leaves the tool's own folder/, '.. at the start');
  await refuses(tarGz([TOOL, { name: `pkg/../${up}`, data: 'changed' }]), 'tar.gz', /"\.\."/, '.. in the middle');
  await refuses(tarGz([TOOL, { name: '../escaped/', type: '5' }]), 'tar.gz', /"\.\."/, '.. as a folder');
  await refuses(zip([ZTOOL, { name: up, data: 'changed' }]), 'zip', /"\.\."/, '.. in a zip');
  await refuses(zip([ZTOOL, { name: `pkg\\..\\..\\${path.basename(outside)}\\kept.txt`, data: 'changed' }]), 'zip', /a path botdot cannot place/, 'a path with backslashes');
  // A long name, or an extended header, is a name like any other.
  await refuses(tarGz([{ name: '././@LongLink', type: 'L', data: `${up}\0` }, { name: 'short', data: 'changed' }, TOOL]), 'tar.gz', /"\.\."/, '.. in a long name');
  const record = `path=${up}\n`;
  await refuses(tarGz([{ name: 'PaxHeader/short', type: 'x', data: `${record.length + 3} ${record}` }, { name: 'short', data: 'changed' }, TOOL]), 'tar.gz', /"\.\."/, '.. in an extended header');
  // Special files: a character device, a block device, a pipe.
  for (const type of ['3', '4', '6']) await refuses(tarGz([TOOL, { name: 'pkg/special', type }]), 'tar.gz', /holds a special file/, `a special file of type ${type}`);
  await refuses(zip([ZTOOL, { name: 'pkg/pipe', data: '', mode: 0o010644, store: true }]), 'zip', /holds a special file/, 'a pipe in a zip');
  await refuses(zip([ZTOOL, { name: 'pkg/device', data: '', mode: 0o020644, store: true }]), 'zip', /holds a special file/, 'a device in a zip');
  // One path twice, and a file where a folder is: what is written is never written over.
  await refuses(tarGz([TOOL, { ...TOOL, data: script('another') }]), 'tar.gz', /holds one path twice/, 'one file twice');
  await refuses(tarGz([TOOL, { name: 'pkg/tool/inside', data: 'x' }]), 'tar.gz', /holds one path twice/, 'a file under a file');
  await refuses(zip([ZTOOL, { name: 'pkg', data: 'x' }]), 'zip', /holds one path twice/, 'a file where a folder is');
  // Kinds of entries and of archives botdot does not unpack.
  await refuses(tarGz([TOOL, { name: 'pkg/sparse', type: 'S' }]), 'tar.gz', /an entry botdot does not unpack/, 'a sparse file');
  await refuses(zip([{ ...ZTOOL, flags: 1 }]), 'zip', /is encrypted/, 'an encrypted zip');
  await refuses(zlib.gzipSync(elf()), 'tar.gz', /not a \.tar\.gz archive botdot can read/, 'a gzip that is no tar');
  await refuses(Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0]), Buffer.alloc(40, 7)]), 'tar.gz', /not a \.tar\.gz archive botdot can read/, 'a broken gzip');
  await refuses(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100, 7)]), 'zip', /not a \.zip archive botdot can read/, 'a broken zip');

  assert.equal(fs.readFileSync(path.join(outside, 'kept.txt'), 'utf8'), 'untouched');
  assert.deepEqual(listing(outside), ['kept.txt']);
});

test('an archive that unpacks to more than the limit, or holds too many files, is refused before it fills the disk', async () => {
  const zeros = Buffer.alloc(4 * 1024 * 1024);
  // 4 MB that are 4 kB compressed: refused when the limit is passed, not after everything was written.
  const bomb = tarGz([TOOL, { name: 'pkg/a', data: zeros }, { name: 'pkg/b', data: zeros }, { name: 'pkg/c', data: zeros }]);
  assert.ok(bomb.length < 64 * 1024);
  const dest = fresh('dest');
  fs.mkdirSync(dest);
  await assert.rejects(link.unpack(saved(bomb), 'tar.gz', { command: 'tool', dest, max: 6 * 1024 * 1024 }), /unpacks to more than botdot installs for one tool \(6 MB\)/);
  assert.ok(!fs.existsSync(path.join(dest, 'pkg', 'c')), 'it stopped on the way');
  await assert.rejects(link.unpack(saved(bomb), 'tar.gz', { command: 'tool', max: 6 * 1024 * 1024 }), /unpacks to more than/, 'the same when it is only looked at');
  assert.equal((await unpacked(bomb, 'tar.gz', 'tool', { max: 13 * 1024 * 1024 })).member, 'pkg/tool');
  // A zip states its files' sizes; what is unpacked is what counts.
  const lying = zip([ZTOOL, { name: 'pkg/a', data: zeros, says: 10 }, { name: 'pkg/b', data: zeros, says: 10 }]);
  await assert.rejects(unpacked(lying, 'zip', 'tool', { max: 6 * 1024 * 1024 }), /unpacks to more than botdot installs for one tool/);
  await assert.rejects(link.unpack(saved(lying), 'zip', { command: 'tool', max: 6 * 1024 * 1024 }), /unpacks to more than/);
  // The limits the product has: 1 GB unpacked, 20000 files.
  assert.equal(link.MAX_UNPACKED, 1024 * 1024 * 1024);
  const many = zip([ZTOOL, ...Array.from({ length: link.MAX_ENTRIES }, (_, i) => ({ name: `d/${i}/` }))]);
  await assert.rejects(link.unpack(saved(many), 'zip', { command: 'tool' }), /holds more than 20000 files/);
  const manyTar = tarGz([TOOL, ...Array.from({ length: link.MAX_ENTRIES }, (_, i) => ({ name: `d/${i}/`, type: '5' }))]);
  await assert.rejects(link.unpack(saved(manyTar), 'tar.gz', { command: 'tool' }), /holds more than 20000 files/);
  // The folders on the way to a file count as well: 600 files, each 39 folders deep, are 24000 things to make.
  const deep = Array.from({ length: 600 }, (_, i) => ({ name: `${i}/${'a/'.repeat(38)}f`, data: 'x' }));
  await assert.rejects(link.unpack(saved(tarGz([TOOL, ...deep])), 'tar.gz', { command: 'tool' }), /holds more than 20000 files and folders/);
  await assert.rejects(link.unpack(saved(zip([ZTOOL, ...deep])), 'zip', { command: 'tool' }), /holds more than 20000 files and folders/);
  assert.equal((await link.unpack(saved(tarGz([TOOL, ...deep.slice(0, 400)])), 'tar.gz', { command: 'tool' })).member, 'pkg/tool');
});

test('place() puts one command into the tool\'s folder, the program itself or a link to it among the archive\'s files', async () => {
  const single = fresh('prefix');
  fs.mkdirSync(single);
  assert.deepEqual(await link.place(saved(elf()), { prefix: single, command: 'tool' }), { kind: 'program' });
  assert.deepEqual(listing(single), ['bin/', 'bin/tool']);
  assert.equal(fs.statSync(path.join(single, 'bin', 'tool')).mode & 0o7777, 0o755);
  const packed = fresh('prefix');
  fs.mkdirSync(packed);
  assert.deepEqual(await link.place(saved(zip([{ name: 'pkg/tool', data: script('tool 1.0') }, { name: 'pkg/lib/x', data: 'x' }])), { prefix: packed, command: 'tool' }), { kind: 'zip', member: 'pkg/tool' });
  assert.deepEqual(listing(packed), ['bin/', 'bin/tool', 'files/', 'files/pkg/', 'files/pkg/lib/', 'files/pkg/lib/x', 'files/pkg/tool']);
  assert.equal(fs.readlinkSync(path.join(packed, 'bin', 'tool')), path.join('..', 'files', 'pkg', 'tool'));
  assert.equal(execFileSync(path.join(packed, 'bin', 'tool'), { encoding: 'utf8' }).trim(), 'tool 1.0 (botdot test tool)', 'the named command may be run, whatever the archive said of its mode');
  const other = fresh('prefix');
  fs.mkdirSync(other);
  await assert.rejects(link.place(saved(Buffer.from('#!/bin/sh\necho installing\n')), { prefix: other, command: 'tool' }), /is a script/);
  assert.deepEqual(listing(other), []);
});

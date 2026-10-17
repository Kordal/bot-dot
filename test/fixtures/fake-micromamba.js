#!/usr/bin/env node
// A stand-in for micromamba, for the tests: no network and nothing real installed. Its registry is
// tools-registry.json. It answers the two calls botdot makes (lib/tools-worker.js):
//   create --dry-run --json … <name>[==<version>]   the packages a tool needs, as micromamba prints them
//   create … -p <prefix> --file <list>              "installs" a pinned list: writes each package's files,
//                                                   its commands as scripts that print "<name> <version> (botdot test tool)"
// Each call is appended to <cache>/calls.jsonl with its arguments, its environment and the list it was given.
// <cache>/fake.json steers it: { "fail": "network" | "disk" } fails that way (an install leaves a half-made
// folder first, as a real one would), { "versions": { "gh": "2.102.0" } } is what the registry has as newest.
// { "wait": 400 } makes an install take that many milliseconds.
// { "refuse": "copy" } is a data folder that refuses micromamba's copy, as a Mac's disk shared into Docker does:
// an install with --always-copy fails the way the real one did there. Without that flag an install hard-links
// each file from $MAMBA_ROOT_PREFIX/pkgs, as the real one does. { "refuse": "copy", "fail": "links" } fails that too.
// { "mention": "copy" } installs as always and prints those words of a refused copy on the way.
// A package marked "tampered" downloads as another file than the registry lists: its sha256 doesn't match.
// A package's "links" are symbolic links it ships: { "<path in the tool's folder>": "<target>" }.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REGISTRY = JSON.parse(fs.readFileSync(path.join(__dirname, 'tools-registry.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.9.0'); process.exit(0); }
const cache = path.dirname(process.env.HOME); // not MAMBA_ROOT_PREFIX: the second way of installing has that on the data folder
let steer = {};
try { steer = JSON.parse(fs.readFileSync(path.join(cache, 'fake.json'), 'utf8')); } catch { /* nothing asked of it */ }
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const platform = process.arch === 'arm64' ? 'linux-aarch64' : 'linux-64';
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const call = { args, env: process.env, uid: process.getuid?.() };
const record = () => fs.appendFileSync(path.join(cache, 'calls.jsonl'), JSON.stringify(call) + '\n');
const partsOf = (file) => { const p = file.split('-'); return { name: p.slice(0, -2).join('-'), version: p.at(-2), build: p.at(-1) }; };
const info = (file) => {
  const p = REGISTRY.packages[file];
  const subdir = p.subdir === 'arch' ? platform : p.subdir;
  return { ...partsOf(file), build_string: partsOf(file).build, channel: 'conda-forge', subdir, fn: `${file}.${p.ext || 'conda'}`, url: `https://conda.anaconda.org/conda-forge/${subdir}/${file}.${p.ext || 'conda'}`, size: p.size, sha256: sha(file), md5: sha(file).slice(0, 32), depends: [] };
};
const failed = (line) => { record(); process.stderr.write(`${line}\n`); process.exit(1); };

if (args[0] !== 'create') failed(`fake micromamba: unexpected ${args.join(' ')}`);

if (args.includes('--dry-run')) {
  if (steer.fail === 'network') failed('critical libmamba Download error (7) Could not connect to server [https://conda.anaconda.org/conda-forge/noarch/repodata_shards.msgpack.zst]');
  const [name, version] = args.at(-1).split('==');
  const tool = REGISTRY.tools[name];
  const files = tool?.packages[version || steer.versions?.[name] || tool.latest];
  record();
  if (!files) { console.log(JSON.stringify({ success: false, solver_problems: [`nothing provides requested ${args.at(-1)}`] })); process.exit(1); }
  const link = files.map(info);
  console.log(JSON.stringify({ success: true, dry_run: true, prefix: val('-p'), actions: { PREFIX: val('-p'), FETCH: link, LINK: link } }));
  process.exit(0);
}

const prefix = val('-p');
const lines = fs.readFileSync(val('--file'), 'utf8').split('\n').filter(Boolean);
call.list = lines;
const half = () => { fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true }); fs.writeFileSync(path.join(prefix, 'bin', 'half'), 'not finished'); };
if (lines[0] !== '@EXPLICIT') failed('fake micromamba: the list is not an explicit one');
if (steer.fail === 'network') { half(); failed('critical libmamba Download error (7) Could not connect to server [https://conda.anaconda.org/conda-forge/]'); }
if (steer.fail === 'disk') { half(); failed('critical libmamba filesystem error: cannot copy file: No space left on device'); }
const copies = args.includes('--always-copy');
// What the real one printed on a Mac-hosted test server on 2026-10-03.
if (steer.refuse === 'copy' && copies) { half(); failed(`critical libmamba filesystem error: cannot copy: Permission denied [${process.env.MAMBA_ROOT_PREFIX}/pkgs/libgomp-15.2.0-h8acb6b2_7/lib/libgomp.so.1.0.0] [${prefix}/lib/libgomp.so.1.0.0]`); }
if (steer.fail === 'links' && !copies) { half(); failed('critical libmamba filesystem error: cannot create hard link: Operation not supported'); }
const wanted = lines.slice(1).map((line) => { const [url, hash] = line.split('#sha256:'); return { file: path.basename(url).replace(/\.(conda|tar\.bz2)$/, ''), hash }; });
for (const { file, hash } of wanted) {
  const p = REGISTRY.packages[file];
  if (!p) failed(`critical libmamba Download error (22) HTTP 404 [${file}]`);
  if (hash !== sha(p.tampered ? `${file} tampered` : file)) {
    // What the real one prints (the installer trial of 2026-10-03), and it installs nothing.
    failed(`error    libmamba File not valid: SHA256 doesn't match expectation "${file}.conda"\n${file}.conda tarball has incorrect SHA256\ncritical libmamba Found incorrect downloads. Aborting`);
  }
}
if (steer.mention === 'copy') process.stderr.write('warning  libmamba filesystem error: cannot copy: Permission denied [a] [b], retried\n');
if (steer.wait) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, steer.wait);
for (const { file } of wanted) {
  const p = REGISTRY.packages[file];
  const { name, version, build } = partsOf(file);
  for (const [at, target] of Object.entries(p.links || {})) fs.symlinkSync(target, path.join(fs.mkdirSync(prefix, { recursive: true }) && prefix, at));
  for (const f of p.files) {
    const target = path.join(prefix, f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Package files arrive group-writable, as two thirds of the real ones do.
    // With --always-copy the file is written at its place; without, into the cache and hard-linked from there.
    const made = copies ? target : path.join(process.env.MAMBA_ROOT_PREFIX, 'pkgs', file, f);
    fs.mkdirSync(path.dirname(made), { recursive: true });
    if (f.startsWith('bin/')) { fs.writeFileSync(made, `#!/bin/sh\necho "${path.basename(f)} of ${name} ${version} (botdot test tool)"\n`); fs.chmodSync(made, 0o775); } else { fs.writeFileSync(made, name); fs.chmodSync(made, 0o664); }
    if (!copies) fs.linkSync(made, target);
  }
  fs.mkdirSync(path.join(prefix, 'conda-meta'), { recursive: true });
  fs.writeFileSync(path.join(prefix, 'conda-meta', `${file}.json`), JSON.stringify({ name, version, build, files: p.files, sha256: sha(file) }));
}
record();

// How much a folder holds, for Storage (docs/api.md, Storage): one walk of the folder, never following a link and
// never leaving its disk, that answers its size, the folders and files in it worth showing, and its largest files.
// It needs only fs and path: the privilege broker's file worker runs it in a bot's workspace or home as that bot
// (principal-fs-worker.js, sizeTreeSync), and lib/storage.js in a thread of its own elsewhere, so that the server
// never waits on a walk. deploy/desktop/botdot-sizes is the same walk on the account's computer, in Python.
//
// A size is what the file takes on the disk (its blocks), as `du` counts it, and falls back to its length.
// The answer: { bytes, files, kids, rest, largest, capped }. `kids` are the entries of at least KEEP bytes, the
// largest MAX_KIDS of each folder, MAX_DEPTH folders deep: { name, bytes, dir, kids?, rest? }. `rest` is what the
// entries left out hold. `largest` the TOP largest files, { path, bytes }, `path` from `dir` with names joined by /.
// Past `cap` entries the walk stops and says `capped`: what it counted until then is the answer.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = 1024 * 1024;
const MAX_KIDS = 40;
const MAX_DEPTH = 12;
const TOP = 25;
const CAP = 3_000_000;

const sizeOf = (st) => (typeof st.blocks === 'number' && st.blocks >= 0 ? st.blocks * 512 : st.size || 0);

// `skip`: names at the top of `dir` left out, walked on their own elsewhere.
function sizeTree(dir, { keep = KEEP, maxKids = MAX_KIDS, maxDepth = MAX_DEPTH, top = TOP, cap = CAP, skip = [] } = {}) {
  const skipped = new Set(Array.isArray(skip) ? skip.map(String) : []);
  let seen = 0;
  let capped = false;
  let largest = [];
  let floor = 0; // the smallest size in `largest` once it is full
  const note = (rel, bytes) => {
    if (largest.length >= top && bytes <= floor) return;
    largest.push({ path: rel, bytes });
    if (largest.length > top * 4) { largest.sort((a, b) => b.bytes - a.bytes); largest = largest.slice(0, top); floor = largest[top - 1].bytes; }
  };
  let root;
  try { root = fs.lstatSync(dir); } catch { return { bytes: 0, files: 0, kids: [], rest: 0, largest: [], capped: false, missing: true }; }
  const device = root.dev;
  // One folder: its own size and its files', and its folders' walked in turn.
  function walk(abs, rel, depth) {
    const node = { bytes: 0, files: 0, kids: [], rest: 0 };
    let list;
    try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch { return node; }
    for (const d of list) {
      if (capped) break;
      if (depth === 0 && skipped.has(d.name)) continue;
      if (++seen > cap) { capped = true; break; }
      const a = path.join(abs, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      let st;
      try { st = fs.lstatSync(a); } catch { continue; }
      if (st.isDirectory()) {
        if (st.dev !== device) continue; // another disk mounted in it
        const sub = walk(a, r, depth + 1);
        sub.bytes += sizeOf(st);
        node.bytes += sub.bytes;
        node.files += sub.files;
        node.kids.push({ name: d.name, dir: true, ...sub });
      } else {
        const bytes = sizeOf(st);
        node.bytes += bytes;
        node.files += 1;
        if (st.isFile()) note(r, bytes);
        node.kids.push({ name: d.name, dir: false, bytes });
      }
    }
    return prune(node, depth);
  }
  function prune(node, depth) {
    node.kids.sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1));
    const kept = depth < maxDepth ? node.kids.filter((k) => k.bytes >= keep).slice(0, maxKids) : [];
    const keptBytes = kept.reduce((n, k) => n + k.bytes, 0);
    node.rest = node.bytes - keptBytes;
    node.kids = kept.map((k) => {
      if (!k.dir) return { name: k.name, bytes: k.bytes, dir: false };
      const out = { name: k.name, bytes: k.bytes, dir: true, files: k.files };
      if (k.kids.length) out.kids = k.kids;
      if (k.rest) out.rest = k.rest;
      return out;
    });
    return node;
  }
  const tree = walk(dir, '', 0);
  largest.sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  return { bytes: tree.bytes, files: tree.files, kids: tree.kids, rest: tree.rest, largest: largest.slice(0, top), capped };
}

module.exports = { sizeTree, KEEP, MAX_KIDS, MAX_DEPTH, TOP, CAP };

// Run as a thread of lib/storage.js: walks workerData.dir and posts the answer.
const threads = require('node:worker_threads');
if (!threads.isMainThread && threads.workerData?.storageWalk) {
  const { dir, options } = threads.workerData.storageWalk;
  try { threads.parentPort.postMessage({ value: sizeTree(dir, options) }); } catch (e) { threads.parentPort.postMessage({ error: e.message }); }
}

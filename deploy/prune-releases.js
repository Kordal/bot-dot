#!/usr/bin/env node
// Which releases of one kind to delete, so that only the newest few stay. Reads `gh release list --json
// tagName,createdAt,isPrerelease,isDraft` from stdin, prints the tags to delete, one per line; it deletes nothing
// itself. Used by images.yml, which keeps the newest ten image-evidence-* releases (each image build makes one).
//
//   gh release list --limit 1000 --json ... | node deploy/prune-releases.js <tag prefix> <keep> <tag never deleted>
//
// A release is a candidate only when its tag is the prefix followed by digits and dashes, and it is a published
// pre-release: nothing else is ever listed, so the android-v*, desktop-v* and desktop-latest releases cannot be.
const KEEP_MAX = 1000;

function toDelete(releases, prefix, keep, current) {
  if (!/^[a-z][a-z-]*-$/.test(prefix || '')) throw new Error('The tag prefix is a lowercase word ending in a dash');
  if (!Number.isInteger(keep) || keep < 1 || keep > KEEP_MAX) throw new Error('keep is a whole number from 1 to ' + KEEP_MAX);
  if (!Array.isArray(releases)) throw new Error('Expected a list of releases');
  const own = new RegExp('^' + prefix + '[0-9]+(-[0-9]+)*$');
  const mine = releases
    .filter((r) => r && typeof r.tagName === 'string' && own.test(r.tagName) && r.isPrerelease === true && r.isDraft !== true
      && Number.isFinite(Date.parse(r.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.tagName < b.tagName ? 1 : -1));
  // The one just made counts among the kept even if the clock puts it lower (a re-run of an old run).
  const kept = new Set([current, ...mine.map((r) => r.tagName).filter((t) => t !== current).slice(0, keep - 1)]);
  return mine.map((r) => r.tagName).filter((t) => !kept.has(t));
}

module.exports = { toDelete };

if (require.main === module) {
  const [prefix, keep, current] = process.argv.slice(2);
  if (process.argv.length !== 5 || !current) throw new Error('Usage: prune-releases.js <tag prefix> <keep> <tag never deleted>');
  const input = require('node:fs').readFileSync(0, 'utf8');
  const out = toDelete(JSON.parse(input), prefix, Number(keep), current);
  if (out.length) process.stdout.write(out.join('\n') + '\n');
}

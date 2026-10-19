#!/usr/bin/env node
// The version of Claude Code (the bots' engine) the Dockerfile pins, and its bump to a newer release
// (claude-code-bump.yml, #85). Only a stable release, x.y.z, is taken: never a next or beta one.
//   node deploy/claude-code-pin.js <Dockerfile>            prints the pinned version
//   node deploy/claude-code-pin.js <Dockerfile> <version>  rewrites the file when <version> is newer, and prints
//                                                           from=, to= and bump=true|false for GITHUB_OUTPUT
const fs = require('node:fs');

const INSTALL = /@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)\b/;
const STABLE = /^\d+\.\d+\.\d+$/;

function pinnedVersion(text) {
  const m = text.match(INSTALL);
  if (!m) throw new Error('The Dockerfile has no pinned @anthropic-ai/claude-code@x.y.z');
  return m[1];
}

// The Dockerfile with `version` on the install line and on the comment above it; nothing else changes.
function withVersion(text, version) {
  if (!STABLE.test(version)) throw new Error(`Not a stable release (x.y.z): ${JSON.stringify(version)}`);
  const old = pinnedVersion(text);
  return text
    .replace(`@anthropic-ai/claude-code@${old}`, `@anthropic-ai/claude-code@${version}`)
    .replace(`# Claude Code ${old} (`, `# Claude Code ${version} (`);
}

function isNewer(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

if (require.main === module) {
  const [file, version] = process.argv.slice(2);
  const text = fs.readFileSync(file, 'utf8');
  const from = pinnedVersion(text);
  if (version === undefined) {
    process.stdout.write(`${from}\n`);
  } else {
    const next = withVersion(text, version);
    const bump = isNewer(version, from);
    if (bump) fs.writeFileSync(file, next);
    process.stdout.write(`from=${from}\nto=${version}\nbump=${bump}\n`);
  }
}

module.exports = { pinnedVersion, withVersion, isNewer };

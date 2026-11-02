// The updater's manifest (#883): the latest.json the desktop app reads from the release `desktop-latest`
// (tauri.conf.json, plugins.updater). It names, for each system the app is built for, the file the updater installs
// and that file's signature by the update key; the files stay in the versioned release `desktop-v<version>`.
//
// Run by desktop-release.yml in the folder of the signed builds:
//   node desktop/manifest.js <version> <repository> > latest.json
'use strict';

const fs = require('fs');
const path = require('path');

// The build each of Tauri's platform names installs, by the name desktop.yml gives it.
const PLATFORMS = {
  'darwin-aarch64': 'mac-apple-silicon.app.tar.gz',
  'darwin-x86_64': 'mac-intel.app.tar.gz',
  'windows-x86_64': 'windows-x64-setup.exe',
  'windows-aarch64': 'windows-arm64-setup.exe',
};

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function manifest({ version, repository, dir, date = new Date() }) {
  if (!SEMVER.test(version)) throw new Error(`Not a version: ${version}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`Not a repository: ${repository}`);
  const platforms = {};
  for (const [platform, suffix] of Object.entries(PLATFORMS)) {
    const file = `botdot-${version}-${suffix}`;
    if (!fs.existsSync(path.join(dir, file))) throw new Error(`Missing ${file}`);
    const sig = path.join(dir, `${file}.sig`);
    if (!fs.existsSync(sig)) throw new Error(`Missing the signature of ${file}`);
    platforms[platform] = {
      signature: fs.readFileSync(sig, 'utf8').trim(),
      url: `https://github.com/${repository}/releases/download/desktop-v${version}/${file}`,
    };
  }
  return { version, pub_date: date.toISOString(), platforms };
}

module.exports = { manifest, PLATFORMS };

if (require.main === module) {
  const [version, repository] = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(manifest({ version, repository, dir: process.cwd() }), null, 2)}\n`);
}

#!/usr/bin/env node
// CI's release environment holds BOTDOT_RELEASE_PRIVATE_KEY (PEM). It must never enter an image.
// Usage: node deploy/sign-release.js app.json mac <revision>
const fs = require('node:fs');
const crypto = require('node:crypto');
const { canonical, verify } = require('../lib/release-manifest');
const [file, app, revision] = process.argv.slice(2);
const info = JSON.parse(fs.readFileSync(file, 'utf8'));
const key = process.env.BOTDOT_RELEASE_PRIVATE_KEY;
if (!key) throw new Error('The release environment has no signing key');
function sign(artifact, kind) {
  const release = { app: kind, version: info.versionCode, revision, file: artifact.file, sha256: artifact.sha256 };
  release.signature = crypto.sign('sha256', canonical(release), key).toString('base64');
  verify(release, { app: kind, installed: 0 }); // refuses a signing key that the clients do not trust
  artifact.release = release;
}
sign(info, app);
fs.writeFileSync(file, JSON.stringify(info, null, 2) + '\n');

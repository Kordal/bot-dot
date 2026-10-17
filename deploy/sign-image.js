#!/usr/bin/env node
// Signing job only. The protected release environment supplies the private key.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { canonical, verify } = require('../lib/release-manifest');
const [app, version, revision, image, digest] = process.argv.slice(2);
if (!/^sha256:[a-f0-9]{64}$/.test(digest || '')) throw new Error('Invalid image digest');
const m = { app, version: Number(version), revision, file: `${image}@${digest}`, sha256: digest.slice(7) };
if (!process.env.BOTDOT_RELEASE_PRIVATE_KEY) throw new Error('Release signing key is not configured');
m.signature = crypto.sign('sha256', canonical(m), process.env.BOTDOT_RELEASE_PRIVATE_KEY).toString('base64');
verify(m, { app, installed: 0 });
fs.writeFileSync('image-release.json', JSON.stringify(m));

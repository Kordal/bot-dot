#!/usr/bin/env node
// @ts-check
// Puts a signed Android bundle on a Google Play track through the Play Developer API (ADR 173).
// CI's release environment holds PLAY_SERVICE_ACCOUNT_JSON: the JSON key of a Google Cloud service account that
// has release rights on the app in Play Console. Without it android.yml skips this step.
// Usage: node deploy/play-upload.js <bundle.aab> [track] (track defaults to internal)
// The first bundle goes up by hand in Play Console: the API can only add releases to an app that has one.
const fs = require('node:fs');
const crypto = require('node:crypto');

const PACKAGE = 'dev.botdot.app';
const API = 'https://androidpublisher.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/** A signed JWT asking Google for an access token for the service account (RFC 7523). */
function assertion(account, now = Math.floor(Date.now() / 1000)) {
  const b64 = (/** @type {any} */ v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({ iss: account.client_email, scope: SCOPE, aud: account.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const signature = crypto.sign('sha256', Buffer.from(`${head}.${body}`), account.private_key).toString('base64url');
  return `${head}.${body}.${signature}`;
}

/** @param {Response} res */
async function json(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

/**
 * Uploads the bundle in one edit and commits it. A new app (still a draft in Play Console) only takes draft
 * releases: then the release waits in Play Console for a tap on "Roll out".
 * @param {{ account: any, bundle: Buffer, track?: string, fetch?: typeof fetch, log?: (s: string) => void }} o
 */
async function upload({ account, bundle, track = 'internal', fetch = globalThis.fetch, log = console.log }) {
  const token = (await json(await fetch(account.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(account) }).toString(),
  }), 'Sign-in to Google')).access_token;
  const auth = { authorization: `Bearer ${token}` };
  const base = `${API}/androidpublisher/v3/applications/${PACKAGE}/edits`;

  const edit = await json(await fetch(base, { method: 'POST', headers: auth }), 'Opening an edit');
  const sent = await json(await fetch(`${API}/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: bundle,
  }), 'Uploading the bundle');
  log(`Uploaded version ${sent.versionCode}`);

  const put = (status) => fetch(`${base}/${edit.id}/tracks/${track}`, {
    method: 'PUT', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ track, releases: [{ versionCodes: [String(sent.versionCode)], status }] }),
  });
  let status = 'completed';
  let res = await put(status);
  if (res.status === 400) {
    const text = await res.text();
    if (!/draft app/i.test(text)) throw new Error(`Setting the ${track} track: HTTP 400 ${text}`);
    status = 'draft';
    res = await put(status);
  }
  await json(res, `Setting the ${track} track`);
  await json(await fetch(`${base}/${edit.id}:commit`, { method: 'POST', headers: auth }), 'Committing the edit');
  log(status === 'draft'
    ? `Version ${sent.versionCode} is a draft on the ${track} track: roll it out in Play Console (the app is not published yet).`
    : `Version ${sent.versionCode} is out on the ${track} track.`);
  return { versionCode: sent.versionCode, status };
}

if (require.main === module) {
  const [file, track] = process.argv.slice(2);
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON;
  if (!file) throw new Error('Usage: node deploy/play-upload.js <bundle.aab> [track]');
  if (!raw) throw new Error('PLAY_SERVICE_ACCOUNT_JSON is not set');
  upload({ account: JSON.parse(raw), bundle: fs.readFileSync(file), track: track || 'internal' })
    .catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { assertion, upload, PACKAGE };

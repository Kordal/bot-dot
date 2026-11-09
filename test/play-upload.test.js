const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertion, upload, PACKAGE } = require('../deploy/play-upload');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { client_email: 'ci@botdot.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };

/** A stand-in for Google: answers each call in turn and remembers them. */
function google(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body, headers: init.headers });
    const [status, body] = answers.shift();
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { calls, fetch };
}

test('the sign-in assertion is a JWT for the publisher scope, signed with the service account key', () => {
  const jwt = assertion(account, 1000);
  const [head, body, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(claims.iss, account.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, 'base64url')));
});

test('a bundle goes up in one edit and is rolled out on the internal track', async () => {
  const g = google([[200, { access_token: 't' }], [200, { id: 'e1' }], [200, { versionCode: 42 }], [200, {}], [200, {}]]);
  const out = await upload({ account, bundle: Buffer.from('aab'), fetch: g.fetch, log: () => {} });
  assert.deepEqual(out, { versionCode: 42, status: 'completed' });
  assert.match(g.calls[2].url, new RegExp(`/upload/androidpublisher/v3/applications/${PACKAGE}/edits/e1/bundles\\?uploadType=media$`));
  assert.equal(g.calls[2].headers.authorization, 'Bearer t');
  assert.match(g.calls[3].url, /\/edits\/e1\/tracks\/internal$/);
  assert.deepEqual(JSON.parse(g.calls[3].body), { track: 'internal', releases: [{ versionCodes: ['42'], status: 'completed' }] });
  assert.match(g.calls[4].url, /\/edits\/e1:commit$/);
});

test('an app not published yet gets a draft release instead', async () => {
  const g = google([[200, { access_token: 't' }], [200, { id: 'e1' }], [200, { versionCode: 43 }],
    [400, { error: { message: 'Only releases with status draft may be created on draft app.' } }], [200, {}], [200, {}]]);
  const out = await upload({ account, bundle: Buffer.from('aab'), fetch: g.fetch, log: () => {} });
  assert.equal(out.status, 'draft');
  assert.equal(JSON.parse(g.calls[4].body).releases[0].status, 'draft');
});

test('any other refusal stops the upload and says what Google said', async () => {
  const g = google([[200, { access_token: 't' }], [200, { id: 'e1' }], [403, 'The caller does not have permission']]);
  await assert.rejects(upload({ account, bundle: Buffer.from('aab'), fetch: g.fetch, log: () => {} }), /Uploading the bundle: HTTP 403 The caller does not have permission/);
  assert.equal(g.calls.length, 3);
});

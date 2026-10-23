// A connected app's failure in plain words (lib/app-errors.js): the known kinds by the app's own error, what helps,
// the app's words kept for a bot, and Claude's one sentence for any other kind.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/app-errors');

const google = (code, status, reason, message) => JSON.stringify({ error: { code, message, status, details: [{ reason }] } });

test('classify: the known kinds of an app\'s error, and what helps', () => {
  const kind = (raw) => { const k = E.classify(raw, 'Google Docs'); return [k.code, k.action, k.message]; };
  assert.deepEqual(kind(google(403, 'PERMISSION_DENIED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'Request had insufficient authentication scopes.')), ['app-permission', 'reconnect', "Google Docs wasn't allowed to do this."]);
  assert.deepEqual(kind(google(401, 'UNAUTHENTICATED', 'ACCESS_TOKEN_EXPIRED', 'Request had invalid authentication credentials.')), ['app-signed-out', 'reconnect', 'Google Docs is signed out.']);
  assert.deepEqual(kind('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}')[0], 'app-signed-out');
  assert.deepEqual(kind(google(429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED', 'Quota exceeded')), ['app-busy', 'retry', 'Google Docs is busy. Try again in a minute.']);
  assert.deepEqual(kind(google(503, 'UNAVAILABLE', '', 'The service is currently unavailable.')).slice(0, 2), ['app-down', 'retry']);
  assert.deepEqual(kind(google(400, 'INVALID_ARGUMENT', '', 'Invalid value at index 4290')), ['app-failed', null, null]);
  assert.deepEqual(kind('Document 1A2B3C429x not found'), ['app-failed', null, null], 'a number in an id is no rate limit');
});

test('appError: status by what helps, the app\'s words as detail; forBot: the sentence, what to do and the app\'s words', () => {
  const raw = google(403, 'PERMISSION_DENIED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'Request had insufficient authentication scopes.');
  const e = E.appError(raw, { app: 'googledocs', name: 'Google Docs' });
  assert.deepEqual([e.status, e.code, e.action, e.app, e.appError], [409, 'app-permission', 'reconnect', 'googledocs', true]);
  assert.match(e.detail, /ACCESS_TOKEN_SCOPE_INSUFFICIENT/);
  assert.equal(E.forBot(e).startsWith("Google Docs wasn't allowed to do this. Ask the owner to reconnect it on the Connectors page. The app said: {"), true);
  assert.equal(E.appError(google(429, 'RESOURCE_EXHAUSTED', '', 'Quota exceeded')).status, 503);
  const other = E.appError('boom', { name: 'Slack' });
  assert.deepEqual([other.status, other.code, other.message], [502, 'app-failed', "Slack couldn't do it."]);
});

test('explain: only an unknown kind is asked of Claude, once per error; a reply that is no plain sentence is not used', async () => {
  let asks = 0;
  const ask = async (prompt, opts) => { asks++; assert.equal(opts.llm.model, 'haiku'); return 'The text was too long for one document. Split it and try again.'; };
  const known = E.appError(google(429, 'RESOURCE_EXHAUSTED', '', 'Quota exceeded'), { name: 'Notion' });
  assert.equal((await E.explain(known, { ask })).message, 'Notion is busy. Try again in a minute.');
  assert.equal(asks, 0);
  const raw = `{"error":"payload too large ${Date.now()}"}`;
  assert.equal((await E.explain(E.appError(raw, { name: 'Notion' }), { ask })).message, 'The text was too long for one document. Split it and try again.');
  assert.equal((await E.explain(E.appError(raw, { name: 'Notion' }), { ask })).message, 'The text was too long for one document. Split it and try again.');
  assert.equal(asks, 1, 'the same error is not asked twice');
  for (const bad of ['', 'ok', '{"error": 1}', 'See https://example.com for more.', 'x'.repeat(201)]) assert.equal(E.sentence(bad), null, bad);
  const e = await E.explain(E.appError(`{"e":"${Math.random()}"}`, { name: 'Notion' }), { ask: async () => { throw new Error('no Claude'); } });
  assert.equal(e.message, "Notion couldn't do it.");
});

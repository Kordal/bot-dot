// A run Claude's servers refused to sign in (a revoked or expired token, Claude Code's "Failed to authenticate.
// API Error: 401") says so in plain words and where to sign in again, not the raw error.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { friendlyProblem } = require('../lib/problems');

const REVOKED = 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token has been revoked."}}';
const REFUSED = "Claude refused my sign-in, so I couldn't finish. Send it again; if this keeps happening, sign in to Claude again in Settings → Claude.";

test('a refused sign-in is said plainly, for a run and for a Chief reply', () => {
  assert.equal(friendlyProblem({ status: 'error', error: REVOKED }), REFUSED);
  assert.equal(friendlyProblem({ status: 'error' }, 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'), REFUSED, 'from the result text too');
  assert.equal(friendlyProblem({ status: 'error', error: 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' }), REFUSED);
  assert.equal(friendlyProblem({ status: 'error', error: REVOKED }, undefined, { details: false }), REFUSED);
});

test('a scheduled run says it tries again at the next time', () => {
  assert.equal(friendlyProblem({ status: 'error', error: REVOKED, jobName: 'Morning mail' }),
    "Claude refused my sign-in, so I couldn't finish. I will try again at the next scheduled time; if this keeps happening, sign in to Claude again in Settings → Claude.");
});

test('a 401 from something else is not taken for Claude', () => {
  assert.match(friendlyProblem({ status: 'error', error: 'Composio rejected the API key (401)' }), /^Something went wrong/);
});

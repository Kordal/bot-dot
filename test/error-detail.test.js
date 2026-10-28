// A failed run's error as one redacted line, for the admin page (ADR 109): the error's own words stay, everything
// that could be what the run read or wrote goes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detail, MAX } = require('../lib/error-detail');

test('the line that names the problem, else the last one', () => {
  assert.equal(detail('Starting\nError: spawn claude ENOENT\n    at ChildProcess._handle'), 'Error: spawn claude ENOENT');
  assert.equal(detail('first\n\nsecond\n'), 'second');
  assert.equal(detail('Exited with code 137'), 'Exited with code 137');
  assert.equal(detail('\u001b[31mError:\u001b[0m boom'), 'Error: boom');
});

test('addresses, paths, quoted text, numbers, ids and secrets are replaced', () => {
  const cases = {
    'curl https://ann:pw@example.com/a?x=1 failed for ann@example.com at 10.0.0.1:8080': 'curl <url> failed for <email> at <ip>',
    'Error: Cannot open /home/ann/Documents/tax.pdf or ~/notes.md or ./x/y or C:\\Users\\ann\\a.txt': 'Error: Cannot open <path> or <path> or <path> or <path>',
    'Error: Authorization: Bearer abc.def password=hunter2 api_key: k1 token=t': 'Error: Authorization: <secret> <secret> password=<secret> api_key: <secret> token=<secret>',
    'Error: bad sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123': 'Error: bad <secret>',
    'Error: run 3f2a9c1d8e7b and 123e4567-e89b-12d3-a456-426614174000 after 1234567 ms': 'Error: run <id> and <id> after <n> ms',
    'Error: Could not read "My tax return" or \'Ann Smith\' or `rm -rf`': 'Error: Could not read "…" or "…" or "…"',
    'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"what the run sent"}}': 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"…"}}',
    'Error: Cannot find module \'left-pad\'': 'Error: Cannot find module \'left-pad\'',
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(detail(text), want, text);
});

test('cut to one short line, redacted first; nothing to show is null', () => {
  const long = detail(`Error: ${'word '.repeat(100)}`);
  assert.ok(long.length <= MAX && long.endsWith('…'));
  assert.equal(detail(`Error: ${'x'.repeat(200)}`), 'Error: <secret>', 'a secret is never cut in half and left');
  for (const nothing of [null, undefined, 42, '', '\n \n', '12345678', '"only quoted"', 'https://example.com/x']) assert.equal(detail(nothing), null, String(nothing));
});

test('running it again changes nothing, as the front door does', () => {
  for (const text of ['Error: Cannot open /home/ann/a.txt token=x', 'API Error: 500 {"type":"error"}', 'spawn claude ENOENT']) assert.equal(detail(detail(text)), detail(text));
});

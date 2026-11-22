'use strict';
// The issue link of a status (Feedback to the developers): the repository moved from Kordal to ladrok, so the relay answers
// the new owner's link and a report kept with the old one keeps it; any other address is dropped, as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanStatus } = require('../lib/front-door/feedback-relay');

const issue = (url) => cleanStatus({ status: 'seen', issue: url }).issue;

test('the links of ladrok/bot-dot and of its earlier owner are kept, and nothing else', () => {
  assert.equal(issue('https://github.com/ladrok/bot-dot/issues/12'), 'https://github.com/ladrok/bot-dot/issues/12');
  assert.equal(issue('https://github.com/Kordal/bot-dot/issues/12'), 'https://github.com/Kordal/bot-dot/issues/12');
  for (const bad of [
    'https://github.com/someone/bot-dot/issues/12',
    'https://github.com/ladrok/other/issues/12',
    'https://github.com/ladrok/bot-dot/pull/12',
    'https://github.com/ladrok/bot-dot/issues/0',
    'https://github.com/ladrok/bot-dot/issues/1234567890',
    'https://github.com/ladrok/bot-dot/issues/12/../../x',
    'http://github.com/ladrok/bot-dot/issues/12',
    'https://evil.example/ladrok/bot-dot/issues/12',
    'https://github.com/ladrok/bot-dot/issues/12?x=1',
  ]) assert.equal(issue(bad), undefined, bad);
});

// install.sh on a stand-in machine (test/installer-helpers.js): Feedback to the developers (ADR 259, #1567). The first
// install asks whether to send Feedback to botdot's developers when someone can answer, says no when nobody can, never
// asks a managed machine, and gives the answer to the front door once, through its environment. The front door's side
// (it takes the answer only while its data has none) is in test/front-door-feedback-relay.test.js.
// Part 1 of 2 of the Feedback tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const { installer } = require('./installer-helpers');

const VAR = 'FRONT_DOOR_FEEDBACK_TO_DEVELOPERS';

const QUESTION = /Send Feedback to botdot's developers\? \[y\/N\]/;

// The answers of a first install on a public domain, then n to Jev, boat.dev and Composio.
const FIRST = '1\nbots.example.org\nann\nn\nn\nn\n';

test('a first install asks whether to send Feedback to the developers, in plain words, and gives the front door the answer', (t) => {
  const yes = installer(t, { dotenv: '', input: `${FIRST}y\n` });
  assert.equal(yes.status, 0, `${yes.said}\n${yes.stderr}`);
  assert.match(yes.said, QUESTION);
  assert.match(yes.said, /every account's Feedback goes to\s+botdot's developers/);
  assert.match(yes.said, /instead of to your admin page/);
  assert.match(yes.said, /change this later on the admin page/);
  assert.equal(yes.env[VAR], '1');

  const no = installer(t, { dotenv: '', input: `${FIRST}n\n` });
  assert.equal(no.status, 0, `${no.said}\n${no.stderr}`);
  assert.match(no.said, QUESTION);
  assert.equal(no.env[VAR], '0');

  const enter = installer(t, { dotenv: '', input: `${FIRST}\n` });
  assert.equal(enter.env[VAR], '0', 'Enter alone is no');
});

test('nobody to answer, no terminal (get.sh piped): the answer is no, and the install says yes for no one', (t) => {
  const done = installer(t, { dotenv: '', input: '1\nbots.example.org\nann\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(done.env[VAR], '0');
  const given = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'bots.example.org', BOT_DOT_ADMIN: 'ann' } });
  assert.equal(given.status, 0, `${given.said}\n${given.stderr}`);
  assert.equal(given.env[VAR], '0', 'an install with every answer given and no terminal');
});

test('botdot on this computer only is not asked, and its answer is no', (t) => {
  const done = installer(t, { dotenv: '', input: 'y\ny\ny\ny\n', given: { BOT_DOT_REACH: 'local' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /Feedback/);
  assert.equal(done.env[VAR], '0');
});

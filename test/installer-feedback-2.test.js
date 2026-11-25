// install.sh on a stand-in machine (test/installer-helpers.js): Feedback to the developers (ADR 259, #1567). The first
// install asks whether to send Feedback to botdot's developers when someone can answer, says no when nobody can, never
// asks a managed machine, and gives the answer to the front door once, through its environment. The front door's side
// (it takes the answer only while its data has none) is in test/front-door-feedback-relay.test.js.
// Part 2 of 2 of the Feedback tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer } = require('./installer-helpers');

const VAR = 'FRONT_DOOR_FEEDBACK_TO_DEVELOPERS';

// The answers of a first install on a public domain, then n to Jev, boat.dev and Composio.
const FIRST = '1\nbots.example.org\nann\nn\nn\nn\n';

const dotenvOf = (done) => fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8');

test("a managed machine is not asked, and gives the front door no answer: each owner is asked there", (t) => {
  const done = installer(t, { dotenv: '', input: 'y\ny\ny\ny\n', given: { BOT_DOT_MANAGED: '1', BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /Feedback/);
  assert.ok(!(VAR in done.env), 'no answer in .env');
});

test("a later install or update never changes the answer, and never asks: the admin page's choice stands", (t) => {
  const first = installer(t, { dotenv: '', input: `${FIRST}y\n` });
  assert.equal(first.env[VAR], '1');
  const again = installer(t, { dotenv: dotenvOf(first), input: 'n\nn\nn\nn\n' });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.doesNotMatch(again.said, /Feedback/);
  assert.equal(again.env[VAR], '1', 'kept as it was');

  const update = installer(t, { dotenv: dotenvOf(first), args: ['--update'] });
  assert.equal(update.status, 0, `${update.said}\n${update.stderr}`);
  assert.equal(update.env[VAR], '1');

  // A machine installed before the question: nothing is asked and nothing is given, so its admin page decides alone.
  const before = installer(t, { input: 'y\n', args: [] });
  assert.equal(before.status, 0, `${before.said}\n${before.stderr}`);
  assert.doesNotMatch(before.said, /Feedback/);
  assert.ok(!(VAR in before.env), 'never answered');
  const old = installer(t, { args: ['--update'] });
  assert.ok(!(VAR in old.env));
});

test("the front door's compose file passes the answer through", () => {
  const compose = fs.readFileSync(path.join(__dirname, '..', 'compose.front-door.yaml'), 'utf8');
  assert.match(compose, /^\s+FRONT_DOOR_FEEDBACK_TO_DEVELOPERS: \$\{FRONT_DOOR_FEEDBACK_TO_DEVELOPERS:-\}$/m);
});

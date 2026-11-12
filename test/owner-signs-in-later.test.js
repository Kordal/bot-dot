// A bot asks before it opens a sign-in the owner must do by hand on its screen, and opens it only after their yes:
// opened at once, the page waited while the owner was away and the computer stopped after 30 minutes unused.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bots = fs.readFileSync(path.join(__dirname, '../lib/bots.js'), 'utf8');
const chief = fs.readFileSync(path.join(__dirname, '../lib/chief.js'), 'utf8');

test('a bot on either computer asks whether the owner takes over its screen now before it opens a sign-in page', () => {
  const rule = bots.match(/^const OWNER_SIGNS_IN = "(.*)";$/m)?.[1];
  assert.ok(rule, 'the rule is one line of its own');
  assert.match(rule, /don't open the sign-in page before they are there to take over/);
  assert.match(rule, /one yes \/ no question: whether they want to take over your screen now/);
  assert.match(rule, /Open the page only after their yes/);
  assert.doesNotMatch(rule, /\[\[/, 'a run the Chief started gets no answer buttons');
  assert.match(rule, /unless they or the Chief's message say they are ready now/);
  assert.match(bots, /^const BOAT_REST = '.*' \+ OWNER_SIGNS_IN;$/m, 'told on the External Virtual PC');
  assert.match(bots, /^- \$\{OWNER_SIGNS_IN\}$/m, "told on the account's computer");
});

test('the Chief asks first and sends the bot to open the sign-in only after the yes, saying the user is ready', () => {
  assert.match(chief, /When the user must sign in by hand on a bot's screen .* ask first whether they want to take over the screen now, with \[\[choices: …\]\], and only after their yes run the bot to open the sign-in page, saying in its prompt that the user is ready now\./);
});

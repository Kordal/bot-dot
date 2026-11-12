// A service botdot connects goes through its app, not the owner's hands (ADR 222): the Chief looks it up before it
// gives steps by hand, and a bot's ask_chief_for_app says it is for any of the services botdot connects.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test("the Chief looks a service up before it gives the owner steps by hand, a team's answer included", () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../lib/chief.js'), 'utf8');
  assert.match(prompt, /Before you give the user steps to do by hand in an online service, or ask them to copy something out of it \(a form, a key, a list id\), look the service up with list_connectors search/);
  assert.match(prompt, /else call offer_connect_app \(bot: the one doing the work\) instead of the steps/);
  assert.match(prompt, /The same holds for a bot's or a team's answer that hands the user such steps\./);
});

test("a bot's ask_chief_for_app is for any service botdot connects, asked before steps by hand", () => {
  const src = fs.readFileSync(path.join(__dirname, '../lib/self-mcp.js'), 'utf8');
  assert.match(src, /any of about 1,500 online services \([^)]*Brevo/);
  assert.match(src, /Ask before you give the owner steps to do by hand in such a service\./);
});

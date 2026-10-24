// Settings on the web page: every card with a title is a fold, closed whenever Settings opens, as a bot's Advanced.
// The one-line cards (Install app, Notifications on this device) and the links to the pages stay as they are.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cut, read } = require('./web-page');

test('web: every titled card of Settings is a closed fold with its title as the summary', () => {
  const settings = cut('function renderSettings()', '// ---------- installing the app ----------')
    + cut('// ---------- backups ----------', '// Setup → Restore a backup')
    + cut('// ---------- when this account switches to a new version ----------', '// ---------- signing out everywhere ----------')
    + cut('// ---------- signing out everywhere ----------', 'async function signOutEverywhere()');
  for (const title of ['Default model and reasoning', 'Bots with their own choice', 'Backups', 'Updates', 'Sign-ins']) {
    assert.match(settings, new RegExp(`<summary><h3 class="page-sub">${title}</h3></summary>`), title);
  }
  assert.match(read('usage.js'), /<summary><h3 class="page-sub">Usage<\/h3><\/summary>/);
  for (const id of ['usage-card', 'backups-card', 'update-card', 'sign-out-card']) {
    assert.match(settings, new RegExp(`<details class="card settings-card settings-fold" id="${id}"`), id);
  }
  assert.doesNotMatch(settings, /<details[^>]*settings-fold[^>]*\sopen/, 'closed when Settings opens');
  assert.doesNotMatch(settings, /<div class="card settings-card">\s*<h3/, 'no titled card left unfolded');
  assert.match(read('style.css'), /\.settings-fold > summary::before \{ content: "▸"/);
});

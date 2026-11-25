// The questions the web page asks before it acts (QW-001): seven that confirmed what can be undone are gone,
// the others are asked as before. The page's own code, read for its confirm() calls. (The question before
// "Everything allowed" is gone with the mode's select, ADR 268.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app, cut } = require('./web-page');

test('web: no question for the seven that can be undone or say what they do', () => {
  for (const gone of [
    /Remove the group/, /Undo this change\?/, /Take control of/, /Approve this job as it was set up/,
    /Delete this note\?/, /Download the bge-m3 model/,
  ]) assert.doesNotMatch(app, gone);
  // Each now acts at once.
  assert.match(app, /\$\('#group-remove', m\)\.onclick = \(\) => rename\('', tr\('Category removed'\)\);/);
  assert.match(app, /if \(a === 'control'\) pip\.control = !pip\.control;/);
  assert.match(app, /\$\('#job-decline', m\)\.onclick = \(\) => whileBusy\(\$\('#job-decline', m\), tr\('Declining…'\), \(\) => answer\(false\)\);/, '"Decline and remove" in the job dialog');
  assert.match(cut("const approve = $('[data-approve]', card);", "$('.job-approve', card)?.remove();"), /approve\.onclick = \(\) => whileBusy\(approve, tr\('Approving…'\), async \(\) => \{\s*try \{\s*const job = await api\(`\$\{jobUrl\(\)\}\/approve`/);
  // Deleting a note and downloading the search model went with the memory screens (MEM-007).
});

test('web: no undo of a bot\'s change but the one of a card\'s change to its main assignment (#305, #596)', () => {
  assert.doesNotMatch(app, /data-undo|The skill "\$\{c\.field\.slice\(6\)\}" is deleted/);
  assert.match(app, /bot\.undo \? `<button type="button" class="link-btn" data-bs-undo>\$\{tr\('Undo last change'\)\}<\/button>` : ''/, 'shown only while the server offers it');
});

test('web: still asked, unchanged, on the page and never with the browser\'s confirm()', () => {
  for (const [what, re] of [
    ['deleting a bot', /if \(!\(await askFirst\(warning, tr\('Delete'\)\)\)\) return;/],
    ['resetting the account\'s computer, in the server\'s words (#107)', /if \(await askFirst\(`\$\{info\.reset\.title\}\\n\\n\$\{info\.reset\.text\}`, tr\('Reset'\)\)\) forAll\('reset', tr\('Resetting…'\)\);/],
    ['updating the account\'s computer (#107)', /if \(info\?\.update && await askFirst\(info\.update\.text, tr\('Update'\), \{ danger: false \}\)\) forAll\('update', tr\('Updating…'\)\);/],
    ['erasing a bot\'s old computer (#107)', /if \(!info\?\.old \|\| !\(await askFirst\(info\.old\.confirm, tr\('Erase'\)\)\)\) return;/],
    ['deleting a skill', /askFirst\(tr\('Delete the skill "\{name\}"\? Bots that have it will stop using it\.', \{ name: k\.name \}\), tr\('Delete'\)\)/],
    ['removing a job in the jobs panel', /if \(!\(await askFirst\(tr\('Remove this job\?'\), tr\('Remove'\)\)\)\) return;/],
    ['Decline on a job\'s card in Needs you, of a server whose button does not say that it removes', /if \(!asksBeforeNo\(x\) \|\| await askFirst\(tr\('Remove this job\?'\), tr\('Remove'\)\)\) return whileBusy\(button, tr\('Declining…'\), \(\) => decide\(x, false\)\);/],
    ['Always allow on a connected-app card, in the server\'s words (#474)', /if \(await sure\(said\(x\.a\.warning\) \|\| \(x\.a\.chief \? tr\('Let \{name\} do this from now on, whatever the details\?', \{ name: chiefTitle\(\) \}\)/],
    ['Always allow on a Chief\'s change after the web, in the server\'s words (#280)', /if \(await sure\(said\(x\.a\.warning\) \|\| `\$\{said\(x\.a\.always\)\}\?`\)\)/],
    ['Always approve', /await sure\(scriptWarning\(x\.bot\.name, x\.job\.name\)\)/],
    ['disconnecting an app', /askFirst\(tr\('Disconnect \{app\}\? Bots lose access, and Composio revokes its access to your account\.', \{ app: c\?\.app\?\.name \|\| c\?\.toolkit \}\), tr\('Disconnect'\)\)/],
    ['signing out of Claude', /askFirst\(`\$\{tr\("Sign out of Claude\? Bots can't run until you sign in again\."\)\}/],
    ['deleting a saved login', /askFirst\(state\.bw\?\.configured \? tr\("Delete \\"\{name\}\\"\? It moves to Bitwarden's trash/],
    ['the password hint', /askFirst\(tr\('This looks like it contains a password\./],
    ['signing out of this device (#1591)', /askFirst\(tr\('Sign out of this device\? Your other browsers and apps stay signed in\.'\), tr\('Sign out'\), \{ danger: false \}\)/],
    ['signing out everywhere (#468)', /askFirst\(tr\('Sign out everywhere\? Every browser and app signed in to your account/],
    ['removing a secret kept in a file (#253)', /if \(!\(await askFirst\(tr\("Remove \{path\}\? The bot can't write it again without asking you on a card\.", \{ path: b\.dataset\.where \}\), tr\('Remove'\)\)\)\) return;/],
    ['switching the account to a new version now (#259)', /if \(!\(await askFirst\(warns \? tr\('Update now\? Your account moves to the new version: your bots restart, and work still running stops\.'\) : tr\('Update now\? Your account moves to the new version\.'\), tr\('Update now'\), \{ danger: false \}\)\)\) return;/],
    ['removing the Anthropic API key (#35)', /askFirst\(c\.subscription === true \? tr\('Remove the API key\? Bots will run on your Claude subscription\.'/],
  ]) assert.match(app, re, what);
  // The browser's confirm() shows nothing in the Mac app and answers no (test/ask-first-web.test.js keeps it out).
  assert.equal((app.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').match(/(?<![\w.])confirm\(/g) || []).length, 0);
});

// The questions the web page asks before it acts (QW-001): seven that confirmed what can be undone are gone,
// the others are asked as before, and choosing "Everything allowed" for a bot asks first. The page's own
// code, read for its confirm() calls, and the new question run against stand-in elements. The question on the
// real page is walked in test/browser/failed-send.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, cut, esc, element, finders, words } = require('./web-page');

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
    ['signing out everywhere (#468)', /askFirst\(tr\('Sign out everywhere\? Every browser and app signed in to your account/],
    ['removing a secret kept in a file (#253)', /if \(!\(await askFirst\(tr\("Remove \{path\}\? The bot can't write it again without asking you on a card\.", \{ path: b\.dataset\.where \}\), tr\('Remove'\)\)\)\) return;/],
    ['switching the account to a new version now (#259)', /if \(!\(await askFirst\(tr\('Update now\? Your account moves to the new version: your bots restart, and work still running stops\.'\), tr\('Update now'\), \{ danger: false \}\)\)\) return;/],
    ['removing the Anthropic API key (#35)', /askFirst\(c\.subscription === true \? tr\('Remove the API key\? Bots will run on your Claude subscription\.'/],
  ]) assert.match(app, re, what);
  // The browser's confirm() shows nothing in the Mac app and answers no (test/ask-first-web.test.js keeps it out).
  assert.equal((app.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').match(/(?<![\w.])confirm\(/g) || []).length, 0);
});

// A bot's settings form, as far as the permission mode goes, wired by the page's own lines.
function settings(answer) {
  const select = element({}, { value: 'dontAsk' });
  const form = element({}, { permissionMode: select, name: element({}, { value: 'Coder' }) });
  const saves = [];
  const asks = [];
  const ctx = vm.createContext({
    form, b: { id: 'coder', name: 'Old name' }, saveSoon: () => saves.push(select.value),
    askEverythingAllowed: (name) => { asks.push(name); return answer(); },
  });
  vm.runInContext(cut('  let mode = form.permissionMode.value;', "  form.onsubmit = (e) => { e.preventDefault(); save(); };"), ctx);
  // The form's own listener, which saves any change that reaches it.
  const choose = async (value) => {
    select.value = value;
    let stopped = false;
    await select.listeners.change[0]({ target: select, stopPropagation() { stopped = true; } });
    if (!stopped) ctx.saveSoon();
  };
  return { select, saves, asks, choose };
}

test('web: choosing "bypassPermissions" asks first, and saves on Allow everything', async () => {
  const s = settings(async () => true);
  await s.choose('bypassPermissions');
  assert.deepEqual(s.asks, ['Coder'], "by the bot's name as the form has it");
  assert.equal(s.select.value, 'bypassPermissions');
  assert.deepEqual(s.saves, ['bypassPermissions'], 'saved once');
});

test('web: Cancel puts the select back to its earlier value and saves nothing', async () => {
  const s = settings(async () => false);
  await s.choose('acceptEdits');
  await s.choose('bypassPermissions');
  assert.equal(s.select.value, 'acceptEdits');
  assert.deepEqual(s.saves, ['acceptEdits'], 'only the earlier choice');
});

test('web: while the question is open the select holds the earlier mode, so no other save carries the new one', async () => {
  let during;
  const s = settings(async () => { during = s.select.value; return true; });
  await s.choose('bypassPermissions');
  assert.equal(during, 'dontAsk');
});

test('web: choosing any other mode asks nothing', async () => {
  const s = settings(async () => assert.fail('no question'));
  for (const mode of ['acceptEdits', 'plan', 'default', 'dontAsk']) await s.choose(mode);
  assert.deepEqual(s.asks, []);
  assert.deepEqual(s.saves, ['acceptEdits', 'plan', 'default', 'dontAsk']);
});

test('web: the question says what it means and how to take it back; closing it any other way is a no', async () => {
  const allow = element();
  const dialog = element({ '#allow-everything': allow }, { close() { dialog.listeners.close.splice(0).forEach((fn) => fn()); } });
  const ctx = vm.createContext({ ...words, ...finders(), esc, Promise, openModal: (html) => { dialog.innerHTML = html; return dialog; } });
  vm.runInContext(`${cut('function askEverythingAllowed(name)', 'function openRunDialog(botId)')}\nthis.ask = askEverythingAllowed;`, ctx);
  const no = ctx.ask('<Coder>');
  const said = dialog.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(said, 'Let &lt;Coder&gt; do everything without checks? ✕ It will run any command and change any file without asking you. You can change this back here at any time. Cancel Allow everything');
  assert.match(dialog.innerHTML, /<button type="button" class="btn" data-dismiss>Cancel<\/button>\s*<button type="button" class="btn primary" id="allow-everything">Allow everything<\/button>/);
  dialog.close(); // Cancel, ✕ and Esc all only close it
  assert.equal(await no, false);
  const yes = ctx.ask('Coder');
  allow.onclick();
  assert.equal(await yes, true);
});

test('web: the switch for files that moves the mode by itself keeps the earlier value in step', () => {
  assert.match(app, /if \(!c\.checked && form\.permissionMode\.value === 'acceptEdits'\) form\.permissionMode\.value = 'dontAsk';\n\s*mode = form\.permissionMode\.value;/);
});

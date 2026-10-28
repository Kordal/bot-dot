// The password hint before a message is sent, on the web page (QW-001): looksLikeSecret cut out of
// public/app.js. It matches a password, not the word "password".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, cut } = require('./web-page');

const page = vm.createContext({ String });
vm.runInContext(`${cut('const SECRET_AFTER = ', '// ---------- vault item types ----------')}\nthis.looksLikeSecret = looksLikeSecret;`, page);
const { looksLikeSecret } = page;

test('web: it shows for a message with a password in it', () => {
  for (const t of ['password: hunter2x', 'my password is Tr0ub4dor&3', 'pass=abcd1234', 'pin 482913']) assert.equal(looksLikeSecret(t), true, t);
});

test('web: it does not show for a sentence about passwords', () => {
  for (const t of ['my password is wrong again', 'the password reset page is broken', 'change the password policy text']) assert.equal(looksLikeSecret(t), false, t);
});

test('web: a separator or "is", then one token that holds a digit or a symbol', () => {
  for (const t of [
    'Password = S3cret!', 'pwd: a1b2c3', 'the passwd - xk29-fq', 'log in, password is p@ssword.', 'hasło: Zima2026', 'haslo=tajne123',
    'passcode is 9f3k', 'use this\npassword:hunter2x\nthanks', 'pass: abcd1234 for the wiki', 'PIN: 4821', 'pin code is 482913', 'my password is: hunter2x', 'password is = S3cret',
  ]) assert.equal(looksLikeSecret(t), true, t);
});

test('web: after ":" or "=" a plain word counts when the message ends with it', () => {
  for (const t of ['password: correcthorse', 'the wifi password = sunflower.', 'pass: sunflower']) assert.equal(looksLikeSecret(t), true, t);
  for (const t of ['password: see the note above', 'password = whatever you like, I will change it']) assert.equal(looksLikeSecret(t), false, t);
});

test('web: ordinary sentences send without a question', () => {
  for (const t of [
    'my password is wrong', 'my password is correcthorse', 'the password is expired, can you reset it?', 'password is required on that form',
    'make the page password-protected', 'the password-reset flow is broken', 'add a password field', 'passwords: how do bots get them?',
    'pass the footer to the designer', 'pass - through filter', 'pin the version to 1.2', 'pin 12', 'a pin is needed', 'the password', 'password',
    'the bypass=true flag', 'the password is case-sensitive, right?', 'password - reset-flow ideas', 'compass: north', '', undefined, null,
  ]) assert.equal(looksLikeSecret(t), false, String(t));
});

test('web: the message box asks before it sends one, and says where a password belongs', () => {
  assert.match(app, /if \(looksLikeSecret\(text\) && !confirm\(tr\('This looks like it contains a password\.\\n\\nMessages are sent to the AI and saved on disk\./);
});

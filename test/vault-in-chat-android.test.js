// A login request, a card payment and a locked Bitwarden are answered in their card in the chat in the Android app
// too, not by a button that opens Needs you (#1186), as on the web page (#1185). The app's source, read as text: its
// unit tests run in CI only (no Android SDK here).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const screen = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app', 'ui', 'NeedsYouScreen.kt'), 'utf8');
const chat = screen.slice(screen.indexOf('fun ChatNeeds('), screen.indexOf('internal fun chatCards('));

test('android: a chat draws the login, payment and Bitwarden cards of Needs you, not a button to it', () => {
  assert.ok(chat.length > 0);
  assert.match(chat, /LoginRequestCard\(r, who, named = shown,/);
  assert.match(chat, /CardRequest\(r, who\.takeIf \{ shown \},/);
  assert.match(chat, /BitwardenCard\(bw, null, unlockError\) \{ pw -> api\?\.let \{ app\.unlockBitwarden\(it, pw\) \} \}/);
  assert.doesNotMatch(chat, /tr\("Add it"\)/);
  assert.match(screen, /fun ChatNeeds\(app: BotDotApp, scope: String\) \{/);
});

test('android: a locked Bitwarden stands in the chat of the bot that waits for it only', () => {
  assert.match(chat, /val bwHere = locked && !chief && group == null && bw\?\.wantedBy\?\.id == scope/);
});

test('android: while a password can be typed in a chat, the window is out of screenshots, as on Needs you', () => {
  assert.match(chat, /if \(bwHere \|\| reqs\.any \{ it\.kind != "card" \}\) Secure\(\)/);
  assert.match(screen, /if \(secureHolds\+\+ == 0\) window\?\.addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/);
  assert.match(screen, /onDispose \{ if \(--secureHolds == 0\) window\?\.clearFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\) \}/);
  assert.equal((screen.match(/addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/g) || []).length, 1, 'one place holds the flag');
});

test('android: an answer in the chat leaves its faded line, and the card goes', () => {
  assert.match(chat, /decided = decided \+ Decided\("r:\$\{r\.id\}", null,/);
  assert.match(chat, /&& decided\.none \{ it\.key == "r:\$\{r\.id\}" \} \}/);
});

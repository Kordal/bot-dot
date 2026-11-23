// The small × after a reply's quick answers on the web page (docs/api.md, "Putting quick answers away"): the page's
// own code (public/app.js choicesHTML) cut out and run against stand-ins, and the three chats that draw the row read
// for what they hand it. The tap itself is walked in test/browser/choices-dismiss.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc } = require('./web-page');

function page(features = ['choices-dismiss']) {
  const ctx = vm.createContext({ esc, state: { features }, tr: (t) => t });
  vm.runInContext(`${cut('// The text colour that reads best on a filled colour', '// Several questions at once')}\nObject.assign(this, { choicesHTML, choicesPut, dismissUndo });`, ctx);
  return ctx;
}
const URL = '/runs/r1/choices-dismissed';
const quickOf = (_key, url, dismissed) => ({ url, dismissed }); // what the chats hand choicesHTML: the reply's own record


test('web: a × stands after the last answer, as a button of its own that is no answer', () => {
  const { choicesHTML } = page();
  const html = choicesHTML(['Yes', 'No'], 0, '#7f77dd', 'r1', quickOf('r1', URL, false));
  assert.match(html, /<button type="button" class="choices-x" data-dismiss title="Dismiss suggested answers" aria-label="Dismiss suggested answers">/);
  assert.match(html, /data-quick="r1" data-url="\/runs\/r1\/choices-dismissed"/);
  assert.match(html, /data-choice="No"[^>]*>No<\/button><button type="button" class="choices-x"/, 'after the last answer');
  assert.equal(html.match(/data-choice=/g).length, 2, 'the × is no answer');
});

test('web: a reply dismissed on the server is drawn without its row; an older server shows no ×', () => {
  const { choicesHTML } = page();
  assert.equal(choicesHTML(['Yes', 'No'], 0, '', 'r1', quickOf('r1', URL, true)), '', 'put away: nothing, and no line once the few seconds are over');
  assert.doesNotMatch(page([]).choicesHTML(['Yes', 'No'], 0, '', 'r1', quickOf('r1', URL, false)), /choices-x/, 'a server without choices-dismiss: no ×');
  assert.doesNotMatch(choicesHTML(['Yes', 'No'], 0, '', 'r1'), /choices-x/, 'a row drawn without a place on the server has none');
});

test('web: what the owner chose here wins over a list the server has not changed yet, and the line stands while it is open', () => {
  const { choicesHTML, choicesPut, dismissUndo } = page();
  choicesPut.set('r1', true); // dismissed here, the list still says it is not
  assert.equal(choicesHTML(['Yes', 'No'], -1, '', 'r1', quickOf('r1', URL, false)), '');
  dismissUndo.set('r1', 1); // its few seconds are not over: a redraw keeps the line
  const line = choicesHTML(['Yes', 'No'], -1, '', 'r1', quickOf('r1', URL, false));
  assert.match(line, /<div class="choices-undo" data-quick="r1"[^>]*>Answers hidden · <button type="button" data-putback>Undo<\/button><\/div>/);
  choicesPut.set('r1', false); // Undo here, the list still says dismissed
  assert.match(choicesHTML(['Yes', 'No'], -1, '', 'r1', quickOf('r1', URL, true)), /class="choices"/);
});

test('web: a reply with no quick answers gets no row and no ×', () => {
  const { choicesHTML } = page();
  assert.equal(choicesHTML([], -1, '', 'r1', quickOf('r1', URL, false)), '');
});

test('web: the bot chat, the group chat and the Chief chat each give their row the reply\'s own place on the server', () => {
  const bot = read('bot-chat.js'), group = read('groups.js'), chief = read('chief.js');
  for (const src of [bot, group]) assert.match(src, /choicesHTML\(r\.choices, r\.yes, [\w.]+, r\.id, \{ url: `\/runs\/\$\{encodeURIComponent\(r\.id\)\}\/choices-dismissed`, dismissed: r\.choicesDismissed \}\)/);
  assert.match(chief, /\{ key: `chief:\$\{state\.chatId\}:\$\{index\}`, url: `\/chief\/chats\/\$\{encodeURIComponent\(state\.chatId\)\}\/messages\/\$\{index\}\/choices-dismissed`, dismissed: m\.choicesDismissed \}/);
  assert.doesNotMatch(read('app.js').slice(read('app.js').indexOf('const questionsHTML'), read('app.js').indexOf('function replyText')), /choices-x|dismiss/, 'the card of questions has no ×');
});

test('web: the × is a round 28px quiet icon, filled on hover', () => {
  const css = read('style.css');
  assert.match(css, /\.choices-x \{[^}]*width: 28px; height: 28px;[^}]*border-radius: 50%; background: transparent; color: var\(--muted\)/);
  assert.match(css, /\.choices-x:hover \{ background: var\(--sunk\)/);
  assert.match(css, /\.choices-undo \{/);
});

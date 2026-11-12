// What a Chief message is about, on the web page (ADR 223): the team in its colour above the message, the project
// before it when the server names one, nothing for a message about no team. `data/ChiefMessageTest` holds Android's side.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc } = require('./web-page');

const page = vm.createContext({ esc });
vm.runInContext(`${cut('function aboutHTML(m)', 'const messageHTML = ')}
  Object.assign(this, { aboutHTML });`, page);
const { aboutHTML } = page;

test('web: a message about a team shows the team in its colour, and opens its chat', () => {
  const html = aboutHTML({ about: { team: { id: 't1', name: 'Strona', color: '#3b82f6' } } });
  assert.match(html, /data-about-team="t1"/);
  assert.match(html, /--c:#3b82f6/);
  assert.match(html, /<span class="about-team">Strona<\/span>/);
  assert.doesNotMatch(html, /about-project/);
});

test('web: outside the project\'s chat the project stands before the team', () => {
  const html = aboutHTML({ about: { team: { id: 't1', name: 'Strona', color: '#3b82f6' }, project: { id: 'p1', name: 'Mug <shop>' } } });
  assert.match(html, /<span class="about-project">Mug &lt;shop&gt;<\/span><span class="about-sep">›<\/span><span class="about-team">Strona<\/span>/);
});

test('web: no team, no line; a colour that is not one is never drawn into the style', () => {
  assert.equal(aboutHTML({ role: 'chief', text: 'Hi' }), '');
  assert.match(aboutHTML({ about: { team: { id: 't', name: 'X', color: 'red;background:url(x)' } } }), /--c:var\(--muted\)/);
});

test('web: the owner\'s message, the Chief\'s reply and a bot\'s report draw it', () => {
  const src = read('chief.js');
  const about = String.raw`\$\{globalThis\.aboutHTML\?\.\(m\) \|\| ''\}`;
  assert.match(src, new RegExp(String.raw`const userBubble = \(m\) => ` + '`' + String.raw`<div class="bubble-row from-me"><div class="stack mine">` + about));
  assert.match(src, /\$\{m\.pending \? '' : globalThis\.aboutHTML\?\.\(m\) \|\| ''\}/);
  assert.match(src, new RegExp(String.raw`<div class="stack from-bot-msg">\n    ` + about));
});

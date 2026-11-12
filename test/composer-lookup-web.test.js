// A chat's message box is found as form.composer, never as the first form in the chat: a card in the thread
// (a login or a token asked for, opened in place) has a form of its own ahead of the box, and a send that set
// the box's placeholder on that card's form failed with "undefined is not an object (form.text…)".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public');

test('web: every chat finds its message box as form.composer', () => {
  const bare = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      if (/\$\('form', root\)|'#view-[a-z-]+ form'/.test(line)) bare.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, []);
  // Each chat's box is drawn with that class.
  assert.match(fs.readFileSync(path.join(dir, 'chief.js'), 'utf8'), /<form class="composer"/);
});

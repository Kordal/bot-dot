// A secret a bot asks to save in the Vault (`vault-save`, ADR 153), on the web page: the page's own code for the cards
// (test/need-cards.js) against the ask as the server sends it (test/vault-save-ask.test.js). Every word is the
// server's, and the secret is dots until Show. Beside a secret the owner types, Show and Hide too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app } = require('./web-page');
const { page, titleOf, metaOf, buttonsOf, rowsOf, BAD } = require('./need-cards');

const ADMIN = { id: 'infra', name: 'Infra Admin', color: '#e8a33d' };
const SAVE = {
  id: 's1', kind: 'vault-save', botId: 'infra', bot: ADMIN, name: 'Qwotz prod DB', site: 'db.qwotz.example', from: 'generate',
  reason: 'The Postgres password of Qwotz prod.',
  title: 'Let Infra Admin save “Qwotz prod DB” in the Vault?',
  parts: [{ label: 'Entry', now: 'Qwotz prod DB (db.qwotz.example)' }, { label: 'Source', now: 'made by botdot' }, { label: 'Shared with', now: 'Infra Admin' }],
  secret: { label: 'Secret', show: 'Show', hide: 'Hide' },
  yes: 'Save', yesOn: 'card', text: 'Asks to save “Qwotz prod DB” in the Vault', at: '2026-11-04T21:00:00.000Z',
};
const draw = (ask) => { const p = page({ state: { asks: [ask] } }); return p.needCardHTML(p.item(`ask:${ask.id}`)); };

test("web: the card is the server's title, the reason, its rows, the secret as dots with Show, and Decline / Save", () => {
  const html = draw(SAVE);
  assert.equal(titleOf(html), 'Let Infra Admin save “Qwotz prod DB” in the Vault?');
  assert.equal(metaOf(html), 'The Postgres password of Qwotz prod.');
  assert.deepEqual(rowsOf(html), [['Entry', 'Qwotz prod DB (db.qwotz.example)'], ['Source', 'made by botdot'], ['Shared with', 'Infra Admin']]);
  assert.match(html, /<span class="need-secret-label">Secret<\/span><code class="mono" data-need-secret>••••••••<\/code><button type="button" class="btn sm ghost" data-need-show data-show="Show" data-hide="Hide">Show<\/button>/);
  assert.deepEqual(buttonsOf(html).filter((b) => b !== 'Show'), ['Decline', 'Save']);
});

test('web: what a bot wrote on the card is text', () => {
  const html = draw({ ...SAVE, reason: BAD, title: BAD, parts: [{ label: BAD, now: BAD }], secret: { label: BAD, show: BAD, hide: BAD }, yes: BAD });
  assert.doesNotMatch(html, /<img|<script/);
});

test('web: Show reads the secret from the server only when pressed, and Hide puts the dots back', () => {
  assert.match(app, /async function toggleSecret\(x, button, el\) \{[\s\S]*?api\(`\/asks\/\$\{encodeURIComponent\(x\.a\.id\)\}\/secret`\)/);
  assert.match(app, /if \(show\) show\.onclick = \(\) => toggleSecret\(x, show, el\);/);
});

test('web: a secret the owner types has Show and Hide beside it, in the Vault and in the "needs a login" dialog', () => {
  const vault = fs.readFileSync(path.join(__dirname, '..', 'public', 'vault.js'), 'utf8');
  assert.equal((vault.match(/\$\{revealButton\(\)\}<\/span><\/label>/g) || []).length, 2, 'the line and the box of several lines');
  assert.match(vault, /field\.type = shown \? 'text' : 'password'/);
  assert.match(vault, /field\.classList\.toggle\('masked', !shown\)/);
});

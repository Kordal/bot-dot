// A Vault entry a bot asks to remove (`vault-remove`, #132), on the web page: the page's own code for the cards
// (test/need-cards.js) against the ask as the server sends it (test/vault-remove-ask.test.js). Every word on the card
// is the server's: its title, the bot's reason, the entry, the bot and Bitwarden's Trash as rows, and its yes button.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./web-page');
const { page, titleOf, metaOf, buttonsOf, rowsOf, BAD } = require('./need-cards');

const ADMIN = { id: 'vps', name: 'VPS Admin', color: '#4a7fd8' };
const REMOVE = {
  id: 'r1', kind: 'vault-remove', botId: 'vps', bot: ADMIN, itemId: 'i1', loginName: 'Uptime Kuma netcup API key', site: 'api.netcup.example',
  reason: 'Uptime Kuma is gone, so its key is not needed any more.',
  title: 'Let VPS Admin remove “Uptime Kuma netcup API key” from the Vault?',
  parts: [{ label: 'Entry', now: 'Uptime Kuma netcup API key (api.netcup.example)' }, { label: 'Asked by', now: 'VPS Admin' }, { label: 'Goes to', now: "Bitwarden's Trash, where you can restore it for 30 days" }],
  yes: 'Allow', yesOn: 'card', text: 'Asks to remove “Uptime Kuma netcup API key” from the Vault', at: '2026-10-19T15:00:00.000Z',
};
const draw = (ask) => { const p = page({ state: { asks: [ask] } }); return p.needCardHTML(p.item(`ask:${ask.id}`)); };

test("web: the card is the server's title, the reason, the entry, the bot and the Trash as rows, and Decline / Allow", () => {
  const html = draw(REMOVE);
  assert.equal(titleOf(html), 'Let VPS Admin remove “Uptime Kuma netcup API key” from the Vault?');
  assert.equal(metaOf(html), 'Uptime Kuma is gone, so its key is not needed any more.');
  assert.deepEqual(rowsOf(html), [['Entry', 'Uptime Kuma netcup API key (api.netcup.example)'], ['Asked by', 'VPS Admin'], ['Goes to', 'Bitwarden&#39;s Trash, where you can restore it for 30 days']], 'as the HTML has it');
  assert.deepEqual(buttonsOf(html), ['Decline', 'Allow']);
  assert.doesNotMatch(html, /Install|skill|⚠️/);
});

test('web: what a bot wrote on the card is text', () => {
  const html = draw({ ...REMOVE, reason: BAD, title: BAD, parts: [{ label: BAD, now: BAD }], yes: BAD });
  assert.doesNotMatch(html, /<img|<script/);
});

test('web: the page asks for these cards wherever it reads the asks', () => {
  assert.match(app, /api\('\/asks\?vault-switch=1&vault-remove=1&vault-file=1&override=1&chief-action=1&room-tool=1&room-post=1&computer-step=1'\)/);
});

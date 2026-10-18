// A switch of a saved login that a bot asks for (`vault-switch`), on the web page: the page's own code for the cards
// (test/need-cards.js) against the ask as the server sends it (test/vault-switch-ask.test.js). Every word on the card
// is the server's: its title, the reason under it, the login and the switch as rows, the warning of "Usable in its
// computer", and its yes button. Words a bot wrote are text, never markup.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./web-page');
const { page, titleOf, metaOf, buttonsOf, rowsOf, BAD } = require('./need-cards');

const ADMIN = { id: 'pve', name: 'Proxmox Admin', color: '#4a7fd8' };
const TLS = {
  id: 'v1', kind: 'vault-switch', botId: 'pve', bot: ADMIN, loginId: 'l1', loginName: 'Proxmox read-only API token', site: 'pve.example.ts.net', vaultSwitch: 'insecureTls',
  reason: 'Proxmox has a self-signed certificate, so I could not check its VMs.',
  title: 'Let Proxmox Admin accept a self-signed certificate for “Proxmox read-only API token”?',
  parts: [{ label: 'Login', now: 'Proxmox read-only API token (pve.example.ts.net)' }, { label: 'Switch', now: 'Accept self-signed certificate' }, { label: 'Only for', now: 'this login, for every bot it is shared with' }],
  yes: 'Allow', yesOn: 'card', text: 'Asks to turn on “Accept self-signed certificate” for “Proxmox read-only API token”', at: '2026-10-18T19:31:00.000Z',
};
const IN_COMPUTER = { ...TLS, id: 'v2', vaultSwitch: 'inComputer', title: 'Let Proxmox Admin use “Proton Bridge” in its computer?', warning: "Proxmox Admin's commands will be able to read this secret. Only for a secret that guards something on its own computer." };
const draw = (ask) => { const p = page({ state: { asks: [ask] } }); return p.needCardHTML(p.item(`ask:${ask.id}`)); };

test('web: the card is the server\'s title, the reason, the login and the switch as rows, and Decline / Allow', () => {
  const html = draw(TLS);
  assert.equal(titleOf(html), 'Let Proxmox Admin accept a self-signed certificate for “Proxmox read-only API token”?');
  assert.equal(metaOf(html), 'Proxmox has a self-signed certificate, so I could not check its VMs.');
  assert.deepEqual(rowsOf(html), [['Login', 'Proxmox read-only API token (pve.example.ts.net)'], ['Switch', 'Accept self-signed certificate'], ['Only for', 'this login, for every bot it is shared with']]);
  assert.deepEqual(buttonsOf(html), ['Decline', 'Allow']);
  assert.doesNotMatch(html, /Install|skill|⚠️/);
});

test('web: "Usable in its computer" shows the warning that its commands can read the secret', () => {
  const html = draw(IN_COMPUTER);
  assert.match(html, /<div class="need-body need-warn" role="note"><div class="nb">⚠️ Proxmox Admin&#39;s commands will be able to read this secret\./);
});

test('web: what a bot or the owner wrote on the card is text', () => {
  const html = draw({ ...IN_COMPUTER, reason: BAD, title: BAD, parts: [{ label: BAD, now: BAD }], warning: BAD, yes: BAD });
  assert.doesNotMatch(html, /<img|<script/);
});

test('web: the page asks for these cards wherever it reads the asks', () => {
  assert.match(app, /api\('\/asks\?vault-switch=1'\)/);
  assert.doesNotMatch(app, /api\('\/asks'\)/, 'every list of asks the page reads has them');
});

// Writes test/fixtures/push-seals.json: seals made by the server's own code (lib/apns.js relayRequest of what lib/push.js
// makes of feed events), which the iOS app's tests open and the shared layer's tests read. node scripts/push-seals.js > test/fixtures/push-seals.json
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const apns = require(path.join(root, 'lib/apns'));
const push = require(path.join(root, 'lib/push'));
const key = crypto.randomBytes(32).toString('base64url');
const token = 'a1'.repeat(32);
const ev = (type, data, lang = 'en', extra = {}) => push.follower({ rung: new Set(), chiefName: () => 'Ada', language: () => lang }).take({ type, data, ...extra }).notices[0];
const cases = [
  ['a bot\'s reply: Reply, a tap opens its chat', ev('run_finished', { botId: 'b1', botName: 'News', status: 'success', result: '## Today\nFound **3** articles.', new: true }), 'chat'],
  ['a Chief reply in Polish', ev('chief_reply', { chatId: 'c1', status: 'success', text: 'Zarezerwowane. Lot o 7:40 ✈️', new: true }, 'pl'), 'chat'],
  ['a question in a group', ev('group_run_finished', { groupId: 'g1', botName: 'Coder', status: 'success', result: 'r', asks: true, title: 'Coder asks', question: 'Ship it?', notify: true }), 'chat'],
  ['a job that waits: Decline and Approve, a tap opens Needs you', ev('approvals', { jobs: [{ botId: 'b1', botName: 'News', jobId: 'j1', jobName: 'Digest', text: 'Wants to run “Digest” every morning', no: 'Decline and remove' }] }), 'needs'],
  ['an ask whose yes is on its card, asked in a group: Decline alone, a tap opens the group', ev('asks', { waiting: 1, list: [{ id: 'a1', kind: 'connector-action', botName: 'Scout', text: 'Wants to send email with Gmail', yesOn: 'card', groupId: 'g2', groupName: 'Dev' }] }), 'chat'],
  ['a card of several: no buttons, a long tag', ev('asks', { waiting: 2, list: [{ id: 'a2', kind: 'permission', botName: 'Scout', text: 'Asks to browse the web', batch: { id: `run-${'x'.repeat(70)}`, title: 'Scout wants 2 things' } }] }), 'needs'],
  ['a bot\'s plan for the Chief', ev('chief_suggestion', { chatId: 'c2', title: 'A digest', from: { id: 'b1', name: 'News' } }), 'chat'],
  ['Claude signed out: no buttons, a tap opens the app', ev('claude', { loggedIn: false }), 'app'],
].map(([what, n, opens]) => {
  const req = apns.relayRequest({ token, environment: 'development', key }, n);
  const payload = apns.open(req.sealed, key);
  return { what, sealed: req.sealed, collapseId: req.collapseId, threadId: req.threadId ?? null, payload, opens };
});
const bad = Buffer.from(cases[0].sealed, 'base64url');
bad[20] ^= 1;
const out = {
  about: 'Seals made by the server (lib/apns.js relayRequest of what lib/push.js makes of feed events), for the iOS app to open: base64url of version 1 | 12-byte nonce | AES-256-GCM ciphertext | 16-byte tag, the version byte as additional data. `opens`: what a tap opens (chat, needs or app). Made by scripts/push-seals.js; test/push-apns.test.js checks every seal opens to its payload.',
  seed: key, // the device's 32 bytes, made up here: named so secret scanners don't read a made-up value as a key
  cases,
  refused: [
    { what: 'one byte changed', sealed: bad.toString('base64url') },
    { what: 'another version', sealed: Buffer.concat([Buffer.from([2]), Buffer.from(cases[0].sealed, 'base64url').subarray(1)]).toString('base64url') },
    { what: 'too short', sealed: Buffer.from([1, 2, 3]).toString('base64url') },
  ],
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);

// What waits in a Chief chat (BUSY-002, ADR 011), where no request reaches it: a chat can be deleted only while no
// reply is going in it, and what waits there starts the moment the reply ends. So this file loads lib/chief.js
// itself, on a scratch data folder in which a message of the owner and a turn of botdot's wait for a chat, as
// botdot would find them when it starts: a deleted chat takes the owner's waiting messages with it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-chief-waits-'));
const data = path.join(dir, 'data');
const out = path.join(dir, 'fake');
for (const d of [data, out, path.join(dir, 'home'), path.join(data, 'chief')]) fs.mkdirSync(d, { recursive: true });
Object.assign(process.env, {
  BOT_DOT_DATA: data, BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'),
});

const now = new Date().toISOString();
const later = new Date(Date.now() + 1000).toISOString(); // when the waiting messages were sent
const chat = (id, title) => ({ id, title, sessionId: null, createdAt: now, updatedAt: now, costUsd: 0, messages: [{ role: 'user', text: 'Hello', at: now }, { role: 'chief', text: 'Hi.', at: now }] });
const mine = (id, text) => ({ owner: true, id, text, attachments: [], key: `${id}-key-0001`, at: later });
const botdots = { prompt: 'botdot writes this, not the user: nobody typed it.', message: null, otherwise: 'Alpha can browse the web now.', title: null, at: now };
for (const c of [chat('leaving', 'Leaving'), chat('staying', 'Staying')]) fs.writeFileSync(path.join(data, 'chief', `${c.id}.json`), JSON.stringify(c));
const waitingFile = path.join(data, 'chief-waiting-turns.json');
fs.writeFileSync(waitingFile, JSON.stringify({ leaving: [botdots, mine('w1', 'First'), mine('w2', 'Second')], staying: [mine('w3', 'Third')] }));

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const chief = require('../lib/chief');

after(() => { chief.stopAll(); fs.rmSync(dir, { recursive: true, force: true }); });
const onDisk = () => JSON.parse(fs.readFileSync(waitingFile, 'utf8'));

test("what waits is read from the file: a chat lists the owner's messages, oldest first, and not botdot's turns", () => {
  assert.deepEqual(chief.queuedOf('leaving'), [{ id: 'w1', text: 'First', attachments: [], at: later }, { id: 'w2', text: 'Second', attachments: [], at: later }]);
  assert.deepEqual(chief.queuedOf('staying').map((q) => q.id), ['w3']);
  assert.deepEqual(chief.queuedOf('no-such-chat'), []);
  assert.deepEqual([chief.ownerWaits('leaving'), chief.ownerWaits('no-such-chat'), chief.ownerWaits(null)], [true, false, false]);
  // A message that waits counts as written from when it was sent (ADR 011), for the rules of ADR 009.
  assert.equal(chief.chatToTell('staying').wroteAt, later);
});

test('take back answers the message with its key, once, and tells whoever waits nothing started', () => {
  assert.deepEqual(chief.takeBack('leaving', 'w2'), { text: 'Second', attachments: [], key: 'w2-key-0001' });
  assert.equal(chief.takeBack('leaving', 'w2'), null);
  assert.equal(chief.takeBack('staying', 'w1'), null, "another chat's message is not this chat's");
  assert.equal(chief.startedFrom('leaving', 'w2'), false, 'it never started');
  assert.deepEqual(onDisk().leaving.map((w) => w.id || 'botdot'), ['botdot', 'w1']);
});

test("a chat that is deleted takes the owner's waiting messages with it; what botdot had to tell stays, and the other chat's stays", () => {
  assert.equal(chief.deleteChat('leaving'), true);
  assert.deepEqual(chief.queuedOf('leaving'), []);
  assert.deepEqual(onDisk(), { leaving: [botdots], staying: [mine('w3', 'Third')] });
  assert.equal(chief.deleteChat('leaving'), false);
});

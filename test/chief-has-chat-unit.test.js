// #1109: every tool call of the Chief names its chat (X-Chief-Chat), and botdot checks that the chat exists. It does
// so without reading the chat, which for a long one is megabytes of JSON parsed on the server's one thread.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-chief-has-'));
const data = path.join(dir, 'data');
for (const d of [data, path.join(dir, 'home'), path.join(data, 'chief')]) fs.mkdirSync(d, { recursive: true });
Object.assign(process.env, {
  BOT_DOT_DATA: data, BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), HOME: path.join(dir, 'home'),
});
const now = new Date().toISOString();
fs.writeFileSync(path.join(data, 'chief', 'long.json'), JSON.stringify({ id: 'long', title: 'Long', createdAt: now, updatedAt: now, messages: [] }));

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const chief = require('../lib/chief');
const realFs = require('fs');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a chat is found without reading it', () => {
  const read = realFs.readFileSync;
  let reads = 0;
  realFs.readFileSync = function (...args) { if (String(args[0]).includes(`${path.sep}chief${path.sep}`)) reads++; return read.apply(this, args); };
  try {
    assert.equal(chief.hasChat('long'), true);
    assert.equal(chief.hasChat('gone'), false);
    assert.equal(chief.hasChat('../long'), false);
    assert.equal(chief.hasChat(undefined), false);
  } finally { realFs.readFileSync = read; }
  assert.equal(reads, 0, 'no chat file was read');
});

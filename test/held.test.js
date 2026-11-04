// What holds up the server is said in the log (lib/held.js): a slow synchronous call with what it was and who
// asked, a held event loop with the slow calls inside it, and memory.db's statements timed like the broker's calls.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const held = require('../lib/held');

const block = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* hold the loop */ } };
const lines = [];
held._setLog((line) => lines.push(line));
afterEach(() => { lines.length = 0; delete process.env.BOT_DOT_SLOW_SYNC_MS; delete process.env.BOT_DOT_LAG_WARN_MS; });

test('a slow call is logged with its label and its caller; a fast one is not', () => {
  process.env.BOT_DOT_SLOW_SYNC_MS = '30';
  assert.equal(held.time('quick thing', () => 7), 7);
  held.time(() => 'broker files readFileSync of b1 x/pages.json', () => block(40));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[held\] \d+ ms broker files readFileSync of b1 x\/pages\.json from .*held\.test\.js:\d+/);
});

test('a call that throws is still timed, and its error goes on', () => {
  process.env.BOT_DOT_SLOW_SYNC_MS = '20';
  assert.throws(() => held.time('failing', () => { block(25); throw new Error('no'); }), /no/);
  assert.match(lines[0], /\[held\] \d+ ms failing/);
});

test('0 turns the slow-call log off', () => {
  process.env.BOT_DOT_SLOW_SYNC_MS = '0';
  held.time('slow', () => block(30));
  assert.deepEqual(lines, []);
});

test('a held event loop is logged with the slow calls inside it and the last request', async () => {
  process.env.BOT_DOT_SLOW_SYNC_MS = '0';
  process.env.BOT_DOT_LAG_WARN_MS = '100';
  const stop = held.watch({ every: 20 });
  try {
    await new Promise((r) => setTimeout(r, 50));
    held.request('GET', '/api/health?x=1');
    held.time('broker prepare of b1', () => block(200));
    await new Promise((r) => setTimeout(r, 60));
  } finally { stop(); }
  const lag = lines.find((l) => l.startsWith('[lag]'));
  assert.ok(lag, lines.join('\n'));
  assert.match(lag, /event loop held \d+ ms; slow calls then: broker prepare of b1 \d+ ms; last request GET \/api\/health, \d+ ms ago/);
});

test('memory.db statements and exec are timed and still work as before', () => {
  process.env.BOT_DOT_SLOW_SYNC_MS = '0';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'held-'));
  const db = held.sqlite(new DatabaseSync(path.join(dir, 'm.db')), 'memory.db');
  try {
    db.exec('CREATE TABLE t (a INTEGER)');
    const insert = db.prepare('INSERT INTO t (a) VALUES (?)');
    assert.equal(insert.run(5).changes, 1);
    assert.deepEqual({ ...db.prepare('SELECT a FROM t').get() }, { a: 5 });
    assert.equal(db.prepare('SELECT a FROM t').all().length, 1);
    assert.equal(typeof insert.sourceSQL, 'string');
    process.env.BOT_DOT_SLOW_SYNC_MS = '1';
    db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000000) SELECT count(*) FROM n`);
    assert.match(lines.at(-1) || '', /\[held\] \d+ ms memory\.db WITH RECURSIVE n\(i\)/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a broker call is logged with its operation, whose and its file, from the code that asked for it', () => {
  process.env.BOT_DOT_SLOW_SYNC_MS = '1';
  const { callSync } = require('../lib/privilege-client');
  const socket = process.env.BOT_DOT_PRIVILEGE_SOCKET;
  delete process.env.BOT_DOT_PRIVILEGE_SOCKET; // no broker: the call fails, after the same node start
  try {
    assert.throws(() => callSync('files', { principal: 'b1', request: { op: 'readFileSync', args: ['/data/workspaces/b1/site/pages.json'] } }));
  } finally { if (socket !== undefined) process.env.BOT_DOT_PRIVILEGE_SOCKET = socket; }
  assert.match(lines.at(-1) || '', /^\[held\] \d+ ms broker files readFileSync of b1 b1\/site\/pages\.json from [^ ]*held\.test\.js:\d+/);
});

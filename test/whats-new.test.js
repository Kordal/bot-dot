// What's new (#219): the notes in whats-new/ (a title and 2 to 4 points each), shown once per account after an update
// that brings one, newest first and at most 3; a new account and a server that just got What's new have seen all.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, ROOT } = require('./helpers');
const whatsNew = require('../lib/whats-new');

const NOTES = path.join(ROOT, 'whats-new');
const note = (title, n = 3) => `${title}\n${Array.from({ length: n }, (_, i) => `- Point ${i + 1}`).join('\n')}\n`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whats-new-'));
const write = (dir, id, text = note(`Note ${id}`)) => fs.writeFileSync(path.join(dir, `${id}.md`), text);

test("every note in whats-new/ has a title and 2 to 4 points, and a name that is its id", () => {
  const files = fs.readdirSync(NOTES).filter((f) => f !== 'README.md');
  assert.ok(files.length > 0, 'whats-new/ has notes');
  for (const f of files) {
    assert.match(f, /\.md$/, `${f} is a .md note`);
    assert.match(f.slice(0, -3), whatsNew.ID, `${f} is named YYYY-MM-DD-short-name.md`);
  }
  for (const n of whatsNew.read(NOTES)) assert.equal(n.error, undefined, `whats-new/${n.id}.md ${n.error}`);
});

test('whats-new/ goes into the image (.dockerignore is an allowlist)', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('!whats-new/'), '.dockerignore lets whats-new/ through');
});

test('a note with no title, 1 point or 5 points is refused; a good one reads as plain text', () => {
  assert.match(whatsNew.parse('').error, /no title/);
  assert.match(whatsNew.parse('- Point 1\n- Point 2').error, /no title/);
  assert.match(whatsNew.parse(note('Title', 1)).error, /1 points/);
  assert.match(whatsNew.parse(note('Title', 5)).error, /5 points/);
  assert.match(whatsNew.parse('Title\n- One\nstray line\n- Two').error, /no point/);
  assert.match(whatsNew.parse(`${'x'.repeat(81)}\n- a\n- b`).error, /title over/);
  assert.deepEqual(whatsNew.parse('# Faster replies\r\n\r\n- One <b>bold</b>\n-  Two  \n'), { title: 'Faster replies', points: ['One <b>bold</b>', 'Two'] });
});

test('unseen notes: none at first, then the new ones newest first and at most 3, until seen', () => {
  const dir = tmp(), dataDir = tmp();
  write(dir, '2026-10-01-old');
  fs.writeFileSync(path.join(dir, 'README.md'), 'not a note');
  const w = whatsNew.create({ dir, dataDir });
  for (const d of ['02', '03', '04', '05', '06']) write(dir, `2026-10-${d}-new`); // nobody asked before the update
  assert.deepEqual(whatsNew.create({ dir: tmp(), dataDir: tmp() }).unseen(), [], 'a new account has seen the notes up to now');
  write(dir, '2026-10-07-broken', note('Broken', 5));
  assert.deepEqual(w.unseen().map((n) => n.id), ['2026-10-06-new', '2026-10-05-new', '2026-10-04-new']);
  assert.deepEqual(w.unseen()[0], { id: '2026-10-06-new', title: 'Note 2026-10-06-new', points: ['Point 1', 'Point 2', 'Point 3'] });
  w.seen('2026-10-06-new');
  assert.deepEqual(w.unseen(), []);
  w.seen('2026-10-02-new');
  assert.deepEqual(w.unseen(), [], 'an older id never takes it back');
  assert.throws(() => w.seen('../etc'), /which note/);
  assert.throws(() => w.seen('2099-01-01-future'), /which note/, 'only a note there is');
});

test('with no notes yet, the first note that comes shows', () => {
  const dir = tmp(), dataDir = tmp();
  const w = whatsNew.create({ dir, dataDir });
  assert.deepEqual(w.unseen(), []);
  write(dir, '2026-10-21-first');
  assert.deepEqual(w.unseen().map((n) => n.id), ['2026-10-21-first']);
});

test('the routes: GET /api/whats-new shows a new note once it came, POST /api/whats-new/seen ends it, for every app', async () => {
  const notes = tmp();
  write(notes, '2026-10-20-before');
  const env = { BOT_DOT_WHATS_NEW_DIR: notes };
  let srv = await startServer({ env });
  try {
    assert.ok((await srv.api('/version')).data.features.includes('whats-new'));
    assert.deepEqual((await srv.api('/whats-new')).data, { entries: [] }, 'the notes before count as seen');
    write(notes, '2026-10-21-example', note('Example', 3)); // an update brought it
    const r = await srv.api('/whats-new');
    assert.deepEqual(r.data, { entries: [{ id: '2026-10-21-example', title: 'Example', points: ['Point 1', 'Point 2', 'Point 3'] }] });
    assert.equal((await srv.api('/whats-new/seen', { method: 'POST', body: { id: 'nonsense' } })).status, 400);
    assert.deepEqual((await srv.api('/whats-new/seen', { method: 'POST', body: { id: '2026-10-21-example' } })).data, { ok: true });
    assert.deepEqual((await srv.api('/whats-new')).data, { entries: [] }, 'the other app sees it gone too');
    await srv.stop();
    srv = await startServer({ dir: srv.dir, env });
    assert.deepEqual((await srv.api('/whats-new')).data, { entries: [] }, 'kept after a restart');
  } finally { await srv.stop(); }
});

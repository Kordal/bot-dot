// A note can name a website (ADR 274): `site` is a plain host, saved normalised, and the notes for the page a bot
// opened are those of the bot and the shared ones whose site is that host or a parent domain.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { scratchMemory } = require('./memory-helpers');
const { SHARED, SCHEMA_VERSION } = require('../lib/memory');
const sites = require('../lib/site-notes');

test('a site is a plain host: no scheme, no www., lower case; anything else is rejected', () => {
  assert.equal(sites.normalize('energa.pl'), 'energa.pl');
  assert.equal(sites.normalize('  WWW.Energa.PL '), 'energa.pl');
  assert.equal(sites.normalize('https://www.energa.pl/'), 'energa.pl');
  assert.equal(sites.normalize('http://login.energa.pl'), 'login.energa.pl');
  assert.equal(sites.normalize('localhost'), 'localhost');
  assert.equal(sites.normalize(''), '', 'nothing is no site');
  assert.equal(sites.normalize(undefined), '');
  for (const bad of ['energa', 'energa.pl/login', 'energa.pl?x=1', 'energa.pl:8080', 'user@energa.pl', 'ener ga.pl', '*.energa.pl', 'energa..pl', '-energa.pl', 'energa.pl-', 'www.', 'the energa site', 'a'.repeat(64) + '.pl', `${'a.'.repeat(130)}pl`, 42, {}, ['energa.pl']]) {
    assert.throws(() => sites.normalize(bad), /host/i, `${JSON.stringify(bad)} is not a plain host`);
  }
});

test('a page matches its own host and its parent domains, never a subdomain below it', () => {
  assert.deepEqual(sites.candidates('login.energa.pl'), ['login.energa.pl', 'energa.pl']);
  assert.deepEqual(sites.candidates('a.b.energa.pl'), ['a.b.energa.pl', 'b.energa.pl', 'energa.pl']);
  assert.deepEqual(sites.candidates('energa.pl'), ['energa.pl']);
  assert.deepEqual(sites.candidates('localhost'), ['localhost']);
  assert.deepEqual(sites.candidates(''), []);
});

test("the page's host is read from the first line of a snapshot", () => {
  assert.equal(sites.pageHost('Page: Energa (https://www.energa.pl/klient)\n- heading "Hi"'), 'energa.pl');
  assert.equal(sites.pageHost('Page: Login (https://Login.Energa.pl:8443/x?y=1)\n- button'), 'login.energa.pl');
  assert.equal(sites.pageHost('Page: Blank (about:blank)\n'), '');
  assert.equal(sites.pageHost('Page: Local (http://localhost:3000/)'), 'localhost');
  assert.equal(sites.pageHost('Page: IP (http://127.0.0.1/)'), '', 'an address is not a website a note names');
  assert.equal(sites.pageHost(''), '');
  assert.equal(sites.pageHost(undefined), '');
  assert.equal(sites.pageHost('Page: Blank (about:blank)\n- text: see (https://evil.example/)'), '', 'only the first line says where the page is');
  assert.equal(sites.pageHost('Page: Foo (bar) - Wikipedia (https://en.wikipedia.org/wiki/Foo_(bar))\n- heading'), 'en.wikipedia.org', 'a ) in the path');
  assert.equal(sites.pageHost('Page: Search (https://www.energa.pl/s?q=a)b)\n- x'), 'energa.pl', 'a ) in the query');
  assert.equal(sites.pageHost('Page: Using (https://evil.example/) in text (https://www.energa.pl/klient)\n- x'), 'energa.pl', 'a title with (http text: the last address is the page');
  assert.equal(sites.pageHost('Page: Odd (https://not a url)'), '', 'an address that does not parse');
});

test('a note keeps its site, in its view and in its history, and the site changes with update_memory', (t) => {
  const { memory: m } = scratchMemory(t);
  const added = m.addNote('alpha', 'The cookie banner must be closed first.', { site: 'https://www.Energa.pl/' });
  assert.equal(added.note.site, 'energa.pl');
  assert.equal(m.addNote('alpha', 'No site on this one.').note.site, undefined);
  assert.throws(() => m.addNote('alpha', 'Bad host.', { site: 'energa.pl/login' }), /host/);
  assert.equal(m.notesOf('alpha').length, 2, 'a rejected site saves nothing');

  const id = added.note.id;
  assert.equal(m.changeNote('alpha', id, 'Close the cookie banner first, then log in.').note.site, 'energa.pl', 'left out, the site stays');
  assert.equal(m.changeNote('alpha', id, 'Close the cookie banner first, then log in.', { site: 'login.energa.pl' }).note.site, 'login.energa.pl');
  assert.equal(m.history(id)[0].site, 'energa.pl', 'the version it replaced keeps the site it had');
  assert.throws(() => m.changeNote('alpha', id, 'x', { site: 'not a host' }), /host/);
  assert.equal(m.changeNote('alpha', id, 'Close the cookie banner first, then log in.', { site: '' }).note.site, undefined, '"" takes the site away');
  assert.equal(m.history(id)[0].site, 'login.energa.pl');

  // Bringing an earlier version back brings its site back.
  const back = m.restore(m.history(id)[1].vid, { by: 'you' });
  assert.equal(back.site, 'energa.pl');
});

test('a removed note, and a note that comes back, keep the site they had', (t) => {
  const { memory: m } = scratchMemory(t);
  const n = m.addNote('alpha', 'Invoices are under Documents.', { site: 'energa.pl' }).note;
  m.removeNote('alpha', n.id, { by: 'you' });
  assert.deepEqual(m.siteNotes({ botId: 'alpha', host: 'energa.pl' }), []);
  const gone = m.removedNote(n.id);
  const back = m.restoreNote(gone.vid, { by: 'you' }).note;
  assert.equal(back.site, 'energa.pl');
  assert.deepEqual(m.siteNotes({ botId: 'alpha', host: 'energa.pl' }).map((x) => x.id), [back.id]);
});

test('login.energa.pl gets the notes of energa.pl, and energa.pl does not get those of login.energa.pl', (t) => {
  const { memory: m } = scratchMemory(t);
  const root = m.addNote('alpha', 'The invoices are under Documents.', { site: 'energa.pl' }).note;
  const login = m.addNote('alpha', 'The login button is top right.', { site: 'login.energa.pl' }).note;
  m.addNote('alpha', 'Another website entirely.', { site: 'tauron.pl' });
  m.addNote('alpha', 'A lookalike host: not a parent.', { site: 'nenerga.pl' });
  m.addNote('alpha', 'No site at all.');
  const ids = (host) => m.siteNotes({ botId: 'alpha', host }).map((n) => n.id).sort();
  assert.deepEqual(ids('login.energa.pl'), [root.id, login.id].sort());
  assert.deepEqual(ids('energa.pl'), [root.id]);
  assert.deepEqual(ids('moje.energa.pl'), [root.id]);
  assert.deepEqual(ids('notenerga.pl'), []);
  assert.deepEqual(ids('example.com'), []);
  assert.deepEqual(ids(''), []);
});

test("the shared notes of a site arrive too; another bot's own notes never do", (t) => {
  const { memory: m } = scratchMemory(t);
  const mine = m.addNote('alpha', 'Mine about the site.', { site: 'energa.pl' }).note;
  const shared = m.addNote(SHARED, 'Shared about the site.', { site: 'energa.pl' }).note;
  m.addNote('beta', "Beta's own note about the site.", { site: 'energa.pl' });
  m.addNote('_chief', "The Chief's own note about the site.", { site: 'energa.pl' });
  assert.deepEqual(m.siteNotes({ botId: 'alpha', host: 'energa.pl' }).map((n) => n.id).sort(), [mine.id, shared.id].sort());
  assert.deepEqual(m.siteNotes({ botId: 'gamma', host: 'energa.pl' }).map((n) => n.id), [shared.id], 'a bot with none of its own gets the shared ones');
});

test('at most five notes, pinned first, then the newest first', (t) => {
  const { memory: m } = scratchMemory(t);
  const make = (text, opts = {}) => m.addNote('alpha', text, { site: 'energa.pl', ...opts }).note;
  const loose = [1, 2, 3, 4, 5].map((i) => make(`Loose note number ${i}.`, { pinned: false }));
  const pinnedOld = make('A pinned note, saved before the others were touched.', { pinned: true });
  const tick = (ms) => { const end = Date.now() + ms; while (Date.now() < end); };
  tick(5);
  m.changeNote('alpha', loose[0].id, 'Loose note number 1, said again later.'); // the newest of the loose ones
  const got = m.siteNotes({ botId: 'alpha', host: 'energa.pl' });
  assert.equal(got.length, 5, 'the cap');
  assert.equal(got[0].id, pinnedOld.id, 'a pinned note stands first');
  assert.equal(got[1].id, loose[0].id, 'then the newest');
  assert.deepEqual(got.slice(2).map((n) => n.id), [loose[4].id, loose[3].id, loose[2].id], 'then the rest, newest first');
  assert.equal(m.siteNotes({ botId: 'alpha', host: 'energa.pl', limit: 2 }).length, 2);
});

test('a forgotten note, a removed note and a passed end never arrive', (t) => {
  const { memory: m } = scratchMemory(t);
  const keep = m.addNote('alpha', 'Kept.', { site: 'energa.pl' }).note;
  const forgotten = m.addNote('alpha', 'To forget.', { site: 'energa.pl' }).note;
  const removed = m.addNote('alpha', 'To remove.', { site: 'energa.pl' }).note;
  const over = m.addNote('alpha', 'A passing state about the site.', { site: 'energa.pl', until: '2999-01-01' }).note;
  assert.equal(m.siteNotes({ botId: 'alpha', host: 'energa.pl' }).length, 4);
  m.erase({ notes: [forgotten.id] });
  m.removeNote('alpha', removed.id, { by: 'you' });
  m.endPast('3000-01-01');
  assert.deepEqual(m.siteNotes({ botId: 'alpha', host: 'energa.pl' }).map((n) => n.id), [keep.id]);
  assert.ok(over.id);
});

test('a note from another project is left out when a project is given', (t) => {
  const { memory: m } = scratchMemory(t);
  const open = m.addNote('alpha', 'Open about the site.', { site: 'energa.pl' }).note;
  m.addNote('alpha', 'Of the homelab project.', { site: 'energa.pl', project: 'homelab' });
  const ofHere = m.addNote('alpha', 'Of the qwotz project.', { site: 'energa.pl', project: 'qwotz' }).note;
  assert.equal(m.siteNotes({ botId: 'alpha', host: 'energa.pl' }).length, 3, 'in no team chat every note is handed');
  assert.deepEqual(m.siteNotes({ botId: 'alpha', host: 'energa.pl', project: 'qwotz' }).map((n) => n.id).sort(), [open.id, ofHere.id].sort());
});

test('a waiting change keeps the site it would save', (t) => {
  const { memory: m } = scratchMemory(t);
  const p = m.propose({ action: 'add', owner: SHARED, text: 'Shared, after outside content.', source: 'outside', site: 'WWW.Energa.pl' });
  assert.equal(p.site, 'energa.pl');
  assert.equal(m.settle(p.id, true).note.site, 'energa.pl');
  const n = m.addNote(SHARED, 'A shared note to change.', { site: 'tauron.pl' }).note;
  const e = m.propose({ action: 'edit', owner: SHARED, noteId: n.id, text: 'A shared note, changed.', site: 'energa.pl', guarded: true });
  assert.equal(m.settle(e.id, true).note.site, 'energa.pl');
  assert.throws(() => m.propose({ action: 'add', owner: SHARED, text: 'x', site: 'a b' }), /host/);
});

test('the same sentence said again with a site names the site on a note that had none', (t) => {
  const { memory: m } = scratchMemory(t);
  const first = m.addNote('alpha', 'Close the banner first.').note;
  const again = m.addNote('alpha', 'Close the banner first.', { site: 'energa.pl' });
  assert.equal(again.duplicate, true);
  assert.equal(again.note.id, first.id);
  assert.equal(again.note.site, 'energa.pl');
});

test('the site is a column of notes, note_versions and pending, added to a database from before', (t) => {
  const { dir } = scratchMemory(t);
  const db = new DatabaseSync(path.join(dir, 'memory.db'));
  for (const table of ['notes', 'note_versions', 'pending']) db.exec(`ALTER TABLE ${table} DROP COLUMN site`);
  db.exec("DELETE FROM meta WHERE key = 'schema_version'");
  db.close();
  const m = require('../lib/memory').create(dir);
  assert.equal(m.getMeta('schema_version'), SCHEMA_VERSION);
  assert.ok(Number(SCHEMA_VERSION) >= 6, 'the version moved on for the new column');
  const columns = (table) => new DatabaseSync(path.join(dir, 'memory.db'), { readOnly: true }).prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const table of ['notes', 'note_versions', 'pending']) assert.equal(columns(table).filter((c) => c === 'site').length, 1, table);
  assert.equal(m.addNote('alpha', 'After the upgrade.', { site: 'energa.pl' }).note.site, 'energa.pl');
  m.setSemanticSettings({ enabled: false });
});

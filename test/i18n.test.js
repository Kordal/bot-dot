// The interface's language (#645, ADR 108): the account's setting, the Polish dictionary the apps draw their words
// with, and that every string the code passes to tr() and trn() has its Polish, with the same placeholders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer, ROOT } = require('./helpers');
const i18n = require('../lib/i18n');
const { AREAS, collect, placeholders } = require('../lib/i18n/keys');

const pl = i18n.load('pl');

test('every string of the web page, the Android app and the server has its Polish, with the same placeholders', () => {
  const problems = [];
  for (const area of Object.keys(AREAS)) {
    for (const k of collect(area)) {
      const at = `${k.file}:${k.line}`;
      if (k.bad) { problems.push(`${at}: ${k.bad} passes no literal string (a key must be the English text itself)`); continue; }
      const v = pl[k.key];
      if (v === undefined) { problems.push(`${at}: no Polish for ${JSON.stringify(k.key)} (lib/i18n/pl/${area}.json; \`node lib/i18n/keys.js ${area}\` lists them)`); continue; }
      const want = new Set([...placeholders(k.key), ...(k.plural ? [...placeholders(k.one), 'n'] : [])]);
      const forms = k.plural ? (v && typeof v === 'object' ? ['one', 'few', 'many'].map((f) => [f, v[f]]) : [['', null]]) : [['', v]];
      for (const [f, text] of forms) {
        if (typeof text !== 'string' || !text.trim()) { problems.push(`${at}: the Polish of ${JSON.stringify(k.key)}${f ? ` has no "${f}" form` : ' is empty or not a text'}`); continue; }
        for (const p of placeholders(text)) if (!want.has(p)) problems.push(`${at}: the Polish of ${JSON.stringify(k.key)} has {${p}}, which the English has not`);
        if (!k.plural) for (const p of want) if (!placeholders(text).has(p)) problems.push(`${at}: the Polish of ${JSON.stringify(k.key)} drops {${p}}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every Polish string of the web page and the Android app is used, and two areas never give one string two texts", () => {
  const used = new Set(['web', 'android'].flatMap((a) => collect(a).map((k) => k.key)));
  const problems = [];
  const seen = {};
  for (const f of fs.readdirSync(path.join(i18n.DIR, 'pl')).filter((x) => x.endsWith('.json')).sort()) {
    const table = JSON.parse(fs.readFileSync(path.join(i18n.DIR, 'pl', f), 'utf8'));
    for (const [k, v] of Object.entries(table)) {
      if (f !== 'server.json' && !used.has(k)) problems.push(`pl/${f}: ${JSON.stringify(k)} is used nowhere`);
      if (k in seen && JSON.stringify(seen[k].v) !== JSON.stringify(v)) problems.push(`pl/${f}: ${JSON.stringify(k)} differs from pl/${seen[k].f}`);
      else if (!(k in seen)) seen[k] = { f, v };
    }
  }
  assert.deepEqual(problems, []);
});

test('every Polish string of the server is one its code writes: a tr() key, or the literal of a sentence said() passes on', () => {
  const used = new Set(collect('server').map((k) => k.key));
  const { dirs, ext, skip } = AREAS.server;
  const walk = (rel) => {
    if (skip.some((x) => rel === x || rel.startsWith(`${x}/`))) return [];
    const abs = path.join(ROOT, rel);
    if (fs.statSync(abs).isFile()) return ext.includes(path.extname(rel)) ? [fs.readFileSync(abs, 'utf8')] : [];
    return fs.readdirSync(abs).flatMap((f) => walk(path.join(rel, f)));
  };
  const code = dirs.flatMap(walk).join('\n');
  const written = (k) => [JSON.stringify(k), `'${k.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`].some((lit) => code.includes(lit));
  const table = JSON.parse(fs.readFileSync(path.join(i18n.DIR, 'pl', 'server.json'), 'utf8'));
  assert.deepEqual(Object.keys(table).filter((k) => !used.has(k) && !written(k)), []);
  assert.equal(i18n.said('pl', 'Bot not found'), 'Nie znaleziono bota');
  assert.equal(i18n.said('en', 'Bot not found'), 'Bot not found');
  assert.equal(i18n.said('pl', 'Not in the dictionary'), 'Not in the dictionary');
});

test('tr() and trn(): Polish where there is one, English otherwise, placeholders filled, Polish plural forms', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'i18n-'));
  fs.mkdirSync(path.join(dir, 'pl'));
  fs.writeFileSync(path.join(dir, 'pl', 'a.json'), JSON.stringify({ Saved: 'Zapisano', '{n} bots': { one: '{n} bot', few: '{n} boty', many: '{n} botów' } }));
  assert.deepEqual(i18n.load('pl', dir), { Saved: 'Zapisano', '{n} bots': { one: '{n} bot', few: '{n} boty', many: '{n} botów' } });
  assert.equal(i18n.tr('pl', 'Saved'), 'Zapisano');
  assert.equal(i18n.tr('en', 'Saved'), 'Saved');
  assert.equal(i18n.tr('pl', 'Nothing like this {x}', { x: 1 }), 'Nothing like this 1', 'no Polish: the English, filled');
  assert.equal(i18n.tr('xx', 'Saved'), 'Saved', 'an unknown language is English');
  assert.deepEqual([1, 2, 4, 5, 12, 14, 21, 22, 25, 112, 122].map((n) => i18n.form('pl', n)), ['one', 'few', 'few', 'many', 'many', 'many', 'many', 'few', 'many', 'many', 'few']);
  assert.deepEqual([0, 1, 2].map((n) => i18n.form('en', n)), ['other', 'one', 'other']);
  assert.equal(i18n.trn('en', 1, '{n} bot', '{n} bots'), '1 bot');
  assert.equal(i18n.trn('en', 3, '{n} bot', '{n} bots'), '3 bots');
});

test('the web page draws a string in Polish from the dictionary kept in the browser, and English without one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8');
  const run = (kept) => {
    const marked = { dataset: { t: 'Settings' }, textContent: 'Settings' };
    const titled = { attrs: { title: 'Saved' }, getAttribute(a) { return this.attrs[a]; }, setAttribute(a, v) { this.attrs[a] = v; } };
    const document = {
      documentElement: {},
      querySelectorAll: (sel) => (sel === '[data-t]' ? [marked] : sel === '[data-t-title]' ? [titled] : []),
    };
    const store = { 'botdot.language': kept && JSON.stringify(kept) };
    const ctx = { document, Intl, JSON, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
    vm.runInNewContext(`${src}\nthis.out = { tr, trn, I18n };`, ctx);
    return { ...ctx.out, marked, titled, lang: document.documentElement.lang };
  };
  const p = run({ language: 'pl', strings: { Settings: 'Ustawienia', Saved: 'Zapisano', '{n} bots': { one: '{n} bot', few: '{n} boty', many: '{n} botów' } } });
  assert.equal(p.lang, 'pl');
  assert.equal(p.marked.textContent, 'Ustawienia', 'data-t is translated when the file loads');
  assert.equal(p.titled.attrs.title, 'Zapisano', 'and data-t-title');
  assert.equal(p.tr('Saved'), 'Zapisano');
  assert.equal(p.tr('Not there'), 'Not there');
  assert.deepEqual([1, 3, 5, 22].map((n) => p.trn(n, '{n} bot', '{n} bots')), ['1 bot', '3 boty', '5 botów', '22 boty']);
  assert.equal(p.I18n.locale, 'pl-PL');
  const e = run(null);
  assert.equal(e.lang, 'en');
  assert.equal(e.marked.textContent, 'Settings');
  assert.equal(e.tr('Saved'), 'Saved');
  assert.equal(e.trn(2, '{n} bot', '{n} bots'), '2 bots');
});

test("an account's language: English to start with, Polish when the owner sets it, and its dictionary served", async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  assert.ok((await s.api('/version')).data.features.includes('language'));
  assert.equal((await s.api('/settings')).data.settings.language, 'en');
  const bad = await s.api('/settings', { method: 'PUT', body: { language: 'de' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /language/);
  const r = await s.api('/settings', { method: 'PUT', body: { language: 'pl' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.language, 'pl');
  assert.equal((await s.api('/settings')).data.settings.language, 'pl');
  const d = await s.api('/i18n/pl');
  assert.equal(d.status, 200);
  assert.equal(d.data.language, 'pl');
  assert.equal(d.data.strings.Saved, 'Zapisano');
  assert.equal((await s.api('/i18n/de')).status, 404);
});

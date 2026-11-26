// The interface's language (#645, ADR 108, ADR 280): the account's setting, the registry of languages and the folders
// that offer them, the dictionaries the apps draw their words with, and that every string the code passes to tr() and
// trn() has its text in every offered language, with the same placeholders and that language's plural forms.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer, ROOT } = require('./helpers');
const i18n = require('../lib/i18n');
const { AREAS, collect, placeholders } = require('../lib/i18n/keys');

const pl = i18n.load('pl');
const OTHERS = i18n.offered().filter((l) => l !== 'en');
// Codes botdot turns away: one no registry lists, and a listed language whose folder is not there yet, while there is one.
const REFUSED = ['xx', ...i18n.REGISTRY.map((l) => l.code).filter((c) => !i18n.offered().includes(c)).slice(0, 1)];
// What a language folder may hold (ADR 280, lib/i18n/README.md): its dictionary, its phrases, its schedule words and its glossary.
const FOLDER_FILES = new Set([...i18n.AREA_FILES, 'phrases.json', 'cron-words.js', 'GLOSSARY.md']);
const folders = () => fs.readdirSync(i18n.DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const tableOf = (lang, f) => { try { return JSON.parse(fs.readFileSync(path.join(i18n.DIR, lang, f), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };

test('Polish and English are offered, and every folder of lib/i18n is a language of the registry', () => {
  assert.deepEqual(i18n.offered().slice(0, 2), ['en', 'pl']);
  const codes = new Set(i18n.REGISTRY.map((l) => l.code));
  assert.equal(codes.size, i18n.REGISTRY.length, 'a code twice in languages.json');
  assert.ok(i18n.REGISTRY.length >= 14);
  for (const l of i18n.REGISTRY) {
    for (const k of ['code', 'name', 'english', 'browser', 'date', 'longDay', 'shortDay']) assert.ok(typeof l[k] === 'string' && l[k], `${l.code}: ${k}`);
    assert.doesNotThrow(() => new Intl.PluralRules(l.code), l.code);
    assert.doesNotThrow(() => new Intl.DateTimeFormat(l.date), l.code);
    assert.equal(new Intl.Locale(l.browser).language, new Intl.Locale(l.code).language, `${l.code}: browser ${l.browser}`);
    assert.match(l.browser, /^[a-z]{2,3}-[A-Z]{2}$/, `${l.code}: browser is a locale camoufox-browser takes (its LOCALE)`);
  }
  for (const f of folders()) {
    assert.ok(codes.has(f), `lib/i18n/${f}/ is no language of lib/i18n/languages.json`);
    assert.notEqual(f, 'en', 'English has no folder: its words are the keys and the code\'s own');
    for (const file of fs.readdirSync(path.join(i18n.DIR, f))) assert.ok(FOLDER_FILES.has(file), `lib/i18n/${f}/${file}: a language folder holds ${[...FOLDER_FILES].join(', ')}`);
  }
  assert.deepEqual(OTHERS, folders().filter((f) => i18n.REGISTRY.some((l) => l.code === f)).sort((a, b) => i18n.REGISTRY.findIndex((l) => l.code === a) - i18n.REGISTRY.findIndex((l) => l.code === b)));
});

test('every string of the web page, the Android app and the server has its text in every offered language, with the same placeholders and the plural forms of that language', () => {
  const problems = [];
  const sites = Object.keys(AREAS).flatMap((area) => collect(area).map((k) => ({ ...k, area })));
  for (const k of sites) if (k.bad) problems.push(`${k.file}:${k.line}: ${k.bad} passes no literal string (a key must be the English text itself)`);
  for (const lang of OTHERS) {
    const table = lang === 'pl' ? pl : i18n.load(lang);
    const need = i18n.categories(lang);
    const allowed = new Set([...need, 'other']);
    for (const k of sites) {
      if (k.bad) continue;
      const at = `${k.file}:${k.line}`;
      const v = table[k.key];
      if (v === undefined) { problems.push(`${at}: no ${lang} for ${JSON.stringify(k.key)} (lib/i18n/${lang}/${k.area}.json; \`node lib/i18n/keys.js missing ${lang} ${k.area} --where\` lists them)`); continue; }
      const want = new Set([...placeholders(k.key), ...(k.plural ? [...placeholders(k.one), 'n'] : [])]);
      let forms;
      if (k.plural) {
        if (!v || typeof v !== 'object') forms = [['', null]];
        else {
          for (const c of Object.keys(v)) if (!allowed.has(c)) problems.push(`${at}: the ${lang} of ${JSON.stringify(k.key)} has a "${c}" form, which ${lang} has not (its forms: ${need.join(', ')})`);
          forms = need.map((f) => [f, v[f]]).concat('other' in v && !need.includes('other') ? [['other', v.other]] : []);
        }
      } else forms = [['', v]];
      for (const [f, text] of forms) {
        if (typeof text !== 'string' || !text.trim()) { problems.push(`${at}: the ${lang} of ${JSON.stringify(k.key)}${f ? ` has no "${f}" form` : ' is empty or not a text'}`); continue; }
        for (const p of placeholders(text)) if (!want.has(p)) problems.push(`${at}: the ${lang} of ${JSON.stringify(k.key)} has {${p}}, which the English has not`);
        if (!k.plural) for (const p of want) if (!placeholders(text).has(p)) problems.push(`${at}: the ${lang} of ${JSON.stringify(k.key)} drops {${p}}`);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 200), [], `${problems.length} problems`);
});

test('every string of a language folder for the web page and the Android app is used, and two areas never give one string two texts', () => {
  const used = new Set(['web', 'android'].flatMap((a) => collect(a).map((k) => k.key)));
  const problems = [];
  for (const lang of folders()) {
    const seen = {};
    for (const f of i18n.AREA_FILES) {
      const table = tableOf(lang, f);
      for (const [k, v] of Object.entries(table)) {
        if (f !== 'server.json' && !used.has(k)) problems.push(`${lang}/${f}: ${JSON.stringify(k)} is used nowhere`);
        if (k in seen && JSON.stringify(seen[k].v) !== JSON.stringify(v)) problems.push(`${lang}/${f}: ${JSON.stringify(k)} differs from ${lang}/${seen[k].f}`);
        else if (!(k in seen)) seen[k] = { f, v };
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('every string of a language folder for the server is one its code writes: a tr() key, or the literal of a sentence said() passes on', () => {
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
  for (const lang of folders()) assert.deepEqual(Object.keys(tableOf(lang, 'server.json')).filter((k) => !used.has(k) && !written(k)), [], lang);
  assert.equal(i18n.said('pl', 'Bot not found'), 'Nie znaleziono bota');
  assert.equal(i18n.said('en', 'Bot not found'), 'Bot not found');
  assert.equal(i18n.said('pl', 'Not in the dictionary'), 'Not in the dictionary');
});

test("every language folder's phrases are lists of the kinds botdot reads, its schedule words have English's shape, and an offered language has its glossary", () => {
  const phrases = require('../lib/i18n/phrases');
  const cronWords = require('../lib/cron-words');
  for (const lang of folders()) {
    const raw = tableOf(lang, 'phrases.json');
    for (const kind of Object.keys(raw)) assert.ok(kind in phrases.KINDS, `${lang}/phrases.json: ${kind} is no kind of lib/i18n/phrases.js`);
    assert.doesNotThrow(() => phrases.of(lang), lang);
    for (const kind of Object.keys(phrases.KINDS)) for (const p of phrases.of(lang)[kind]) assert.doesNotThrow(() => new RegExp(phrases.source(p), 'u'), `${lang} ${kind}: ${p}`);
    if (fs.existsSync(path.join(i18n.DIR, lang, 'cron-words.js'))) {
      const P = require(path.join(i18n.DIR, lang, 'cron-words.js'));
      for (const k of Object.keys(cronWords.EN)) assert.equal(typeof P[k], typeof cronWords.EN[k], `${lang}/cron-words.js: ${k}`);
    }
  }
  for (const lang of OTHERS) assert.ok(fs.existsSync(path.join(i18n.DIR, lang, 'GLOSSARY.md')), `lib/i18n/${lang}/GLOSSARY.md: every offered language has its glossary`);
  assert.ok(fs.existsSync(path.join(i18n.DIR, 'GLOSSARY.md')));
});

test("the phones' plural fixture is what Intl.PluralRules answers for every language of the registry", () => {
  const { pluralFixture } = require('../lib/i18n/keys');
  const kept = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'plural-rules.json'), 'utf8'));
  assert.deepEqual(kept, pluralFixture(), 'run node lib/i18n/keys.js plural-fixture');
  assert.deepEqual(Object.keys(kept.languages), i18n.REGISTRY.map((l) => l.code));
});

test('a language is offered once its folder is there: a folder of German strings makes German one', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'i18n-'));
  fs.copyFileSync(path.join(i18n.DIR, 'languages.json'), path.join(dir, 'languages.json'));
  assert.deepEqual(i18n.offered(dir), ['en']);
  const dir2 = fs.mkdtempSync(path.join(require('os').tmpdir(), 'i18n-'));
  fs.mkdirSync(path.join(dir2, 'de'));
  fs.writeFileSync(path.join(dir2, 'de', 'web.json'), JSON.stringify({ Saved: 'Gespeichert', '{n} bots': { one: '{n} Bot', other: '{n} Bots' } }));
  fs.writeFileSync(path.join(dir2, 'de', 'phrases.json'), JSON.stringify({ because: ['weil'] }));
  fs.mkdirSync(path.join(dir2, 'xx')); // no language of the registry: never offered
  assert.deepEqual(i18n.offered(dir2), ['en', 'de']);
  assert.deepEqual(i18n.load('de', dir2), { Saved: 'Gespeichert', '{n} bots': { one: '{n} Bot', other: '{n} Bots' } }, 'phrases.json is no dictionary');
  assert.deepEqual(require('../lib/i18n/phrases').of('de', dir2).because, ['weil']);
  assert.deepEqual(i18n.categories('de'), ['one', 'other']);
  assert.deepEqual(i18n.categories('ja'), ['other']);
  assert.deepEqual(i18n.categories('ru'), ['one', 'few', 'many']);
  assert.deepEqual(i18n.categories('fr'), ['one', 'many', 'other']);
  assert.equal(i18n.info('pt-BR').english, 'Brazilian Portuguese');
  for (const code of REFUSED) assert.equal(i18n.clean(code), 'en', `${code} has no folder here: not offered`);
});

test('tr() and trn(): Polish where there is one, English otherwise, placeholders filled, Polish plural forms', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'i18n-'));
  fs.mkdirSync(path.join(dir, 'pl'));
  fs.writeFileSync(path.join(dir, 'pl', 'web.json'), JSON.stringify({ Saved: 'Zapisano', '{n} bots': { one: '{n} bot', few: '{n} boty', many: '{n} botów' } }));
  assert.deepEqual(i18n.load('pl', dir), { Saved: 'Zapisano', '{n} bots': { one: '{n} bot', few: '{n} boty', many: '{n} botów' } });
  assert.equal(i18n.tr('pl', 'Saved'), 'Zapisano');
  assert.equal(i18n.tr('en', 'Saved'), 'Saved');
  assert.equal(i18n.tr('pl', 'Nothing like this {x}', { x: 1 }), 'Nothing like this 1', 'no Polish: the English, filled');
  assert.equal(i18n.tr('xx', 'Saved'), 'Saved', 'an unknown language is English');
  assert.deepEqual([1, 2, 4, 5, 12, 14, 21, 22, 25, 112, 122].map((n) => i18n.form('pl', n)), ['one', 'few', 'few', 'many', 'many', 'many', 'many', 'few', 'many', 'many', 'few']);
  assert.deepEqual([0, 1, 2].map((n) => i18n.form('en', n)), ['other', 'one', 'other']);
  assert.equal(i18n.trn('en', 1, '{n} bot', '{n} bots'), '1 bot');
  assert.equal(i18n.trn('en', 3, '{n} bot', '{n} bots'), '3 bots');
  // A missing form: "other", then "few" (a Polish fraction, "1,5 godziny"), then "many".
  assert.equal(i18n.pick({ one: 'a', few: 'b', many: 'c' }, 'pl', 1.5), 'b');
  assert.equal(i18n.pick({ one: 'a', other: 'o' }, 'fr', 1e6), 'o', 'French "many" is missing: other');
  assert.equal(i18n.pick({ other: 'o' }, 'ja', 1), 'o');
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
  const p = run({ language: 'pl', strings: { Settings: 'Ustawienia', Saved: 'Zapisano', '{n} bots': { one: '{n} bot', few: '{n} boty', many: '{n} botów' } }, languages: [{ code: 'en', name: 'English', locale: 'en-US' }, { code: 'pl', name: 'Polski', locale: 'pl-PL' }] });
  assert.equal(p.lang, 'pl');
  assert.equal(p.marked.textContent, 'Ustawienia', 'data-t is translated when the file loads');
  assert.equal(p.titled.attrs.title, 'Zapisano', 'and data-t-title');
  assert.equal(p.tr('Saved'), 'Zapisano');
  assert.equal(p.tr('Not there'), 'Not there');
  assert.deepEqual([1, 3, 5, 22].map((n) => p.trn(n, '{n} bot', '{n} bots')), ['1 bot', '3 boty', '5 botów', '22 boty']);
  assert.equal(p.I18n.locale, 'pl-PL');
  assert.equal(run({ language: 'pl', strings: {} }).I18n.locale, 'pl', 'kept before the server listed its languages: the code');
  // Any language the server offers (ADR 280), its plural forms by its CLDR categories, with the phrases kept beside.
  const g = run({ language: 'de', strings: { Saved: 'Gespeichert', '{n} bots': { one: '{n} Bot', other: '{n} Bots' } }, languages: [{ code: 'en', name: 'English' }, { code: 'de', name: 'Deutsch', locale: 'de-DE' }], phrases: { because: ['weil'] } });
  assert.equal(g.lang, 'de');
  assert.equal(g.tr('Saved'), 'Gespeichert');
  assert.deepEqual([0, 1, 2].map((n) => g.trn(n, '{n} bot', '{n} bots')), ['0 Bots', '1 Bot', '2 Bots']);
  assert.equal(g.I18n.locale, 'de-DE');
  assert.deepEqual(g.I18n.languages.map((l) => l.code), ['en', 'de']);
  assert.deepEqual(g.I18n.phrases.because, ['weil']);
  const j = run({ language: 'ja', strings: { '{n} bots': { other: 'ボット{n}体' } } });
  assert.equal(j.trn(1, '{n} bot', '{n} bots'), 'ボット1体', 'Japanese has one form, other');
  assert.equal(run({ language: '<script>', strings: { Saved: 'x' } }).lang, 'en', 'no language code: English');
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
  for (const code of REFUSED) {
    const bad = await s.api('/settings', { method: 'PUT', body: { language: code } });
    assert.equal(bad.status, 400, code);
    assert.match(bad.data.error, /language/);
  }
  const r = await s.api('/settings', { method: 'PUT', body: { language: 'pl' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.language, 'pl');
  assert.equal((await s.api('/settings')).data.settings.language, 'pl');
  const d = await s.api('/i18n/pl');
  assert.equal(d.status, 200);
  assert.equal(d.data.language, 'pl');
  assert.equal(d.data.strings.Saved, 'Zapisano');
  for (const code of REFUSED) assert.equal((await s.api(`/i18n/${code}`)).status, 404, code);
  // The languages the account may choose and the phrases the apps read come with every dictionary, English's too (ADR 280).
  assert.ok((await s.api('/version')).data.features.includes('languages'));
  assert.deepEqual(d.data.languages.map((l) => l.code), i18n.offered());
  assert.deepEqual(d.data.languages.find((l) => l.code === 'pl'), { code: 'pl', name: 'Polski', locale: 'pl-PL', date: 'pl', longDay: 'EEEE, d MMMM', shortDay: 'd MMM' });
  assert.ok(d.data.phrases.because.includes('bo'));
  assert.ok(d.data.phrases.noSource.includes('brak'));
  const en = await s.api('/i18n/en');
  assert.equal(en.status, 200);
  assert.deepEqual(en.data.strings, {});
  assert.deepEqual(en.data.languages, d.data.languages);
  assert.deepEqual((await s.api('/settings')).data.languages, d.data.languages, 'GET /api/settings lists them too');
});

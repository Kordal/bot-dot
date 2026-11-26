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
const { AREAS, collect, calls, placeholders } = require('../lib/i18n/keys');

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

test('the server\'s strings are found as the code calls them: i18n.tr(), i18n.trn() and i18n.said() on the module it required, a bare said() taken from it, and a sentence said() passes on that Polish has', () => {
  const keys = (src, area = 'server') => [...src.matchAll(calls(src, area))].map((m) => m[1] || m[2]);
  const required = "const i18n = require('./i18n');\n";
  assert.deepEqual(keys(`${required}i18n.tr(lang, 'Opening {host}', { host }); i18n.trn(lang, n, '{n} file', '{n} files'); i18n.said(lang, 'Thinking');`), ['tr', 'trn', 'said']);
  assert.deepEqual(keys("const words = require('../i18n');\nwords.said(lang, 'Typing'); require('./i18n').tr(lang, 'Saved');"), ['said', 'tr']);
  assert.deepEqual(keys("const { said } = require('./i18n');\nsaid(lang, 'Choose files');"), ['said']);
  // Another object's tr() or said(), or a said() of the file's own, takes no key.
  assert.deepEqual(keys("foo.tr(lang, 'x'); i18n.tr(lang, 'not required here'); said(extra, 'such field');"), []);
  assert.deepEqual(keys(`${required}i18n.tr('x'); words.tr('y'); I18n.tr('z'); tr('w');`, 'web'), ['tr', 'tr']);
  assert.deepEqual(keys('dev.botdot.app.data.tr("Saved"); other.data.tr("x")', 'android'), ['tr']);
  const server = collect('server');
  const at = (key) => server.filter((k) => k.key === key).map((k) => `${k.file}${k.passed ? ' (passed on)' : ''}`);
  assert.ok(at('Reading a web page').includes('lib/working-line.js'), 'i18n.said(lang, \'Reading a web page\')');
  assert.ok(at('Opening {host}').includes('lib/working-line.js'), 'i18n.tr(lang, \'Opening {host}\', …)');
  assert.ok(at('Thinking').includes('lib/chief.js'), 'i18n.said(lang, \'Thinking\')');
  assert.ok(at('Choose files').includes('lib/drop-page.js'), 'said(lang, \'Choose files\') taken from i18n');
  assert.ok(at('No space left on the server.').includes('lib/problems.js (passed on)'), 'said(lang, NO_SPACE), NO_SPACE written in lib/problems.js');
  assert.ok(at('Its bot is gone').includes('server.js (passed on)'), 'an error\'s message');
  assert.ok(!server.some((k) => k.key === 'such field'), 'lib/pieces.js has a said() of its own');
  assert.ok(!collect('web').some((k) => k.file === 'public/unread.js' && k.line === 16), 'words.tr(text, vars) in public/unread.js is no key');
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

test('French elides de, que and le before a name that starts with a vowel or a mute h, on the server', () => {
  const plan = (who) => i18n.tr('fr', "{who}'s plan", { who });
  assert.equal(plan('Anna'), "Plan d'Anna");
  assert.equal(plan('Bob'), 'Plan de Bob');
  assert.equal(i18n.tr('fr', 'Waits until {who} is free', { who: 'Émile' }), "Attend qu'Émile soit libre");
  assert.equal(i18n.tr('fr', 'Waits until {who} is free', { who: 'Zoé' }), 'Attend que Zoé soit libre');
  assert.equal(plan('Hélène'), "Plan d'Hélène", 'a mute h');
  assert.equal(plan('Hugo'), 'Plan de Hugo', 'an aspirated h, or one the list does not know: not elided');
  assert.equal(plan('Yann'), 'Plan de Yann');
  assert.equal(plan('anna@x.com'), 'Plan de anna@x.com', 'an address is not a name');
  assert.equal(plan('app.js'), 'Plan de app.js');
  assert.equal(plan(8), 'Plan de 8');
  assert.equal(plan('Élodie-Marie (Home)'), "Plan d'Élodie-Marie (Home)", 'the first word decides');
  assert.equal(i18n.tr('fr', 'Waits until {names} are free', { names: 'Anna et Bob' }), "Attend qu'Anna et Bob soient libres");
  assert.equal(i18n.tr('fr', "{who}'s plan"), 'Plan de {who}', 'no values: the text as it is');
  assert.equal(i18n.tr('fr', 'Saved'), 'Enregistré', 'a string with no placeholder is not touched');
  for (const lang of OTHERS.filter((l) => l !== 'fr')) assert.equal(i18n.elisionOf(lang), null, `${lang} declares none`);
  assert.equal(i18n.elisionOf('en'), null);
  assert.equal(i18n.tr('en', "{who}'s plan", { who: 'Anna' }), "Anna's plan");
  assert.equal(i18n.tr('pl', "{who}'s plan", { who: 'Anna' }), i18n.strings('pl')["{who}'s plan"].replace('{who}', 'Anna'), 'another language is filled as it always was');
});

test('elision: the word right before a placeholder, its capital and its case, from a rule a folder declares', () => {
  const elision = require('../lib/i18n/elision');
  const rule = elision.of('fr');
  assert.deepEqual(Object.keys(rule.words), ['de', 'que', 'le', 'la']);
  const fill = (t, vars) => elision.fill(t, vars, rule);
  assert.equal(fill('de {name}', { name: 'Anna' }), "d'Anna");
  assert.equal(fill('de {name}', { name: 'Bob' }), 'de Bob');
  assert.equal(fill('que {bot}', { bot: 'Émile' }), "qu'Émile");
  assert.equal(fill('Que {bot}', { bot: 'Émile' }), "Qu'Émile");
  assert.equal(fill('De {name}', { name: 'Anna' }), "D'Anna");
  assert.equal(fill('le {name} et la {other}', { name: 'Alice', other: 'Odile' }), "l'Alice et l'Odile");
  assert.equal(fill('de\u00a0{name}', { name: 'Anna' }), "d'Anna", 'after a no-break space too');
  assert.equal(fill('ode {name}', { name: 'Anna' }), 'ode Anna', 'only the word itself');
  assert.equal(fill("l'de {name}", { name: 'Anna' }), "l'de Anna", 'not after an apostrophe');
  assert.equal(fill('de {a} et de {b}', { a: 'Anna', b: 'Bob' }), "d'Anna et de Bob");
  assert.equal(fill('de {missing}', {}), 'de {missing}');
  assert.equal(fill('{name}', { name: 'Anna' }), 'Anna', 'a placeholder with no word before it');
  assert.equal(fill('de la {name}', { name: 'Anna' }), "de l'Anna", 'the word right before: la');
  assert.equal(elision.fill('de {name}', { name: 'Anna' }, null), 'de Anna', 'no rule: no elision');
  // A rule is data: Italian could declare its own.
  assert.equal(elision.fill('di {n}', { n: 'Anna' }, { words: { di: "d'" }, silentH: [] }), "d'Anna");
  assert.equal(elision.of('xx'), null);
  assert.equal(elision.of('en'), null);
  assert.equal(elision.of('fr', fs.mkdtempSync(path.join(require('os').tmpdir(), 'elision-'))), null, 'a folder with no phrases.json declares none');
  assert.equal(i18n.trn('fr', 2, '{n} bot', '{n} bots'), '2 bots', 'a count is filled as it was');
});

test('the API hands out a language\'s elision rule with its dictionary, and English has none', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const fr = (await s.api('/i18n/fr')).data;
  assert.deepEqual(fr.elision.words, { de: "d'", que: "qu'", le: "l'", la: "l'" });
  assert.ok(fr.elision.silentH.includes('hélène'));
  assert.equal((await s.api('/i18n/pl')).data.elision, null);
  assert.equal((await s.api('/i18n/en')).data.elision, null);
});

test('"On" and "Off" are the state of every setting, so a language that agrees a state with its subject gives them words that agree with nothing', () => {
  // Backups, Notifications, Skills, a tile's dot and a report's rhythm all read "Off": French "Désactivé" was masculine
  // for Sauvegardes, Compétences and Notifications alike. These languages inflect (gender or number), so theirs are a
  // yes and a no or an abbreviation; the others' words (An/Aus, Aan/Uit, オン/オフ…) are invariant already.
  const words = { fr: ['Oui', 'Non'], es: ['Sí', 'No'], it: ['Sì', 'No'], 'pt-BR': ['Sim', 'Não'], pl: ['Wł.', 'Wył.'], ru: ['Вкл.', 'Выкл.'] };
  for (const [lang, [on, off]] of Object.entries(words)) {
    assert.equal(i18n.tr(lang, 'On'), on, lang);
    assert.equal(i18n.tr(lang, 'Off'), off, lang);
  }
  // "On" is not a preposition either: the payment request says "Site" above the site's address.
  assert.ok(!/tr\('On'\)<\/div>\s*<div class="site"/.test(fs.readFileSync(path.join(ROOT, 'public/vault.js'), 'utf8')));
});

test("every language folder's phrases are lists of the kinds botdot reads, its schedule words have English's shape, and an offered language has its glossary", () => {
  const phrases = require('../lib/i18n/phrases');
  const cronWords = require('../lib/cron-words');
  for (const lang of folders()) {
    const raw = tableOf(lang, 'phrases.json');
    for (const kind of Object.keys(raw)) assert.ok(kind in phrases.KINDS || kind === 'elision', `${lang}/phrases.json: ${kind} is no kind of lib/i18n/phrases.js`);
    if (raw.elision) assert.ok(require('../lib/i18n/elision').of(lang), `${lang}/phrases.json: elision needs its words, { "de": "d'" }`);
    assert.doesNotThrow(() => phrases.of(lang), lang);
    for (const kind of Object.keys(phrases.KINDS)) for (const p of phrases.of(lang)[kind]) assert.doesNotThrow(() => new RegExp(phrases.source(p), 'u'), `${lang} ${kind}: ${p}`);
    if (fs.existsSync(path.join(i18n.DIR, lang, 'cron-words.js'))) {
      const P = require(path.join(i18n.DIR, lang, 'cron-words.js'));
      for (const k of Object.keys(cronWords.EN)) assert.equal(typeof P[k], typeof cronWords.EN[k], `${lang}/cron-words.js: ${k}`);
      // The optional ones (lib/cron-words.js): how the words are joined; English's ", " and " and " where it sets none.
      for (const [k, type] of [['listSep', 'string'], ['partSep', 'string'], ['lastSep', 'function']]) assert.ok(!(k in P) || typeof P[k] === type, `${lang}/cron-words.js: ${k} is a ${type}`);
    }
  }
  for (const lang of OTHERS) assert.ok(fs.existsSync(path.join(i18n.DIR, lang, 'GLOSSARY.md')), `lib/i18n/${lang}/GLOSSARY.md: every offered language has its glossary`);
  assert.ok(fs.existsSync(path.join(i18n.DIR, 'GLOSSARY.md')));
});

// Common English words. A word of another language's list that is also one of these is read in English text as that
// language's filler, reason or yes: Spanish "son" is a stop word and English "son" is not, German "hat" and "war" are
// stop words and English "hat" and "war" are not. The lists are short on purpose: a word that is the same in both
// languages and means the same (a name, "ok") is no mistake.
const ENGLISH_WORDS = new Set(`hat bin die war den son pour ton sur door over van art bed bit bar bat bay bear bell bill bird boat body bone
  book boot box boy bus cab cap car cat chair city club coat cold cook cool corn cup cut dad dance dark date day deal dear deep desk dish
  dog doll down draw dress drink drive drop dust ear east eat egg end eye face fact fall farm fast fat fear fee fill film find fine fire fish
  flat floor fly food foot fork form fun game gift girl glass goal gold good grass gray green ground gun hair hall hand hard head heart heat
  help hide high hill hole home hope horse hot hour house ice idea iron job joy key kid king kiss knee lake lamp land last late law leaf leg
  life lift light line lip list live lock long look lot love low luck mail main man map mark mass meal meat milk mind mine mix moon name neck
  news nice night noise nose note nut oil one pack page pain pair park part pass path pay pen pick pie pin pipe plan plant plate play point
  pool pot rain rate rest rice ride ring river road rock roof room root rope rose rule run sale salt sand seat sell ship shoe shop show side
  sign sing sink skin sky sleep slow snow soap sock soft soil song soon sort soul soup space star step stone store storm sun tail tank tax tea
  team tent test time tip tire top town toy tree trip tube turn use view wall wash wave way wear wind wine wing wire wish wolf wood word work
  yard year zone`.split(/\s+/));
// Short English words that begin a sentence or an answer: "Can I send it?", "Is that right?". A yes or a no must not be one.
const ENGLISH_ANSWER_STARTS = new Set(`can will may must should could would have has had are is was were be been am it the and or but if so in
  on at to of for with by from as an a i we he she they you does did let make take get give want need think see know look`.split(/\s+/));

test("no language's word lists hold a common English word, and its yes and no are single words", () => {
  const phrases = require('../lib/i18n/phrases');
  const { BUILT_IN_YES, BUILT_IN_NO } = require('../lib/choices');
  const word = (p) => p.toLowerCase().replace(/\*$/, '');
  for (const lang of folders()) {
    const own = phrases.of(lang);
    for (const kind of ['stopWords', 'because']) for (const p of own[kind] || []) assert.ok(!ENGLISH_WORDS.has(word(p)), `${lang}/phrases.json ${kind}: "${p}" is an English word`);
    // The words lib/choices.js has of its own (cross-language ones like "da" and "si" included) are its choice.
    for (const [kind, built] of [['yes', BUILT_IN_YES], ['no', BUILT_IN_NO]]) {
      for (const p of own[kind] || []) {
        assert.ok(!/[\s\p{P}]/u.test(p.replace(/['’]/g, '')), `${lang}/phrases.json ${kind}: "${p}" is more than one word, and an answer is read by its first word`);
        if (built.includes(p.toLowerCase())) continue;
        assert.ok(!ENGLISH_WORDS.has(word(p)) && !ENGLISH_ANSWER_STARTS.has(word(p)), `${lang}/phrases.json ${kind}: "${p}" is an English word`);
      }
    }
  }
  // The test itself: it finds what it is meant to.
  assert.ok(ENGLISH_WORDS.has('hat') && ENGLISH_ANSWER_STARTS.has('can'));
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
  // French: the rule comes with the dictionary and elides before a name; English text and other languages are as they were.
  const rule = { words: { de: "d'", que: "qu'", le: "l'", la: "l'" }, silentH: ['hélène'] };
  const f = run({ language: 'fr', strings: { "{who}'s plan": 'Plan de {who}', 'Waits until {who} is free': 'Attend que {who} soit libre', Saved: 'Enregistré', '{n} files of {who}': { one: '{n} fichier de {who}', other: '{n} fichiers de {who}' } }, languages: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }], elision: rule });
  assert.equal(f.tr("{who}'s plan", { who: 'Anna' }), "Plan d'Anna");
  assert.equal(f.tr("{who}'s plan", { who: 'Bob' }), 'Plan de Bob');
  assert.equal(f.tr('Waits until {who} is free', { who: 'Émile' }), "Attend qu'Émile soit libre");
  assert.equal(f.tr("{who}'s plan", { who: 'Hélène' }), "Plan d'Hélène");
  assert.equal(f.tr("{who}'s plan", { who: 'Hugo' }), 'Plan de Hugo');
  assert.equal(f.tr("{who}'s plan", { who: 'anna@x.com' }), 'Plan de anna@x.com');
  // The page's names are HTML: botLabel() is the bot's mark (an <svg>), then its escaped name. Elision reads what shows.
  const mark = '<svg class="fig fig-small" viewBox="0 0 10 10" style="--c:#fc0" aria-hidden="true" data-bot="b1"><path d="M0 0h10v10H0z"/></svg>';
  assert.equal(f.tr("{who}'s plan", { who: `${mark}Anna` }), `Plan d'${mark}Anna`, 'a vowel after the mark');
  assert.equal(f.tr("{who}'s plan", { who: `${mark}Bob` }), `Plan de ${mark}Bob`, 'a consonant after the mark');
  assert.equal(f.tr("{who}'s plan", { who: `${mark}Hélène` }), `Plan d'${mark}Hélène`);
  assert.equal(f.tr("{who}'s plan", { who: '<b>Émile</b>' }), "Plan d'<b>Émile</b>", 'a name in <b>');
  assert.equal(f.tr("{who}'s plan", { who: '<a href="#x">Zoé</a>' }), 'Plan de <a href="#x">Zoé</a>', 'a link');
  assert.equal(f.tr("{who}'s plan", { who: 'Alice &amp; Bob' }), "Plan d'Alice &amp; Bob", 'an escaped name');
  assert.equal(f.tr("{who}'s plan", { who: `${mark}&lt;x&gt;` }), `Plan de ${mark}&lt;x&gt;`, 'a name that is no word');
  assert.equal(f.tr("{who}'s plan", { who: `${mark}` }), `Plan de ${mark}`, 'a mark and no name');
  assert.equal(f.tr('Saved'), 'Enregistré');
  assert.equal(f.tr("{who}'s plan"), 'Plan de {who}');
  assert.equal(f.tr('Not in the dictionary: de {who}', { who: 'Anna' }), 'Not in the dictionary: de Anna', 'English text is not elided');
  assert.equal(f.trn(2, '{n} file of {who}', '{n} files of {who}', { who: 'Anna' }), "2 fichiers d'Anna");
  assert.equal(run({ language: 'fr', strings: { "{who}'s plan": 'Plan de {who}' } }).tr("{who}'s plan", { who: 'Anna' }), 'Plan de Anna', 'kept before the server handed out a rule: as it was');
  assert.equal(run({ language: 'pl', strings: { "{who}'s plan": 'Plan de {who}' }, elision: rule }).tr("{who}'s plan", { who: 'Anna' }), "Plan d'Anna", 'the rule is the language\'s, as the server hands it out');
  const j = run({ language: 'ja', strings: { '{n} bots': { other: 'ボット{n}体' } } });
  assert.equal(j.trn(1, '{n} bot', '{n} bots'), 'ボット1体', 'Japanese has one form, other');
  assert.equal(run({ language: '<script>', strings: { Saved: 'x' } }).lang, 'en', 'no language code: English');
  // <html lang> is the owner's language, for the style sheet's :lang(ko) (word-break) and text-transform.
  assert.equal(run({ language: 'ko', strings: {} }).lang, 'ko');
  assert.equal(run({ language: 'zh-Hans', strings: {} }).lang, 'zh-Hans');
  // Capital and small letters by the language's rules: Turkish "i" is "İ", not "I".
  assert.equal(run({ language: 'tr', strings: {} }).I18n.upper('istanbul'), 'İSTANBUL');
  assert.equal(run({ language: 'tr', strings: {} }).I18n.lower('DİYARBAKIR'), 'diyarbakır');
  assert.equal(run({ language: 'de', strings: {} }).I18n.upper('i'), 'I');
  assert.equal(run(null).I18n.upper('i'), 'I');
  const e = run(null);
  assert.equal(e.lang, 'en');
  assert.equal(e.marked.textContent, 'Settings');
  assert.equal(e.tr('Saved'), 'Saved');
  assert.equal(e.trn(2, '{n} bot', '{n} bots'), '2 bots');
});

test("the style sheet keeps Korean words whole: keep-all on <html lang=ko>, a long token still breaks", () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
  const rule = css.match(/html:lang\(ko\)\s*\{([^}]*)\}/);
  assert.ok(rule, 'a rule for html:lang(ko)');
  assert.match(rule[1], /word-break:\s*keep-all/);
  assert.match(rule[1], /overflow-wrap:\s*break-word/);
  assert.doesNotMatch(rule[1], /overflow-wrap:\s*anywhere/, 'anywhere shrinks a Korean item to one syllable');
});

test("a keypad key's name wraps to two balanced lines before it is cut, so a long name of a language shows whole", () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
  const rule = css.match(/^\.key \.name\s*\{([^}]*)\}/m);
  assert.ok(rule, 'a rule for .key .name');
  assert.match(rule[1], /-webkit-line-clamp:\s*2/);
  assert.match(rule[1], /text-wrap:\s*balance/);
  assert.doesNotMatch(rule[1], /white-space:\s*nowrap/);
});

test('the server capitalises text for the owner by the language, not by the default rules: Turkish "i" is "İ"', () => {
  assert.equal(i18n.upper('tr', 'istanbul'), 'İSTANBUL');
  assert.equal(i18n.lower('tr', 'DIYARBAKIR'), 'dıyarbakır');
  assert.equal(i18n.lower('tr', 'DİYARBAKIR'), 'diyarbakır');
  assert.equal(i18n.upper('en', 'istanbul'), 'ISTANBUL');
  assert.equal(i18n.upper('ja', 'abc'), 'ABC');
  assert.equal(i18n.upper('not a tag', 'i'), 'I', 'a tag Intl does not know is English');
  assert.equal(i18n.upper(undefined, 'i'), 'I');
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

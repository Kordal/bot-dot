// The interface's language (#644, ADR 108, ADR 280): English, or another language the account chose in Settings. A
// string is keyed by its English text and passed through tr() (trn() for a count), so the code reads as it always did
// and a string without a translation stays English.
// Every language botdot may speak is listed once in languages.json (the registry); one is offered only when its
// folder lib/i18n/<code>/ exists, so adding a language is adding a folder. A folder's dictionary is one file per area
// (web.json, android.json, server.json, so that work on one area does not touch another), merged here and handed to
// the apps by GET /api/i18n/<code>: data the server hands out (ADR 003). A value is the text in that language, with
// the English text's {placeholders}; a plural's value is an object keyed by the language's CLDR plural categories
// ({ one, few, many } in Polish, { one, other } in German, { other } in Japanese).
const fs = require('fs');
const path = require('path');

const DEFAULT = 'en';
const DIR = __dirname;
// The dictionary's files of a language folder, in the order they are merged. Anything else there (phrases.json,
// cron-words.js, GLOSSARY.md) is not a dictionary.
const AREA_FILES = ['android.json', 'server.json', 'web.json'];
const elision = require('./elision');
const REGISTRY = require('./languages.json').languages;
const BY_CODE = new Map(REGISTRY.map((l) => [l.code, l]));

// The codes of the languages offered: English, then every language of the registry whose folder is there, in the
// registry's order. Read once per folder: a language comes with a new version of botdot, never while it runs.
const offeredIn = new Map();
function offered(dir = DIR) {
  if (!offeredIn.has(dir)) {
    offeredIn.set(dir, REGISTRY.filter((l) => l.code === DEFAULT || (() => { try { return fs.statSync(path.join(dir, l.code)).isDirectory(); } catch { return false; } })()).map((l) => l.code));
  }
  return offeredIn.get(dir);
}
const isOffered = (lang) => typeof lang === 'string' && offered().includes(lang);

// An offered language's code; any other value is the default.
const clean = (lang) => (isOffered(lang) ? lang : DEFAULT);

// The registry's entry of a language (code, name, english, browser, date, longDay, shortDay, spaced), offered or not;
// English's for a code the registry has not.
const info = (lang) => BY_CODE.get(lang) || BY_CODE.get(DEFAULT);

// The offered languages as the apps get them (GET /api/i18n/<code>, GET /api/settings): what the Settings picker
// lists and how each writes a date.
const languages = () => offered().map((code) => {
  const { name, browser, date, longDay, shortDay } = info(code);
  return { code, name, locale: browser, date, longDay, shortDay };
});

// Every key of every dictionary file of one language, merged in file order. A key two files give different texts
// is the first file's; test/i18n.test.js fails on that.
function load(lang, dir = DIR) {
  const out = {};
  for (const f of AREA_FILES) {
    let table;
    try { table = JSON.parse(fs.readFileSync(path.join(dir, lang, f), 'utf8')); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue; throw e; }
    for (const [k, v] of Object.entries(table)) if (!(k in out)) out[k] = v;
  }
  return out;
}

const cache = new Map();
const strings = (lang) => {
  lang = clean(lang);
  if (lang === DEFAULT) return {};
  if (!cache.has(lang)) cache.set(lang, load(lang));
  return cache.get(lang);
};

// The plural category of `n` in a language, by CLDR's rules (Intl.PluralRules): "one", "few", "many", "other"…
const rules = new Map();
function form(lang, n) {
  const code = info(lang).code;
  if (!rules.has(code)) rules.set(code, new Intl.PluralRules(code));
  return rules.get(code).select(Math.abs(Number(n)) || 0);
}

// The categories a language's whole counts take, in CLDR's order: what each plural of its dictionary must have.
// "other" may be there as well where it is not one of them (Polish and Russian give it to fractions alone).
const ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];
const SAMPLES = [...Array(1001).keys(), 1e4, 1e5, 1e6, 2e6, 1e7, 1e9];
function categories(lang) {
  const seen = new Set(SAMPLES.map((n) => form(lang, n)));
  return ORDER.filter((c) => seen.has(c));
}

// A language's elision rule (lib/i18n/elision.js), kept like its dictionary; null for English and any language that has none.
const elisions = new Map();
function elisionOf(lang) {
  lang = clean(lang);
  if (lang === DEFAULT) return null;
  if (!elisions.has(lang)) elisions.set(lang, elision.of(lang));
  return elisions.get(lang);
}

// `text` with its {placeholders} filled from `vars`; `rule`: the elision of the language the text is in, if any.
const fill = (text, vars, rule = null) => (vars ? elision.fill(text, vars, rule) : String(text));

// `text` in `lang`, its {placeholders} filled from `vars`. Only a text of the dictionary elides: English is left as it is.
function tr(lang, text, vars) {
  const v = strings(lang)[text];
  return typeof v === 'string' ? fill(v, vars, elisionOf(lang)) : fill(text, vars);
}

// A plural's text for `n` from its forms: the language's category, or else "other", then "few" (a Polish or Russian
// fraction, "1,5 godziny", takes the few form's words), then "many".
const pick = (forms, lang, n) => forms[form(lang, n)] ?? forms.other ?? forms.few ?? forms.many;

// A count: `one` for one, `other` else, in English; the key of the other languages' forms is `other`. {n} is the count.
function trn(lang, n, one, other, vars) {
  const all = { n, ...vars };
  const v = strings(lang)[other];
  if (v && typeof v === 'object') { const t = pick(v, lang, n); return t === undefined ? fill(other, all) : fill(t, all, elisionOf(lang)); }
  return fill(n === 1 ? one : other, all);
}

// A sentence made elsewhere and passed on as it is (an error's message, #649): in `lang` when the dictionary has its
// English, else as it came. Its keys are the literals of the code that makes them, not tr() calls: test/i18n.test.js
// checks that each key of <code>/server.json is written somewhere in the server, and keys.js counts each key of
// pl/server.json the server writes as a string every language must have.
function said(lang, text) {
  const v = typeof text === 'string' ? strings(lang)[text] : undefined;
  return typeof v === 'string' ? v : text;
}

// Capital and small letters by `lang`'s own rules, for text shown to the owner in that language (Turkish "i" is "İ", not
// "I"). Never for an identifier or a key, which stay as they are (toUpperCase, toLowerCase).
// A tag Intl doesn't know is English's.
const upper = (lang, text) => { try { return String(text).toLocaleUpperCase(lang); } catch { return String(text).toUpperCase(); } };
const lower = (lang, text) => { try { return String(text).toLocaleLowerCase(lang); } catch { return String(text).toLowerCase(); } };

module.exports = { DEFAULT, DIR, AREA_FILES, REGISTRY, offered, isOffered, clean, info, languages, load, strings, form, categories, pick, fill, elisionOf, tr, trn, said, upper, lower };

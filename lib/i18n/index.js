// The interface's language (#644, ADR 108): English, or Polish when the account chose it in Settings. A string is
// keyed by its English text and passed through tr() (trn() for a count), so the code reads as it always did and a
// string without a translation stays English.
// The Polish dictionary is one per area (pl/web.json, pl/android.json, pl/server.json, so that work on one area does
// not touch another), merged here and handed to the apps by GET /api/i18n/pl: data the server hands out (ADR 003).
// A value is the Polish text, with the English text's {placeholders}; a plural's value is { one, few, many }.
const fs = require('fs');
const path = require('path');

const LANGUAGES = ['en', 'pl'];
const DEFAULT = 'en';
const DIR = __dirname;

// "pl" or "en": any other value is the default.
const clean = (lang) => (LANGUAGES.includes(lang) ? lang : DEFAULT);

// Every key of every file of one language, merged in file order. A key two files give different texts is the
// first file's; test/i18n.test.js fails on that.
function load(lang, dir = DIR) {
  const folder = path.join(dir, lang);
  let files;
  try { files = fs.readdirSync(folder).filter((f) => f.endsWith('.json')).sort(); } catch { return {}; }
  const out = {};
  for (const f of files) {
    const table = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'));
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

// The plural form of `n`, by the language's rules: English one/other, Polish one/few/many.
function form(lang, n) {
  const a = Math.abs(n);
  if (clean(lang) === 'pl') {
    if (a === 1) return 'one';
    if (Number.isInteger(a) && a % 10 >= 2 && a % 10 <= 4 && !(a % 100 >= 12 && a % 100 <= 14)) return 'few';
    return Number.isInteger(a) ? 'many' : 'few'; // a fraction ("1,5 godziny") takes the few form
  }
  return a === 1 ? 'one' : 'other';
}

const fill = (text, vars) => (vars ? String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(text));

// `text` in `lang`, its {placeholders} filled from `vars`.
function tr(lang, text, vars) {
  const v = strings(lang)[text];
  return fill(typeof v === 'string' ? v : text, vars);
}

// A count: `one` for one, `other` else, in English; the key of the Polish forms is `other`. {n} is the count.
function trn(lang, n, one, other, vars) {
  const all = { n, ...vars };
  const v = strings(lang)[other];
  if (v && typeof v === 'object') return fill(v[form(lang, n)] ?? v.many ?? other, all);
  return fill(n === 1 ? one : other, all);
}

// A sentence made elsewhere and passed on as it is (an error's message, #649): in `lang` when the dictionary has its
// English, else as it came. Its keys are the literals of the code that makes them, not tr() calls: test/i18n.test.js
// checks that each key of pl/server.json is written somewhere in the server.
function said(lang, text) {
  const v = typeof text === 'string' ? strings(lang)[text] : undefined;
  return typeof v === 'string' ? v : text;
}

module.exports = { LANGUAGES, DEFAULT, DIR, clean, load, strings, form, fill, tr, trn, said };

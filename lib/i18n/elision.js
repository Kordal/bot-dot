// Elision before a name (ADR 280): French writes "d'Anna", "qu'Émile" and "l'Alice", not "de Anna", "que Émile" and
// "le Alice", so a string that puts "de {name}" before a placeholder needs the value to decide. A language declares it
// in its folder's phrases.json, under "elision":
//
//   "elision": { "words": { "de": "d'", "que": "qu'", "le": "l'", "la": "l'" }, "silentH": ["hélène", "henri", "homme"] }
//
// words: the word that elides and what it becomes before a vowel; silentH: the words with a mute h, which a vowel's
// rule treats as one ("d'Hélène" but "de Hugo"; a short list, and a word that is not on it is not elided).
//
// It is applied after the placeholders are filled, to the one word right before a placeholder and only when the
// string came from the language's dictionary. The value must start with a letter of its own, a vowel or a mute h, and
// its first word be plain letters: "Anna", "Émile-Marie" and "ouvrir" elide, "app.js", "anna@x.com", "8" and "Yann" do
// not (when in doubt, don't). The web page (public/i18n.js) and Android (I18n.kt) read the same data, from
// GET /api/i18n/<code>, and apply the same rule.
const fs = require('fs');
const path = require('path');

const VOWELS = 'aeiouàâäéèêëîïôöùûüœæ';
// The first word of a value, when it is made of letters alone and ends where a word ends.
const FIRST_WORD = /^([\p{L}\p{M}][\p{L}\p{M}'’-]*)(?=$|[\s,;:!?)»…])/u;

// A language's elision rule from its folder's phrases.json, or null when it declares none (or a broken one).
function of(lang, dir = __dirname) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, lang, 'phrases.json'), 'utf8')).elision; } catch { return null; }
  if (!raw || typeof raw.words !== 'object' || !raw.words) return null;
  const words = Object.fromEntries(Object.entries(raw.words).filter(([w, e]) => /^\p{L}+$/u.test(w) && typeof e === 'string' && e));
  if (!Object.keys(words).length) return null;
  return { words, silentH: Array.isArray(raw.silentH) ? raw.silentH.filter((h) => typeof h === 'string').map((h) => h.toLowerCase()) : [] };
}

// Whether `value` starts with a sound that takes the elided form.
function soft(value, rule) {
  const word = FIRST_WORD.exec(value)?.[1];
  if (!word) return false;
  const lower = word.toLowerCase();
  return VOWELS.includes(lower[0]) || (lower[0] === 'h' && rule.silentH.includes(lower.split('-')[0]));
}

const regexes = new WeakMap();
// `text` with its {placeholders} filled from `vars`, a word of the rule that stands right before one elided where the
// value asks for it.
function fill(text, vars, rule) {
  if (!rule) return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  if (!regexes.has(rule)) regexes.set(rule, new RegExp(`(?<![\\p{L}\\p{N}'’])(${Object.keys(rule.words).join('|')})([ \\u00a0\\u202f])\\{(\\w+)\\}|\\{(\\w+)\\}`, 'giu'));
  return String(text).replace(regexes.get(rule), (m, word, space, k, plain) => {
    const key = k ?? plain;
    if (!(key in vars)) return m;
    const value = String(vars[key]);
    const form = word && rule.words[word.toLowerCase()];
    if (!form || !soft(value, rule)) return word ? `${word}${space}${value}` : value;
    return (word[0] === word[0].toUpperCase() ? form[0].toUpperCase() + form.slice(1) : form) + value;
  });
}

module.exports = { of, soft, fill };

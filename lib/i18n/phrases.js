// The words botdot reads in what the owner, a bot or the Chief wrote (ADR 280): a short "no" that says the bot got it
// wrong, the words that start a decision's reason, a figure's source that says there is none… English's are in the
// code that reads them, written in English as the dictionary's keys are. Every other language's are in its folder's
// phrases.json, one list per kind below, so a language brings its own without touching that code. The lists of every
// offered language are read together: an owner may write in a language other than the interface's.
//
// A phrase is matched as whole words, case aside; spaces in it stand for any run of spaces, a "*" at its end for the
// rest of a word ("popraw*" is "popraw", "poprawię", "popraw to"), a "#" for a number ("co # minut*"). In a language
// written without spaces ("spaced": false in languages.json) a phrase is found inside a word too.
const fs = require('fs');
const path = require('path');
const i18n = require('.');

// Each kind, and what reads it. The apps get the kinds in APP_KINDS with the dictionary (GET /api/i18n/<code>).
const KINDS = {
  stopWords: 'lib/memory.js: filler words a note search leaves out ("the", "and")',
  corrections: 'lib/outcomes.js: how a message that tells a bot it got it wrong starts ("no", "wrong", "try again")',
  never: 'lib/bot-hints.js: a word that makes a line of a main assignment one about what the bot never does ("never", "not")',
  schedule: 'lib/bot-hints.js: words that say when a bot wakes ("daily", "every morning", "every # minutes")',
  yes: 'lib/choices.js: the first word of an answer button that says yes ("yes", "sure")',
  no: 'lib/choices.js: the first word of an answer button that says no ("no", "cancel", "later")',
  nothingNew: 'lib/reporting.js: a whole report that says there is nothing to report ("nothing new", "no changes")',
  because: 'public/company-floor.js, ProjectPlanner.kt: the word between a decision and its reason ("because")',
  noSource: 'public/answer-view.js, AnswerView.kt: a figure\'s source that says there is none ("none", "unknown", "no source")',
  nameEndings: 'public/app.js, BotNames.kt: an ending the language puts on a name ("Alfred" → "Alfredowi"), for a bot\'s name as a link',
  password: 'public/vault.js: a word for "password" before a password typed into a message',
};
const APP_KINDS = ['because', 'noSource', 'nameEndings', 'password'];

// One language's phrases: each kind's list of non-empty strings (missing kinds are empty). A broken file is an error:
// test/i18n.test.js reads every one.
function of(lang, dir = i18n.DIR) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, lang, 'phrases.json'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  const out = {};
  for (const kind of Object.keys(KINDS)) {
    const l = raw[kind];
    if (l !== undefined && (!Array.isArray(l) || l.some((p) => typeof p !== 'string' || !p.trim()))) throw new Error(`${lang}/phrases.json: ${kind} is not a list of phrases`);
    out[kind] = (l || []).map((p) => p.trim());
  }
  return out;
}

const cache = new Map();
// Every offered language's phrases, English's aside: [{ lang, spaced, phrases }].
function all() {
  const key = i18n.offered().join(',');
  if (!cache.has(key)) cache.set(key, i18n.offered().filter((l) => l !== i18n.DEFAULT).map((lang) => ({ lang, spaced: i18n.info(lang).spaced !== false, phrases: of(lang) })));
  return cache.get(key);
}

// One kind's phrases of every offered language but English, each once.
const list = (kind) => [...new Set(all().flatMap((l) => l.phrases[kind] || []))];

// The kinds the apps read, for GET /api/i18n/<code>.
const forApps = () => Object.fromEntries(APP_KINDS.map((k) => [k, list(k)]));

const EDGE = '[\\p{L}\\p{N}_]';
// A phrase as a regular expression's source (see the top of this file).
function source(phrase) {
  const rest = phrase.endsWith('*');
  const body = (rest ? phrase.slice(0, -1) : phrase).trim().split(/\s+/).map((w) => w.split('#').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\d+')).join('\\s+');
  return rest ? `${body}${EDGE}*` : body;
}

// One kind's phrases of every offered language but English as one regular expression (flags "iu"), or null when there
// are none. start: only at the start of the text, after any spaces. A spaced language's phrase is a whole word.
function regex(kind, { start = false } = {}) {
  const parts = all().flatMap(({ spaced, phrases }) => (phrases[kind] || []).map((p) => (spaced ? `(?<!${EDGE})${source(p)}(?!${EDGE})` : source(p))));
  if (!parts.length) return null;
  return new RegExp(`${start ? '^\\s*' : ''}(?:${parts.join('|')})`, 'iu');
}

module.exports = { KINDS, APP_KINDS, of, all, list, forApps, regex, source };

// The Play listing's words in each language (docs/google-play/README.md, ADR 280): captions/<code>.json holds a
// language's line of the feature graphic (`feature`) and the caption of each phone screenshot (`screenshots`, by the
// file's name in screenshots/raw/), so a language brings its own file and every language with one is drawn.
// <code> is a language of lib/i18n/languages.json; its store listing texts are listing-<code>.md beside it.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'captions');

/** Every language with captions: [{ lang, feature, screenshots }], English first, then by code. */
function all(dir = DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    .sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)))
    .map((lang) => ({ lang, ...JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8')) }));
}

/** The feature graphic's file of a language: feature-1024x500.png in English, feature-1024x500-<code>.png in another. */
const featureFile = (lang) => (lang === 'en' ? 'feature-1024x500.png' : `feature-1024x500-${lang}.png`);

module.exports = { DIR, all, featureFile };

// A note is the owner's only when it holds the owner's own words (ADR 273, which amends ADR 015). A bot or the Chief
// that saves what the owner said copies their words into `quote`; the server looks for them in what the owner wrote
// that this run or turn was handed, and only then, with ADR 015's rule, says "the owner said". The quote is checked
// and thrown away: it is never stored and never shown.

// Quote marks of any language, taken out of both sides: a bot that copies "I'm vegan" out of a text typed with ’ must not fail.
const MARKS = /["'`´‘’‚‛“”„‟«»‹›「」『』]/gu;
// What a sentence ends with, ignored at the end of the quote only: the dot, the question mark, the dash.
const END = /[\s.,;:!?…\-–—)\]}]+$/u;
const WORD = /[\p{L}\p{N}]+/gu;
const BOUNDARY = /[\p{L}\p{N}]/u;

// A least number of words below which a quote holds no one's own words: "vegan", "yes", "Berlin".
const MIN_WORDS = 2;

// A text as it is compared: lower case, no quote marks, one space between words.
const flat = (text) => String(text ?? '').replace(MARKS, '').replace(/\s+/g, ' ').trim().toLowerCase();
const normalize = (text) => flat(text).replace(END, '').trim();
const words = (text) => (normalize(text).match(WORD) || []).length;

// Whether `quote` is found in one of `sources`, the owner's own texts. Not found: no quote, fewer than two words, or
// words that stand in none of them. The match is on whole words, so "am vegan" is not found in "I am veganuary".
function found(quote, sources) {
  const q = normalize(quote);
  if (typeof quote !== 'string' || !q || words(quote) < MIN_WORDS) return false;
  for (const source of Array.isArray(sources) ? sources : []) {
    const text = flat(source);
    for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + 1)) {
      const before = text[at - 1];
      const after = text[at + q.length];
      if ((before === undefined || !BOUNDARY.test(before)) && (after === undefined || !BOUNDARY.test(after))) return true;
    }
  }
  return false;
}

// What a memory tool answers when it says so: the server's words, as the other answers of lib/learning.js.
const NOT_QUOTED = 'Kept as your own conclusion, not as what the owner said, because the owner\'s words were not quoted. When the owner did say it, save it again with "quote": their words, copied exactly from what they wrote.';

module.exports = { found, normalize, words, MIN_WORDS, NOT_QUOTED };

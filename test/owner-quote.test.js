// A note is the owner's only when it holds the owner's own words (ADR 276): the quote check on its own.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { found, normalize, words } = require('../lib/owner-quote');

const said = ['I live in Berlin and I am vegan. Please keep answers short!'];

test('a quote copied exactly from what the owner wrote is found', () => {
  assert.equal(found('I am vegan', said), true);
  assert.equal(found('Please keep answers short', said), true);
  assert.equal(found('I live in Berlin and I am vegan', said), true);
});

test('a quote that stands in none of the owner\'s texts is not found', () => {
  assert.equal(found('I am vegetarian', said), false);
  assert.equal(found('I am vegan', ['Find me a recipe']), false);
  assert.equal(found('I am vegan', []), false);
  assert.equal(found('I am vegan', undefined), false);
  assert.equal(found(undefined, said), false);
  assert.equal(found('', said), false);
  assert.equal(found(42, said), false);
});

test('the comparison ignores case, spacing, quote marks and end punctuation', () => {
  assert.equal(found('i AM   vegan', said), true);
  assert.equal(found('"I am vegan."', said), true);
  assert.equal(found('“I am vegan”', said), true);
  assert.equal(found('I am vegan.', said), true);
  assert.equal(found('Please keep answers short!!!', said), true);
  assert.equal(found('I am vegan…', said), true);
  // A typographic apostrophe on one side and a plain one on the other.
  assert.equal(found("I'm vegan", ['Note that I’m vegan, thanks']), true);
  assert.equal(found('I\nam\tvegan', said), true);
  assert.equal(normalize('  “Hello,   World!” '), 'hello, world');
  assert.equal(found('ŁÓDŹ jest piękna', ['Mieszkam w Łodzi. Łódź jest piękna.']), true);
});

test('the words must stand together, in order, and whole', () => {
  assert.equal(found('vegan am I', said), false);
  assert.equal(found('I am vegan', ['I am veganuary']), false);
  assert.equal(found('I am vegan', ['I am vegan']), true);
  assert.equal(found('am vegan', ['I am vegan']), true);
  assert.equal(found('Berlin and I', said), true);
});

test('a quote of fewer than two meaningful words does not count', () => {
  assert.equal(words('vegan'), 1);
  assert.equal(words('"Vegan."'), 1);
  assert.equal(words('!!! ...'), 0);
  assert.equal(words('I am'), 2);
  assert.equal(found('vegan', said), false);
  assert.equal(found('"Vegan."', said), false);
  assert.equal(found('Berlin', said), false);
  assert.equal(found('...', said), false);
  assert.equal(found('Berlin', ['Berlin']), false);
  assert.equal(found('vegan!', ['vegan!']), false);
  assert.equal(found('am vegan', said), true);
});

test('any of the owner\'s texts may hold it', () => {
  const texts = ['Find me a recipe', 'Also: my cat is called Pixel', 'Thanks'];
  assert.equal(found('my cat is called Pixel', texts), true);
  assert.equal(found('a recipe', texts), true);
});

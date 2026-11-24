// A bot's chat stays at its end while a reply's pictures load (#1647): the part of public/replies.js that follows what a
// chat holds as it grows (followGrowth, through holdChatEnd), run against a stand-in thread. A chat at its end stays at
// its end when a picture loads and takes its height; one the owner scrolled up to read stays where it is. And the
// pictures of a reply are never lazy: one below the visible part of the chat's own scroll is never loaded, so it never
// grows, and the chat looks at its end with a picture still to come.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read } = require('./web-page');

const src = read('replies.js');
const from = src.indexOf('function holdChatEnd(');
const to = src.indexOf('// A chat\'s new replies changed');
assert.ok(from > 0 && to > from, 'replies.js has holdChatEnd and what follows growth');
const ctx = vm.createContext({ ResizeObserver: undefined });
vm.runInContext(`${src.slice(src.lastIndexOf('const heldChats', from), to)}\nthis.holdChatEnd = holdChatEnd;`, ctx);

// A thread that scrolls: its content's height and how far it is scrolled; as a browser has it, a scroll event follows a move.
function thread({ content = 3000, view = 700, top = 2300 } = {}) {
  const t = {
    listeners: {}, clientHeight: view, content, lineAt: null,
    addEventListener(type, fn, capture) { (t.listeners[type] ||= []).push({ fn, capture }); },
    get scrollHeight() { return t.content; },
    set scrollTop(v) { t.top = Math.min(v, t.content - t.clientHeight); },
    get scrollTop() { return t.top; },
    top,
    fire(type, e = {}) { for (const { fn } of t.listeners[type] || []) fn(e); },
    getBoundingClientRect() { return { top: 0 }; },
    // A "New" line at `lineAt` px of the content, as a chat opened on its New line has one.
    querySelector(sel) { return sel === '.new-line' && t.lineAt !== null ? { getBoundingClientRect: () => ({ top: t.lineAt - t.top }) } : null; },
    // The owner scrolls (or the page does): the scroll event comes after.
    scrollTo(v) { t.scrollTop = v; t.fire('scroll'); },
    // A picture loads and takes `px` of height: no scroll event, as in a browser.
    grow(px) { t.content += px; t.fire('load', { target: { offsetHeight: px } }); },
  };
  return t;
}

test('web: a chat at its end stays at its end while pictures load', () => {
  const t = thread();
  ctx.holdChatEnd(t);
  t.grow(270);
  assert.equal(t.scrollTop, t.scrollHeight - t.clientHeight, 'the first picture');
  t.grow(270);
  t.grow(270);
  assert.equal(t.scrollHeight - t.scrollTop - t.clientHeight, 0, 'all three');
});

test('web: a chat the owner scrolled up in is left where it is', () => {
  const t = thread();
  ctx.holdChatEnd(t);
  t.scrollTo(900); // reading older messages
  t.grow(270);
  assert.equal(t.scrollTop, 900);
  t.scrollTo(t.scrollHeight - t.clientHeight - 100); // back near the end: following again
  t.grow(270);
  assert.equal(t.scrollHeight - t.scrollTop - t.clientHeight, 0);
});

test('web: a chat opened on its New line keeps the line in sight while the pictures under it load', () => {
  // One line of text and three pictures under the line, the chat placed with the line 28 px from the top (scrollToNew).
  const t = thread({ content: 1400, view: 700, top: 0 });
  t.lineAt = 700;
  ctx.holdChatEnd(t);
  t.scrollTo(672);
  for (let i = 0; i < 3; i++) {
    t.grow(270);
    assert.equal(t.lineAt - t.scrollTop, 28, `the line stays where scrollToNew put it after picture ${i + 1}`);
  }
});

test('web: a chat opened on its New line still follows growth up to the line, so no more than that', () => {
  const t = thread({ content: 1400, view: 700, top: 0 });
  t.lineAt = 700;
  ctx.holdChatEnd(t);
  t.scrollTo(600); // the line is 100 px down, the end 100 px away: held
  t.grow(1000); // takes all the room
  assert.equal(t.lineAt - t.scrollTop, 28);
  assert.equal(t.scrollTop, 672);
});

test('web: a New line scrolled out of sight (above) no longer holds the chat back', () => {
  const t = thread({ content: 3000, view: 700, top: 2300 });
  t.lineAt = 200;
  ctx.holdChatEnd(t);
  t.grow(270);
  assert.equal(t.scrollHeight - t.scrollTop - t.clientHeight, 0);
});

test('web: where the chat was is read when a picture loads, so a chat drawn after it was watched is not held by a stale answer', () => {
  const t = thread({ content: 0, view: 700, top: 0 }); // empty when watched: "at its end"
  ctx.holdChatEnd(t);
  t.content = 3000; // drawn, the owner reading from the top
  t.top = 0;
  t.grow(270); // a cached picture loads before any scroll event
  assert.equal(t.scrollTop, 0);
});

test('web: a picture that fails to load (it shows its words) also keeps the chat at its end', () => {
  const t = thread();
  ctx.holdChatEnd(t);
  t.content += 60;
  t.fire('error');
  assert.equal(t.scrollHeight - t.scrollTop - t.clientHeight, 0);
});

test('web: load and error are caught on the way down, since they do not bubble; a chat is watched once', () => {
  const t = thread();
  ctx.holdChatEnd(t);
  ctx.holdChatEnd(t, () => '');
  for (const type of ['load', 'error']) {
    assert.equal(t.listeners[type].length, 1, `${type}: once`);
    assert.equal(t.listeners[type][0].capture, true, `${type}: capture`);
  }
});

test('web: the pictures of a reply are never lazy', () => {
  const chief = read('chief.js');
  const draw = chief.slice(chief.indexOf('const botFilesHTML'), chief.indexOf('const botFilesHTML') + 600);
  assert.match(draw, /<img src=/);
  assert.doesNotMatch(draw, /loading="lazy"/);
});

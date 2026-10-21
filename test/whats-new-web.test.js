// What's new on the web page (#219): after an update, the notes this person has not seen in a pop-up with "Got it",
// once; closing it any way marks the newest seen. Never over another dialog, never from a server without
// `whats-new`, and a note's text is drawn as text. The page's own code (public/whats-new.js), run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc, element } = require('./web-page');

const ENTRIES = [
  { id: '2026-10-21-b', title: 'Newer <b>note</b>', points: ['One <img src=x onerror=alert(1)>', 'Two'] },
  { id: '2026-10-20-a', title: 'Older note', points: ['Three', 'Four'] },
];

function page({ features = ['whats-new'], entries = ENTRIES, open = false } = {}) {
  const calls = [];
  const timers = [];
  const listeners = {};
  const modal = element({}, {
    open,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    close() { modal.open = false; (listeners.close || []).forEach((fn) => fn()); },
  });
  const ctx = vm.createContext({
    state: { features },
    esc,
    $: (sel) => (sel === '#modal' ? modal : null),
    openModal: (html) => { modal.html = html; modal.open = true; return modal; },
    setTimeout: (fn, ms) => timers.push([fn, ms]),
    api: async (url, opts) => { calls.push([url, opts]); return url === '/whats-new' ? { entries } : { ok: true }; },
  });
  vm.runInContext(`${read('whats-new.js')}
    Object.assign(this, { showWhatsNew });`, ctx);
  return { ctx, calls, timers, modal };
}

test('web: after an update the unseen notes show newest first with one button, as text', async () => {
  const p = page();
  await p.ctx.showWhatsNew();
  assert.deepEqual(p.calls.map(([u]) => u), ['/whats-new']);
  assert.equal(p.modal.open, true);
  assert.match(p.modal.html, /<h2>What's new<\/h2>/);
  assert.ok(p.modal.html.indexOf('Newer') < p.modal.html.indexOf('Older note'), 'newest first');
  assert.match(p.modal.html, /Newer &lt;b&gt;note&lt;\/b&gt;/);
  assert.match(p.modal.html, /One &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(p.modal.html, /<img|<b>/, 'no markup from a note');
  assert.match(p.modal.html, /data-dismiss>Got it<\/button>/);
});

test('web: closing it (Got it, ✕ or Escape all close the dialog) marks the newest note seen', async () => {
  const p = page();
  await p.ctx.showWhatsNew();
  p.modal.close();
  await new Promise((r) => setImmediate(r));
  assert.equal(JSON.stringify(p.calls.at(-1)), JSON.stringify(['/whats-new/seen', { method: 'POST', body: { id: '2026-10-21-b' } }]));
});

test('web: nothing new, or a server without whats-new, shows nothing; the latter is not even asked', async () => {
  const none = page({ entries: [] });
  await none.ctx.showWhatsNew();
  assert.equal(none.modal.open, false);
  const old = page({ features: ['unread'] });
  await old.ctx.showWhatsNew();
  assert.deepEqual(old.calls, []);
  assert.equal(old.modal.open, false);
});

test('web: it waits while another dialog is open, then shows', async () => {
  const p = page({ open: true });
  p.modal.html = 'a card';
  await p.ctx.showWhatsNew();
  assert.equal(p.modal.html, 'a card', 'the open dialog stays as it is');
  assert.equal(p.timers.length, 1);
  p.modal.open = false;
  p.timers[0][0]();
  assert.match(p.modal.html, /What's new/);
});

test('web: index.html loads whats-new.js and the page asks once, after it opened its first view', () => {
  assert.match(read('index.html'), /<script src="\/boot.js"><\/script>\s*<script src="\/whats-new.js">/); // after boot.js, as groups.js: boot's first await has passed by the time it is called
  assert.match(read('boot.js'), /showList\(\);[^\n]*\n\s*showWhatsNew\(\);/);
});

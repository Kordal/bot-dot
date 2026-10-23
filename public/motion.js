// The page's short movements (#497): one motion system, its times and curves the tokens of style.css (--t1 120 ms,
// --t2 200 ms, --t3 260 ms, --out for what enters, --in for what leaves). The movements themselves are classes there
// ("motion"); this file only starts them. Nothing here waits: a view that enters takes clicks from its first frame,
// and one that leaves takes none while it goes. Under reduced motion the style keeps a fade of --t1, or nothing.
(function (root) {
'use strict';

// A browser driven by tests (navigator.webdriver) sees each exit end at once, so that what a test checks right after
// a close is already gone; the entrances still play. (A test of the exits says it is no such browser.)
const exits = () => !(typeof navigator === 'object' && navigator.webdriver);
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// A token of style.css in ms: '--t2' → 200.
function ms(token, fallback = 200) {
  const v = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(token) : '';
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
const curve = (token) => (typeof getComputedStyle === 'function' && getComputedStyle(document.documentElement).getPropertyValue(token).trim()) || 'ease-out';

// Plays the movement `name` (a class of style.css) on `el` once, from its start. The class goes after `long` ms:
// long enough for a movement that holds its children's too (the Board's tiles, one after another).
function play(el, name, long = 450) {
  if (!el) return;
  settle(el);
  el.classList.remove(name);
  void el.offsetWidth; // the class again starts it again
  el.classList.add(name);
  clearTimeout(el._play);
  el._play = setTimeout(() => el.classList.remove(name), long);
}

// `el` leaves with the movement `name`: it stays drawn where it was, out of the layout and untouchable, while what
// replaces it is already in place, and is then hidden as the code that called this hid it (its class or its parent's).
function leave(el, name) {
  if (!el || !exits()) return;
  const box = el.getBoundingClientRect();
  if (!box.width || !box.height) return;
  settle(el);
  el.style.setProperty('--m-display', getComputedStyle(el).display);
  Object.assign(el.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  el.classList.add('m-leaving', name);
  el._leaving = name;
  el._motion = setTimeout(() => settle(el), ms('--t2') + 60);
}
// A leaving `el` stops leaving: where it is shown again before its exit ended, or when the exit is over.
function settle(el) {
  if (!el || !el._leaving) return;
  clearTimeout(el._motion);
  el.classList.remove('m-leaving', el._leaving);
  for (const p of ['left', 'top', 'width', 'height', '--m-display']) el.style.removeProperty(p);
  el._leaving = null;
}

// Redraws what `change` redraws in `box` and moves each of its `sel` that changed place from where it was to where it
// is (FLIP), told apart by their `key` attribute: the rest close up behind what left. One that was not there arrives
// as a new message does. On the first draw, out of sight or under reduced motion, nothing moves.
function flip(box, sel, key, change) {
  const before = new Map();
  for (const el of box.querySelectorAll(sel)) before.set(el.getAttribute(key), el.getBoundingClientRect());
  change();
  if (!before.size || still()) return;
  const duration = ms('--t2'), easing = curve('--out');
  for (const el of box.querySelectorAll(sel)) {
    const was = before.get(el.getAttribute(key));
    if (!was) { play(el, 'arrives', 400); continue; }
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (!was.width || !now.width || (!dx && !dy) || !el.animate) continue;
    el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration, easing });
  }
}

// What a key last said, by its id: { kind, at }. Says whether `kind` just turned from working to done (in the last
// --t3), for the one pop of the key and its words that cross-fade.
const kinds = new Map();
function justDone(id, kind, now = Date.now()) {
  const was = kinds.get(id);
  if (!was || was.kind !== kind) kinds.set(id, { kind, at: now, from: was?.kind });
  const k = kinds.get(id);
  return k.kind === 'done' && k.from === 'working' && now - k.at < 300;
}

// Without exits, dialogs close at once too (style.css, .m-exits-off).
if (typeof document === 'object' && !exits()) document.documentElement.classList.add('m-exits-off');

const api = { play, leave, settle, flip, justDone, exits, still, ms };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Motion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

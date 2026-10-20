// Diagrams in replies (#177, ADR 041). A ```mermaid block of a reply, a tile or a skill is written by mdHTML as its
// escaped code, <pre class="mermaid-src">, and this file has it drawn by botdot's own copy of Mermaid (vendor/mermaid)
// in a frame of its own, /diagram-frame.html, made the first time such a block is on the page: a page without one never
// loads Mermaid. The drawing takes the block's place with "Show code" under it, which switches to the code and back. A
// block Mermaid can't draw stays its code, with "Diagram could not be drawn" under it.
// A bot's text is never markup (ADR 004): Mermaid runs at its strict security level (no script, no click handler) in a
// frame whose policy loads nothing from anywhere while it draws, and what it drew comes back as text that is cleaned,
// still inert, before it is shown (scrub): strict keeps pictures, links and styles a bot writes into a label.
// A plain <script>, as window.Diagrams, loaded before app.js; the tests load it the same way.

(function (root) {

const FRAME = '/diagram-frame.html';
const WAIT_MS = 20000; // a frame that says nothing by then did not load

let frame = null; // the promise of the frame, ready to draw; a frame that failed is made again by the next block
const asked = new Map(); // a drawing asked of the frame, by its id -> what to do with the answer
const drawings = new Map(); // a source -> the promise of its SVG, so a thread drawn again draws no diagram again
let count = 0; // for each drawing's own id

// The frame Mermaid draws in: out of sight, but laid out, as Mermaid measures its text.
function load(doc) {
  return (frame ??= new Promise((resolve, reject) => {
    const el = doc.createElement('iframe');
    el.className = 'diagram-frame';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    const fail = (why) => { clearTimeout(timer); root.removeEventListener('message', ready); frame = null; el.remove(); reject(new Error(why)); };
    const timer = setTimeout(() => fail(`${FRAME} did not load`), WAIT_MS);
    // Its first word: Mermaid is there, or it is not.
    const ready = (e) => {
      if (e.source !== el.contentWindow || e.data?.ready === undefined) return;
      if (!e.data.ready) return fail(String(e.data.error || 'Mermaid did not load'));
      clearTimeout(timer);
      root.removeEventListener('message', ready);
      resolve(el);
    };
    root.addEventListener('message', ready);
    el.src = FRAME;
    doc.body.append(el);
  }));
}

// Each answer of the frame: the drawing it was asked for, by its id.
root.addEventListener('message', (e) => {
  const d = e.data, done = d && asked.get(d.id);
  if (!done || e.source !== done.from) return;
  asked.delete(d.id);
  if (typeof d.svg === 'string') done.resolve(d.svg); else done.reject(new Error(String(d.error || 'no drawing')));
});

// The SVG of a source. One that Mermaid can't read stays failed; one that waited on a frame that failed is tried again.
function svgOf(doc, source) {
  let svg = drawings.get(source);
  if (!svg) {
    svg = load(doc).then((el) => new Promise((resolve, reject) => {
      const id = ++count;
      asked.set(id, { from: el.contentWindow, resolve, reject });
      el.contentWindow.postMessage({ id, source }, root.location.origin);
    }), (e) => { drawings.delete(source); throw e; });
    drawings.set(source, svg);
  }
  return svg;
}

// What only the drawing's own parts may name: its markers and gradients (url(#…), #…), never another address.
const AWAY = /url\(\s*(?!['"]?#)[^)]*\)|@import/i;
const LINKS = new Set(['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'background', 'poster', 'data']);
// A drawing, still inert in its <template>, without what would load or open anything: no picture, frame or media,
// no link (a group or a span in its place keeps what it holds where it was), no handler, and no address but its own in
// an attribute or a style.
const SVG_NS = 'http://www.w3.org/2000/svg';
function scrub(content) {
  for (const el of content.querySelectorAll('img, image, picture, video, audio, source, track, iframe, frame, object, embed, script, link, meta, base, feImage')) el.remove();
  for (const a of content.querySelectorAll('a')) {
    const keep = a.ownerDocument.createElementNS(a.namespaceURI, a.namespaceURI === SVG_NS ? 'g' : 'span');
    for (const { name, value } of [...a.attributes]) keep.setAttribute(name, value); // the links go below
    keep.append(...a.childNodes);
    a.replaceWith(keep);
  }
  for (const el of content.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      const n = name.toLowerCase();
      if (n.startsWith('on') || (LINKS.has(n) && !value.trim().startsWith('#')) || AWAY.test(value)) el.removeAttribute(name);
    }
  }
  for (const style of content.querySelectorAll('style')) style.textContent = style.textContent.replace(new RegExp(AWAY.source, 'gi'), 'none');
  return content;
}

async function drawBlock(pre) {
  const doc = pre.ownerDocument;
  let svg;
  try { svg = await svgOf(doc, pre.textContent); }
  catch (e) {
    console.error('[diagram] could not be drawn:', e?.message || e);
    pre.dataset.diagram = 'failed';
    const note = doc.createElement('div');
    note.className = 'diagram-note';
    note.textContent = 'Diagram could not be drawn';
    if (pre.isConnected) pre.after(note);
    return;
  }
  if (!pre.isConnected) return; // the thread was drawn again meanwhile: its new block is drawn by itself
  pre.dataset.diagram = 'drawn';
  const figure = doc.createElement('div');
  figure.className = 'diagram';
  const picture = doc.createElement('div');
  picture.className = 'diagram-svg';
  const inert = doc.createElement('template'); // nothing in it loads until it is cleaned
  inert.innerHTML = svg;
  picture.append(scrub(inert.content));
  // As wide as Mermaid drew it (it says 100%, which is nothing in a bubble as wide as its words), and the bubble at
  // most (in place of the width Mermaid gives as its most).
  const drawing = picture.querySelector('svg'), wide = drawing?.viewBox?.baseVal?.width;
  if (wide) Object.assign(drawing.style, { width: `${Math.ceil(wide)}px`, maxWidth: '100%' });
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'diagram-toggle';
  toggle.textContent = 'Show code';
  toggle.addEventListener('click', () => {
    const showCode = pre.hidden;
    pre.hidden = !showCode;
    picture.hidden = showCode;
    toggle.textContent = showCode ? 'Show diagram' : 'Show code';
  });
  pre.replaceWith(figure);
  pre.hidden = true;
  figure.append(picture, pre, toggle);
}

// Every diagram block in `node`, or `node` itself, that is not drawn or being drawn yet.
function draw(node) {
  if (!node?.querySelectorAll) return;
  const blocks = [...(node.matches('pre.mermaid-src') ? [node] : []), ...node.querySelectorAll('pre.mermaid-src')];
  for (const pre of blocks) if (!pre.dataset.diagram) { pre.dataset.diagram = 'drawing'; drawBlock(pre); }
}

// Draws every diagram block added inside `el` from now on: a reply, a thread drawn again, a tile opened.
function watch(el) {
  if (!el) return;
  new MutationObserver((changes) => { for (const c of changes) for (const node of c.addedNodes) draw(node); }).observe(el, { childList: true, subtree: true });
  draw(el);
}

root.Diagrams = { draw, watch };
})(typeof globalThis !== 'undefined' ? globalThis : this);

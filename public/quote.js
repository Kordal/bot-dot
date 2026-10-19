// Quote (#97): text selected in one chat message, added to the message box as a Markdown quote, so the bot sees which
// part the owner means. "> " in front of each line, then a blank line, after whatever was typed already. No author name.
// The apps follow the same rules, all checked against test/fixtures/quote-cases.json (see its "about"). The web page
// loads this file as a plain <script> (window.Quote); chief.js shows the Quote button (initQuote).

(function (root) {

// The quote of the selected text: '' when there is nothing to quote.
function block(selected) {
  const lines = String(selected ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  const kept = lines.filter((l, i) => l || lines[i - 1]); // several blank lines in a row are one
  return kept.map((l) => (l ? `> ${l}` : '>')).join('\n');
}

// The message box after Quote: { text, cursor }, the cursor at the end; null when there is nothing to quote.
function add(draft, selected) {
  const quote = block(selected);
  if (!quote) return null;
  const kept = String(draft ?? '').replace(/\s+$/, '');
  const text = `${kept ? `${kept}\n\n` : ''}${quote}\n\n`;
  return { text, cursor: text.length };
}

// The text of a selection in a message (a range's cloneContents()), as the owner saw it: a list keeps its "- " or
// "1. ", paragraphs keep a blank line between them, a line break is one, a bot named in the owner's message is its
// "@" mention. pre: the message keeps its spaces and line breaks (the owner's own, drawn as written).
const SKIP = new Set(['SVG', 'BUTTON', 'IMG', 'SCRIPT', 'STYLE']);
const PARAS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR']);
function read(root, pre = false) {
  let out = '';
  const breaks = (n) => {
    if (!out) return;
    const have = out.length - out.replace(/\n+$/, '').length;
    if (have < n) out += '\n'.repeat(n - have);
  };
  const walk = (node, keep, depth) => {
    if (node.nodeType === 3) {
      let t = String(node.nodeValue ?? '');
      if (!keep) {
        t = t.replace(/[ \t\r\n\f]+/g, ' ');
        if (!out || out.endsWith('\n')) t = t.replace(/^ /, '');
      }
      out += t;
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return; // an element, or the fragment itself
    const tag = String(node.nodeName || '').toUpperCase();
    const cls = node.classList;
    if (SKIP.has(tag) || cls?.contains('bubble-files')) return;
    if (tag === 'BR') { out += '\n'; return; }
    if (cls?.contains('mention') && node.getAttribute?.('title')) { out += node.getAttribute('title'); return; }
    const kids = () => { for (const c of node.childNodes || []) walk(c, keep || tag === 'PRE', depth); };
    if (tag === 'LI') {
      breaks(1);
      const list = node.parentNode, ordered = String(list?.nodeName || '').toUpperCase() === 'OL';
      const items = [...(list?.childNodes || [])].filter((c) => String(c.nodeName).toUpperCase() === 'LI');
      const n = (Number(list?.getAttribute?.('start')) || 1) + Math.max(0, items.indexOf(node));
      out += '  '.repeat(depth) + (ordered ? `${n}. ` : '- ');
      for (const c of node.childNodes || []) walk(c, keep, depth + 1);
      breaks(1);
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      const inner = depth > 0; // a list inside an item
      breaks(inner ? 1 : 2);
      for (const c of node.childNodes || []) walk(c, keep, inner ? depth : 0);
      breaks(inner ? 1 : 2);
      return;
    }
    if (tag === 'TD' || tag === 'TH') {
      if (!out.endsWith('\n') && out) out += ' | ';
      kids();
      return;
    }
    const lines = PARAS.has(tag) ? 2 : tag === 'TR' || tag === 'DIV' ? 1 : 0;
    breaks(lines);
    kids();
    breaks(lines);
  };
  walk(root, pre, 0);
  return out;
}

const api = { block, add, read };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Quote = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

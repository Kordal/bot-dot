// Copy on a code block (#285): every fenced block of a reply has a Copy button in its corner that copies the block's
// text as it was written (its <pre>'s text, not its escaped HTML), a diagram's block too (its source); an inline
// `code` has none. The page's own md() and its copy handler, cut out of public/app.js. test/browser/code-copy.cjs
// checks the same in a real page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, words } = require('./web-page');

const page = vm.createContext({ ...words, esc });
vm.runInContext(`${cut('function md(src, botId)', '// Link bare web addresses after rendering')} this.md = md;`, page);
const { md } = page;

// What a browser gives as an element's text: the five escapes the page writes, as their characters.
const unescape = (s) => s.replace(/&(lt|gt|quot|#39|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' }[e]));
// The code blocks of a reply's HTML: each one's Copy button (its attributes) and the text its <pre> holds.
const blocks = (html) => [...html.matchAll(/<div class="code-block">(<pre[^>]*>)<code>([^<]*)<\/code><\/pre><button ([^>]*)>[\s\S]*?<\/button><\/div>/g)]
  .map(([, pre, code, attrs]) => ({
    pre,
    button: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
    copies: unescape(code),
  }));

// The page's copy handler, with a stand-in clipboard and timers, and a press on a Copy button of a block whose <pre>
// holds `text` (as a browser gives it).
function handler() {
  const listeners = [], copied = [], timers = [];
  const ctx = vm.createContext({ ...words,
    esc,
    ICON: { copy: '<copy>', copied: '<check>' },
    toast: (m) => assert.fail(`no toast: ${m}`),
    navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } },
    document: { addEventListener: (type, fn) => listeners.push({ type, fn }) },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  });
  vm.runInContext(cut('async function copyText(text)', '// 👍 or 👎'), ctx);
  const click = listeners.find((l) => l.type === 'click').fn;
  const press = async (text) => {
    const pre = { textContent: text };
    const box = { querySelector: (sel) => (sel === 'pre' ? pre : null) };
    const btn = { dataset: {}, innerHTML: '<copy>', closest: (sel) => (sel === '.code-block' ? box : null) };
    await click({ target: { closest: (sel) => (sel === '[data-copy], .code-copy' ? btn : null) }, stopPropagation() {} });
    return btn;
  };
  return { press, copied, timers };
}

test('web: a code block has a Copy button, and its text is the code as written, with < & and quotes', () => {
  const raw = `echo "<a href='x'>" && cat a.txt > b.txt\nif [ $a -lt 2 ]; then echo &amp; fi`;
  const html = md(`Run this:\n\n\`\`\`sh\n${raw}\n\`\`\`\n\nThen wait.`);
  const found = blocks(html);
  assert.equal(found.length, 1, 'one block, one button');
  assert.equal(found[0].copies, raw, 'the text as written: no line numbers, no newline added');
  assert.deepEqual(found[0].button, { type: 'button', class: 'copy-btn code-copy', title: 'Copy code', 'aria-label': 'Copy code' });
  assert.equal(html.match(/<button/g).length, 1);
});

test('web: each block has its own; an inline code has none', () => {
  assert.deepEqual(blocks(md('```\none\n```\n\n```js\nconst b = 2;\n```')).map((b) => b.copies), ['one', 'const b = 2;']);
  assert.doesNotMatch(md('Use `npm test` and `make lint`.'), /<button|code-block/);
});

test('web: a diagram block has Copy too, beside its source', () => {
  const src = 'flowchart LR\n  A["<b>x</b>"] --> B & C';
  const [b, more] = blocks(md(`\`\`\`mermaid\n${src}\n\`\`\``));
  assert.equal(more, undefined);
  // diagrams.js draws the picture in the place of the <pre>, inside the same box, and keeps the <pre> in it, hidden.
  assert.equal(b.pre, '<pre class="mermaid-src">');
  assert.equal(b.copies, src);
});

test('web: pressing it copies its block\'s text and shows a check for 1.5 s', async () => {
  const { press, copied, timers } = handler();
  const raw = 'a < b && c > "d"';
  const btn = await press(raw);
  assert.deepEqual(copied, [raw]);
  assert.equal(btn.innerHTML, '<check>');
  assert.deepEqual(timers.map((t) => t.ms), [1500]);
  timers[0].fn();
  assert.equal(btn.innerHTML, '<copy>');
});

test('web: the button stays in sight on a touch screen; with a mouse it shows on hover or focus; none in a draft or on a tile', () => {
  const css = read('style.css');
  assert.match(css, /\.md \.code-block \{[^}]*position: relative;[^}]*padding-right: var\(--sp-\d+\);/, 'a column of its own beside the code');
  assert.match(css, /\.md \.code-copy \{[^}]*position: absolute;[^}]*top:[^}]*right:/);
  const hover = css.match(/@media \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n\}/g)?.find((m) => m.includes('.code-copy'));
  assert.ok(hover, 'the hiding is inside @media (hover: hover) and (pointer: fine)');
  assert.match(hover, /\.md \.code-copy \{ opacity: 0; \}/);
  assert.match(hover, /\.md \.code-block:hover \.code-copy, \.md \.code-copy:focus-visible \{ opacity: 1; \}/);
  // A reply still being written may cut its code short, and a tile is pressed to run it: no Copy there.
  assert.match(css, /\n\.bubble\.draft \.code-copy, \.tile-note \.code-copy \{ display: none; \}/);
  const rest = css.replace(hover, '').replace('.bubble.draft .code-copy, .tile-note .code-copy { display: none; }', '');
  assert.doesNotMatch(rest, /\.code-copy[^{]*\{[^}]*(opacity: 0|display: none|visibility: hidden)/, 'hidden nowhere else');
});

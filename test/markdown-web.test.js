// A reply on the web page: md() cut out of public/app.js, as the Chief's tests cut it. mdBlocks reads a text into
// blocks by the rules the Android app shares (test/fixtures/markdown-cases.json); mdHTML draws them: a sub-list
// inside its item, numbers that go on, titles that stand out, quotes and rules. Nothing a bot writes is markup.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, cut, esc } = require('./web-page');

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markdown-cases.json'), 'utf8'));
const css = read('style.css');
const page = vm.createContext({ esc });
vm.runInContext(`${cut('function md(src)', '// Link bare web addresses after rendering')}
  this.md = md; this.mdBlocks = mdBlocks;`, page);
const { md, mdBlocks } = page;
const plain = (v) => JSON.parse(JSON.stringify(v));
const source = (name) => cases.find((c) => c.name.startsWith(name)).source;

// The value of a property in the rule with exactly this selector, and a length in em as a number.
const rule = (selector) => {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
  assert.ok(m, `style.css has "${selector} { … }"`);
  return m[1];
};
const prop = (selector, name) => (rule(selector).match(new RegExp(`(?:^|[;\\s])${name}: ([^;]+);`)) || [])[1];
const em = (v) => { assert.match(v, /^\d*\.?\d+em$|^0$/); return parseFloat(v); };

test('web: every case of the shared fixture is read into its blocks', () => {
  assert.ok(cases.length >= 30);
  for (const c of cases) {
    // The page escapes first, so its blocks hold escaped text.
    const expected = c.blocks.map((b) => ({ ...b, ...(b.text === undefined ? {} : { text: esc(b.text) }), ...(b.rows ? { rows: b.rows.map((r) => r.map(esc)) } : {}) }));
    assert.deepEqual(plain(mdBlocks(c.source)), expected, c.name);
  }
});

test('web: a sub-list is drawn inside its item, and a numbered list goes on after it', () => {
  assert.equal(md('1. one\n   - a\n   - b\n1. two'), '<ol><li>one<ul><li>a</li><li>b</li></ul></li><li>two</li></ol>');
  assert.equal(md('- a\n  1. x\n  1. y\n- b'), '<ul><li>a<ol><li>x</li><li>y</li></ol></li><li>b</li></ul>');
  assert.equal(md('- a\n  - b\n    - c\n- d'), '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>');
  assert.equal(md('1. one\n\n2. two\n\n3. three'), '<ol><li>one</li><li>two</li><li>three</li></ol>', 'one list, not three');
});

test('web: a numbered list starts at the number written; a bullet between numbers starts a new list', () => {
  assert.equal(md('3. a\n4. b'), '<ol start="3"><li>a</li><li>b</li></ol>');
  assert.equal(md('1. a\n- b\n5. c'), '<ol><li>a</li></ol>\n<ul><li>b</li></ul>\n<ol start="5"><li>c</li></ol>');
  // A list the parser ended (here at a table of nothing but its separator row) is not joined to the next one.
  assert.equal(md('1. a\n|---|\n1. b'), '<ol><li>a</li></ol>\n<ol><li>b</li></ol>');
});

test('web: a paragraph keeps its line breaks, and so do a continuation line and a quote', () => {
  assert.equal(md('One line\nand the next\n\nSecond.'), '<p>One line<br>and the next</p>\n<p>Second.</p>');
  assert.equal(md('1. one\n   more **about** one\n2. two'), '<ol><li>one<br>more <strong>about</strong> one</li><li>two</li></ol>');
  assert.equal(md('> one\n> *two*\nafter'), '<blockquote>one<br><em>two</em></blockquote>\n<p>after</p>');
});

test('web: a rule is a line, and headings 5 and 6 are drawn as 4', () => {
  assert.equal(md('above\n\n---\nbelow'), '<p>above</p>\n<hr>\n<p>below</p>');
  assert.equal(md('# a\n##### e\n###### f'), '<h1>a</h1>\n<h4>e</h4>\n<h4>f</h4>');
});

test('web: a bold-only line is a title, a bold sentence is not', () => {
  assert.equal(md('**Host (pve)**\n- a'), '<h3>Host (pve)</h3>\n<ul><li>a</li></ul>');
  assert.equal(md('**Do not restart the server.**\nIt is mid-backup.'), '<p><strong>Do not restart the server.</strong><br>It is mid-backup.</p>');
  assert.equal(md('**Done**'), '<p><strong>Done</strong></p>');
  // Sixty characters as the owner reads them: an ampersand counts once.
  assert.match(md(`**${'a&'.repeat(30)}**\nText.`), /^<h3>/);
  assert.match(md(`**${'a&'.repeat(30)}a**\nText.`), /^<p>/);
});

test("web: the owner's reply is a paragraph, a title, a list of three, a title, one list 1 to 4 and a paragraph", () => {
  const html = md(source("the owner's reply"));
  const shape = html.split('\n').map((b) => b.match(/^<(\w+)/)[1]);
  assert.deepEqual(shape, ['p', 'h3', 'ul', 'h3', 'ol', 'p']);
  const [, , bullets, , numbered] = html.split('\n');
  assert.equal(bullets.match(/<li>/g).length, 3);
  assert.doesNotMatch(numbered, /<\/ol>.*<ol/, 'one numbered list');
  assert.doesNotMatch(numbered, /start=/, 'it starts at 1');
  // Its four items, each with its own bullets inside it.
  assert.match(numbered, /^<ol><li>.*<\/ul><\/li><\/ol>$/);
  const items = numbered.slice('<ol>'.length, -'</ol>'.length).split('</ul></li>').filter(Boolean);
  assert.deepEqual(items.map((i) => i.match(/^<li>([^<]*)<ul>/)[1]), ['Free space on local-lvm', 'Update the kernel', 'Turn on backup verification', 'Renew the certificate']);
  assert.deepEqual(items.map((i) => i.match(/<li>/g).length - 1), [2, 2, 1, 1]);
});

test('web: nothing a bot writes is markup, in any block (Rule 6)', () => {
  const evil = '<script>alert(1)</script><img src=x onerror="alert(2)">';
  const html = md([
    evil, `# ${evil}`, `**${evil}**`, 'text', `- ${evil}`, `  ${evil}`, `  1. ${evil}`, '', `> ${evil}`, `> ${evil}`, '---',
    `| ${evil} | b |`, '|---|---|', `| c | ${evil} |`, '```', evil, '```', `[${evil}](https://example.com/"onmouseover="x)`, `3. ${evil}`,
  ].join('\n'));
  assert.doesNotMatch(html, /<script|<img|onerror="|onmouseover="/);
  assert.equal(html.match(/&lt;script&gt;/g).length, 13, 'every one of them is there, as text');
  // The only tags are the page's own.
  const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)[^>]*>/g)].map((m) => m[1]));
  assert.deepEqual([...tags].sort(), ['a', 'blockquote', 'br', 'code', 'h1', 'h3', 'hr', 'li', 'ol', 'p', 'pre', 'table', 'td', 'th', 'tr', 'ul'].sort());
  assert.match(md('7. x'), /^<ol start="7">/);
  assert.doesNotMatch(md('99999999999999999999. x'), /start=/, 'a number too long to be one is text');
});

test('web: tables, code blocks, links, bold, italic and inline code are drawn as before', () => {
  assert.equal(md('| A | B |\n|---|:-:|\n| 1 | **2** |'), '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td><strong>2</strong></td></tr></table>');
  assert.equal(md('```js\nconst a = 1 < 2;\n```'), '<pre><code>const a = 1 &lt; 2;</code></pre>');
  assert.equal(md('See [the page](https://example.com/a?b=1), **bold**, *italic* and `code`.'),
    '<p>See <a href="https://example.com/a?b=1" target="_blank" rel="noopener">the page</a>, <strong>bold</strong>, <em>italic</em> and <code>code</code>.</p>');
  assert.equal(md(''), '');
  assert.equal(md(null), '');
});

test('web: a title is larger than the text and stands off from what is above it', () => {
  assert.deepEqual(['h1', 'h2', 'h3', 'h4'].map((h) => prop(`.md ${h}`, 'font-size')), ['1.35em', '1.2em', '1.08em', '1em']);
  const all = '.md h1, .md h2, .md h3, .md h4';
  assert.equal(prop(all, 'font-weight'), '600');
  const [above, sides, below] = prop(all, 'margin').split(' ');
  assert.equal(sides, '0');
  const [paraGap] = prop('.md p', 'margin').split(' ');
  // A heading's em is at least the text's, so its margin is at least this much of the text's size.
  assert.ok(em(above) >= 2 * em(paraGap), 'at least twice the space between two paragraphs');
  assert.ok(em(above) > em(below), 'more above than below');
  assert.equal(prop('.md > h1:first-child, .md > h2:first-child, .md > h3:first-child, .md > h4:first-child', 'margin-top'), '0', 'none above a title that opens a reply');
});

test('web: a sub-list is indented under its item and keeps the next item at a distance', () => {
  assert.ok(em(prop('.md ul, .md ol', 'padding-left')) > 0, 'a list inside an item starts right of the item\'s text');
  const [, , under] = prop('.md li > ul, .md li > ol', 'margin').split(' ');
  const [between] = prop('.md li', 'margin').split(' ');
  assert.ok(em(under) > em(between), 'more space after an item with sub-items than between two plain items');
});

test('web: a quote has a line on its left and muted text; a rule is one thin line', () => {
  assert.match(prop('.md blockquote', 'border-left'), /^\d+px solid var\(--line\)$/);
  assert.equal(prop('.md blockquote', 'color'), 'var(--muted)');
  assert.equal(prop('.md hr', 'border-top'), '1px solid var(--line)');
  assert.equal(prop('.md hr', 'border'), '0');
});

test('web: a mermaid block is its escaped code, marked for the page to draw (#177); other code blocks are not marked', () => {
  assert.equal(md('```mermaid\nflowchart LR\n  A["<b>x</b>"] --> B\n```'),
    '<pre class="mermaid-src"><code>flowchart LR\n  A[&quot;&lt;b&gt;x&lt;/b&gt;&quot;] --&gt; B</code></pre>');
  assert.equal(md('```\nplain\n```\n\n```Mermaid\nx\n```'), '<pre><code>plain</code></pre>\n<pre><code>x</code></pre>', 'only the word mermaid, as written');
});

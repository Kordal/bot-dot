import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A hook and "git rebase --exec" export these, and every git below would then write into the caller's repository.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES']) delete process.env[name];

// The real tests/integration/check-docs.sh in a Git repository of its own.
const script = fileURLToPath(new URL('../tests/integration/check-docs.sh', import.meta.url));
const temporary = (t, name) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
function fixture(t, files, prepare = () => {}, env = process.env) {
  const dir = temporary(t, 'check-docs');
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  write('tests/integration/check-docs.sh', fs.readFileSync(script, 'utf8'));
  for (const [file, text] of Object.entries(files)) write(file, text);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: dir }).status, 0);
  prepare(dir);
  return spawnSync('bash', [path.join(dir, 'tests/integration/check-docs.sh')], { encoding: 'utf8', env });
}
const md = (...lines) => `${lines.join('\n')}\n`;
// Exactly these failures, in any order: a link that must stay unscanned would add one.
function fails(result, ...patterns) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const pattern of patterns) assert.match(result.stderr, pattern);
  assert.match(result.stderr, new RegExp(`\\n${patterns.length} documentation check\\(s\\) failed`));
}
function passes(result, links, files) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`^PASS  ${links} relative links in ${files} Markdown files`));
}

test('links to existing files and headings pass: titles, encoded and non-ASCII paths, repeated headings', t => {
  const result = fixture(t, {
    'README.md': '[a](docs/guide.md "The guide") [b](docs/my%20file.md) [c](docs/zażółć.md#setup-1) [d](#top) [e](https://example.com/x.md)\n\n# Top\n',
    'docs/guide.md': '# Guide\n', 'docs/my file.md': '# File\n', 'docs/zażółć.md': '# Setup\n\n## Setup\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  4 relative links in 4 Markdown files/);
});
test('a missing file, a missing heading and an ignored file fail, also behind a title', t => {
  const result = fixture(t, {
    'README.md': '[a](docs/missing.md "t") [b](docs/guide.md#nowhere) [c](secret.md)\n',
    'docs/guide.md': '# Guide\n', 'secret.md': '# Secret\n', '.gitignore': 'secret.md\n',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/missing\.md does not exist/);
  assert.match(result.stderr, /no heading "#nowhere" in docs\/guide\.md/);
  assert.match(result.stderr, /secret\.md is ignored by Git/);
  assert.match(result.stderr, /3 documentation check\(s\) failed/);
});
test('a link inside a code block or code span is not a link', t => {
  const result = fixture(t, { 'README.md': '`[a](missing.md)`\n\n```\n[b](missing.md)\n```\n' });
  assert.equal(result.status, 0, result.stderr);
});
test('a tracked file deleted from the working tree is not read, and a link to it fails', t => {
  const result = fixture(t, { 'README.md': '[a](docs/gone.md)\n', 'docs/gone.md': '# Gone\n' }, dir => {
    assert.equal(spawnSync('git', ['add', '--all'], { cwd: dir }).status, 0);
    fs.rmSync(path.join(dir, 'docs/gone.md'));
  });
  fails(result, /README\.md: link to docs\/gone\.md: docs\/gone\.md does not exist/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});
test('the fixtures stay out of the repository these tests are run from: what Git exports to a hook is not inherited', t => {
  const caller = temporary(t, 'check-docs-caller');
  const git = (...args) => spawnSync('git', args, { cwd: caller, encoding: 'utf8' });
  fs.writeFileSync(path.join(caller, 'kept.txt'), 'kept\n');
  assert.equal(git('init', '--quiet').status, 0);
  assert.equal(git('add', '--all').status, 0);
  // The test that stages its fixture, run the way a hook of that repository would run it. Not as a part of this run:
  // the runner starts no second run from inside a test file.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=deleted from the working tree', fileURLToPath(import.meta.url)],
    { encoding: 'utf8', env: { ...env, GIT_DIR: path.join(caller, '.git'), GIT_INDEX_FILE: path.join(caller, '.git/index') } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^# pass 1$/m, 'the test that stages its fixture ran');
  assert.equal(git('ls-files').stdout, 'kept.txt\n', 'the caller\'s index holds what it held');
  assert.notEqual(git('config', 'core.bare').stdout.trim(), 'true', 'and its repository was not initialised again');
});
test('a Markdown file is read whatever its name holds: a double quote, a backslash, a tab', t => {
  fails(fixture(t, { 'README.md': '# Top\n', 'we"ird.md': '[a](behind-quote.md)\n', 'back\\slash.md': '[b](behind-backslash.md)\n', 'a\ttab.md': '[c](behind-tab.md)\n' }),
    /we"ird\.md: link to behind-quote\.md/, /back\\slash\.md: link to behind-backslash\.md/, /a\ttab\.md: link to behind-tab\.md/);
});

test('an inline link is read with every form of title, with a target in angle brackets and with parentheses in its target', t => {
  passes(fixture(t, {
    'README.md': "[a](docs/guide.md 'The guide') [b](docs/guide.md (The guide)) [c](<docs/my file.md>) ![d](<docs/guide.md#guide> 'The guide') [e](docs/file_(1).md) [f](docs/file_(1).md#file \"t\")\n",
    'docs/guide.md': '# Guide\n', 'docs/my file.md': '# File\n', 'docs/file_(1).md': '# File\n',
  }), 6, 4);
  fails(fixture(t, { 'README.md': "[a](missing1.md 'title') [b](missing2.md (title)) [c](<missing 3.md>) ![d](missing4.png 'title') [e](missing_(5).md)\n" }),
    /missing1\.md does not exist/, /missing2\.md does not exist/, /missing 3\.md does not exist/, /missing4\.png does not exist/, /missing_\(5\)\.md does not exist/);
});
test('a link that leads out of the repository is not checked: any scheme in any case, and a host without one', t => {
  passes(fixture(t, { 'README.md': md('[a](tel:+123) [b](//example.com/x) [c](ftp://x/y) [d](HTTP://EXAMPLE.COM) [e](mailto:a@example.com)', '', '[f]: git+ssh://example.com/x.git', '[g]: //example.com/y') }), 0, 1);
});
test('a target is a path: its query dropped, its encoded "#" kept in the name, a leading "/" read from the repository root', t => {
  passes(fixture(t, {
    'README.md': '[a](docs/guide.md?plain=1) [b](docs/guide.md?plain=1#guide) [c](docs/a%23b.md) [d](docs/a%23b.md#ab) [e](/docs/guide.md)\n',
    'docs/sub/x.md': '[f](/docs/guide.md#guide) [g](/README.md) [h](../guide.md)\n', 'docs/guide.md': '# Guide\n', 'docs/a#b.md': '# AB\n',
  }), 8, 4);
  fails(fixture(t, { 'docs/sub/x.md': '[a](/docs/sub/missing.md) [b](/docs/guide.md?plain=1#nowhere) [c](x.md?a#nowhere)\n', 'docs/guide.md': '# Guide\n' }),
    /docs\/sub\/x\.md: link to \/docs\/sub\/missing\.md: docs\/sub\/missing\.md does not exist/, /no heading "#nowhere" in docs\/guide\.md/, /no heading "#nowhere" in docs\/sub\/x\.md/);
});
test('a bare #anchor that names no heading of its own file fails, inline and in a definition', t => {
  fails(fixture(t, { 'README.md': md('# Top', '', '[a](#nowhere)', '', '[b]: #gone') }),
    /README\.md: link to #nowhere: no heading "#nowhere" in README\.md/, /README\.md: link to #gone: no heading "#gone" in README\.md/);
});
test('a heading gives the anchor GitHub gives it: closing hashes, indented, quoted, emphasis, a byte-order mark, combining marks', t => {
  passes(fixture(t, {
    'README.md': md(
      '[a](#closed) [b](#indented) [c](#quoted) [d](#title-with-emph-and-strong) [e](#my_function) [f](#the-__init__-method) [g](#c) [h](docs/bom.md#guide)',
      '[i](#\uFE0F-warning) [j](#हिन्दी) [k](#empty-below)', '',
      '## Closed ##', '  ## Indented', '> ## Quoted', '## Title with _emph_ and __strong__', '## my_function', '## The `__init__` method', '# C#', '## \u26A0\uFE0F Warning', '## हिन्दी',
      // An empty heading takes no text from the line below it.
      '##', 'Empty above', '## Empty below',
    ),
    'docs/bom.md': '\uFEFF# Guide\n',
  }), 11, 2);
  fails(fixture(t, { 'README.md': md('[a](#closed-) [b](#title-with-_emph_) [c](#-warning) [d](#empty-above)', '', '## Closed ##', '## Title with _emph_', '## \u26A0\uFE0F Warning', '##', 'Empty above') }),
    /no heading "#closed-"/, /no heading "#title-with-_emph_"/, /no heading "#-warning"/, /no heading "#empty-above"/);
});
test('Git is asked once which of the targets it ignores, however many links there are', t => {
  // A git that notes how it is called, in front of the real one.
  const bin = temporary(t, 'check-docs-bin'), log = path.join(bin, 'log');
  const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >>'${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const result = fixture(t, {
    'README.md': '[a](docs/guide.md) [b](secret.md) [c](docs/other.md) [d](secret.md) [e](docs/guide.md#guide) [f](docs/zażółć.md)\n\n[g]: build/out.md\n',
    'docs/guide.md': '# Guide\n', 'docs/other.md': '# Other\n', 'docs/zażółć.md': '# Ignored\n', 'secret.md': '# Secret\n', 'build/out.md': '# Out\n', '.gitignore': 'secret.md\nbuild/\nzażółć.md\n',
  }, undefined, { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  // Each link to an ignored file is a failure of its own.
  fails(result, /link to secret\.md: secret\.md is ignored by Git/, /link to secret\.md: secret\.md is ignored by Git[^]*link to secret\.md: secret\.md is ignored by Git/, /docs\/zażółć\.md is ignored by Git/, /build\/out\.md is ignored by Git/);
  assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter(call => call.includes('check-ignore')).length, 1, fs.readFileSync(log, 'utf8'));
});
test('a target that Git cannot be asked about, one outside the repository, leaves the ignored ones reported', t => {
  fails(fixture(t, { 'README.md': '[a](secret.md) [up](..) [b](docs/guide.md)\n', 'docs/guide.md': '# Guide\n', 'secret.md': '# Secret\n', '.gitignore': 'secret.md\n' }), /secret\.md is ignored by Git/);
});

test('a fenced block is not scanned: tildes, an info string, a longer fence around a shorter one, in a list item and a quote, unclosed', t => {
  const result = fixture(t, {
    'README.md': md(
      '~~~', '[a](missing.md)', '~~~', '',
      '```sh title="x"', '[b](missing.md)', '```', '',
      '~~~ `text` with backticks', '[c](missing.md)', '~~~', '',
      '````markdown', '```', '[d](missing.md)', '```', '[e](missing.md)', '````', '',
      '~~~~', '~~~', '[f](missing.md)', '~~~~', '',
      // Neither a fence with an info string nor the other character closes a block.
      '```', '``` sh', '[g](missing.md)', '~~~', '[h](missing.md)', '```', '',
      '1. A step:', '', '    ```sh', '    [i](missing.md)', '', '    [n](missing.md)', '    ```', '',
      '- ```', '  [j](missing.md)', '', '  [o](missing.md)', '  ```', '',
      '- An item', '  with a paragraph', '', '    ```', '    [p](missing.md)', '    ```', '',
      '> ```', '> [k](missing.md)', '>', '> [q](missing.md)', '> ```', '',
      '   ~~~', '   [l](missing.md)', '   ~~~', '',
      // Indented under a paragraph is not inside a list item: the text of such a block may start at the margin.
      'A paragraph:', '  ```', '[r](missing.md)', '  ```', '',
      '[real](docs/guide.md)',
    ),
    'docs/guide.md': md('# Guide', '', '```', '[m](missing.md)'),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  1 relative links in 2 Markdown files/);
});
test('a fence closes on its own character, at least as long, and what follows it is scanned again', t => {
  fails(fixture(t, {
    'README.md': md(
      '```', '~~~', '```', '[a](after-backticks.md)', '',
      '~~~~', '~~~', '[x](inside.md)', '~~~~', '[b](after-tildes.md)', '',
      '````', '```', '[y](inside.md)', '````', '[c](after-long.md)', '',
      // Backticks in the info string: a code span, which opens no block.
      '```one``` [d](after-span.md)',
    ),
  }), /after-backticks\.md does not exist/, /after-tildes\.md does not exist/, /after-long\.md does not exist/, /after-span\.md does not exist/);
});
test('a fenced block ends with the quote or the list item it stands in, closed or not: what follows is scanned', t => {
  fails(fixture(t, {
    'README.md': md(
      // The fence of the quote does not pair with the next one of the file, which would turn code into prose and prose into code.
      '> ```', '> [w](in-quote.md)', '', 'See [a](after-quote.md).', '', '```', '[x](in-block.md)', '```', '',
      '- step one:', '  ```', '  [y](in-item.md)', '- step two, see [b](next-item.md)', '',
      'A list whose first item starts with the fence:', '- ```', '  [z](on-the-marker-line.md)', '- next, see [c](after-marker-line.md)', '',
      // Closed inside its item or quote, a block ends where it is closed.
      '- An item:', '  ```', '  [u](in-closed-block.md)', '  ```', '  and behind its block [e](same-item.md)', '',
      '> ```', '> [t](in-closed-block.md)', '> ```', '> and behind its block [f](same-quote.md)', '',
      '1. A step:', '', '    ~~~', '    [v](in-numbered-item.md)', '', 'See [d](after-numbered-item.md).',
    ),
  }), /after-quote\.md does not exist/, /next-item\.md does not exist/, /after-marker-line\.md does not exist/, /same-item\.md does not exist/, /same-quote\.md does not exist/, /after-numbered-item\.md does not exist/);
});
test('a heading inside a fenced block or a comment is no anchor; a heading with a code span is', t => {
  fails(fixture(t, {
    'README.md': '[a](docs/guide.md#guide) [b](docs/guide.md#in-tildes) [c](docs/guide.md#in-backticks) [d](docs/guide.md#in-a-comment) [e](docs/guide.md#the-make-lint-ax-target)\n',
    'docs/guide.md': md('# Guide', '', '~~~', '# In tildes', '~~~', '', '```sh', '# In backticks', '```', '', '<!--', '# In a comment', '-->', '', '## The `make lint a[x]` target'),
  }), /no heading "#in-tildes" in docs\/guide\.md/, /no heading "#in-backticks" in docs\/guide\.md/, /no heading "#in-a-comment" in docs\/guide\.md/);
});

test('a code span of any number of backticks is not scanned, also wrapped onto the next line', t => {
  const result = fixture(t, {
    'README.md': md(
      '``[a](missing.md)`` and `` `[b](missing.md)` `` and ```[c](missing.md)```.',
      'A span that wraps: `[d](missing.md)',
      'and ends here` [e](docs/guide.md).',
      'A lone `` is no span: [f](docs/guide.md) and [`code` in the text](docs/guide.md#guide).', '',
      '- In a list item: `[g](missing.md)', '  and ends here`.', '',
      '> In a quote: `[h](missing.md)', '> and ends here`.', '',
      // A quote goes on in a line without its marker.
      '> In a quote that goes on lazily: `[i](missing.md)', 'and ends here`.', '',
      '## In a heading: `[j](missing.md)` and `[k](missing.md)`', '',
      '| In a row: `[l](missing.md)` | `[m](missing.md)` |',
    ),
    'docs/guide.md': '# Guide\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  3 relative links in 2 Markdown files/);
});
test('a code span ends at its own run of backticks, and a stray backtick hides nothing beyond its block', t => {
  fails(fixture(t, {
    'README.md': md(
      '``a ` b ``` c`` [a](after-double.md)',
      '`one` [b](between.md) `two`',
      '\\` [c](escaped.md) \\`', '',
      '- a stray ` in one item', '- [d](next-item.md) and `code`', '',
      '| a stray ` in one row |', '| [e](next-row.md) and `code` |', '',
      'A stray ` before a heading', '## A [f](heading.md) with `code`', '',
      'A stray ` before a fenced block', '```', 'code ` here', '```', '[g](after-block.md) and `code`', '',
      'A stray ` in a paragraph', '',
      '[h](next-paragraph.md) and `code`', '',
      '## A stray ` in a heading', '[i](under-heading.md) and `code`', '',
      'A stray ` before a quote', '> [j](in-quote.md) and `code`', '',
      '> A stray ` in a quote', '>', '> [k](after-quote-blank.md) and `code`', '',
      'A stray ` in a title', '---', '[l](under-title.md) and `code`', '',
      'A stray ` in a title with a short underline', '-', '[m](under-short-underline.md) and `code`', '',
      'A stray ` in another title', '===', '[n](under-equals.md) and `code`', '',
      'A stray ` before a rule', '_ _ _', '[o](under-rule.md) and `code`', '',
      'a stray ` in | a header', '--- | ---', '[p](table-row.md) | `code`', '',
      '| a stray ` in | the last row |', '[q](after-table.md) and `code`',
    ),
  }), /after-double\.md does not exist/, /between\.md does not exist/, /escaped\.md does not exist/, /next-item\.md does not exist/, /next-row\.md does not exist/,
  /heading\.md does not exist/, /after-block\.md does not exist/, /next-paragraph\.md does not exist/, /under-heading\.md does not exist/, /in-quote\.md does not exist/,
  /after-quote-blank\.md does not exist/, /under-title\.md does not exist/, /under-short-underline\.md does not exist/, /under-equals\.md does not exist/, /under-rule\.md does not exist/,
  /table-row\.md does not exist/, /after-table\.md does not exist/);
});
test('a backslash that is escaped itself escapes nothing: the code span or the comment behind it opens', t => {
  passes(fixture(t, { 'README.md': 'A path C:\\\\`[a](missing.md)` and a comment \\\\<!-- [b](missing.md) --> behind one.\n' }), 0, 1);
  // An odd number of them does escape, also where the file starts.
  fails(fixture(t, { 'README.md': '\\`[a](behind-one.md)\\` and \\\\\\`[b](behind-three.md)\\`\n' }), /behind-one\.md does not exist/, /behind-three\.md does not exist/);
});
test('CRLF line endings read the same', t => {
  const result = fixture(t, {
    'README.md': ['`[a](missing.md)', 'wrapped', 'twice` [b](docs/guide.md#guide)', '~~~', '[c](missing.md)', '~~~', '[text][ref]', '', '[ref]: docs/guide.md', ''].join('\r\n'),
    'docs/guide.md': '# Guide\r\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  2 relative links in 2 Markdown files/);
});

test('an HTML comment is not scanned: on a line, behind a checkbox, in a sentence, over several lines, in a list item and a quote', t => {
  const result = fixture(t, {
    'README.md': md(
      '<!-- [a](missing.md) -->',
      '- [ ] <!-- [b](missing.md) -->',
      'Text <!-- [c](missing.md) --> and [d](docs/guide.md).',
      'A comment joins nothing: [i]<!-- c -->(missing.md).',
      'A comment that wraps <!-- [j](missing.md)', 'onto the next line [k](missing.md) --> of its paragraph.',
      '<!--', '[e](missing.md)', '```', '[f][undefined] and a stray `', '[g]: missing.md', '-->',
      // One that starts its line, item or quote is a block, which a blank line does not end.
      '<!--', '[l](missing.md)', '', '[m](missing.md)', '-->',
      '- <!-- in a list item', '', '  [n](missing.md)', '  -->',
      '> <!-- in a quote', '>', '> [o](missing.md)', '> -->',
      '[h](docs/guide.md)',
    ),
    'docs/guide.md': '# Guide\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  2 relative links in 2 Markdown files/);
});
test('what a comment or code holds opens nothing: the text after it is scanned', t => {
  fails(fixture(t, {
    'README.md': md(
      '<!--', '```', '-->', '[a](after-comment.md)', '',
      '```html', '<!--', '```', '[b](after-block.md)', '',
      '`<!--` [c](after-span.md)', '',
      '<!--> [e](after-empty-comment.md)', '',
      '<!-- A Mermaid flowchart (a ```mermaid block) of the journey. -->', '[d](after-placeholder.md)',
    ),
  }), /after-comment\.md does not exist/, /after-block\.md does not exist/, /after-span\.md does not exist/, /after-empty-comment\.md does not exist/, /after-placeholder\.md does not exist/);
});
test('a "<!--" without its "-->" is text and hides nothing: in a sentence, in indented code, closed only in a later paragraph, at the start of a line', t => {
  fails(fixture(t, {
    'README.md': md(
      'Placeholders open with <!-- and are replaced during planning: [a](docs/guide.md#later).', '',
      '[b](after-sentence.md) and [text][undefined]', '',
      '    sed -n "/<!--/p" file', '',
      '[c](after-code.md)', '',
      'Write <!-- to open.', '', '[d](between.md)', '', 'Write --> to close.', '',
      '[defined]: docs/guide.md', '',
      '<!-- never closed', '[e](after-line-start.md)',
    ),
    // The heading below the mention is a heading still.
    'docs/guide.md': md('# Guide', 'A comment opens with <!-- in HTML.', '## Later'),
  }), /after-sentence\.md does not exist/, /reference to \[undefined\]: no definition/, /after-code\.md does not exist/, /between\.md does not exist/, /after-line-start\.md does not exist/);
});

test('reference definitions with existing targets pass: titles, angle brackets, an anchor, indented, quoted, any case', t => {
  const result = fixture(t, {
    'README.md': md(
      '[guide]: docs/guide.md',
      '[titled]: docs/guide.md "The guide"',
      '[single]: docs/guide.md \'The guide\'',
      '[paren]: docs/guide.md (The guide)',
      '[angle]: <docs/my file.md>',
      '[both]: <docs/guide.md#guide> "The guide"',
      '[self]: #top',
      '[encoded]: docs/my%20file.md',
      '[external]: https://example.com/missing.md',
      '   [Mixed  Case]: docs/guide.md',
      '> [quoted]: docs/guide.md', '',
      '# Top', '',
      '[text][guide], [titled][], [text][MIXED case], ![image][angle], [text][quoted], [text][external] and',
      '[a text that', 'wraps][both].',
    ),
    'docs/guide.md': '# Guide\n', 'docs/my file.md': '# File\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  10 relative links in 3 Markdown files/);
});
test('a definition is read wherever one may stand: in a list item, under a heading or a rule, behind another one, in a quote that interrupts a paragraph, behind a block that its item ended', t => {
  passes(fixture(t, {
    'README.md': md(
      'A list under its paragraph:', '- [item]: docs/guide.md', '',
      '# References', '[heading]: docs/guide.md', '',
      'A title', '---', '[rule]: docs/guide.md', '',
      // The target of the first and the title of the third stand on lines of their own.
      '[late]:', '  docs/guide.md', '[next]: docs/guide.md', '[titled]: docs/guide.md', '"The title"', '[last]: docs/guide.md', '',
      'Some text', '> [quoted]: docs/guide.md', '',
      '- An item:', '  ```', '  code', '[fenced]: docs/guide.md', '',
      '[a][item] [b][heading] [c][rule] [d][late] [e][next] [f][titled] [g][last] [h][quoted] [i][fenced]',
    ),
    'docs/guide.md': '# Guide\n',
  }), 8, 2);
});
test('a "[label]:" line that continues a paragraph is its text: it defines nothing and names no file', t => {
  passes(fixture(t, { 'README.md': md('Statuses:', '[todo]: unstarted', '[x]: done', '', '- A legend, in an item', '  [doing]: started', '', '> In a quote', '> [held]: waiting') }), 0, 1);
  // Nothing was defined there, which a reference shows in a file that does define a label.
  fails(fixture(t, { 'README.md': md('Statuses:', '[todo]: docs/guide.md', '', '[text][todo] and [text][guide]', '', '[guide]: docs/guide.md'), 'docs/guide.md': '# Guide\n' }), /README\.md: reference to \[todo\]: no definition/);
});
test('a reference definition fails like an inline link: a missing file, a missing heading, an ignored file, with a title and in angle brackets', t => {
  fails(fixture(t, {
    'README.md': md('[a]: docs/missing.md', '[b]: docs/guide.md#nowhere "t"', '[c]: <secret.md>', '[d]: <docs/not here.md> \'title\''),
    'docs/guide.md': '# Guide\n', 'secret.md': '# Secret\n', '.gitignore': 'secret.md\n',
  }), /README\.md: link to docs\/missing\.md: docs\/missing\.md does not exist/, /no heading "#nowhere" in docs\/guide\.md/, /secret\.md is ignored by Git/, /docs\/not here\.md does not exist/);
});
test('a reference to a label with no definition in the file fails: full, collapsed, image, wrapped, emphasised, in parentheses', t => {
  fails(fixture(t, {
    'README.md': md(
      '[text][nope], [Gone][] and ![image][lost]. [A text that', 'wraps][wrapped]. _[Emphasised][slanted]_, __[strong][bold]__ and ([in parentheses][round]).',
      '[text][defined] and [elsewhere][] are fine here.', '',
      // The limit that the script states: behind a space, text that was meant as no link reads as one, and the failure says what to do.
      'Usage: cmd [options][file]', '',
      '[defined]: docs/guide.md', '[elsewhere]: docs/guide.md',
    ),
    // A definition in another file defines nothing here.
    'docs/guide.md': md('# Guide', '', '[text][elsewhere] and [the top][top]', '', '[top]: #guide'),
  }), /README\.md: reference to \[nope\]: no definition "\[nope\]: <target>" in this file/, /README\.md: reference to \[Gone\]: no definition/, /README\.md: reference to \[lost\]: no definition/,
  /README\.md: reference to \[wrapped\]: no definition/, /README\.md: reference to \[slanted\]: no definition/, /README\.md: reference to \[bold\]: no definition/, /README\.md: reference to \[round\]: no definition/,
  /README\.md: reference to \[file\]: no definition "\[file\]: <target>" in this file \(not a link\? use a code span or \\\[\)/, /docs\/guide\.md: reference to \[elsewhere\]: no definition/);
});
test('what only looks like a reference is not flagged: a shortcut, a task-list checkbox, a footnote, an escape, code, indexing', t => {
  const result = fixture(t, {
    'README.md': md(
      'See [shortcut] and [another one].', '',
      '- [ ] an open task', '- [x] a done task', '- [ ] [shortcut] in a task', '- [ ] <!-- criterion -->', '',
      'A note[^1][^2], [^1][shortcut], [shortcut][^2], \\[a\\]\\[b\\], \\[a][b], `[c][d]`, [][] and [[wiki]].', '',
      // Behind a letter or a digit of any script, the underscore that ends a name, a bracket or a parenthesis.
      'The cell grid[row][col], cube[x][y][z], rows()[0][1], Wartość[wiersz][kolumna], v2[i][j] and data_[i][j].', '',
      '    total += matrix[i][j];', '',
      '[^1]: Footnote.', '[^2]: Another.', '',
      // A label needs a character, and a definition one target.
      '[ ]: open', '', '[Note]: two words', '',
      '~~~', '[e][f]', '[g]: missing.md', '~~~', '',
      // Counts as defined; its target is not read.
      'A definition with its target on the next line: [text][late].', '', '[late]:', '  docs/guide.md',
    ),
    'docs/guide.md': '# Guide\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  0 relative links in 2 Markdown files/);
});
test('two bracket pairs in a row are no reference in a file that defines no label: a pattern, labelled tasks, usage text', t => {
  passes(fixture(t, { 'README.md': md('| Pattern | Meaning |', '|---|---|', '| [A-Z][a-z]+ | a capitalised word |', '', '- [x] [P1][backend] Fix login', '', 'Usage: tool [-v][-q] [file], or cmd [options][file].') }), 0, 1);
});

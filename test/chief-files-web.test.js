// A late result's files in the Chief's chat, on the web page (BUSY-008): the page's own chiefBubble, reportBubble
// and botFilesHTML, cut out of public/app.js and run with its Markdown. A reply of the Chief about a bot's result
// carries that run's `files` (docs/api.md, A late result): they are drawn in its bubble with the markup a `report`
// bubble has, pictures as themselves and other files as links that download. A reply without files and a `report`
// bubble are as before. `ui/ChiefReplyTest` holds Android's side.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, noDrafts, words } = require('./web-page');

const css = read('style.css');
const page = vm.createContext({ ...noDrafts, ...words,
  esc, state: { features: [], bots: [{ id: 'surf', name: 'Web Surfer', computer: 'none' }], runs: [] }, CHIEF_COLOR: '#d85a30',
  msgTime: () => '09:12', copyBtn: () => '<copy>', choicesHTML: () => '', questionsHTML: () => '', botLabel: (b) => `<bot:${b.name}>`,
});
vm.runInContext(read('unread.js'), page);
vm.runInContext(read('ratings.js'), page);
vm.runInContext(`${cut('function md(src, botId)', '// Link bare web addresses after rendering')}
  ${cut('const fmtSize = ', '// Files botdot already has')}
  ${cut('function actionBot(a)', '// What Approve sends to answer')}
  ${cut('const reportBubble = ', '// at: the message\'s place')}
  Object.assign(this, { chiefBubble, reportBubble, botFilesHTML });`, page);
const { chiefBubble, reportBubble, botFilesHTML } = page;

const at = '2026-10-06T09:12:00Z';
const from = { kind: 'from', text: 'From Web Surfer', botId: 'surf', runId: 'r5' };
const files = [{ name: 'table.png', file: 'r5/table.png', size: 2048 }, { name: 'menu.pdf', file: 'r5/menu.pdf', size: 4096 }, { name: 'prices 2026.xlsx', file: 'r5/prices 2026.xlsx', size: 512 }];
const FILES = '<div class="bubble-files">'
  + '<a class="file-image" href="/api/files/r5/table.png" target="_blank" rel="noopener" title="table.png"><img src="/api/files/r5/table.png" alt="table.png" loading="lazy"></a>'
  + '<a class="file-chip link" href="/api/files/r5/menu.pdf" target="_blank" rel="noopener" title="menu.pdf · 4 KB">📕 <span class="fname">menu.pdf</span></a>'
  + '<a class="file-chip link" href="/api/files/r5/prices%202026.xlsx" download="prices 2026.xlsx" title="prices 2026.xlsx · 512 B">📊 <span class="fname">prices 2026.xlsx</span></a>'
  + '</div>';
// The reply's bubble: its classes and what it holds, up to the chips under it.
const bubble = (html) => html.match(/<div class="bubble from-bot([^"]*)">([\s\S]*?)<\/div>\s*<div class="actions">/);

test('web: a Chief reply about a bot\'s result draws that run\'s files under its text, as a report bubble does', () => {
  assert.equal(botFilesHTML(files), FILES, 'a picture as itself, a PDF opened, any other file downloaded');
  const html = chiefBubble({ role: 'chief', text: 'Web Surfer booked your table for 8 pm.', at, actions: [from], files });
  const [, classes, body] = bubble(html);
  assert.equal(classes.trim(), '');
  assert.equal(body, `<div class="md"><p>Web Surfer booked your table for 8 pm.</p></div>${FILES}`);
  assert.match(html, /data-kind="from"/, 'its chip is still there');
  // The same markup as under "Message from".
  assert.ok(reportBubble({ role: 'report', from: { id: 'surf', name: 'Web Surfer' }, text: 'Booked.', files }).includes(`<div class="md"><p>Booked.</p></div>${FILES}</div>`));
});

test('web: the files of a reply without words still show, and those of a failed reply stand with its problem', () => {
  const alone = chiefBubble({ role: 'chief', text: '', at, actions: [from], files });
  assert.deepEqual(bubble(alone).slice(1), [' ', FILES], 'a bubble that holds only the files');
  assert.doesNotMatch(alone, /bubble-meta/, 'no time and no copy for a reply without words, as before');
  assert.match(css, /\.bubble\.from-bot > \.bubble-files:first-child \{ margin-top: 0; \}/, 'no gap above files that stand alone');
  const problem = chiefBubble({ role: 'chief', text: '', error: 'Claude stopped answering.', at, files });
  assert.deepEqual(bubble(problem).slice(1), [' problem', `<div class="md"><p>Claude stopped answering.</p></div>${FILES}`]);
  const both = chiefBubble({ role: 'chief', text: 'Half of it.', error: 'Claude stopped answering.', at, files });
  assert.ok(both.includes(`<div class="md"><p>Half of it.</p></div>${FILES}<div class="problem-line">`), 'under the text, above the problem');
});

test('web: a Chief reply without files, and one still being written, are drawn as before', () => {
  const plain = chiefBubble({ role: 'chief', text: 'All done.', at });
  assert.equal(bubble(plain)[2], '<div class="md"><p>All done.</p></div>');
  for (const none of [[], null, undefined, 'r5/table.png', { length: 1 }, 7]) {
    assert.equal(chiefBubble({ role: 'chief', text: 'All done.', at, files: none }), plain, JSON.stringify(none));
    assert.equal(bubble(chiefBubble({ role: 'chief', text: '', at, files: none })), null, 'neither words nor files: no bubble');
  }
  const pending = chiefBubble({ pending: true, actions: [from], files });
  assert.equal(bubble(pending), null);
  assert.doesNotMatch(pending, /bubble-files/);
});

test('web: a report bubble is drawn as before', () => {
  const src = cut('const reportBubble = ', '// at: the message\'s place');
  assert.equal((src.match(/botFilesHTML\(m\.files\)/g) || []).length, 2);
  assert.equal(reportBubble({ role: 'report', from: { id: 'surf', name: 'Web Surfer' }, text: '', files: [files[0]] }).replace(/\s*\n\s*/g, ''),
    '<div class="bubble-row from-me"><div class="stack from-bot-msg"><div class="bot-msg-label">Message from <bot:Web Surfer></div>'
    + '<div class="bubble from-other-bot report-msg"><div class="bubble-files"><a class="file-image" href="/api/files/r5/table.png" target="_blank" rel="noopener" title="table.png"><img src="/api/files/r5/table.png" alt="table.png" loading="lazy"></a></div></div></div></div>');
});

test('web: a file\'s name and path are text, never markup', () => {
  const odd = [{ name: '"><script>alert(1)</script>.txt', file: 'r5/"><img src=x onerror=1>.txt', size: 1 }, { name: '<b>x</b>" onload="y.png', file: 'r5/a b&c.png' }];
  const html = chiefBubble({ role: 'chief', text: 'Here.', at, files: odd });
  assert.doesNotMatch(html, /<script|<b>|<img src=x|onerror=1>|" onload="/);
  assert.match(html, /<span class="fname">&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;\.txt<\/span>/);
  assert.match(html, /href="\/api\/files\/r5\/%22%3E%3Cimg%20src%3Dx%20onerror%3D1%3E\.txt"/);
  assert.match(html, /<img src="\/api\/files\/r5\/a%20b%26c\.png" alt="&lt;b&gt;x&lt;\/b&gt;&quot; onload=&quot;y\.png" loading="lazy">/);
});

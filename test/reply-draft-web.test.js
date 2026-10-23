// The reply draft on the web page (docs/api.md, "The reply draft", ADR 042): from a server whose `features` name
// `reply-draft`, the bot chat and the Chief chat draw the draft their stream sends in the row of the reply being
// written, in place, at most once a frame, and their end takes it away. Its Markdown is drawn by the rules the
// Android app shares (the `stream` cases of test/fixtures/markdown-cases.json). The page's own code, cut out of it
// and run against stand-ins; the group chat's drafts are in groups-web.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, esc } = require('./web-page');
const { webSource } = require('./web-source');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markdown-cases.json'), 'utf8'));
const app = webSource();
const plain = (v) => JSON.parse(JSON.stringify(v));
const mdPage = vm.createContext({ esc });
vm.runInContext(`${cut('function md(src, botId)', '// Link bare web addresses after rendering')} this.md = md; this.mdBlocks = mdBlocks; this.draftSource = draftSource;`, mdPage);
const { md, mdBlocks, draftSource } = mdPage;

// ---------- Markdown that is still being written ----------

test('web: every stream case of the shared fixture is drawn as its blocks', () => {
  assert.ok(fixture.stream.length >= 10);
  for (const c of fixture.stream) {
    const expected = c.blocks.map((b) => ({ ...b, ...(b.text === undefined ? {} : { text: esc(b.text) }), ...(b.rows ? { rows: b.rows.map((r) => r.map(esc)) } : {}) }));
    assert.deepEqual(plain(mdBlocks(draftSource(c.source))), expected, c.name);
  }
});

test('web: a draft cut mid-table, inside a fence or at an unclosed ** or [ never draws broken', () => {
  const table = md(draftSource('| Host | Free |\n|---|---|\n| pve | 41% |\n| nas | 1'));
  assert.equal(table, '<table><tr><th>Host</th><th>Free</th></tr><tr><td>pve</td><td>41%</td></tr></table>', 'no half row');
  // Without the Copy buttons of the code blocks and their boxes (#285, test/code-copy-web.test.js).
  const noCopy = (html) => html.replace(/<div class="code-block">(<pre[\s\S]*?<\/pre>)<button [^>]*code-copy[\s\S]*?<\/button><\/div>/g, '$1');
  const code = noCopy(md(draftSource('```sh\n# rm -rf\n- x')));
  assert.equal(code, '<pre><code># rm -rf\n- x</code></pre>', 'code stays code');
  assert.equal(noCopy(md(draftSource('```mermaid\ngraph TD\nA-->B'))), '<pre><code>graph TD\nA--&gt;B</code></pre>', 'a diagram is code until the reply is whole');
  assert.equal(noCopy(md(draftSource('```mermaid\ngraph TD\nA-->B\n```\nMore'))), '<pre><code>graph TD\nA--&gt;B</code></pre>\n<p>More</p>', 'closed too: no diagram is drawn in a draft');
  assert.equal(md(draftSource('It is **very')), '<p>It is **very</p>');
  assert.equal(md(draftSource('See [the page')), '<p>See [the page</p>');
  // A whole reply is drawn as it is without drafts.
  const whole = '## Done\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nx\n```\nEnd. **Bold** and [a link](https://example.com).';
  assert.equal(md(draftSource(whole)), md(whole));
});

// ---------- the keeper: in place, once a frame ----------

// The drafts' part of the page, with a frame the test lets go.
function drafts(features = ['reply-draft']) {
  const frames = [];
  const ctx = vm.createContext({ state: { features }, md, draftSource, requestAnimationFrame: (fn) => frames.push(fn), $: (sel, root) => root.querySelector(sel) });
  vm.runInContext(`${cut('// ---------- the reply draft ----------', '// ---------- data ----------')} this.replyDrafts = replyDrafts; this.showsDrafts = showsDrafts; this.draftHTML = draftHTML;`, ctx);
  return { ctx, frame: () => frames.splice(0).forEach((fn) => fn()), frames };
}
// A bot's reply row, which has no stack: what is drawn into it (a stack of the draft's own, its bubble), and how often.
function row() {
  const r = { isConnected: true, stack: null, draft: null, inserted: 0,
    querySelector: (sel) => (sel === '.draft-stack' || sel === '.stack' ? r.stack : null),
    insertAdjacentHTML(where, html) {
      assert.equal(where, 'afterbegin');
      const m = html.match(/^<div class="stack draft-stack"><div class="bubble from-bot draft">([\s\S]*)<\/div><\/div>$/);
      assert.ok(m, html);
      r.draft = { innerHTML: m[1], remove: () => { r.draft = null; } };
      r.stack = { querySelector: (sel) => (sel === '.draft' ? r.draft : null), remove: () => { r.stack = null; r.draft = null; } };
      r.inserted++;
    } };
  return r;
}

test('web: a draft is drawn in its row at the next frame, grows in place, and goes when it is cleared', () => {
  const { ctx, frame, frames } = drafts();
  const r = row();
  const thread = { scrollHeight: 1000, scrollTop: 940, clientHeight: 50 };
  ctx.replyDrafts.say('run1', 'Free space:\nlocal-lvm', () => [r, thread]);
  ctx.replyDrafts.say('run1', 'Free space:\nlocal-lvm 41%', () => [r, thread]);
  assert.equal(r.draft, null, 'not before the frame');
  assert.equal(frames.length, 1, 'one frame for both');
  frame();
  assert.equal(r.draft.innerHTML, '<div class="md"><p>Free space:<br>local-lvm 41%</p></div>');
  assert.equal(thread.scrollTop, 1000, 'at the end, it stays at the end');
  const bubble = r.draft;
  thread.scrollTop = 0;
  ctx.replyDrafts.say('run1', 'Free space:\nlocal-lvm 41%, nas 12%', () => [r, thread]);
  frame();
  assert.equal(r.draft, bubble, 'the same bubble: it grows in place');
  assert.equal(r.inserted, 1, 'never a second one');
  assert.match(bubble.innerHTML, /nas 12%/);
  assert.equal(thread.scrollTop, 0, 'read further up: the page does not move');
  assert.equal(ctx.replyDrafts.of('run1'), 'Free space:\nlocal-lvm 41%, nas 12%');
  ctx.replyDrafts.say('run1', '', () => [r, thread]);
  frame();
  assert.deepEqual([r.draft, r.stack], [null, null], 'cleared at a tool call, with the stack put in for it');
  ctx.replyDrafts.say('run1', 'The reply.\nAll fine.', () => [r, thread]);
  ctx.replyDrafts.end('run1');
  frame();
  assert.equal(ctx.replyDrafts.of('run1'), '', 'its end takes it away');
  assert.equal(r.draft, null, 'and nothing waits to be drawn');
  // A row that is gone is not drawn into.
  ctx.replyDrafts.say('run2', 'Text.\nMore.', () => [{ ...row(), isConnected: false }, thread]);
  frame();
  assert.equal(ctx.draftHTML(''), '');
  assert.equal(ctx.draftHTML('It is **fine**\nthere'), '<div class="bubble from-bot draft"><div class="md"><p>It is <strong>fine</strong><br>there</p></div></div>');
  assert.equal(ctx.draftHTML('<img src=x onerror=alert(1)>\nx'), '<div class="bubble from-bot draft"><div class="md"><p>&lt;img src=x onerror=alert(1)&gt;<br>x</p></div></div>', 'nothing a bot writes is markup');
});

test('web: drafts are shown only when the server lists reply-draft', () => {
  assert.equal(drafts(['reply-draft']).ctx.showsDrafts(), true);
  assert.equal(drafts(['working-line']).ctx.showsDrafts(), false);
});

// ---------- the bot chat ----------

// watchRun against a stand-in EventSource: what it calls back with.
function watched(features) {
  const sources = [];
  class EventSource { constructor(url) { this.url = url; this.closed = false; sources.push(this); } close() { this.closed = true; } }
  const lib = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'opening-line.js'), 'utf8'), lib);
  const ctx = vm.createContext({ EventSource, JSON, String, state: { features }, OpeningLine: lib.OpeningLine, showsDrafts: () => features.includes('reply-draft') });
  vm.runInContext(`${cut('function watchRun(', '// ---------- live screen preview')} this.watchRun = watchRun;`, ctx);
  const got = { drafts: [], ended: 0, lines: [] };
  ctx.watchRun('r1', () => got.ended++, null, (l) => got.lines.push(l), (d) => got.drafts.push(d));
  const send = (ev) => sources[0].onmessage({ data: JSON.stringify(ev) });
  return { got, send, es: sources[0] };
}

test('web: the bot chat hands the run\'s drafts on, from a server with drafts only, and its end after them', () => {
  const on = watched(['working-line', 'reply-draft']);
  assert.equal(on.es.url, '/api/runs/r1/stream');
  on.send({ type: 'working_line', text: 'Checking the disk' });
  on.send({ type: 'reply_draft', text: 'The disk\nhas room' });
  on.send({ type: 'reply_draft', text: '' });
  on.send({ type: 'run_end', meta: {} });
  assert.deepEqual([on.got.lines, on.got.drafts, on.got.ended, on.es.closed], [['Checking the disk'], ['The disk\nhas room', ''], 1, true]);
  const off = watched(['working-line']);
  off.send({ type: 'reply_draft', text: 'The disk\nhas room' });
  assert.deepEqual(off.got.drafts, [], 'an app whose server does not list it behaves as before');
});

test('web: the bot chat follows every run that is going, each in its own row (ADR 062), and the streams of runs drawn before close', () => {
  const all = cut('function followBotRuns(running)', '// A bot\'s running run as it happens');
  assert.match(all, /for \(const es of state\.botStreams\.splice\(0\)\) es\.close\(\);\n  running\.forEach\(followBotRun\);/);
  assert.match(cut('function renderBotChat()', '// Rejects when the task did not go'), /followBotRuns\(runs\.filter\(\(r\) => r\.status === 'running'\)\);/);
  assert.match(cut('function followBotRun(run)', '// Follow a running run'), /state\.botStreams\.push\(es\);/);
});

test('web: the bot chat draws the draft in the running run\'s row and nowhere else; its end and a refresh draw the reply as before', () => {
  const render = cut('function botThreadHTML', '// The notes other bots left for a bot');
  const [running, ended] = render.split("} else {\n    const failed = ['error', 'stopped', 'interrupted'].includes(r.status);");
  assert.ok(ended, 'the row of a running run, then the reply');
  assert.match(running, /data-live="\$\{esc\(r\.id\)\}">\$\{draftHTML\(replyDrafts\.of\(r\.id\), true\)\}\$\{botFilesHTML\(r\.files\)\}<\/div>/, 'the draft stands in the reply\'s row, in a stack as a reply\'s bubble, also when the chat is drawn again');
  assert.equal(drafts().ctx.draftHTML('Text\nmore', true), '<div class="stack draft-stack"><div class="bubble from-bot draft"><div class="md"><p>Text<br>more</p></div></div></div>');
  assert.doesNotMatch(ended, /replyDrafts|draft/i, 'an ended run is drawn as it always was: the same HTML, footer, choices, files and chips');
  const follow = cut('function followBotRun(run)', '// Follow a running run');
  assert.match(follow, /watchRun\(run\.id, \(\) => \{ state\.botStreams = state\.botStreams\.filter\(\(x\) => x !== es\); replyDrafts\.end\(run\.id\); refresh\(\); \}/, 'the end takes the draft away before the reply is drawn: a Stop leaves none');
  assert.match(follow, /\(text\) => replyDrafts\.say\(run\.id, text, \(\) => \[\$\(`\[data-live="\$\{CSS\.escape\(run\.id\)\}"\]`\), \$\('#bot-thread'\)\]\)/);
});

// ---------- the Chief chat ----------

test('web: the Chief chat draws the draft in its pending reply, from a server with drafts, and done draws the reply in its place', () => {
  const bubble = cut('function chiefBubble(', '// What Approve sends');
  assert.match(bubble, /: m\.pending \? draftHTML\(replyDrafts\.of\(`chief:\$\{state\.chatId\}`\)\) : ''\}/, 'a chat drawn again keeps the draft');
  const follow = cut('function followChief(id) {', '// EventSource reconnects after transport errors');
  assert.match(follow, /ev\.type === 'reply_draft'\) \{[\s\S]*?if \(showsDrafts\(\)\) replyDrafts\.say\(`chief:\$\{id\}`, String\(ev\.text \?\? ''\), \(\) => \[\$\$\('\[data-pending\]', thread\)\.pop\(\), thread\]\);/);
  const done = follow.slice(follow.indexOf("ev.type === 'done'"));
  assert.ok(done.indexOf('replyDrafts.end(`chief:${id}`)') >= 0 && done.indexOf('replyDrafts.end(`chief:${id}`)') < done.indexOf('row.outerHTML = chiefBubble(ev.message, true)'), 'the reply takes the draft\'s place, drawn as without drafts');
});

test('web: the page asks for no new stream and opens no socket for drafts', () => {
  assert.doesNotMatch(app, /WebSocket\([^)]*draft|\/api\/events[^'`]*draft/);
  assert.equal((app.match(/new EventSource\(/g) || []).length >= 1, true);
});

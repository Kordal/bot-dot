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
const { cut, esc, words } = require('./web-page');
const { webSource } = require('./web-source');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markdown-cases.json'), 'utf8'));
const app = webSource();
const plain = (v) => JSON.parse(JSON.stringify(v));
const mdPage = vm.createContext({ ...words, esc });
vm.runInContext(`${cut('function md(src, botId)', '// Link bare web addresses after rendering')} this.md = md; this.mdBlocks = mdBlocks; this.mdParts = mdParts; this.draftSource = draftSource;`, mdPage);
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
  assert.equal(table, '<div class="md-table"><table><thead><tr><th>Host</th><th class="num">Free</th></tr></thead><tbody><tr><td>pve</td><td class="num">41%</td></tr></tbody></table></div>', 'no half row');
  // Without the Copy buttons of the code blocks and their boxes (#285, test/code-copy-web.test.js).
  const noCopy = (html) => html.replace(/<div class="code-block">(<pre[\s\S]*?<\/pre>)<button [^>]*code-copy[\s\S]*?<\/button><\/div>/g, '$1');
  const code = noCopy(md(draftSource('```sh\n# rm -rf\n- x')));
  assert.equal(code, '<pre><code># rm -rf\n- x</code></pre>', 'code stays code');
  assert.equal(noCopy(md(draftSource('```mermaid\ngraph TD\nA-->B'))), '<pre><code>graph TD\nA--&gt;B</code></pre>', 'a diagram is code until the reply is whole');
  assert.equal(noCopy(md(draftSource('```mermaid\ngraph TD\nA-->B\n```\nMore'))), '<pre><code>graph TD\nA--&gt;B</code></pre>\n<p>More</p>', 'closed too: no diagram is drawn in a draft');
  // A mark that opens on the line being written is left out until it closes: never a flash of ** or [.
  assert.equal(md(draftSource('It is **very')), '<p>It is very</p>');
  assert.equal(md(draftSource('It is **very** good')), '<p>It is <strong>very</strong> good</p>');
  assert.equal(md(draftSource('See [the page](https://exa')), '<p>See the page</p>');
  assert.equal(md(draftSource('Run `npm ins')), '<p>Run npm ins</p>');
  assert.equal(md(draftSource('It is **very\nAnd')), '<p>It is **very<br>And</p>', 'a line that has ended is drawn as the reply will be');
  assert.equal(draftSource('Four fit.\n```js\nx\n```'), 'Four fit.\n```js\nx\n```', 'a fence is no mark');
  // A whole reply is drawn as it is without drafts.
  const whole = '## Done\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nx\n```\nEnd. **Bold** and [a link](https://example.com).';
  assert.equal(md(draftSource(whole)), md(whole));
});

// ---------- the keeper: in place, once a frame ----------

// The drafts' part of the page, with a frame the test lets go.
function drafts(features = ['reply-draft']) {
  const frames = [];
  const ctx = vm.createContext({ ...words, state: { features }, md, mdBlocks, mdParts: mdPage.mdParts, draftSource, requestAnimationFrame: (fn) => frames.push(fn), $: (sel, root) => root.querySelector(sel) });
  vm.runInContext(`${cut('// ---------- the reply draft ----------', '// ---------- data ----------')} Object.assign(this, { replyDrafts, showsDrafts, draftHTML, drawDraftMd });`, ctx);
  return { ctx, frame: () => frames.splice(0).forEach((fn) => fn(performance.now())), frames };
}
// A bot's reply row, which has no stack: what is drawn into it (a stack of the draft's own, its bubble), and how often.
function row() {
  const r = { isConnected: true, stack: null, draft: null, inserted: 0,
    querySelector: (sel) => (sel === '.draft-stack' || sel === '.stack' ? r.stack : null),
    insertAdjacentHTML(where, html) {
      assert.equal(where, 'afterbegin');
      const m = html.match(/^<div class="stack draft-stack"><div class="bubble from-bot draft">([\s\S]*)<\/div><\/div>$/);
      assert.ok(m, html);
      r.draft = { innerHTML: m[1], querySelector: () => null, remove: () => { r.draft = null; } };
      r.stack = { querySelector: (sel) => (sel === '.draft' ? r.draft : null), remove: () => { r.stack = null; r.draft = null; } };
      r.inserted++;
    } };
  return r;
}

test('web: a draft is drawn in its row at the next frame as it comes, grows in place, and goes when it is cleared', () => {
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

// A draft's row with a real .md box: its child nodes, as drawDraftMd keeps them.
function mdRow() {
  const node = (html) => ({ html, remove() { md.nodes.splice(md.nodes.indexOf(this), 1); } });
  const md = {
    nodes: [],
    get childNodes() { return md.nodes; },
    get lastChild() { return md.nodes.at(-1); },
    set innerHTML(v) { md.nodes = v ? [node(v)] : []; },
    get innerHTML() { return md.nodes.map((n) => n.html).join(''); },
    insertAdjacentHTML(where, html) { assert.equal(where, 'beforeend'); md.nodes.push(node(html)); },
  };
  const bubble = { querySelector: (sel) => (sel === '.md' ? md : null) };
  const stack = { querySelector: (sel) => (sel === '.draft' ? bubble : null), remove() { r.cleared = true; } };
  const r = { isConnected: true, inserted: 0, querySelector: (sel) => (sel === '.draft-stack' ? stack : null),
    insertAdjacentHTML() { r.inserted++; } };
  return { row: r, md };
}

test('web: a long draft is drawn whole at the next frame, never revealed bit by bit (#870)', () => {
  const { ctx, frame, frames } = drafts();
  const { row: r, md } = mdRow();
  const at = () => [r, { scrollHeight: 1000, scrollTop: 950, clientHeight: 50 }];
  const first = 'The disk on staging has 41% free, the backups take 212 GB.';
  ctx.replyDrafts.say('run1', first, at);
  assert.equal(ctx.replyDrafts.of('run1'), first, 'held whole at once');
  frame();
  assert.equal(md.innerHTML, `<p>${first}</p>`, 'drawn whole at the first frame');
  assert.equal(frames.length, 0, 'and no frame after it');
  ctx.replyDrafts.say('run1', `${first}\n\nNothing else to do.`, at);
  frame();
  assert.equal(md.innerHTML, `<p>${first}</p><p>Nothing else to do.</p>`);
  assert.equal(frames.length, 0);
  // A cleared draft goes at the next frame.
  ctx.replyDrafts.say('run1', '', at);
  frame();
  assert.equal(r.cleared, true);
  assert.doesNotMatch(cut('const replyDrafts = (() => {', '// ---------- data ----------'), /prefers-reduced-motion|graphemes|Segmenter/, 'no reveal is left');
});

test('web: a frame draws only the draft\'s last block again: the blocks before it stay in the page', () => {
  const { ctx } = drafts();
  const { md } = mdRow();
  md.innerHTML = '<p>drawn from HTML</p>';
  ctx.drawDraftMd(md, '## Disks\n\nThe disk is');
  assert.deepEqual(md.nodes.map((n) => n.html), ['<h2>Disks</h2>', '<p>The disk is</p>'], 'a box drawn from HTML is drawn whole once');
  const [head, para] = md.nodes;
  ctx.drawDraftMd(md, '## Disks\n\nThe disk is full');
  assert.equal(md.nodes[0], head, 'the heading is the same node: a selection in it stays');
  assert.notEqual(md.nodes[1], para);
  assert.deepEqual(md.nodes.map((n) => n.html), ['<h2>Disks</h2>', '<p>The disk is full</p>']);
  ctx.drawDraftMd(md, '## Disks\n\nThe disk is full.\n\n- clean');
  assert.equal(md.nodes[0], head);
  assert.deepEqual(md.nodes.map((n) => n.html), ['<h2>Disks</h2>', '<p>The disk is full.</p>', '<ul><li>clean</li></ul>']);
  const kept = md.nodes[1];
  ctx.drawDraftMd(md, '## Disks\n\nThe disk is full.\n\n- clean\n- logs');
  assert.deepEqual([md.nodes[0], md.nodes[1]], [head, kept]);
  assert.equal(md.nodes.length, 3);
  // The bot chat, the Chief chat and the group chat all draw a frame this way.
  assert.match(cut('const replyDrafts = (() => {', '// ---------- data ----------'), /if \(mdBox && text\) drawDraftMd\(mdBox, text\);/);
  assert.match(require('./web-page').read('groups.js'), /if \(mdBox\) drawDraftMd\(mdBox, text\);/);
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
  const lib = vm.createContext({ ...words });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'opening-line.js'), 'utf8'), lib);
  const ctx = vm.createContext({ ...words, EventSource, JSON, String, state: { features }, OpeningLine: lib.OpeningLine, showsDrafts: () => features.includes('reply-draft') });
  vm.runInContext(`${cut('function watchRun(', '// ---------- live screen preview')} this.watchRun = watchRun;`, ctx);
  const got = { drafts: [], ended: 0, lines: [] };
  ctx.watchRun('r1', () => got.ended++, null, (l) => got.lines.push(l), (d) => got.drafts.push(d));
  const send = (ev) => sources[0].onmessage({ data: JSON.stringify(ev) });
  return { got, send, es: sources[0] };
}

test('web: the bot chat hands the run\'s drafts on, from a server with drafts only, and its end after them', () => {
  const on = watched(['working-line', 'reply-draft']);
  assert.equal(on.es.url, '/api/runs/r1/stream?simple', 'the simple form: the page reads no raw Claude Code event');
  on.send({ type: 'working_line', text: 'Checking the disk' });
  on.send({ type: 'reply_draft', text: 'The disk\nhas room' });
  on.send({ type: 'reply_draft', text: '' });
  on.send({ type: 'end', run: {} });
  assert.deepEqual([on.got.lines, on.got.drafts, on.got.ended, on.es.closed], [['Checking the disk'], ['The disk\nhas room', ''], 1, true]);
  const off = watched(['working-line']);
  off.send({ type: 'reply_draft', text: 'The disk\nhas room' });
  assert.deepEqual(off.got.drafts, [], 'an app whose server does not list it behaves as before');
});

test('web: the bot chat follows every run that is going, each in its own row (ADR 062), once by its id, and the streams of runs that ended close (#1063)', () => {
  const all = cut('function followBotRuns(running', '// The run of a bot\'s chat the owner picked Reply on');
  // The open view's streams are the state's; a chat in the Projects screen's dock (#714) keeps its own.
  assert.match(all, /const streams = root\?\.id === 'view-bot' \? state\.botStreams : \(root\._streams \|\|= \[\]\);/);
  const opened = [];
  const ctx = vm.createContext({ state: { botStreams: [] }, $: () => null, Set });
  ctx.followBotRun = (run, root, streams) => { const s = { runId: run.id, closed: false, close() { this.closed = true; } }; opened.push(s); streams.push(s); };
  vm.runInContext(`${all} this.followBotRuns = followBotRuns;`, ctx);
  const root = { id: 'view-bot' };
  ctx.followBotRuns([{ id: 'a' }, { id: 'b' }], root);
  ctx.followBotRuns([{ id: 'a' }, { id: 'b' }], root);
  assert.deepEqual(opened.map((s) => s.runId), ['a', 'b'], 'a chat drawn again opens no stream it has');
  ctx.followBotRuns([{ id: 'b' }, { id: 'c' }], root);
  assert.deepEqual([opened.map((s) => s.runId), opened.map((s) => s.closed), [...ctx.state.botStreams].map((s) => s.runId)], [['a', 'b', 'c'], [true, false, false], ['b', 'c']], 'the stream of a run that ended closes, one new to the chat opens');
  const dock = { id: 'dock-x' };
  ctx.followBotRuns([{ id: 'b' }], dock);
  assert.deepEqual([[...dock._streams].map((s) => s.runId), ctx.state.botStreams.length], [['b'], 2], 'a chat in the dock keeps its own');
  assert.match(cut('function renderBotChat(root', '// Rejects when the task did not go'), /followBotRuns\(runs\.filter\(\(r\) => r\.status === 'running'\), root\);/);
  assert.match(cut('function followBotRun(run', '// Follow a running run'), /streams\.push\(es\);/);
});

test('web: the bot chat draws the draft in the running run\'s row and nowhere else; its end and a refresh draw the reply as before', () => {
  const render = cut('function botThreadHTML', '// The notes other bots left for a bot');
  const [running, ended] = render.split("} else {\n    const failed = ['error', 'stopped', 'interrupted'].includes(r.status);");
  assert.ok(ended, 'the row of a running run, then the reply');
  assert.match(running, /data-live="\$\{esc\(r\.id\)\}">\$\{draftHTML\(replyDrafts\.of\(r\.id\), true\)\}\$\{botFilesHTML\(r\.files\)\}<\/div>/, 'the draft stands in the reply\'s row, in a stack as a reply\'s bubble, also when the chat is drawn again');
  assert.equal(drafts().ctx.draftHTML('Text\nmore', true), '<div class="stack draft-stack"><div class="bubble from-bot draft"><div class="md"><p>Text<br>more</p></div></div></div>');
  assert.doesNotMatch(ended, /replyDrafts|draft/i, 'an ended run is drawn as it always was: the same HTML, footer, choices, files and chips');
  const follow = cut('function followBotRun(run', '// Follow a running run');
  assert.match(follow, /watchRun\(run\.id, \(\) => \{ const at = streams\.indexOf\(es\); if \(at !== -1\) streams\.splice\(at, 1\); replyDrafts\.end\(run\.id\); refresh\(\); \}/, 'the end takes the draft away before the reply is drawn: a Stop leaves none');
  assert.match(follow, /\(text\) => replyDrafts\.say\(run\.id, text, \(\) => \[\$\(`\[data-live="\$\{CSS\.escape\(run\.id\)\}"\]`, root\), thread\(\)\]\)/);
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

// A run stream that drops while its run runs comes back (#1063): the browser's own retry, or the page's after 2 s and
// longer each time when the browser gave up. One whose run ended stays closed.
test('web: a bot chat\'s run stream that drops comes back while the run runs, and stays closed once it ended (#1063)', () => {
  const sources = [];
  const timers = [];
  class EventSource { constructor(url) { this.url = url; this.closed = false; this.readyState = 0; sources.push(this); } close() { this.closed = true; this.readyState = 2; } }
  const lib = vm.createContext({ ...words });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'opening-line.js'), 'utf8'), lib);
  const state = { features: ['working-line', 'reply-draft'], runs: [{ id: 'r1', status: 'running' }] };
  const ctx = vm.createContext({ ...words, EventSource, JSON, String, Math, state, OpeningLine: lib.OpeningLine, showsDrafts: () => true,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {} });
  vm.runInContext(`${cut('function watchRun(', '// ---------- live screen preview')} this.watchRun = watchRun;`, ctx);
  const drafts = [];
  let ended = 0;
  const handle = ctx.watchRun('r1', () => ended++, null, null, (d) => drafts.push(d));
  assert.equal(handle.runId, 'r1');
  // The browser retries by itself (CONNECTING): nothing is opened twice.
  sources[0].readyState = 0;
  sources[0].onerror();
  assert.deepEqual([sources.length, sources[0].closed, timers.length], [1, false, 0]);
  // The browser gave up (CLOSED): opened again after 2 s, then 4 s, and the replay draws the draft again.
  sources[0].readyState = 2;
  sources[0].onerror();
  assert.equal(timers[0].ms, 2000);
  timers[0].fn();
  assert.equal(sources.length, 2);
  sources[1].readyState = 2;
  sources[1].onerror();
  assert.equal(timers[1].ms, 4000);
  timers[1].fn();
  sources[2].onopen();
  sources[2].onmessage({ data: JSON.stringify({ type: 'reply_draft', text: 'So far' }) });
  assert.deepEqual(drafts, ['So far']);
  sources[2].readyState = 2;
  sources[2].onerror();
  assert.equal(timers[2].ms, 2000, 'a stream that opened starts again from 2 s');
  // Its run ended (the feed said so): an error closes it for good.
  state.runs[0].status = 'success';
  timers[2].fn();
  assert.equal(sources.length, 3, 'a retry for a run that ended opens nothing');
  state.runs[0].status = 'running';
  const h1 = ctx.watchRun('r1', () => ended++);
  state.runs[0].status = 'success';
  sources[3].readyState = 0;
  sources[3].onerror();
  assert.deepEqual([sources.length, sources[3].closed, timers.length, ended], [4, true, 3, 0], 'the browser\'s own retry is stopped too');
  h1.close();
  // Closed by the chat, no retry that was waiting opens anything.
  state.runs[0].status = 'running';
  const h2 = ctx.watchRun('r1', () => ended++);
  sources[4].readyState = 2;
  sources[4].onerror();
  h2.close();
  timers[3].fn();
  assert.equal(sources.length, 5);
  sources[4].onmessage({ data: 'not json' });
});

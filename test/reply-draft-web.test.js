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
  assert.equal(table, '<table><tr><th>Host</th><th>Free</th></tr><tr><td>pve</td><td>41%</td></tr></table>', 'no half row');
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

// The drafts' part of the page, with a frame the test lets go (every 1000/60 ms). calm: reduced motion.
function drafts(features = ['reply-draft'], { calm = true } = {}) {
  const frames = [];
  let clock = 1000;
  const ctx = vm.createContext({ ...words, Intl, state: { features }, md, mdBlocks, mdParts: mdPage.mdParts, draftSource, requestAnimationFrame: (fn) => frames.push(fn), $: (sel, root) => root.querySelector(sel),
    matchMedia: (q) => ({ matches: calm && q === '(prefers-reduced-motion: reduce)' }) });
  vm.runInContext(`${cut('// ---------- the reply draft ----------', '// ---------- data ----------')} Object.assign(this, { replyDrafts, showsDrafts, draftHTML, drawDraftMd, draftRate, draftStep, graphemesOf, DRAFT_CATCH_UP });`, ctx);
  return { ctx, frame: () => frames.splice(0).forEach((fn) => fn(clock += 1000 / 60)), frames };
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

test('web: with reduced motion a draft is drawn in its row at the next frame as it comes, grows in place, and goes when it is cleared', () => {
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

// ---------- the paced reveal ----------

test('web: the pace catches up with each draft in about 250 ms, at least one grapheme a frame', () => {
  const { ctx } = drafts();
  assert.equal(ctx.DRAFT_CATCH_UP, 250);
  assert.equal(ctx.draftRate(100), 0.4, '100 graphemes behind: 0.4 a millisecond');
  assert.equal(ctx.draftRate(0), 0);
  const frame = 1000 / 60;
  assert.deepEqual(plain(ctx.draftStep(ctx.draftRate(100), frame)).map((x) => +x.toFixed(3)), [6, 0.667], 'about 6.7 a frame: 6 now, the rest carried');
  assert.equal(ctx.draftStep(ctx.draftRate(100), frame, 0.667)[0], 7, 'and one more the next');
  assert.deepEqual(plain(ctx.draftStep(ctx.draftRate(3), frame)), [1, 0], 'a short backlog still moves one a frame');
  // A whole backlog in about 250 ms: 15 frames of 1/60 s.
  let shown = 0, carry = 0, frames = 0;
  const rate = ctx.draftRate(120);
  while (shown < 120) { const [n, c] = ctx.draftStep(rate, frame, carry); shown += n; carry = c; frames++; }
  assert.ok(frames >= 14 && frames <= 16, `${frames} frames`);
  // Graphemes, not code units: an emoji or a letter with its accent is never cut.
  assert.deepEqual(plain(ctx.graphemesOf('👍🏽 ok', 1)), { text: '👍🏽', count: 1 });
  assert.equal(ctx.graphemesOf('Zażółć').count, 6);
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

test('web: a draft is revealed in many small steps between two drafts, and the run\'s end or a cleared draft stops it at once', () => {
  const { ctx, frame, frames } = drafts(['reply-draft'], { calm: false });
  const { row: r, md } = mdRow();
  const thread = { scrollHeight: 1000, scrollTop: 950, clientHeight: 50 };
  const at = () => [r, thread];
  const first = 'The disk on staging has 41% free, the backups take 212 GB.';
  ctx.replyDrafts.say('run1', first, at);
  const seen = [];
  for (let i = 0; i < 30 && frames.length; i++) { frame(); seen.push(ctx.replyDrafts.of('run1')); }
  assert.ok(seen.length >= 12, `${seen.length} frames, not one jump`);
  assert.ok(new Set(seen).size >= 12, 'each frame shows more');
  assert.ok(seen.every((t, i) => first.startsWith(t) && (i === 0 || t.length > seen[i - 1].length)), 'it only grows');
  assert.equal(seen.at(-1), first, 'and catches up');
  assert.ok(seen.length <= 17, `within about 250 ms (${seen.length} frames)`);
  assert.equal(frames.length, 0, 'no frame asked for once it has caught up');
  assert.match(md.innerHTML, /41% free, the backups take 212 GB\./);
  // The next draft goes on from what is shown: it grows from there.
  ctx.replyDrafts.say('run1', `${first}\n\nNothing else to do.`, at);
  frame();
  const next = ctx.replyDrafts.of('run1');
  assert.ok(next.length > first.length && next.length < first.length + 20, 'a few graphemes, not the whole new text');
  // A draft that does not go on from it (a tool call cleared it, then a new text) is shown at once.
  ctx.replyDrafts.say('run1', 'Another text.', at);
  assert.equal(ctx.replyDrafts.of('run1'), 'Another text.');
  frame();
  assert.equal(md.innerHTML, '<p>Another text.</p>');
  // A cleared draft goes at the next frame, whatever was still to show.
  ctx.replyDrafts.say('run1', 'Another text. And it goes on and on.', at);
  ctx.replyDrafts.say('run1', '', at);
  assert.equal(ctx.replyDrafts.of('run1'), '');
  frame();
  assert.equal(r.cleared, true, 'its bubble goes at the next frame');
  // The end: nothing is left to reveal, and no frame draws it again.
  ctx.replyDrafts.say('run2', 'A reply that is still being revealed.', at);
  frame();
  ctx.replyDrafts.end('run2');
  frames.splice(0);
  assert.equal(ctx.replyDrafts.of('run2'), '');
});

test('web: with reduced motion each draft is shown whole as it comes', () => {
  const { ctx, frame } = drafts(['reply-draft'], { calm: true });
  const { row: r, md } = mdRow();
  ctx.replyDrafts.say('run1', 'The disk on staging has 41% free.', () => [r, null]);
  assert.equal(ctx.replyDrafts.of('run1'), 'The disk on staging has 41% free.');
  frame();
  assert.equal(md.innerHTML, '<p>The disk on staging has 41% free.</p>');
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
  const all = cut('function followBotRuns(running', '// A bot\'s running run as it happens');
  // The open view's streams are the state's; a chat in the Projects screen's dock (#714) keeps its own.
  assert.match(all, /const streams = root\?\.id === 'view-bot' \? state\.botStreams : \(root\._streams \|\|= \[\]\);\n  for \(const es of streams\.splice\(0\)\) es\.close\(\);\n  running\.forEach\(\(run\) => followBotRun\(run, root, streams\)\);/);
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

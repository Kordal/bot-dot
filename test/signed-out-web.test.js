// Claude signed out, on the web page (BUSY-005): the page's own code for its standing lines and for the live
// feed, cut out of public/app.js and run against stand-ins. While the feed says Claude is signed out
// (`hello.claude`, the `claude` event) one line stands where "Can't reach botdot" stands, beside the logo on a
// wide screen and above the message box on a narrow one, its last words opening Setup; it goes when Claude is
// signed in again, and "Can't reach botdot" wins when both hold. The look is walked in
// test/browser/message-waits.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, finders, words } = require('./web-page');

const css = read('style.css');
const html = read('index.html');
const LINE = "Claude is signed out: bots can't work.";

// The page with both lines beside the logo and both above one chat's message box.
function page() {
  const hidden = () => element({}, { classes: ['hidden'] });
  const el = { away: hidden(), awayLine: hidden(), out: hidden(), outLine: hidden() };
  const doc = element({ '#away': el.away, '.away-line': [el.awayLine], '#signed-out': el.out, '.claude-line': [el.outLine] });
  const ctx = vm.createContext({ ...words, ...finders(doc), esc, fetch: async () => { throw new TypeError('Failed to fetch'); }, console: { warn() {} } });
  vm.runInContext(`${cut('const away = { on: false };', 'function esc(s)')}
    Object.assign(this, { api, away, setAway, signedOut, setSignedOut, signedOutHTML, SIGNED_OUT });`, ctx);
  const shows = (x) => !x.classList.contains('hidden');
  // [Can't reach botdot, Claude is signed out], each as [beside the logo, above the box].
  const shown = () => ({ away: [shows(el.away), shows(el.awayLine)], out: [shows(el.out), shows(el.outLine)] });
  return { ctx, shown };
}

test('web: while Claude is signed out one line stands, beside the logo and above the box, and goes when it is signed in again', () => {
  const { ctx, shown } = page();
  assert.deepEqual(shown().out, [false, false]);
  ctx.setSignedOut({ loggedIn: false });
  assert.deepEqual(shown(), { away: [false, false], out: [true, true] });
  ctx.setSignedOut({ loggedIn: false });
  assert.deepEqual(shown().out, [true, true], 'said again: it stays');
  ctx.setSignedOut({ loggedIn: true });
  assert.deepEqual(shown().out, [false, false]);
});

test('web: what says nothing about Claude leaves the line as it is', () => {
  const { ctx, shown } = page();
  ctx.setSignedOut({ loggedIn: false });
  for (const none of [undefined, null, {}, { loggedIn: 'no' }, { loggedIn: 0 }, 'x', { email: 'a@b.c' }]) {
    ctx.setSignedOut(none);
    assert.deepEqual(shown().out, [true, true], JSON.stringify(none));
  }
  const fresh = page();
  for (const none of [undefined, null, {}, { loggedIn: 'no' }, { loggedIn: 0 }]) {
    fresh.ctx.setSignedOut(none);
    assert.deepEqual(fresh.shown().out, [false, false], `a server that does not say it: no line (${JSON.stringify(none)})`);
  }
});

test('web: "Can\'t reach botdot" wins when both hold, and the signed-out line is back when botdot answers again', () => {
  const { ctx, shown } = page();
  ctx.setSignedOut({ loggedIn: false });
  ctx.setAway(true);
  assert.deepEqual(shown(), { away: [true, true], out: [false, false] });
  ctx.setAway(false);
  assert.deepEqual(shown(), { away: [false, false], out: [true, true] });
  // Signed out while botdot is away: said only once botdot answers.
  ctx.setSignedOut({ loggedIn: true });
  ctx.setAway(true);
  ctx.setSignedOut({ loggedIn: false });
  assert.deepEqual(shown(), { away: [true, true], out: [false, false] });
  ctx.setAway(false);
  assert.deepEqual(shown().out, [true, true]);
});

test('web: the line is on the page in both places, drawn as Claude is at that moment, its last words a button', () => {
  assert.match(html, /<span class="away hidden" id="signed-out" role="status"><span data-t>Claude is signed out: bots can't work\.<\/span> <button type="button" data-sign-in data-t>Sign in<\/button><\/span>\s*(?:<!--[\s\S]*?-->\s*)?<div class="search">/, 'beside the logo, in the place of "Can\'t reach botdot"');
  assert.ok(html.indexOf('id="away"') < html.indexOf('id="signed-out"') && html.indexOf('id="signed-out"') < html.indexOf('class="search"'), 'in the list\'s head');
  const { ctx } = page();
  assert.equal(ctx.SIGNED_OUT, LINE);
  assert.equal(ctx.signedOutHTML(), 'Claude is signed out: bots can&#39;t work. <button type="button" data-sign-in>Sign in</button>');
  const composer = cut('function composerHTML(placeholder', '// Files attached in a composer');
  assert.match(composer, /<div class="claude-line\$\{signedOut\.on && !away\.on \? '' : ' hidden'\}" role="status">\$\{signedOutHTML\(\)\}<\/div>/);
  assert.ok(composer.indexOf('away-line') < composer.indexOf('claude-line') && composer.indexOf('claude-line') < composer.indexOf('composer-box'), 'above the box');
});

test('web: "Sign in" opens Setup, wherever the line stands', () => {
  assert.match(app, /document\.addEventListener\('click', \(e\) => \{ if \(e\.target\.closest\('\[data-sign-in\]'\)\) setView\('setup'\); \}\);/);
  assert.match(app, /'settings', 'setup', 'connectors'\]\.includes\(view\)/, 'Setup is a view of the page');
});

test('web: the feed says it: `hello.claude` at the start and the `claude` event on every change', () => {
  const listeners = {};
  const got = [];
  const ctx = vm.createContext({ ...words,
    JSON, window: { EventSource: true }, state: {}, setTimeout: () => 0, clearTimeout() {}, setSignedOut: (c) => got.push(c),
    EventSource: class { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } },
  });
  vm.runInContext(`${cut('function followFeed()', '// ---------- boot ----------')}\nfollowFeed();`, ctx);
  const emit = (type, data) => listeners[type].forEach((fn) => fn({ data: typeof data === 'string' ? data : JSON.stringify(data) }));
  emit('hello', { version: '1', claude: { loggedIn: false }, approvals: { jobs: [], tiles: [], memory: 0 } });
  assert.equal(ctx.state.approvals.memory, 0, 'hello still brings what waits for the owner');
  emit('claude', { loggedIn: true });
  emit('claude', 'not json');
  emit('hello', { version: '1' }); // a server that does not say it
  assert.deepEqual(JSON.parse(JSON.stringify(got)), [{ loggedIn: false }, { loggedIn: true }, null]);
});

test('web: the look: the warning colour in both places; above the box only where the list is hidden; nothing is cut', () => {
  assert.match(css, /\.claude-line \{ font-size: 12\.5px; color: var\(--warn-text\); padding: 0 0 8px 6px; \}/, 'as the line it stands in for');
  assert.match(css, /\.away-line, \.send-note \{ font-size: 12\.5px; color: var\(--warn-text\); padding: 0 0 8px 6px; \}/);
  assert.match(css, /@media \(min-width: 480px\) \{ \.claude-line \{ display: none; \} \}/);
  assert.match(css, /\.claude-line:has\(~ \.send-note:not\(\.hidden\)\) \{ display: none; \}/, 'a send that failed says more: its line stands alone');
  // Beside the logo the sentence is longer than "Can't reach botdot": it wraps inside the head, and never pushes the logo out.
  assert.match(css, /\.away \{[^}]*color: var\(--warn-text\);[^}]*text-align: right;[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.side-head \{ display: flex; align-items: center;/);
  assert.match(css, /\.away \{ flex: 1;/, 'between the logo and the top bar\'s tools (#635)');
  assert.match(css, /\.away button, \.claude-line button \{[^}]*color: inherit;[^}]*font-weight: 600;[^}]*text-decoration: underline;/, '"Sign in" reads as the line\'s last words');
});

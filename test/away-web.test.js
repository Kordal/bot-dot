// "Can't reach botdot" on the web page (QW-001): api() and the away state cut out of public/app.js and run
// against a stand-in fetch and stand-in elements: the three sentences api() throws, the line on and off,
// the feed that takes it away, and a background refresh that shows no toast. The look is walked in
// test/browser/failed-send.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, element, finders, answer } = require('./web-page');

const css = read('style.css');
const html = read('index.html');

// The page with its line beside the logo and one chat's line above the message box.
function page(fetch) {
  const beside = element({}, { classes: ['hidden'] });
  const above = element({}, { classes: ['hidden'] });
  const doc = element({ '#away': beside, '.away-line': [above] });
  const ctx = vm.createContext({ ...finders(doc), fetch, console: { warn() {} }, JSON, Object, Error, Promise });
  vm.runInContext(`${cut('const away = { on: false };', 'function esc(s)')}\nthis.api = api; this.away = away; this.setAway = setAway;`, ctx);
  const shown = () => [!beside.classList.contains('hidden'), !above.classList.contains('hidden')];
  return { ctx, shown };
}
const noAnswer = async () => { throw new TypeError('Failed to fetch'); };
const thrown = (p) => p.then(() => assert.fail('it should have thrown'), (e) => e);

test('web: a request that got no answer throws "Can\'t reach botdot.", never the browser\'s own message', async () => {
  for (const browser of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
    const { ctx } = page(async () => { throw new TypeError(browser); });
    const e = await thrown(ctx.api('/bots'));
    assert.equal(e.message, "Can't reach botdot.");
    assert.equal(e.unreached, true);
  }
});

test('web: a response that is not OK throws the server\'s sentence', async () => {
  const { ctx } = page(answer(429, { error: 'The Chief already has 10 of your messages waiting here. Take one back, or wait.' }));
  const e = await thrown(ctx.api('/chief/chats/c1/messages', { method: 'POST', body: { text: 'hi' } }));
  assert.equal(e.message, 'The Chief already has 10 of your messages waiting here. Take one back, or wait.');
  assert.equal(e.refused, true);
  assert.equal(e.status, 429);
  assert.ok(!e.unreached && !e.unsure);
});

test('web: a response that is not OK and has no sentence throws the status, not the browser\'s words', async () => {
  for (const [status, body, unsure] of [[504, undefined, true], [500, {}, true], [500, undefined, true], [501, {}, true], [404, {}, false], [413, { error: '   ' }, false], [400, { error: { code: 1 } }, false]]) {
    const { ctx } = page(answer(status, body));
    const e = await thrown(ctx.api('/x'));
    assert.equal(e.message, `botdot couldn't do that (${status}).`);
    assert.equal(e.refused, false);
    assert.equal(e.unsure, unsure, `${status}: nobody knows whether botdot did it only when its side failed`);
    assert.ok(!e.unreached);
    assert.doesNotMatch(e.message, /Browser Words/);
  }
});

// QW-006: Tailscale Serve answers 502 in botdot's place while botdot is down.
test('web: a gateway saying botdot is not there (502, 503 without botdot\'s sentence) throws "Can\'t reach botdot.", as a request without an answer', async () => {
  for (const status of [502, 503]) {
    for (const body of [undefined, {}, { error: '   ' }, { error: { code: 1 } }, { message: 'Bad Gateway' }]) {
      const { ctx } = page(answer(status, body));
      const e = await thrown(ctx.api('/chief/chats/c1/messages', { method: 'POST', body: { text: 'hi' } }));
      assert.equal(e.message, "Can't reach botdot.", String(status));
      assert.equal(e.unreached, true);
      assert.ok(!e.unsure && !e.refused);
      assert.doesNotMatch(e.message, /couldn't do that|Browser Words/);
    }
  }
});

test('web: a 502, 503, 504 or 500 with botdot\'s own sentence is its refusal', async () => {
  for (const status of [502, 503, 504, 500]) {
    const { ctx, shown } = page(answer(status, { error: 'botdot is updating.' }));
    const e = await thrown(ctx.api('/bots'));
    assert.equal(e.message, 'botdot is updating.');
    assert.equal(e.refused, true);
    assert.equal(e.status, status);
    assert.ok(!e.unreached && !e.unsure);
    assert.deepEqual(shown(), [false, false], 'botdot answers');
  }
});

test('web: an answer comes back as its data, and sends what it was given', async () => {
  let sent;
  const { ctx } = page(async (url, opts) => { sent = { url, opts }; return (await answer(200, { id: 'c1' })()); });
  assert.deepEqual({ ...(await ctx.api('/chief/chats', { method: 'POST', body: { a: 1 } })) }, { id: 'c1' });
  assert.equal(sent.url, '/api/chief/chats');
  assert.equal(sent.opts.body, '{"a":1}');
  assert.equal(sent.opts.headers['X-Bot-Dot'], '1');
});

test('web: the line shows after a request that got no answer, beside the logo and above the box, and goes when one is answered', async () => {
  let reply = noAnswer;
  const { ctx, shown } = page((...a) => reply(...a));
  assert.deepEqual(shown(), [false, false]);
  await thrown(ctx.api('/bots'));
  assert.deepEqual(shown(), [true, true]);
  await thrown(ctx.api('/runs'));
  assert.deepEqual(shown(), [true, true], 'still one line');
  reply = answer(429, { error: 'The Chief already has 10 of your messages waiting here. Take one back, or wait.' });
  await thrown(ctx.api('/chief/chats/c1/messages'));
  assert.deepEqual(shown(), [false, false], 'botdot answered, even with a refusal');
  reply = noAnswer;
  await thrown(ctx.api('/bots'));
  reply = answer(200, []);
  await ctx.api('/bots');
  assert.deepEqual(shown(), [false, false]);
});

test('web: a gateway answering in botdot\'s place, with botdot down behind it, shows the line too', async () => {
  for (const status of [502, 503, 504]) {
    let reply = answer(status, undefined);
    const { ctx, shown } = page((...a) => reply(...a));
    assert.equal((await thrown(ctx.api('/bots'))).message, status === 504 ? "botdot couldn't do that (504)." : "Can't reach botdot.");
    assert.deepEqual(shown(), [true, true], String(status));
    reply = answer(503, { error: 'botdot is updating.' });
    await thrown(ctx.api('/bots'));
    assert.deepEqual(shown(), [false, false], "botdot's own sentence: it answers");
  }
  const { ctx, shown } = page(answer(500, {}));
  await thrown(ctx.api('/bots'));
  assert.deepEqual(shown(), [false, false], 'a failure inside botdot is an answer');
});

test('web: the line is on the page: beside the logo, and above every message box, drawn as botdot is at that moment', () => {
  assert.match(html, /<div class="brand" id="brand"[^>]*>.*<\/div>\s*(<!--.*-->\s*)?<span class="away hidden" id="away" role="status">Can't reach botdot<\/span>\s*(<!--.*-->\s*)?<span class="away hidden" id="signed-out" role="status">.*<\/span>\s*<\/div>/, 'with the line for a signed-out Claude after it (test/signed-out-web.test.js)');
  const composer = cut('function composerHTML(placeholder', '// Files attached in a composer');
  assert.match(composer, /<div class="away-line\$\{away\.on \? '' : ' hidden'\}" role="status">Can't reach botdot\. Trying again…<\/div>/);
  assert.ok(composer.indexOf('away-line') < composer.indexOf('composer-box'), 'above the box');
});

test('web: above the box only where the list is hidden, a phone\'s chat; both in the warning colour', () => {
  assert.match(css, /@media \(min-width: 480px\) \{ \.away-line \{ display: none; \} \}/);
  assert.match(css, /@media \(max-width: 479px\) \{[^}]*\}\s*[^@]*\.app\.in-main \.sidebar \{ display: none; \}/, 'the width below which a chat hides the list');
  assert.match(css, /\.away \{[^}]*color: var\(--warn-text\)/);
  assert.match(css, /\.away-line, \.send-note \{[^}]*color: var\(--warn-text\)/);
});

test('web: the live feed opening again takes the line away', () => {
  const { ctx, shown } = page(noAnswer);
  let feed;
  Object.assign(ctx, {
    window: { EventSource: true }, state: {}, setTimeout: () => 0, clearTimeout() {},
    EventSource: class { constructor(url) { this.url = url; feed = this; } addEventListener() {} },
  });
  vm.runInContext(`${cut('function followFeed()', '// ---------- boot ----------')}\nfollowFeed();`, ctx);
  assert.equal(feed.url, '/api/events?guarded=1'); // with the guarded memory changes (MEM-007)
  ctx.setAway(true);
  assert.deepEqual(shown(), [true, true]);
  feed.onopen();
  assert.deepEqual(shown(), [false, false]);
});

test('web: while the line shows, the page asks again soon, also when a proxy holds the feed open', () => {
  assert.match(app, /const due = \(at, ms\) => !live\(\) \|\| away\.on \|\| Date\.now\(\) - \(at \|\| 0\) >= ms;/);
});

test('web: the background refresh shows no toast while botdot is away; the line says it', async () => {
  const { ctx, shown } = page(noAnswer);
  const toasts = [];
  Object.assign(ctx, { state: {}, Date, toast: (...a) => toasts.push(a), loadSkillLib: () => Promise.resolve(), loadMentionPages: () => null, loadGroups: () => Promise.resolve([]), fresh: { check() {} } });
  vm.runInContext(`${cut('async function refresh()', 'function render()')}\nthis.refresh = refresh;`, ctx);
  await ctx.refresh();
  await ctx.refresh();
  assert.deepEqual(toasts, []);
  assert.deepEqual(shown(), [true, true]);
  assert.doesNotMatch(cut('async function refresh()', 'function render()'), /toast\(/);
});

test('web: something the owner did still says its sentence, now botdot\'s own', async () => {
  // As everywhere in app.js: `catch (e) { toast(e.message, true); }` around the owner's action.
  assert.ok((app.match(/catch \((e|err)\) \{ (return )?toast\(e(rr)?\.message, true\);/g) || []).length > 40);
  const { ctx } = page(noAnswer);
  const toasts = [];
  Object.assign(ctx, { toast: (...a) => toasts.push(a) });
  vm.runInContext(`${cut('async function stopRun(id)', '// ---------- the live feed ----------')}\nthis.stopRun = stopRun;`, ctx);
  ctx.encodeURIComponent = encodeURIComponent;
  await ctx.stopRun('r1');
  assert.deepEqual(toasts, [["Can't reach botdot.", true]]);
});

// ADR 028: a session the front door no longer knows (signed out, or ended elsewhere) takes the page to the
// front door's sign-in page; any other 401 is botdot's own refusal.
test('web: a request the front door answers "Sign in first." goes to its sign-in page', async () => {
  const went = [];
  const { ctx } = page(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Sign in first.', signIn: '/sign-in' }) }));
  ctx.location = { assign: (to) => went.push(to) };
  await thrown(ctx.api('/bots'));
  assert.deepEqual(went, ['/sign-in']);
  const other = page(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Wrong key.' }) }));
  other.ctx.location = { assign: (to) => went.push(to) };
  assert.equal((await thrown(other.ctx.api('/bots'))).message, 'Wrong key.');
  assert.deepEqual(went, ['/sign-in']);
});

// 👍 and 👎 under an unasked Chief message on the web page: public/ratings.js loaded the way the browser loads
// it (a plain script, after unread.js): what a tap makes of a rating, which messages get the thumbs (none
// against a server without `ratings`), their markup; then the page's own code, read for where it draws them,
// sends a tap, rolls it back and follows the feed. The tap itself is walked in test/browser/ratings.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webSource } = require('./web-source');
const { words } = require('./web-page');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const page = vm.createContext({ ...words });
vm.runInContext(read('unread.js'), page);
vm.runInContext(read('ratings.js'), page);
const { Ratings } = page;
const app = webSource();
const css = read('style.css');
const FEATURES = ['chief', 'unread', 'ratings'];
const unasked = { role: 'chief', text: 'Your backup bot has not run since Monday. Start it?', at: '2026-10-03T09:00:00Z', unasked: true };

test('web: the page gets it as window.Ratings, after unread.js and before app.js', () => {
  assert.equal(typeof Ratings.next, 'function');
  const html = read('index.html');
  const at = (src) => html.indexOf(`<script src="${src}">`);
  assert.ok(at('/unread.js') > 0 && at('/unread.js') < at('/ratings.js') && at('/ratings.js') < at('/app.js'));
});

test('web: a tap fills the thumb, a tap on the filled one clears it, a tap on the other moves it', () => {
  assert.equal(Ratings.next(null, 'up'), 'up');
  assert.equal(Ratings.next(null, 'down'), 'down');
  assert.equal(Ratings.next('up', 'up'), null);
  assert.equal(Ratings.next('down', 'down'), null);
  assert.equal(Ratings.next('up', 'down'), 'down');
  assert.equal(Ratings.next('down', 'up'), 'up');
  assert.equal(Ratings.next(undefined, 'up'), 'up', 'no rating yet');
  assert.equal(Ratings.next('sideways', 'down'), 'down', 'an unknown rating counts as none');
  assert.equal(Ratings.next('up', 'sideways'), 'up', 'an unknown tap changes nothing');
});

test('web: only an unasked Chief message gets the thumbs, and only from a server with ratings', () => {
  assert.equal(Ratings.shows(unasked, FEATURES, 4), true);
  assert.equal(Ratings.shows(unasked, ['chief', 'unread'], 4), false, 'an older server: no icons');
  assert.equal(Ratings.shows(unasked, [], 4), false, 'features not known yet');
  assert.equal(Ratings.shows(unasked, undefined, 4), false);
  assert.equal(Ratings.shows({ ...unasked, unasked: undefined }, FEATURES, 4), false, 'an ordinary reply');
  assert.equal(Ratings.shows({ ...unasked, unasked: 'yes' }, FEATURES, 4), false);
  assert.equal(Ratings.shows({ ...unasked, role: 'user' }, FEATURES, 4), false, "the owner's own message");
  assert.equal(Ratings.shows({ ...unasked, role: 'report' }, FEATURES, 4), false, "a bot's report");
  assert.equal(Ratings.shows({ ...unasked, pending: true }, FEATURES, 4), false, 'a reply still being written');
  for (const index of [null, undefined, -1, 1.5, '4']) assert.equal(Ratings.shows(unasked, FEATURES, index), false, `index ${index}`);
  assert.equal(Ratings.shows(unasked, FEATURES, 0), true, 'the first message of a chat');
});

test('web: two buttons with a label each, the rated one pressed, in the Chief\'s colour', () => {
  const html = Ratings.html('up', 7, '#d85a30');
  assert.match(html, /^<span class="rate" data-rate="7" style="--c:#d85a30">/);
  const buttons = html.match(/<button [^>]*>/g);
  assert.equal(buttons.length, 2);
  assert.match(buttons[0], /type="button"/);
  assert.match(buttons[0], /data-rating="up" aria-label="More like this" title="More like this" aria-pressed="true"/);
  assert.match(buttons[1], /data-rating="down" aria-label="Less like this" title="Less like this" aria-pressed="false"/);
  assert.match(Ratings.html('down', 0, '#d85a30'), /data-rating="up"[^>]*aria-pressed="false"[^]*data-rating="down"[^>]*aria-pressed="true"/);
  for (const none of [null, undefined, 'sideways']) assert.doesNotMatch(Ratings.html(none, 0, '#d85a30'), /aria-pressed="true"/, String(none));
  assert.match(Ratings.html(null, 0, 'red;background:url(x)'), /--c:#888780/, 'only a colour gets into the style');
  assert.match(Ratings.html(null, '"><img>', '#d85a30'), /data-rate="NaN"/, 'the index is a number');
});

test('web: the thumbs on screen show and change a rating', () => {
  const button = (rating) => ({ dataset: { rating }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const buttons = [button('up'), button('down')];
  const el = {
    querySelectorAll: () => buttons,
    querySelector: (sel) => (sel === '[aria-pressed="true"]' ? buttons.find((b) => b.attrs['aria-pressed'] === 'true') || null : null),
  };
  Ratings.show(el, 'down');
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'true']);
  assert.equal(Ratings.shown(el), 'down');
  Ratings.show(el, null);
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false']);
  assert.equal(Ratings.shown(el), null);
  Ratings.show(null, 'up'); // a message that is not on screen
  assert.equal(Ratings.shown(null), null);
});

test('web: the Chief\'s chat draws the thumbs after Copy, with the message\'s place in the whole chat', () => {
  assert.match(app, /copyBtn\(m\.text \|\| m\.error\)\}\$\{Ratings\.shows\(m, state\.features, index\) \? Ratings\.html\(m\.rating, index, CHIEF_COLOR\) : ''\}<\/div>/);
  assert.match(app, /messageHTML\(m, i, all, \(chat\.offset \|\| 0\) \+ i\)/, 'a chat read in part counts from its offset');
});

test('web: a tap is sent to the server and rolled back with a toast when it is refused or the server is away', () => {
  const tap = app.slice(app.indexOf("e.target.closest('.rate [data-rating]')"), app.indexOf('function toast('));
  assert.ok(tap.length > 0);
  assert.match(tap, /Ratings\.next\(before, b\.dataset\.rating\)/);
  assert.ok(tap.indexOf('Ratings.show(el, rating)') < tap.indexOf('await api('), 'filled at once');
  assert.match(tap, /api\(`\/chief\/chats\/\$\{encodeURIComponent\(chatId\)\}\/messages\/\$\{el\.dataset\.rate\}\/rating`, \{ method: 'PUT', body: \{ rating \} \}\)/);
  assert.match(tap, /catch \{\s*if \(Ratings\.shown\(el\) === rating\) Ratings\.show\(el, before\);[^\n]*\n\s*toast\(tr\("Couldn't save your rating"\), true\)/);
});

test('web: a rating made in another app shows from the feed, in the chat on screen only', () => {
  const on = app.slice(app.indexOf("es.addEventListener('rating'"), app.indexOf("es.addEventListener('checkup'"));
  assert.ok(on.length > 0);
  assert.match(on, /thread\.dataset\.chat !== d\.chatId/);
  assert.match(on, /Ratings\.show\(\$\(`\.rate\[data-rate="\$\{d\.index\}"\]`, thread\), d\.rating\)/);
});

test('web: the thumbs stay on the time\'s line, and the pressed one is filled in the Chief\'s colour', () => {
  assert.match(css, /\.bubble-meta:has\(\.rate\) \{ flex-wrap: nowrap; white-space: nowrap; \}/);
  assert.match(css, /\.rate-btn\[aria-pressed="true"\] svg \{ fill: var\(--c\); \}/);
  assert.match(css, /\.rate-btn\.down svg \{ transform: rotate\(180deg\); \}/);
  assert.match(css, /\.rate-btn:focus-visible/);
});

test('web: an unasked message that came while the Chief answered in the open chat shows, with its thumbs, when the answer is in', () => {
  // It waited for the turn on the server, so its chief_reply has no `from`: it must not pass for the Chief's own reply,
  // which the page's stream draws. The chat is drawn again from the server once the stream is done.
  const on = app.slice(app.indexOf("es.addEventListener('chief_reply'"), app.indexOf("es.addEventListener('rating'"));
  assert.ok(on.length > 0);
  assert.match(on, /if \(state\.chatStream\) \{ if \(d\.from \|\| d\.unasked\) state\.chatReload = true; \}\s*else showChat\(d\.chatId\);/);
  const done = app.slice(app.indexOf("} else if (ev.type === 'done') {"), app.indexOf("es.onerror = () => { if (state.chatId !== id) es.close(); };"));
  assert.ok(done.length > 0);
  assert.match(done, /if \(state\.chatReload\) \{ state\.chatReload = false; return showChat\(id\); \}/, 'the stream reloads the chat when it is done');
});

// A change to a bot that the Chief asked for, on the web page (OK-004): the page's own code for the cards
// (test/need-cards.js) against bot changes as the botdot server will send them (`by`, `chatId`, `title`, `parts`:
// "The contract" of OK-002) and as it sends them today. The card stands at the end of the Chief's chat as well as
// in the bot's chat and in Needs you, and answered in one it fades in the others. Its title is the server's; a
// changed text shows what goes, struck, above what comes, also on a closed card; anything else is its label and
// what it becomes in one row; without `parts` the card shows `details`, as before. The real page is walked in
// test/browser/carries-on.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { read, esc } = require('./web-page');
const { page, plain, titleOf, metaOf, thenOf, buttonsOf, rowsOf, CODER, NEWS, PERMISSION, BAD } = require('./need-cards');

const css = read('style.css');
const HERE = { who: 'chief', chatId: 'c1', text: 'The Chief carries on in “Morning tech news” when you allow it.', here: 'The Chief carries on in this chat when you allow it.' };
// As OK-002 words them: one permission, and a changed main assignment.
const WEB = { id: 'b1', kind: 'bot-change', botId: 'news', bot: NEWS, by: 'chief', chatId: 'c1', title: 'Let News Watcher browse the web?', reason: 'The Chief set it up for you',
  parts: [{ label: 'Web access', now: 'allowed' }], details: 'Tools\nNow: Read\nProposed: Read, WebSearch, WebFetch', then: HERE, at: '2026-10-05T09:00:00.000Z' };
const WAS = 'Sort the mail every morning\nand file every invoice under Finance.';
const NOW = 'Sort the mail every morning\nand file every invoice under Finance.\nFlag anything from the tax office and tell the owner the same day.';
const ASSIGNMENT = { id: 'b2', kind: 'bot-change', botId: 'coder', bot: CODER, by: 'chief', chatId: 'c2', title: 'Change Coder: new main assignment?', reason: 'You asked it to flag the tax office',
  parts: [{ label: 'Main assignment', was: WAS, now: NOW }], details: `Main assignment\nNow: ${WAS}\nProposed: ${NOW}`, at: '2026-10-05T09:01:00.000Z' };
// As the botdot server of Milestone 5 sends one.
const OLD = { id: 'b3', kind: 'bot-change', botId: 'coder', bot: CODER, title: 'Approve changes to this bot?', reason: 'To run the checks.', details: 'Tools\nNow: Read\nProposed: Read, Bash', at: '2026-10-05T09:02:00.000Z' };
// The blocks of changed texts: each [what goes, struck; what comes], null for the half it lacks.
const changes = (html) => [...html.matchAll(/<div class="need-body need-change">(?:<div class="nb faint-strike">([\s\S]*?)<\/div>)?(?:<div class="nb">([\s\S]*?)<\/div>)?<\/div>/g)].map((m) => [m[1] ?? null, m[2] ?? null]);
const labels = (html) => [...html.matchAll(/<div class="need-meta need-part">(.*?)<\/div>/g)].map((m) => m[1]);

test('web: a bot change the Chief asked for stands in the Chief\'s chat, in that bot\'s chat and in Needs you', () => {
  const p = page({ state: { asks: [WEB, ASSIGNMENT, OLD, PERMISSION], bots: [CODER, NEWS] } });
  const keys = (scope) => plain(p.chatNeeds(scope).map((x) => x.key));
  assert.deepEqual(keys('chief'), ['ask:b1', 'ask:b2'], 'the Chief\'s chat: both changes it asked for');
  assert.deepEqual(keys('news'), ['ask:b1'], 'the chat of the bot it changes');
  assert.deepEqual(keys('coder'), ['ask:b2', 'ask:b3', 'ask:p1'], 'with what that bot asked for itself');
  assert.deepEqual(keys('reader'), [], 'no other bot\'s chat');
  assert.deepEqual(plain(p.needsItems().map((x) => x.key)), ['ask:b1', 'ask:b2', 'ask:b3', 'ask:p1'], 'Needs you has every one of them');
  // A change a bot proposed for itself, and one from a server that does not say who asked: the bot's chat only, as before.
  const own = page({ state: { asks: [{ ...WEB, by: 'bot', chatId: undefined }, OLD, { ...WEB, id: 'b4', by: 'Chief' }, { ...WEB, id: 'b5', by: true }] } });
  assert.deepEqual(plain(own.chatNeeds('chief').map((x) => x.key)), []);
  assert.deepEqual(plain(own.chatNeeds('news').map((x) => x.key)), ['ask:b1', 'ask:b4', 'ask:b5']);
  // In the Chief's chat the card shows whose bot it is; in the bot's own chat the head is hidden.
  assert.match(css, /\.chat-needs:not\(\[data-scope="chief"\]\) \.need-who \{ display: none; \}/);
  assert.match(p.needCardHTML(p.item('ask:b1'), 'c1'), /<div class="need-who"><svg class="fig fig-small"><\/svg>News Watcher<\/div>/);
});

test('web: at the end of the Chief\'s chat it says "in this chat" in the chat that asked, and names that chat in another', () => {
  const p = page({ state: { asks: [WEB], bots: [NEWS] } });
  const chief = p.thread('c1');
  p.updateChatNeeds(chief.thread, 'chief');
  assert.equal(titleOf(chief.box.innerHTML), 'Let News Watcher browse the web?');
  assert.equal(thenOf(chief.box.innerHTML), 'The Chief carries on in this chat when you allow it.');
  assert.equal(chief.thread.lastElementChild, chief.box, 'the cards are the last thing in the chat');
  // All the Chief's chats share one box of cards: the change shows in whichever is open.
  chief.thread.dataset.chat = 'c9';
  p.updateChatNeeds(chief.thread, 'chief');
  assert.equal(thenOf(chief.box.innerHTML), 'The Chief carries on in “Morning tech news” when you allow it.');
  const bots = p.thread();
  p.updateChatNeeds(bots.thread, 'news');
  assert.equal(thenOf(bots.box.innerHTML), HERE.text, 'in the bot\'s chat');
  p.renderNeeds();
  assert.equal(thenOf(p.needsPage.innerHTML), HERE.text, 'in Needs you');
});

test('web: answered in one place, it fades in the others at once, and is gone from them when the page draws again', async () => {
  for (const [yes, label] of [[true, 'Allowed · the Chief carries on'], [false, 'Declined']]) {
    const p = page({ state: { asks: [WEB], bots: [NEWS] }, answer: (url, body) => (body.yes ? { ok: true, bot: NEWS, carriesOn: { who: 'chief', text: 'the Chief carries on' } } : { ok: true, declined: true }) });
    const cards = [p.show('ask:b1', 'chief', WEB.title), p.show('ask:b1', 'news', WEB.title), p.show('ask:b1', null, WEB.title)];
    await p.decide(p.item('ask:b1'), yes);
    assert.deepEqual(plain(p.calls), [['/asks/b1', 'POST', { yes, always: false }]], 'one answer');
    for (const card of cards) {
      assert.ok(card.classList.contains('done'), 'every card of it fades');
      assert.equal(card.actions.innerHTML, `<span class="muted">${label}</span>`);
    }
    const line = (scope) => ({ scope, title: 'Let News Watcher browse the web?', label });
    assert.deepEqual(plain([...p.chatDecided.values()]), [line('chief'), line('news')]);
    assert.equal(p.needsDone.get('ask:b1'), cards[2].outerHTML, 'on the Needs you page it stays, faded, until the owner leaves it');
    assert.equal(p.refreshed(), 1);
    // The ask is gone from the server's list: the chat on screen, the Chief's, shows the line in place of the card.
    p.state.asks = [];
    const chief = p.thread('c1');
    p.updateChatNeeds(chief.thread, 'chief');
    assert.equal(chief.box.innerHTML, `<div class="chat-decided">Let News Watcher browse the web? · ${label}</div>`);
    // The page keeps the faded lines of the chat on screen only (the rule a tool's card has): in the bot's chat,
    // opened afterwards, the card is gone and nothing is left of it.
    assert.deepEqual(plain([...p.chatDecided.values()]), [line('chief')]);
    const bots = p.thread();
    p.updateChatNeeds(bots.thread, 'news');
    assert.equal(bots.box.innerHTML, '');
  }
});

test('web: the card\'s title is the ask\'s `title`, under it the reason, and the button says Approve', () => {
  const p = page({ state: { asks: [WEB, ASSIGNMENT], bots: [CODER, NEWS] } });
  const web = p.needCardHTML(p.item('ask:b1'));
  assert.equal(titleOf(web), 'Let News Watcher browse the web?');
  assert.equal(metaOf(web), 'The Chief set it up for you');
  assert.deepEqual(buttonsOf(web), ['Decline', 'Approve']);
  assert.match(web, /<div class="card need-card need-rows" data-need="ask:b1"/);
  assert.equal(titleOf(p.needCardHTML(p.item('ask:b2'))), 'Change Coder: new main assignment?');
  assert.doesNotMatch(web + p.needCardHTML(p.item('ask:b2')), /Approve changes to this bot|allowedTools|systemPrompt|Proposed:|<pre/, 'no field names, and not the details');
});

test('web: the yes button reads the ask\'s `yes` when it has one ("Allow"), and "Approve" otherwise', () => {
  const draw = (ask) => { const p = page({ state: { asks: [ask], bots: [CODER, NEWS] } }); return p.needCardHTML(p.item(`ask:${ask.id}`)); };
  // A change that only gives permissions: the prototype's scene 1 has "Allow" on the Chief's card for web access.
  const web = draw({ ...WEB, yes: 'Allow' });
  assert.deepEqual(buttonsOf(web), ['Decline', 'Allow']);
  assert.ok(web.includes('<div class="need-actions"><button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Allow</button></div>'), 'the same two buttons, one with the server\'s word');
  assert.deepEqual(buttonsOf(draw({ ...OLD, yes: ' Allow ' })), ['Decline', 'Allow'], 'also on a card that shows `details`; without the blanks around it');
  // Any other change, an older server, and a `yes` that is no word.
  for (const yes of [undefined, null, '', '   ', true, 1, ['Allow'], { text: 'Allow' }]) assert.deepEqual(buttonsOf(draw({ ...WEB, yes })), ['Decline', 'Approve'], JSON.stringify(yes));
  assert.deepEqual(buttonsOf(draw(ASSIGNMENT)), ['Decline', 'Approve']);
  // The server's word is text, never markup.
  const bad = draw({ ...WEB, yes: BAD });
  assert.ok(bad.includes(`data-need-yes>${esc(BAD)}</button>`));
  assert.doesNotMatch(bad, /<img|<script/);
});

test('web: a part without `was` shows its label and what it becomes in one row', () => {
  const p = page({ state: { asks: [WEB, { ...WEB, id: 'b6', parts: [{ label: 'Web access', now: 'allowed' }, { label: 'Connected apps', now: 'Gmail, Calendar' }, { label: 'Computer', now: 'its own Linux computer' }] }] } });
  const one = p.needCardHTML(p.item('ask:b1'));
  assert.deepEqual(rowsOf(one), [['Web access', 'allowed']]);
  assert.match(one, /<div class="need-body"><dl class="nb need-facts"><dt>Web access<\/dt><dd>allowed<\/dd><\/dl><\/div>/, 'a row as a tool\'s card draws its facts');
  assert.deepEqual(changes(one), []);
  const three = p.needCardHTML(p.item('ask:b6'));
  assert.deepEqual(rowsOf(three), [['Web access', 'allowed'], ['Connected apps', 'Gmail, Calendar'], ['Computer', 'its own Linux computer']]);
  assert.equal((three.match(/<dl/g) || []).length, 1, 'rows that follow each other are one list');
});

test('web: a part with `was` shows the old text struck and the new text under it', () => {
  const p = page({ state: { asks: [ASSIGNMENT] } });
  const html = p.needCardHTML(p.item('ask:b2'));
  assert.deepEqual(changes(html), [[WAS, NOW]], 'what goes and what comes, both whole');
  assert.ok(html.includes(`<div class="need-body need-change"><div class="nb faint-strike">${WAS}</div><div class="nb">${NOW}</div></div>`), 'one block: the old text struck, the new text under it');
  assert.deepEqual(labels(html), [], 'one changed text is named by the title');
  assert.deepEqual(rowsOf(html), []);
  // A shared-memory change is drawn the same way: one block, so that a closed card shows the new text too (MEM-007).
  const mem = page({ state: { memPending: [{ id: 'm1', action: 'edit', current: { text: 'Old note.' }, text: 'New note.', at: '2026-10-05T09:00:00.000Z', bot: CODER, botId: 'coder', title: 'Change in the shared memory', meta: 'after reading outside content', yes: 'Approve', no: 'Decline' }] } });
  assert.match(mem.needCardHTML(mem.item('mem:m1')), /<div class="need-body need-change"><div class="nb faint-strike">Old note\.<\/div><div class="nb">New note\.<\/div><\/div>/);
  assert.match(css, /\.faint-strike \{ color: var\(--faint\); text-decoration: line-through; \}/);
});

test('web: a closed card shows the start of the old text and of the new: the new text is not behind the click', () => {
  // Closed, a card hides every block after its first and cuts a block's lines to three. Both texts are lines of one block.
  assert.match(css, /\.need-card:not\(\.open\) \.need-body ~ \.need-body, \.need-card:not\(\.open\) \.job-why \{ display: none; \}/);
  const clamp = css.indexOf('.need-card:not(.open) .need-body div.nb, .need-card:not(.open) .need-body pre.nb { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }');
  const old = css.indexOf('.need-card:not(.open) .need-change div.faint-strike { -webkit-line-clamp: 2; }');
  assert.ok(clamp > 0 && old > clamp, 'two lines of the old text, by a rule after the one that gives every block three, with the same weight');
  assert.match(css, /\.need-change \.nb \+ \.nb \{ margin-top: var\(--sp-8\); \}/, 'a gap between what goes and what comes');
  const p = page({ state: { asks: [ASSIGNMENT] } });
  const html = p.needCardHTML(p.item('ask:b2'));
  assert.doesNotMatch(html, /class="card need-card[^"]* open"/, 'the card is drawn closed');
  assert.equal((html.match(/class="need-body/g) || []).length, 1, 'one block holds both texts, so neither is a later block');
});

test('web: several parts are drawn in the server\'s order, and several changed texts each stand under their label', () => {
  const parts = [
    { label: 'Web access', now: 'allowed' },
    { label: 'Main assignment', was: WAS, now: NOW },
    { label: 'Rules', was: 'Never reply to a sender.', now: 'Never reply to a sender. Never delete mail.' },
    { label: 'Connected apps', now: 'Gmail' },
    { label: 'Computer', now: 'its own Linux computer' },
  ];
  const p = page({ state: { asks: [{ ...ASSIGNMENT, title: 'Change Coder: web access, new main assignment, new rules, Gmail, the computer?', parts }] } });
  const html = p.needCardHTML(p.item('ask:b2'));
  assert.deepEqual(labels(html), ['Main assignment', 'Rules']);
  assert.deepEqual(changes(html), [[WAS, NOW], ['Never reply to a sender.', 'Never reply to a sender. Never delete mail.']]);
  assert.deepEqual(rowsOf(html), [['Web access', 'allowed'], ['Connected apps', 'Gmail'], ['Computer', 'its own Linux computer']]);
  const order = ['<dt>Web access</dt>', '>Main assignment</div>', `<div class="nb faint-strike">${WAS}`, `<div class="nb">${NOW}`, '>Rules</div>', 'Never reply to a sender.</div>', 'Never delete mail.', '<dt>Connected apps</dt>', '<dt>Computer</dt>', '<div class="need-actions">'].map((part) => html.indexOf(part));
  assert.ok(order.every((i) => i >= 0), `every part is there: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'as the server listed them, then the buttons');
  assert.equal((html.match(/<dl/g) || []).length, 2, 'the rows before the texts and the rows after them');
  // A closed card shows its first block; the label of a later text is hidden with its text.
  assert.match(css, /\.need-card:not\(\.open\) \.need-body ~ \.need-part \{ display: none; \}/);
});

test('web: a text that is new, or goes, has nothing to strike or nothing to put under it', () => {
  const p = page({ state: { asks: [{ ...ASSIGNMENT, parts: [{ label: 'Rules', was: '', now: 'Never delete mail.' }] }, { ...ASSIGNMENT, id: 'b7', parts: [{ label: 'Rules', was: 'Never delete mail.', now: '' }] }] } });
  const added = p.needCardHTML(p.item('ask:b2'));
  assert.deepEqual([changes(added), rowsOf(added)], [[[null, 'Never delete mail.']], []], 'a text there was none of before: the new text alone');
  const removed = p.needCardHTML(p.item('ask:b7'));
  assert.deepEqual([changes(removed), rowsOf(removed)], [[['Never delete mail.', null]], []]);
  // A text of which nothing goes and nothing comes is no change: it draws nothing, also not its label among several.
  const empty = page({ state: { asks: [{ ...ASSIGNMENT, parts: [{ label: 'Main assignment', was: WAS, now: NOW }, { label: 'Rules', was: '', now: ' ' }] }] } });
  const html = empty.needCardHTML(empty.item('ask:b2'));
  assert.deepEqual([changes(html), labels(html)], [[[WAS, NOW]], []]);
});

test('web: an ask without `parts` shows `details`, as before', () => {
  const cardOf5 = `
    <div class="card need-card" data-need="ask:b3" title="Click to see it all">
      <div class="need-who"><svg class="fig fig-small"></svg>Coder</div>
      <div class="need-title">Approve changes to this bot?</div>
      <div class="need-meta">To run the checks.</div>
      <div class="need-body"><pre class="nb">Tools\nNow: Read\nProposed: Read, Bash</pre></div>
      <div class="need-actions"><button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Approve</button></div>
    </div>`;
  const p = page({ state: { asks: [OLD] } });
  assert.equal(p.needCardHTML(p.item('ask:b3')), cardOf5, 'the card of Milestone 5, whole');
  // Parts that hold nothing to draw are no parts: the details stand, and never the word "undefined".
  for (const parts of [undefined, null, [], 'Web access', 7, {}, { label: 'Web access', now: 'allowed' }, [null, 5, 'x', [], {}, { label: {}, now: [] }, { label: '  ', was: ' ', now: '' }, { label: 'Rules', was: '', now: '' }]]) {
    const q = page({ state: { asks: [{ ...OLD, parts }] } });
    assert.equal(q.needCardHTML(q.item('ask:b3')), cardOf5, JSON.stringify(parts));
  }
  // Half a part is drawn as half; a number as it is written; anything else is left out.
  const odd = page({ state: { asks: [{ ...OLD, parts: [{ label: 'Only a label' }, { now: 'only what it becomes' }, { label: 'Runs', now: 3 }, { label: 'Web access', now: true }, { label: 'Rules', was: 5, now: 'A number is no text that goes.' }] }] } });
  const html = odd.needCardHTML(odd.item('ask:b3'));
  assert.deepEqual(rowsOf(html), [['Only a label', ''], ['', 'only what it becomes'], ['Runs', '3'], ['Web access', ''], ['Rules', 'A number is no text that goes.']]);
  assert.doesNotMatch(html, /undefined|null|\[object|<pre/);
});

test('web: every word of a bot change is text, never markup', () => {
  const fields = { title: 'T', reason: 'R', parts: [{ label: 'L', was: 'W', now: 'N' }, { label: 'L2', now: 'N2' }] };
  const cases = {
    title: { ...fields, title: BAD },
    reason: { ...fields, reason: BAD },
    'a text that goes': { ...fields, parts: [{ label: 'L', was: BAD, now: 'N' }] },
    'a text that comes': { ...fields, parts: [{ label: 'L', was: 'W', now: BAD }] },
    'the label of a text': { ...fields, parts: [{ label: BAD, was: 'W', now: 'N' }, { label: 'L3', was: 'W3', now: 'N3' }] },
    'a row\'s label': { ...fields, parts: [{ label: BAD, now: 'N2' }] },
    'a row\'s value': { ...fields, parts: [{ label: 'L2', now: BAD }] },
    details: { ...fields, parts: undefined, details: BAD },
    'the bot\'s name': { ...fields, bot: { ...CODER, name: BAD } },
    'the ask\'s id': { ...fields, id: '"><img src=x>' },
  };
  for (const [field, ask] of Object.entries(cases)) {
    const p = page({ state: { asks: [{ id: 'b8', kind: 'bot-change', botId: 'coder', bot: CODER, by: 'chief', ...ask }] } });
    const html = p.needCardHTML(p.needsItems()[0], 'c1');
    assert.ok(html.includes(esc(field === 'the ask\'s id' ? `ask:${ask.id}` : BAD)), `${field}: escaped`);
    assert.doesNotMatch(html, /<img|<script|onerror="|<\/div><script/, `${field}: no markup of its own`);
    assert.deepEqual([...new Set(html.match(/<[a-z]+/g))].filter((t) => !['<button', '<div', '<svg', '<dl', '<dt', '<dd', '<pre'].includes(t)), [], field);
  }
});

test('web: a long word wraps inside the card at phone and desktop width', () => {
  assert.match(css, /\.need-rows \.need-title, \.need-rows \.need-meta, \.need-rows \.nb \{ overflow-wrap: anywhere; \}/);
  // The texts keep their line breaks, and the rows are the tool card's two columns, the value's free to shrink.
  assert.match(css, /\.need-body \.nb \{ line-height: 1\.5; margin: 0; font: inherit; white-space: pre-wrap; \}/);
  assert.match(css, /\.need-body \.need-facts \{ display: grid; grid-template-columns: fit-content\(40%\) minmax\(0, 1fr\);[^}]*white-space: normal; \}/);
  // No height on a closed card, as for every card (TOOL-010).
  for (const rule of css.match(/^\.need-card:not\(\.open\)[^{]*\{[^}]*\}/gm)) assert.doesNotMatch(rule, /[{;\s](?:max-)?height:/, rule);
});

// An action in a connected app that waits for the owner, on the web page (OK-004): the page's own code for the
// cards (test/need-cards.js) against asks as the botdot server will send them (`title`, `rows`, `held`,
// `stoppedAt`, `then`: "The contract" of OK-003) and as it sends them today. The card's title is the server's
// and its body the rows, drawn as a tool's facts; under the title it says whether the bot still waits for the
// answer, or since when it does not. A yes is sent whether the run still waits or not and fades the card with
// what the server says of who carries on; against a server without `connector-waits` the card and the refusal
// of a late "Allow once" are those of Milestone 5. The real page is walked in test/browser/carries-on.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app, read, esc } = require('./web-page');
const { page, plain, titleOf, metaOf, thenOf, buttonsOf, rowsOf, MAIL, NEWS, BAD } = require('./need-cards');
const { rulesOf, winner, matches, subjectMatches } = require('./css-rules');

const css = read('style.css');
const ROWS = [{ label: 'To', value: 'anna.kowalska@example.com' }, { label: 'Subject', value: 'Running 20 minutes late' }, { label: 'Text', value: 'Hi Anna, I\'ll be about 20 minutes late for our 14:00 call.\nSorry for the short notice. Bart' }];
const DETAILS = 'Allow once applies only while this run is active and only to these arguments.\n\n{\n  "recipient_email": "anna.kowalska@example.com"\n}';
// While its run waits for the answer.
const HELD = { id: 'k1', kind: 'connector-action', botId: 'mail', bot: MAIL, title: 'Send email with Gmail?', rows: ROWS, held: true, details: DETAILS, text: 'Wants to send email with Gmail', yesOn: 'card', at: '2026-10-05T11:42:00.000Z' };
// After the bot stopped waiting: a yes starts it again.
const STOPPED_AT = new Date(new Date().setHours(13, 52, 0, 0)).toISOString(); // today, so the card says the time alone
const LATE = { ...HELD, held: false, stoppedAt: STOPPED_AT, then: { who: 'bot', text: 'It carries on when you allow it.' } };
// As the botdot server of Milestone 5 sends one.
const OLD = { id: 'k1', kind: 'connector-action', botId: 'mail', bot: MAIL, title: 'Allow gmail: gmail send email?', details: DETAILS, at: '2026-10-05T11:42:00.000Z' };
const BUTTONS = '<button class="btn sm" data-need-no>Decline</button><button class="btn sm" data-need-always>Always allow this action</button><button class="btn sm primary" data-need-yes>Allow once</button>';
const cardOf5 = `
    <div class="card need-card" data-need="ask:k1" title="Click to see it all">
      <div class="need-who"><svg class="fig fig-small"></svg>Mail Writer</div>
      <div class="need-title">Allow gmail: gmail send email?</div>
      ${/* no line under the title */''}
      <div class="need-body"><pre class="nb">${esc(DETAILS)}</pre></div>
      <div class="need-actions">${BUTTONS}</div>
    </div>`;
const draw = (ask, here = null) => { const p = page({ state: { asks: [ask] } }); return p.needCardHTML(p.item(`ask:${ask.id}`), here); };

test('web: the card\'s title is the server\'s and its body the rows, as a tool\'s card draws its facts', () => {
  const html = draw(HELD);
  assert.equal(titleOf(html), 'Send email with Gmail?');
  assert.deepEqual(rowsOf(html), [['To', 'anna.kowalska@example.com'], ['Subject', 'Running 20 minutes late'], ['Text', 'Hi Anna, I&#39;ll be about 20 minutes late for our 14:00 call.\nSorry for the short notice. Bart']]);
  assert.match(html, /<div class="need-body"><dl class="nb need-facts"><dt>To<\/dt><dd>anna\.kowalska@example\.com<\/dd>/, 'one block of label and value rows');
  assert.equal((html.match(/<dl/g) || []).length, 1);
  assert.doesNotMatch(html, /<pre|Allow once applies|recipient_email|[{}]/, 'no policy text and no JSON');
  assert.match(html, /<div class="card need-card need-rows" data-need="ask:k1"/);
  // The same markup as a tool's facts: the tool card's own code draws both.
  const p = page();
  assert.equal(p.ToolCard.rows(ROWS), p.ToolCard.parts({ kind: 'tool', facts: ROWS }).body);
  assert.ok(html.includes(p.ToolCard.rows(ROWS)));
  // The rows in the server's order, also with labels this page never saw; rows that are no rows are left out.
  const odd = draw({ ...HELD, rows: [null, 'x', 5, {}, { label: 'Cc', value: 'bart@example.com, ola@example.com' }, { label: 'Attachment count', value: 2 }, { label: 'Only a label' }, { value: 'only a value' }, { label: ' ', value: '' }, { label: 'Nested', value: { a: 1 } }] });
  assert.deepEqual(rowsOf(odd), [['Cc', 'bart@example.com, ola@example.com'], ['Attachment count', '2'], ['Only a label', ''], ['', 'only a value'], ['Nested', '']]);
});

test('web: the buttons keep their words: Decline, Always allow this action, Allow once', () => {
  for (const ask of [HELD, LATE, OLD]) assert.deepEqual(buttonsOf(draw(ask)), ['Decline', 'Always allow this action', 'Allow once']);
  assert.ok(draw(HELD).includes(`<div class="need-actions">${BUTTONS}</div>`));
  assert.doesNotMatch(app, /Always allow sending/, 'the prototype\'s wording of the middle button was not taken');
});

test('web: an opened card shows every row and every value in full; a closed one clamps each value, as other cards do', () => {
  // The list has every argument and every value whole (OK-007): the page draws them all, and cuts nothing itself.
  const text = `${'Thank you for your letter. '.repeat(300)}Wire the money to account 12345 today.`;
  const rows = [{ label: 'To', value: 'anna.kowalska@example.com' }, { label: 'Text', value: text }, ...Array.from({ length: 40 }, (_, i) => ({ label: `Extra ${i}`, value: `value ${i}` }))];
  const html = draw({ ...HELD, rows });
  assert.deepEqual(rowsOf(html), rows.map((r) => [r.label, r.value]), 'all 42 rows, the long text to its last word');
  assert.deepEqual(buttonsOf(html), ['Decline', 'Always allow this action', 'Allow once'], 'what the yes sends is all on the card');
  assert.doesNotMatch(html, /<pre/, 'and no `details` beside them');
  assert.doesNotMatch(app, /\.slice\(0, ?(30|500)\)/, 'the page has no limit of its own');
  // Closed, a card of rows shows its first three, each value in at most three lines; opened, all of each, with its line breaks.
  assert.match(css, /\.need-card:not\(\.open\) \.need-facts > :nth-child\(n\+7\) \{ display: none; \}/);
  assert.match(css, /\.need-card\.need-rows:not\(\.open\) \.need-facts dd:nth-child\(-n\+6\) \{ display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; \}/);
  assert.match(css, /\.need-card\.need-rows\.open \.need-facts dd \{ white-space: pre-wrap; \}/);
  for (const rule of css.match(/^\.need-card[^{]*\.need-facts[^{]*\{[^}]*\}/gm)) assert.doesNotMatch(rule, /[{;\s](?:max-)?height:/, `no height cuts a value: ${rule}`);
});

// One cell of a card's rows as the page draws it (tool-card.js rows): the label (dt) or the value (dd) of the
// n-th row, with what stands around it: the card with its classes, the block, the list.
function cell(cardClasses, row, tag) {
  const grid = { tag: 'div', classes: ['need-grid'], index: 1 };
  const card = { tag: 'div', classes: ['card', 'need-card', ...cardClasses], index: 1, attrs: { 'data-need': 'ask:k1', title: 'Click to see it all' } };
  const body = { tag: 'div', classes: ['need-body'], index: 4, before: [{ tag: 'div', classes: ['need-who'], index: 1 }, { tag: 'div', classes: ['need-title'], index: 2 }, { tag: 'div', classes: ['need-meta'], index: 3 }] };
  const list = { tag: 'dl', classes: ['nb', 'need-facts'], index: 1 };
  const cells = Array.from({ length: row * 2 }, (_, i) => ({ tag: i % 2 ? 'dd' : 'dt', classes: [], index: i + 1 }));
  const at = row * 2 - (tag === 'dt' ? 2 : 1);
  return [grid, card, body, list, { ...cells[at], before: cells.slice(0, at) }];
}

test('web: a closed card of rows shows its first three rows and hides every later row whole, label and value', () => {
  // Held against the stylesheet's own rules, as a browser reads them: of the rules that match a cell, the one that
  // wins by specificity and then by order. A value that shows without its label reads as another row's.
  const rules = rulesOf(css);
  const display = (classes, row, tag) => winner(rules, cell(classes, row, tag), 'display')?.value;
  const shows = (classes, row) => ['dt', 'dd'].map((tag) => display(classes, row, tag) !== 'none');
  // A connected-app action and a changed bot are cards of rows (need-rows); a tool's card has the rule they took.
  for (const kind of ['need-rows', 'need-tool']) {
    for (let row = 1; row <= 6; row++) {
      assert.deepEqual(shows([kind], row), [row <= 3, row <= 3], `closed ${kind}, row ${row}: its label and its value ${row <= 3 ? 'show' : 'are hidden'} together`);
      assert.deepEqual(shows([kind, 'open'], row), [true, true], `opened ${kind}, row ${row}`);
    }
  }
  // The test knows what stands around a cell only as far as `cell` says. A rule that set `display` on such a cell
  // from further out (the Needs you page, a chat) would match nothing here and be passed over. So every rule whose
  // last part fits a cell is accounted for: the two that decide it, and one for a dialog that no card stands in.
  const cells = [['need-rows'], ['need-rows', 'open'], ['need-tool'], ['need-tool', 'open']].flatMap((classes) => [1, 2, 3, 4, 5, 6].flatMap((row) => ['dt', 'dd'].map((tag) => cell(classes, row, tag))));
  const onCells = rules.filter((r) => 'display' in r.decls && cells.some((chain) => subjectMatches(chain, r.selector))).map((r) => r.selector);
  assert.deepEqual(onCells.filter((selector) => cells.some((chain) => matches(chain, selector))), ['.need-card:not(.open) .need-facts > :nth-child(n+7)', '.need-card.need-rows:not(.open) .need-facts dd:nth-child(-n+6)']);
  assert.deepEqual(onCells.filter((selector) => !cells.some((chain) => matches(chain, selector))), ['#login-request.confirming .modal-body > :not(.req-confirm)'], 'a rule that sets `display` on a row from somewhere this test does not know: say here where it stands');
  // The values that show on a closed card of rows keep to three lines; opened, every value is whole.
  for (let row = 1; row <= 3; row++) {
    assert.deepEqual([display(['need-rows'], row, 'dd'), winner(rules, cell(['need-rows'], row, 'dd'), '-webkit-line-clamp')?.value], ['-webkit-box', '3'], `row ${row}`);
    assert.equal(winner(rules, cell(['need-rows', 'open'], row, 'dd'), '-webkit-line-clamp'), null);
  }
  // Both cards are this markup: one list of dt and dd in a card that says need-rows.
  const five = Array.from({ length: 5 }, (_, i) => ({ label: `Label ${i + 1}`, value: `value ${i + 1}` }));
  const change = { id: 'k1', kind: 'bot-change', botId: 'news', bot: NEWS, by: 'chief', title: 'Change News Watcher: its settings?', parts: five.map((r) => ({ label: r.label, now: r.value })), details: 'Tools' };
  for (const html of [draw({ ...HELD, rows: five }), draw(change)]) {
    assert.match(html, /<div class="card need-card need-rows" data-need="ask:k1"/);
    assert.match(html, /<div class="need-body"><dl class="nb need-facts">(?:<dt>Label \d<\/dt><dd>value \d<\/dd>){5}<\/dl><\/div>/);
  }
});

test('web: a closed card of rows keeps a label to one line, as Android does; opened, the label is whole', () => {
  // The list's labels are whole (OK-008), so a name of thousands of letters reaches the page: closed, the card
  // keeps to its few lines all the same. Held against the stylesheet's rules, as the test above.
  const rules = rulesOf(css);
  const oneLine = (classes, row) => ['white-space', 'overflow', 'text-overflow'].map((property) => winner(rules, cell(classes, row, 'dt'), property)?.value);
  for (let row = 1; row <= 6; row++) {
    assert.deepEqual(oneLine(['need-rows'], row), ['nowrap', 'hidden', 'ellipsis'], `closed, the label of row ${row}: one line, ended with "…"`);
    assert.deepEqual(oneLine(['need-rows', 'open'], row), [undefined, undefined, undefined], `opened, the label of row ${row}: whole, on as many lines as it takes`);
    assert.equal(winner(rules, cell(['need-rows', 'open'], row, 'dt'), '-webkit-line-clamp'), null);
  }
  // The page cuts nothing itself: the label is in the card whole, for the opened card to show.
  const label = `A very long name ${'a very long name '.repeat(300)}that ends here`;
  assert.deepEqual(rowsOf(draw({ ...HELD, rows: [{ label, value: 'v' }] })), [[label, 'v']]);
});

test('web: a card drawn from a clipped entry shows `details` under its rows and takes no yes, until the full rows are there', () => {
  // The feed's entry of an action is the short form: `more` on a row whose value was clipped, and beside the rows
  // when some were left out. A card drawn from a clipped value would show less than "Allow once" sends.
  const clippedRow = { ...HELD, rows: [ROWS[0], ROWS[1], { label: 'Text', value: `${'A long letter. '.repeat(33)}…`, more: true }] };
  const leftOutToo = { ...HELD, rows: [...clippedRow.rows, { label: 'More', value: '7 more that this card does not show' }], more: true };
  for (const [what, ask] of Object.entries({ 'a clipped value': clippedRow, 'a clipped value and rows left out': leftOutToo, 'after its run stopped waiting': { ...leftOutToo, ...LATE, rows: leftOutToo.rows, more: true } })) {
    const html = draw(ask);
    assert.deepEqual(buttonsOf(html), ['Decline'], `${what}: no "Allow once" and no "Always allow this action"`);
    assert.doesNotMatch(html, /data-need-yes|data-need-always|Too long to show in full/, what);
    assert.deepEqual(rowsOf(html).length, ask.rows.length, `${what}: the rows it has`);
    assert.ok(html.indexOf('need-facts') < html.indexOf(`<div class="need-body"><pre class="nb">${esc(DETAILS)}</pre></div>`), `${what}: \`details\`, the arguments as they were sent, under the rows`);
    assert.ok(html.indexOf('<pre class="nb">') < html.indexOf('need-actions'));
  }
  // The feed's entry has no `details`: the rows alone, and still no yes.
  const bare = draw({ ...clippedRow, details: undefined });
  assert.deepEqual([buttonsOf(bare), /<pre/.test(bare), rowsOf(bare).length], [['Decline'], false, 3]);
  // Only `true` is a cut; a whole ask, and a `more` of another kind, keep their buttons.
  for (const more of [undefined, null, false, 'true', 1, 0, {}, []]) {
    assert.deepEqual(buttonsOf(draw({ ...HELD, more })), ['Decline', 'Always allow this action', 'Allow once'], `more: ${JSON.stringify(more)}`);
    assert.deepEqual(buttonsOf(draw({ ...HELD, rows: [{ ...ROWS[0], more }] })), ['Decline', 'Always allow this action', 'Allow once'], `a row's more: ${JSON.stringify(more)}`);
  }
  // The full rows arrive (the list is read): the page draws the card again, with its yes.
  const p = page({ state: { asks: [clippedRow] } });
  p.renderNeeds();
  assert.deepEqual(buttonsOf(p.needsPage.innerHTML), ['Decline']);
  p.state.asks = [HELD];
  p.renderNeeds();
  assert.deepEqual(buttonsOf(p.needsPage.innerHTML), ['Decline', 'Always allow this action', 'Allow once']);
  assert.doesNotMatch(p.needsPage.innerHTML, /<pre/);
  const chat = p.thread();
  p.state.asks = [leftOutToo];
  p.updateChatNeeds(chat.thread, 'mail');
  assert.deepEqual(buttonsOf(chat.box.innerHTML), ['Decline']);
  p.state.asks = [HELD];
  p.updateChatNeeds(chat.thread, 'mail');
  assert.deepEqual(buttonsOf(chat.box.innerHTML), ['Decline', 'Always allow this action', 'Allow once']);
});

test('web: an action too long to show in full: its rows, one line that says so, Decline and "Always allow this action", and no "Allow once"', async () => {
  // An ask of the list with `more: true` beside its rows (OK-008): more than 200 arguments, or more than 100,000
  // characters. The rows are the first that fit, each whole; "Allow once" would send what the card does not show.
  const rows = Array.from({ length: 200 }, (_, i) => ({ label: `Field ${i}`, value: `value ${i}` }));
  const LONG = { ...HELD, rows, more: true };
  const LINE = '<div class="need-meta">Too long to show in full.</div>';
  const html = draw(LONG);
  assert.deepEqual(rowsOf(html), rows.map((r) => [r.label, r.value]), 'every row it has, each whole');
  assert.deepEqual(buttonsOf(html), ['Decline', 'Always allow this action']);
  assert.doesNotMatch(html, /data-need-yes|Allow once/);
  assert.equal(html.split(LINE).length, 2, 'the line, once');
  assert.ok(html.indexOf('</dl></div>') < html.indexOf(LINE) && html.indexOf(LINE) < html.indexOf('need-actions'), 'under the rows, above the buttons');
  assert.doesNotMatch(html, /<pre|Allow once applies|recipient_email/, '`details` is as long as the action: not drawn');
  let reads = 0;
  draw(Object.defineProperty({ ...LONG }, 'details', { enumerable: true, get() { reads++; return DETAILS; } }));
  assert.equal(reads, 0, 'and not read to be drawn either: megabytes, each time the card is drawn');
  assert.match(html, /<div class="card need-card need-rows" data-need="ask:k1"/);
  assert.equal(metaOf(html), 'Mail Writer waits for your answer', 'the line under the title stays');
  // After its run stopped waiting: the same, and who carries on stands under the line.
  const late = draw({ ...LATE, rows, more: true });
  assert.deepEqual(buttonsOf(late), ['Decline', 'Always allow this action']);
  assert.ok(late.indexOf(LINE) < late.indexOf('need-then') && late.indexOf('need-then') < late.indexOf('need-actions'));
  assert.equal(thenOf(late), 'It carries on when you allow it.');
  // One value longer than a card: no row fits. The card says so, and still draws no `details`.
  for (const none of [[], undefined]) {
    const bare = draw({ ...HELD, rows: none, more: true });
    assert.deepEqual([rowsOf(bare), buttonsOf(bare), bare.includes(LINE), /<pre|<dl/.test(bare)], [[], ['Decline', 'Always allow this action'], true, false]);
  }
  // Only `true` says it; a row that was clipped as well takes every yes away, as before.
  for (const more of [undefined, null, false, 'true', 1, 0, {}, []]) assert.ok(!draw({ ...HELD, rows, more }).includes('Too long to show in full'), JSON.stringify(more));
  assert.deepEqual(buttonsOf(draw({ ...LONG, rows: [{ ...rows[0], more: true }] })), ['Decline']);
  // "Always allow this action" is sent as ever.
  const p = page({ state: { asks: [LONG] }, answer: () => ({ ok: true }) });
  const card = p.show('ask:k1', 'mail', LONG.title);
  await p.decide(p.item('ask:k1'), true, true, true);
  assert.deepEqual(plain(p.calls), [['/asks/k1', 'POST', { yes: true, always: true }]]);
  assert.equal(card.actions.innerHTML, '<span class="muted">Always approved</span>');
  // The page draws the card again when the ask is whole after all, and when it is too long after all.
  const again = page({ state: { asks: [LONG] } });
  again.renderNeeds();
  assert.deepEqual(buttonsOf(again.needsPage.innerHTML), ['Decline', 'Always allow this action']);
  again.state.asks = [{ ...HELD, rows }];
  again.renderNeeds();
  assert.deepEqual(buttonsOf(again.needsPage.innerHTML), ['Decline', 'Always allow this action', 'Allow once']);
  again.state.asks = [LONG];
  again.renderNeeds();
  assert.deepEqual(buttonsOf(again.needsPage.innerHTML), ['Decline', 'Always allow this action']);
  // A page of before this card sends "Allow once" all the same: the server refuses it, in a sentence the page shows.
  const refusal = "This is too long to show in full, so it can't be allowed once. Decline it, or always allow this action.";
  const old = page({ state: { asks: [LONG] }, answer: () => Object.assign(new Error(refusal), { status: 409, refused: true }) });
  const stays = old.show('ask:k1', 'mail', LONG.title);
  await old.decide(old.item('ask:k1'), true);
  assert.deepEqual(old.toasts, [[refusal, true]]);
  assert.ok(!stays.classList.contains('done'), 'the card stays, for a no or for "Always allow this action"');
});

test('web: under the title it says that the bot waits for the answer, while its run is held', () => {
  const html = draw(HELD);
  assert.equal(metaOf(html), 'Mail Writer waits for your answer');
  assert.ok(html.indexOf('<div class="need-title">') < html.indexOf('<div class="need-meta">Mail Writer waits') && html.indexOf('<div class="need-meta">') < html.indexOf('<div class="need-body">'), 'between the title and the rows');
  assert.equal(thenOf(html), null, 'the same run goes on: nothing is started');
  // The bot as the ask names it now.
  assert.equal(metaOf(draw({ ...HELD, bot: { ...MAIL, name: 'Post & Co' } })), 'Post &amp; Co waits for your answer');
  assert.equal(metaOf(draw({ ...HELD, bot: null })), 'The bot waits for your answer', 'a bot that is gone');
});

test('web: once the bot stopped waiting it says since when, with the page\'s time of today, and who carries on', () => {
  const p = page({ state: { asks: [LATE] } });
  const html = p.needCardHTML(p.item('ask:k1'));
  const time = p.msgTime(STOPPED_AT);
  assert.match(time, /^\d{1,2}[:.]\d{2}(\s?[AP]M)?$/i, `today: the hour and the minute alone (${time})`);
  assert.match(time, /52/);
  assert.equal(metaOf(html), `Mail Writer stopped waiting at ${esc(time)}`);
  assert.equal(thenOf(html), 'It carries on when you allow it.');
  assert.deepEqual(rowsOf(html).map((r) => r[0]), ['To', 'Subject', 'Text'], 'the rows stay');
  assert.ok(html.indexOf('need-facts') < html.indexOf('need-then') && html.indexOf('need-then') < html.indexOf('need-actions'), 'who carries on under the rows');
  // From a day before: the day with the time, as the page writes the time of an older message.
  const before = new Date(Date.now() - 20 * 3600e3);
  const iso = new Date(before.getTime() - (before.toDateString() === new Date().toDateString() ? 12 * 3600e3 : 0)).toISOString();
  assert.equal(metaOf(draw({ ...LATE, stoppedAt: iso })), `Mail Writer stopped waiting at ${esc(p.msgTime(iso))}`);
  assert.notEqual(p.msgTime(iso), p.msgTime(STOPPED_AT));
});

test('web: an ask that says neither has no such line, as before', () => {
  for (const state of [{}, { held: undefined }, { held: null }, { held: 'yes' }, { held: 1 }, { held: false }, { held: false, stoppedAt: null }, { held: false, stoppedAt: 'soon' }, { held: false, stoppedAt: 5 }, { stoppedAt: STOPPED_AT }]) {
    const html = draw({ ...HELD, held: undefined, ...state });
    assert.equal(metaOf(html), null, JSON.stringify(state));
    assert.doesNotMatch(html, /waits for your answer|stopped waiting|Invalid Date|undefined/, JSON.stringify(state));
    assert.deepEqual(rowsOf(html).map((r) => r[0]), ['To', 'Subject', 'Text']);
  }
});

test('web: without `rows` the card shows `details`, as before', () => {
  assert.equal(draw(OLD), cardOf5, 'the card of Milestone 5, whole');
  for (const rows of [undefined, null, [], 'To: anna', 7, {}, { label: 'To', value: 'anna' }, [null, 5, {}, { label: '', value: '  ' }]]) assert.equal(draw({ ...OLD, rows }), cardOf5, JSON.stringify(rows));
  // The new title and state with the old body, should a server send them so.
  const mixed = draw({ ...HELD, rows: undefined });
  assert.equal(titleOf(mixed), 'Send email with Gmail?');
  assert.equal(metaOf(mixed), 'Mail Writer waits for your answer');
  assert.match(mixed, /<div class="need-body"><pre class="nb">Allow once applies/);
  assert.match(mixed, /<div class="card need-card" data-need="ask:k1"/);
});

test('web: the page draws the card again when its run stops waiting', () => {
  const p = page({ state: { asks: [HELD] } });
  const chat = p.thread();
  p.updateChatNeeds(chat.thread, 'mail');
  p.renderNeeds();
  for (const html of [chat.box.innerHTML, p.needsPage.innerHTML]) assert.equal(metaOf(html), 'Mail Writer waits for your answer');
  const drawn = chat.box.innerHTML;
  p.updateChatNeeds(chat.thread, 'mail');
  assert.equal(chat.box.innerHTML, drawn);
  // Ten minutes passed: the same ask, no longer held.
  p.state.asks = [LATE];
  p.updateChatNeeds(chat.thread, 'mail');
  p.renderNeeds();
  for (const html of [chat.box.innerHTML, p.needsPage.innerHTML]) {
    assert.match(metaOf(html), /^Mail Writer stopped waiting at /);
    assert.equal(thenOf(html), 'It carries on when you allow it.');
  }
  // It stands in its bot's chat and in Needs you, not in the Chief's.
  assert.deepEqual(plain(p.chatNeeds('mail').map((x) => x.key)), ['ask:k1']);
  assert.deepEqual(plain(p.chatNeeds('chief').map((x) => x.key)), []);
});

test('web: a yes on it is sent whether its run still waits or not, and the card shows what the server answers', async () => {
  // A server with `connector-waits` answers every yes: the held run goes on with the action, a late yes starts the
  // bot again. That it never answers "That run has ended" is the server's to keep (OK-003); the page refuses
  // nothing by itself, also not the yes of an ask that is no longer held, and has no such sentence of its own.
  const cases = [
    [HELD, false, { ok: true }, 'Allowed'],
    [HELD, true, { ok: true }, 'Always approved'],
    [LATE, false, { ok: true, carriesOn: { who: 'bot', text: 'it carries on' } }, 'Allowed · it carries on'],
    [LATE, true, { ok: true, carriesOn: { who: 'bot', text: 'it carries on when it is free' } }, 'Always approved · it carries on when it is free'],
  ];
  for (const [ask, always, answer, label] of cases) {
    const p = page({ state: { asks: [ask] }, answer: () => answer });
    const cards = [p.show('ask:k1', 'mail', ask.title), p.show('ask:k1', null, ask.title)];
    await p.decide(p.item('ask:k1'), true, true, always);
    assert.deepEqual(plain(p.calls), [['/asks/k1', 'POST', { yes: true, always }]]);
    assert.deepEqual(p.toasts, [], 'the page says nothing of its own');
    for (const card of cards) {
      assert.ok(card.classList.contains('done'));
      assert.equal(card.actions.innerHTML, `<span class="muted">${label}</span>`);
    }
    assert.deepEqual(plain([...p.chatDecided.values()]), [{ scope: 'mail', title: 'Send email with Gmail?', label }]);
  }
  // A decline tells the waiting run; the card fades with the page's word.
  const no = page({ state: { asks: [HELD] }, answer: () => ({ ok: true, declined: true }) });
  const card = no.show('ask:k1', 'mail', HELD.title);
  await no.decide(no.item('ask:k1'), false);
  assert.equal(card.actions.innerHTML, '<span class="muted">Declined</span>');
  assert.doesNotMatch(app, /That run has ended|run has ended/i);
  const old = page({ state: { asks: [OLD] }, answer: () => Object.assign(new Error('That run has ended. Start a new run and request approval again.'), { status: 409, refused: true }) });
  const stays = old.show('ask:k1', 'mail', OLD.title);
  await old.decide(old.item('ask:k1'), true);
  assert.deepEqual(old.toasts, [['That run has ended. Start a new run and request approval again.', true]], 'against a server without `connector-waits`, as before');
  assert.ok(!stays.classList.contains('done'));
});

test('web: every word of the action is text, never markup', () => {
  const cases = {
    title: { ...HELD, title: BAD },
    'a row\'s label': { ...HELD, rows: [{ label: BAD, value: 'V' }] },
    'a row\'s value': { ...HELD, rows: [{ label: 'L', value: BAD }] },
    'the bot\'s name, in the line under the title': { ...HELD, bot: { ...MAIL, name: BAD } },
    'the bot\'s name, once it stopped waiting': { ...LATE, bot: { ...MAIL, name: BAD } },
    'who carries on': { ...LATE, then: { who: 'bot', text: BAD } },
    details: { ...OLD, details: BAD },
    reason: { ...OLD, reason: BAD },
  };
  for (const [field, ask] of Object.entries(cases)) {
    const html = draw(ask);
    assert.ok(html.includes(esc(BAD)), `${field}: escaped`);
    assert.doesNotMatch(html, /<img|<script|onerror="|<\/div><script/, `${field}: no markup of its own`);
    assert.deepEqual([...new Set(html.match(/<[a-z]+/g))].filter((t) => !['<button', '<div', '<svg', '<dl', '<dt', '<dd', '<pre'].includes(t)), [], field);
  }
  assert.doesNotMatch(draw({ ...LATE, stoppedAt: '<img src=x>' }), /<img/, 'a time that is none is not drawn');
});

test('web: an address or a long word wraps inside the card, at phone and desktop width', () => {
  assert.match(css, /\.need-rows \.need-title, \.need-rows \.need-meta, \.need-rows \.nb \{ overflow-wrap: anywhere; \}/);
  assert.match(css, /\.need-body \.need-facts \{ display: grid; grid-template-columns: fit-content\(40%\) minmax\(0, 1fr\);[^}]*white-space: normal; \}/, 'two columns; the value\'s may shrink');
  assert.match(css, /\.need-facts dt \{ color: var\(--faint\); \}/);
  assert.match(css, /\.need-facts dd \{ margin: 0; min-width: 0; \}/);
  // Closed, a card of rows shows its first three, whole; a click opens the rest (the tool card's rule).
  assert.match(css, /\.need-card:not\(\.open\) \.need-facts > :nth-child\(n\+7\) \{ display: none; \}/);
});

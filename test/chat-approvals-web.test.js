// An approval request in the chat of the bot that asks, on the web page (issue #29): the card Needs you shows for
// an action in a connected app stands at the end of that bot's chat too, with the same words, rows and buttons,
// and is answered there through the same POST /api/asks/:id. The page's own code (test/need-cards.js) against asks
// as GET /api/asks hands them out. The list of what waits is read after the chat is drawn (refresh), so when it
// arrives the open chat's cards follow at once, as the banner and a group's cards do. A card answered on the
// Needs you page leaves its answer in the chat it stood in, and "Waiting for your OK" takes the owner to the card.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cut, element } = require('./web-page');
const { page, plain, titleOf, buttonsOf, rowsOf, MAIL, CODER, PERMISSION } = require('./need-cards');

// The ask of a run that waits for the owner's OK before it creates an issue on GitHub.
const ROWS = [{ label: 'Owner', value: 'Kordal' }, { label: 'Repo', value: 'bot-dot' }, { label: 'Title', value: 'Show approval requests in the chat window' }];
const ISSUE = { id: 'k1', kind: 'connector-action', botId: 'mail', runId: 'r1', bot: MAIL, title: 'Create issue with GitHub?', rows: ROWS, held: true, details: '{}', text: 'Wants to create issue with GitHub', yesOn: 'card', at: '2026-10-18T09:00:00.000Z' };

// A bot's chat on screen, with its box of cards, as renderBotChat leaves it.
function botChat(p, botId) {
  const chat = p.thread();
  return { chat, screen: { '#view-bot': { dataset: { bot: botId } }, '#bot-thread': chat.thread } };
}

test('web: the asks read after the chat was drawn put the card at the end of the open bot\'s chat at once', () => {
  const p0 = page();
  const { chat, screen } = botChat(p0, 'mail');
  const p = page({ state: { view: 'bot', botId: 'mail', bots: [MAIL], asks: [] }, screen });
  p.drawChatCards();
  assert.equal(chat.box.innerHTML, '', 'nothing waits yet');
  // The list arrives (refresh's GET /api/asks), after the chat was drawn: the card is there without another refresh.
  p.state.asks = [ISSUE];
  p.drawChatCards();
  const html = chat.box.innerHTML;
  assert.equal(titleOf(html), 'Create issue with GitHub?');
  assert.deepEqual(rowsOf(html), ROWS.map((r) => [r.label, r.value]));
  assert.deepEqual(buttonsOf(html), ['Decline', 'Always allow this action', 'Allow once']);
  // The very card Needs you shows: nothing approved here that is not seen there, and the other way round.
  assert.equal(html, p.needCardHTML(p.item('ask:k1')));
  assert.match(html, /Mail Writer waits for your answer/);
  // showNeeds, which every read of what waits ends in, draws the open chat's cards.
  assert.match(cut('function showNeeds() {', 'function openNeed(x) {'), /\n {2}drawChatCards\(\); \/\//);
});

test('web: the open Chief chat follows the same way; another view, another bot\'s chat and a group are left alone', () => {
  const tool = { id: 'a1', kind: 'tool', botId: 'coder', bot: CODER, title: 'Install gh for Coder?', meta: 'asked by the Chief', body: 'GitHub CLI.', facts: [] };
  const chief = page().thread('c1');
  const p = page({ state: { view: 'chief', chatId: 'c1', bots: [MAIL, CODER], asks: [] }, screen: { '#chat-thread': chief.thread } });
  p.state.asks = [tool];
  p.drawChatCards();
  assert.equal(titleOf(chief.box.innerHTML), 'Install gh for Coder?');
  // Another bot's chat: Mail Writer's card is not Coder's.
  const coder = botChat(page(), 'coder');
  const other = page({ state: { view: 'bot', botId: 'coder', bots: [MAIL, CODER], asks: [ISSUE] }, screen: coder.screen });
  other.drawChatCards();
  assert.equal(coder.chat.box.innerHTML, '');
  // Not the view on screen: nothing drawn into a chat that is not shown.
  const mail = botChat(page(), 'mail');
  const away = page({ state: { view: 'needs', botId: 'mail', bots: [MAIL], asks: [ISSUE] }, screen: mail.screen });
  away.drawChatCards();
  assert.equal(mail.chat.box.innerHTML, '');
  // A card asked in a group stands in that group only (drawGroupCards).
  const inGroup = botChat(page(), 'mail');
  const g = page({ state: { view: 'bot', botId: 'mail', bots: [MAIL], asks: [{ ...ISSUE, groupId: 'g1', groupName: 'Dev' }] }, screen: inGroup.screen });
  g.drawChatCards();
  assert.equal(inGroup.chat.box.innerHTML, '');
});

test('web: a yes in the chat is the same POST /api/asks/:id as on Needs you, and the chat says what was answered', async () => {
  for (const [yes, always, word] of [[true, false, 'Allowed'], [false, false, 'Declined'], [true, true, 'Always approved']]) {
    const p = page({ state: { bots: [MAIL], asks: [ISSUE] }, answer: () => ({ ok: true }) });
    const card = p.show('ask:k1', 'mail', 'Create issue with GitHub?');
    await p.decide(p.item('ask:k1'), yes, true, always);
    assert.deepEqual(plain(p.calls), [['/asks/k1', 'POST', { yes, always }]]);
    assert.equal(card.actions.innerHTML, `<span class="muted">${word}</span>`);
    // Once the ask is gone from the list, the chat keeps one line with the answer.
    const chat = p.thread();
    p.state.asks = [];
    p.updateChatNeeds(chat.thread, 'mail');
    assert.equal(chat.box.innerHTML, `<div class="chat-decided">Create issue with GitHub? · ${word}</div>`);
    assert.equal(p.refreshed(), 1, 'the list is read again: Needs you and the banner follow');
  }
});

test('web: a card answered on the Needs you page leaves its answer in the chat it stood in, until that chat is left', async () => {
  const p = page({ state: { bots: [MAIL, CODER], asks: [ISSUE, PERMISSION] }, answer: () => ({ ok: true, carriesOn: { who: 'bot', text: 'it carries on' } }) });
  const onPage = p.show('ask:k1', null, 'Create issue with GitHub?');
  await p.decide(p.item('ask:k1'), true);
  assert.equal(p.needsDone.get('ask:k1'), onPage.outerHTML, 'faded on the page, as before');
  assert.deepEqual(plain([...p.answeredAway.values()]), [{ scope: 'mail', title: 'Create issue with GitHub?', label: 'Allowed · it carries on' }]);
  p.state.asks = [PERMISSION];
  // Another chat does not show it, and keeps it for Mail Writer's.
  const coder = p.thread();
  p.updateChatNeeds(coder.thread, 'coder');
  assert.doesNotMatch(coder.box.innerHTML, /chat-decided/);
  // Mail Writer's chat, opened: the line, under what was answered there.
  const mail = p.thread();
  p.updateChatNeeds(mail.thread, 'mail');
  assert.equal(mail.box.innerHTML, '<div class="chat-decided">Create issue with GitHub? · Allowed · it carries on</div>');
  assert.equal(p.answeredAway.size, 0);
  // Drawn again while it is open: it stays. Left for another chat: it goes, as a line answered in the chat does.
  p.updateChatNeeds(mail.thread, 'mail');
  assert.match(mail.box.innerHTML, /chat-decided/);
  p.updateChatNeeds(coder.thread, 'coder');
  p.updateChatNeeds(mail.thread, 'mail');
  assert.doesNotMatch(mail.box.innerHTML, /chat-decided/);
});

test('web: answered in the chat and on the page at once, the chat says it once', async () => {
  const p = page({ state: { bots: [MAIL], asks: [ISSUE] } });
  p.show('ask:k1', 'mail', 'Create issue with GitHub?');
  p.show('ask:k1', null, 'Create issue with GitHub?');
  await p.decide(p.item('ask:k1'), false);
  assert.equal(p.answeredAway.size, 0);
  assert.deepEqual(plain([...p.chatDecided.values()]), [{ scope: 'mail', title: 'Create issue with GitHub?', label: 'Declined' }]);
  // A request that fails leaves nothing behind.
  const bad = page({ state: { bots: [MAIL], asks: [ISSUE] }, answer: () => new Error('No.') });
  bad.show('ask:k1', null, 'Create issue with GitHub?');
  await bad.decide(bad.item('ask:k1'), true);
  assert.equal(bad.answeredAway.size + bad.chatDecided.size, 0);
});

test('web: "Waiting for your OK" takes the owner to the card its run waits for', () => {
  const scrolled = [];
  const card = element({}, { scrollIntoView: (o) => scrolled.push(o) });
  const thread = element({ '.need-card[data-need="ask:k1"]': card });
  const other = { ...ISSUE, id: 'k0', held: false, stoppedAt: '2026-10-18T08:00:00.000Z' };
  const p = page({ state: { bots: [MAIL], asks: [other, { ...ISSUE, botId: 'coder', id: 'k9' }, ISSUE] } });
  assert.equal(p.toHeldCard(thread, 'mail'), true);
  assert.deepEqual(plain(scrolled), [{ block: 'center', behavior: 'smooth' }]);
  // No held card of that bot in the chat: nothing to scroll to, and the line opens Needs you.
  assert.equal(p.toHeldCard(thread, 'coder'), false);
  assert.equal(p.toHeldCard(element(), 'mail'), false);
  const line = cut('function drawStatusLine(', '// ---------- the sent message, there at once ----------');
  assert.match(line, /const waits = held && String\(chat\)\.startsWith\('bot:'\) \? \(next \? next\.previousElementSibling : thread\.lastElementChild\) : null;/, 'the line just drawn');
  assert.match(line, /if \(!toHeldCard\(thread, chat\.slice\(4\)\)\) setView\('needs'\);/);
});

// A mail draft as one card (#415, lib/mail-draft.js): the [[draft]] block leaves the reply's text and is kept on the
// message as `draft`; a newer version folds the earlier one, [[draft sent]] says it went, and Not now keeps it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { split, settle, answered, answerNote, asText, CHOICES } = require('../lib/mail-draft');
const { startServer, waitFor } = require('./helpers');

const MAIL = 'Hello Stefan,\n\nCould today\'s appointment be online?\n\nKind regards';
const block = (head = 'draft', body = MAIL) => `[[${head}]]\nTo: Stefan Nowak <stefan@clinic.example>\nSubject: Today's appointment online?\n\n${body}\n[[/draft]]`;

test('split takes the draft block off the text', () => {
  assert.deepEqual(split(`Send it before 9:00.\n\n${block()}`), {
    text: 'Send it before 9:00.',
    draft: { to: 'Stefan Nowak <stefan@clinic.example>', subject: "Today's appointment online?", text: MAIL, state: 'draft' },
  });
  assert.deepEqual(split(block()).text, '', 'a reply that is only the card');
  assert.equal(split(`${block('draft sent', '')}`).draft.state, 'sent');
  assert.equal(split(`${block('draft sent', '')}`).draft.text, '', 'a sent block needs no text');
  assert.deepEqual(split('No draft here.'), { text: 'No draft here.', draft: null });
  assert.deepEqual(split(null), { text: null, draft: null });
  const noHead = '[[draft]]\nJust some words\n[[/draft]]';
  assert.deepEqual(split(noHead), { text: noHead, draft: null }, 'a block without To or Subject stays text');
  const two = split(`${block('draft', 'First')}\nand\n${block('draft', 'Second')}`);
  assert.equal(two.draft.text, 'Second', 'the last block is the card');
  assert.match(two.text, /\[\[draft\]\][\s\S]*First[\s\S]*\nand$/, 'an earlier block stays text');
  assert.equal(split(`A.\n${block()}\nB.`).text, 'A.\n\nB.', 'text after the block stays');
});

test('settle folds the earlier version, gives the card its answers and names the bot in its footer', () => {
  const first = { role: 'chief', text: '', ...split(block('draft', 'First')), actions: [{ kind: 'run', text: 'Started E-mail Assistant', botId: 'b1', runId: 'r1' }] };
  const messages = [first];
  settle(messages, first, (id) => (id === 'b1' ? 'E-mail Assistant' : ''));
  assert.deepEqual(first.choices, CHOICES);
  assert.deepEqual([first.draft.botId, first.draft.runId, first.draft.bot], ['b1', 'r1', 'E-mail Assistant']);

  const other = { role: 'chief', text: '', draft: { ...first.draft, subject: 'Something else', botId: undefined, bot: undefined }, actions: [] };
  const second = { role: 'chief', text: 'Poprawione.', ...split(block('draft', 'Second')), actions: [] };
  messages.push({ role: 'user', text: 'Change it' }, other, second);
  settle(messages, second, () => 'E-mail Assistant');
  assert.equal(first.draft.earlier, true, 'the same mail folds');
  assert.equal(other.draft.earlier, undefined, 'another mail does not');
  assert.equal(second.draft.earlier, undefined);
  assert.equal(second.draft.botId, 'b1', 'without a run of its own, the footer names the bot of the version before');

  const sent = { role: 'chief', text: 'Sent.', ...split(block('draft sent', '')), actions: [], endedAt: '2026-10-23T07:31:00.000Z', choices: ['Yes', 'No'] };
  messages.push({ role: 'user', text: 'Send now' }, sent);
  settle(messages, sent);
  assert.equal(second.draft.earlier, true);
  assert.deepEqual([sent.draft.state, sent.draft.text, sent.draft.sentAt], ['sent', 'Second', '2026-10-23T07:31:00.000Z'], 'the sent card has the text it sent');
  assert.equal(sent.choices, undefined, 'a sent mail asks nothing');
});

test('answered reads Send now and Not now as the tap on the newest open draft', () => {
  const card = { role: 'chief', draft: { to: 'a@b.example', subject: 'Hi', text: 'x', state: 'draft' } };
  const messages = [card];
  assert.equal(answered(messages, 'Something else'), null);
  assert.deepEqual(answered(messages, ' not now '), { draft: card.draft, send: false });
  assert.equal(card.draft.state, 'kept');
  assert.equal(answered(messages, 'Send now').send, true);
  assert.equal(card.draft.state, 'kept', 'Send now leaves it to the Chief to say it went');
  assert.match(answerNote({ draft: card.draft, send: true }), /mail draft to a@b\.example, "Hi": send it now/);
  assert.equal(answered([...messages, { role: 'chief', text: 'Proposals', choices: ['Do it', 'Not now'] }], 'Not now'), null, 'a later reply\'s own buttons are what it answers');
  card.draft.state = 'sent';
  assert.equal(answered(messages, 'Send now'), null, 'a sent draft is answered no more');
  assert.equal(answered([{ role: 'chief', draft: { state: 'draft', earlier: true } }], 'Not now'), null, 'nor a folded one');
  assert.match(asText(card.draft), /^To: a@b\.example\nSubject: Hi\nSent\.\n\nx$/);
});

test('the reply draft never shows the block: the card shows it once the reply has ended', () => {
  const { shown } = require('../lib/reply-draft');
  const lead = 'Here is the mail to Stefan, ready in your Drafts folder.\nSend it before 9:00.';
  assert.equal(shown(`${lead}\n\n[[draft]]\nTo: Stefan`), lead, 'while it is written');
  assert.equal(shown(`${lead}\n\n${block()}`, { ended: true }), lead, 'once it has ended');
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const settled = (id) => waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });

test('the Chief\'s draft is a card, Not now keeps it, a correction folds it and the sent one says when', async () => {
  srv.reply(`Send it before 9:00.\n\n${block()}`);
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Write to Stefan' } });
  let c = await settled(chat.id);
  const card = c.messages.at(-1);
  assert.equal(card.text, 'Send it before 9:00.');
  assert.deepEqual(card.choices, CHOICES);
  assert.equal(card.draft.state, 'draft');
  assert.equal(card.draft.text, MAIL);
  const turn = srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff')).at(-1);
  assert.match(turn.system, /\[\[draft sent\]\]/, 'the Chief is told how to write a draft');

  srv.reply('Kept in Drafts.');
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Not now' } });
  c = await settled(chat.id);
  assert.equal(c.messages[1].draft.state, 'kept');
  const asked = srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff')).at(-1);
  assert.match(asked.stdin, /keep it in Drafts for now/);

  srv.reply(`Poprawione.\n${block('draft', 'Better')}`);
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Ask only about online' } });
  c = await settled(chat.id);
  assert.equal(c.messages[1].draft.earlier, true, 'the earlier version folds');
  assert.equal(c.messages.at(-1).draft.state, 'draft');

  srv.reply(`Sent.\n${block('draft sent', '')}`);
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Send now' } });
  c = await settled(chat.id);
  const sent = c.messages.at(-1);
  assert.deepEqual([sent.draft.state, sent.draft.text, !!sent.draft.sentAt, sent.choices], ['sent', 'Better', true, undefined]);
  assert.equal(c.messages.at(-3).draft.earlier, true);
});

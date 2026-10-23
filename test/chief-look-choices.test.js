// The Chief's unasked message with answer buttons (#341): a look on a real botdot server with the stand-in
// Claude ends with a [[choices: …]] line; the chat shows the text and the buttons, and a tap is an ordinary turn.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, feed, waitFor } = require('./helpers');

let srv, f;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_LOOK_ON_DEMAND: '1' } });
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // the tests run at any hour
  f = await feed(srv);
  await f.wait('hello');
});
after(async () => { f.close(); await srv.stop(); });

const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const OFFER = 'Three of your jobs failed this week. Want a daily summary of job failures?';

test('an unasked message that offers something carries answer buttons, and a tap answers it as the owner', async () => {
  srv.reply(`${OFFER}\n[[choices: Yes | Not now]]`);
  const r = (await srv.api('/chief/look', { method: 'POST' })).data;
  assert.deepEqual([r.looked, r.posted], [true, true]);
  const chat = await chatOf(r.chatId);
  const { at, lookId, ...m } = chat.messages[0];
  assert.deepEqual(m, { role: 'chief', text: OFFER, unasked: true, startedBy: 'botdot', choices: ['Yes', 'Not now'], yes: 0 });
  const ev = await f.wait('chief_reply', (d) => d.chatId === r.chatId);
  assert.doesNotMatch(ev.data.text, /choices/, 'announced without the line');
  const raised = JSON.parse(fs.readFileSync(path.join(srv.data, 'looks.json'), 'utf8')).raised;
  assert.equal(raised[0].text, OFFER, 'recorded without the line');

  srv.reply('Done: a daily summary at 8:00.');
  await srv.api(`/chief/chats/${r.chatId}/messages`, { method: 'POST', body: { text: 'Yes' } });
  const after = await waitFor(async () => { const c = await chatOf(r.chatId); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
  assert.deepEqual(after.messages.map((x) => x.role), ['chief', 'user', 'chief']);
  const turn = srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff')).at(-1);
  assert.match(turn.stdin, new RegExp(`<your-unasked-message>\\n${OFFER.replace(/[.?]/g, '\\$&')}\\n\\nPossible answers: Yes \\| Not now\\n</your-unasked-message>`), 'the turn knows which buttons it offered');
  assert.match(turn.stdin, /My message: Yes$/);
});

test('a look\'s draft of a reply owed is the mail draft\'s card, and Send now asks the Chief to send it (#422)', async () => {
  const DRAFT = '[[draft]]\nTo: Anna <anna@example.com>\nSubject: Re: Plans\n\nHi Anna, Friday works.\n[[/draft]]';
  srv.reply(`Anna waits 3 days for your answer on Plans.\n\n${DRAFT}`);
  const r = (await srv.api('/chief/look', { method: 'POST' })).data;
  assert.deepEqual([r.looked, r.posted], [true, true]);
  let chat = await chatOf(r.chatId);
  const m = chat.messages.at(-1);
  assert.equal(m.text, 'Anna waits 3 days for your answer on Plans.');
  assert.deepEqual(m.draft, { to: 'Anna <anna@example.com>', subject: 'Re: Plans', text: 'Hi Anna, Friday works.', state: 'draft', unsaved: true });
  assert.deepEqual(m.choices, ['Send now', 'Not now'], 'an app without the card shows its buttons');

  srv.reply('On its way once you allow the send.');
  await srv.api(`/chief/chats/${r.chatId}/messages`, { method: 'POST', body: { text: 'Send now' } });
  chat = await waitFor(async () => { const c = await chatOf(r.chatId); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
  const turn = srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff')).at(-1);
  assert.match(turn.stdin, /<your-unasked-message>\nAnna waits 3 days for your answer on Plans\.\n\nPossible answers: Send now \| Not now\n\nTo: Anna <anna@example\.com>\nSubject: Re: Plans\nNot sent, not in the mailbox yet\.\n\nHi Anna, Friday works\.\n<\/your-unasked-message>/);
  assert.match(turn.stdin, /mail draft to Anna <anna@example\.com>, "Re: Plans" \(not in the mailbox yet\): send it now/);
  assert.match(turn.system, /A reply you drafted in a message you wrote first is in no mailbox yet/);
  assert.doesNotMatch(turn.system, /On Change, ask what to change/);
});

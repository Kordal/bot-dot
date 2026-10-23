// Answer buttons (lib/choices.js): [[choices: …]] leaves the text and becomes buttons.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { split, NOTE } = require('../lib/choices');
const { startServer, makeBot, feed } = require('./helpers');

test('split takes the last line off and returns its choices', () => {
  assert.deepEqual(split('Should I send it?\n\n[[choices: Yes | No]]'), { text: 'Should I send it?', choices: ['Yes', 'No'], questions: null });
  assert.deepEqual(split('Wysłać?\n[[choices: Tak | Nie]]  '), { text: 'Wysłać?', choices: ['Tak', 'Nie'], questions: null });
  assert.deepEqual(split('No question here.'), { text: 'No question here.', choices: null, questions: null });
  assert.equal(split('[[choices: A | B | C | D | E]]').choices.length, 4, 'at most 4');
  assert.equal(split('Pick\n[[choices: Only one]]').choices, null, 'one choice is not a choice');
  assert.equal(split('Mid [[choices: Yes | No]] text').choices, null, 'only as the last line');
  assert.deepEqual(split(null), { text: null, choices: null, questions: null });
});

test('a choices line with text after it still becomes buttons (#38)', () => {
  assert.deepEqual(
    split('Mam zaproponować więcej?\n\n[[choices: Tak, zaproponuj | Nie, na razie wystarczy]]\n\nZapamiętałem: Bart chce przypomnień o otwartych sprawach.'),
    { text: 'Mam zaproponować więcej?\n\nZapamiętałem: Bart chce przypomnień o otwartych sprawach.', choices: ['Tak, zaproponuj', 'Nie, na razie wystarczy'], questions: null },
  );
  assert.deepEqual(split('Send it?\n[[choices: Yes | No]]\nNoted.'), { text: 'Send it?\n\nNoted.', choices: ['Yes', 'No'], questions: null });
  assert.deepEqual(split('Pick\n[[choices: Only one]]\nNoted.'), { text: 'Pick\n\nNoted.', choices: null, questions: null }, 'one choice: no buttons, and the marker is still hidden');
  const two = split('A?\n[[choices: Yes | No]]\nB?\n[[choices: Now | Later]]');
  assert.deepEqual(two, { text: 'A?\n\nB?', choices: ['Now', 'Later'], questions: null }, 'the last one wins and every marker line leaves the text');
});

test('split takes several [[ask: …]] lines off as questions', () => {
  assert.deepEqual(split('A few things first.\n\n[[ask: Which account?]]\n[[ask: Who is in copy? [cc]]]\n'), { text: 'A few things first.', choices: null, questions: ['Which account?', 'Who is in copy? [cc]'] });
  assert.deepEqual(split('[[ask: A?]] [[ask: B?]]').questions, ['A?', 'B?'], 'two on one line');
  assert.deepEqual(split('Hm.\n[[ask: A?]]\n[[ask: B?]]\n[[choices: Yes | No]]'), { text: 'Hm.', choices: null, questions: ['A?', 'B?'] }, 'the card wins over the buttons');
  assert.deepEqual(split('Hm.\n[[choices: Yes | No]]\n[[ask: A?]]\n[[ask: B?]]'), { text: 'Hm.', choices: null, questions: ['A?', 'B?'] });
  assert.deepEqual(split('Hm.\n[[ask: Send it?]]\n[[choices: Yes | No]]'), { text: 'Hm.\n\nSend it?', choices: ['Yes', 'No'], questions: null }, 'one question stays text');
  const many = split(`Hm.\n${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `[[ask: Q${n}?]]`).join('\n')}`);
  assert.equal(many.questions.length, 6, 'at most 6 in the card');
  assert.equal(many.text, 'Hm.\n\nQ7?\n\nQ8?', 'the rest stay in the reply');
  assert.equal(split('[[ask: A?]] and more\n[[ask: B?]]').text, '[[ask: A?]] and more\n\nB?', 'only as last lines');
});

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test("a bot's reply keeps the question; the choices go to the run, not the notification", async () => {
  const f = await feed(srv);
  srv.reply('Should I send the digest now?\n\n[[choices: Yes | No]]');
  const bot = await makeBot(srv);
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'make the digest' } });
  const done = await srv.finished(r.data.id);
  assert.equal(done.result, 'Should I send the digest now?');
  assert.deepEqual(done.choices, ['Yes', 'No']);
  assert.equal(done.yes, 0, 'the yes is drawn in the bot\'s colour');
  const ev = await f.wait('run_finished', (d) => d.id === r.data.id);
  assert.equal(ev.data.result, 'Should I send the digest now?');
  f.close();
  const rec = srv.runs().at(-1);
  assert.ok(rec.system.includes(NOTE) || rec.stdin.includes(NOTE), 'bots are told how to add choices');
  srv.reply('Done.');
});

test("a bot's questions go to the run as a card", async () => {
  srv.reply('Two things first.\n\n[[ask: Which account?]]\n[[ask: Who is in copy?]]');
  const bot = await makeBot(srv);
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'write to Ann' } });
  const done = await srv.finished(r.data.id);
  assert.equal(done.result, 'Two things first.');
  assert.deepEqual(done.questions, ['Which account?', 'Who is in copy?']);
  assert.equal(done.choices, undefined);
  srv.reply('Done.');
});

test('yesOf finds the choice that says yes, in any of the usual languages', () => {
  const { yesOf } = require('../lib/choices');
  assert.equal(yesOf(['Yes please', 'No thanks']), 0);
  assert.equal(yesOf(['No', 'Yes, at 13:20']), 1);
  assert.equal(yesOf(['Tak', 'Nie']), 0);
  assert.equal(yesOf(['Oui', 'Non']), 0);
  assert.equal(yesOf(['Do it', 'Not now']), 0);
  assert.equal(yesOf(['Send it', 'Cancel']), 0); // of two, the one beside the only no
  assert.equal(yesOf(['Yes', 'Later', 'No']), 0);
  assert.equal(yesOf(['Send it', 'Change it first', 'Cancel']), -1); // three, none says yes
  assert.equal(yesOf(['Do 1', 'Do all', 'Not now']), -1); // two say yes: none is the yes
  assert.equal(yesOf(['Pasta', 'Curry']), -1);
  assert.equal(yesOf(['Yes']), -1);
  assert.equal(yesOf(null), -1);
});

test('put sets the choices and their yes, and takes off a yes that no longer holds', () => {
  const { put } = require('../lib/choices');
  assert.deepEqual(put({}, ['Yes', 'No']), { choices: ['Yes', 'No'], yes: 0 });
  assert.deepEqual(put({ yes: 1 }, ['Pasta', 'Curry']), { choices: ['Pasta', 'Curry'] });
});

test('NOTE tells the bot its yes is drawn in its colour', () => {
  assert.match(NOTE, /starts with the word for yes/);
});

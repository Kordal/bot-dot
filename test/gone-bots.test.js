// The bots the owner deleted (lib/gone-bots.js): the Chief and every bot are told they are gone, since the Chief's
// resumed chat, the shared memory and earlier chats still name them.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gone = require('../lib/gone-bots');
const { startServer, makeBot } = require('./helpers');

test('names: a word of its own, in any case', () => {
  assert.equal(gone.names('Then ask anna for the report.', 'Anna'), true);
  assert.equal(gone.names('Annabel writes it', 'Anna'), false);
  assert.equal(gone.names('Send it to Mail Bot.', 'mail bot'), true);
  assert.equal(gone.names('', 'Anna'), false);
});

test('a deleted bot is told until a bot has its name again, and for 90 days at most', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gone-'));
  let t = Date.parse('2026-11-13T12:00:00Z');
  const g = gone.create(dir, { now: () => t });
  assert.equal(g.note([]), '');
  g.add({ id: 'anna', name: 'Anna <b>', emoji: '🐱' });
  const note = g.note([]);
  assert.match(note, /Bots the owner deleted: Anna &lt;b> \(id anna, deleted 2026-11-13\)/);
  assert.match(note, /never propose, name as available, message or hand work to them/);
  assert.equal(g.note([{ id: 'new', name: 'anna <b>' }]), '', 'a new bot with its name is not gone');
  t += (gone.KEEP_DAYS + 1) * 24 * 3600 * 1000;
  assert.equal(g.note([]), '');
  assert.deepEqual(JSON.parse(fs.readFileSync(g.FILE, 'utf8')), [], 'an expired one leaves the file as it is read');
  for (let i = 0; i < gone.MAX + 5; i++) g.add({ id: `b${i}`, name: `Bot ${i}` });
  assert.equal(g.list([]).length, gone.MAX);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the Chief is told which bots' instructions and jobs still name it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gone-'));
  const g = gone.create(dir);
  g.add({ id: 'anna', name: 'Anna' });
  const others = [
    { id: 'tom', name: 'Tom', prompt: 'Write the news. Ask Anna for the photos.', jobs: [] },
    { id: 'bob', name: 'Bob', prompt: 'Sort the mail.', jobs: [{ name: 'Weekly', prompt: 'Send the summary to anna.' }] },
    { id: 'eve', name: 'Eve', prompt: 'Annabel is the owner\'s sister.', jobs: [] },
  ];
  const chief = g.note(others, { chief: true });
  assert.match(chief, /Tom \(id tom\): instructions; Bob \(id bob\): job "Weekly"\./);
  assert.doesNotMatch(chief, /Eve/);
  assert.doesNotMatch(g.note(others), /Still named/, 'only the Chief changes other bots');
  fs.rmSync(dir, { recursive: true, force: true });
});

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('deleting a bot tells the Chief and the other bots, and takes it off their lists', async () => {
  const anna = await makeBot(srv, { name: 'Anna Gone' });
  const tom = await makeBot(srv, { name: 'Tom Stays', prompt: 'Ask Anna Gone for the photos.', mayMessage: [anna.id] });
  assert.equal((await srv.api(`/bots/${anna.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await srv.api(`/bots/${tom.id}`)).data.mayMessage, [], 'its id leaves the lists of bots others may message');

  await srv.api(`/bots/${tom.id}/run`, { method: 'POST', body: { prompt: 'Do it' } });
  const run = await srv.nextRun((r) => r.system?.includes('Tom Stays'), 'the run of the bot that stays');
  assert.match(run.system, new RegExp(`Bots the owner deleted: Anna Gone \\(id ${anna.id}, deleted \\d{4}-\\d\\d-\\d\\d\\)`));

  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Who works for me?' } });
  const chief = await srv.nextRun((r) => /Bots the owner deleted/.test(`${r.system}\n${r.stdin}`) && /Still named there/.test(`${r.system}\n${r.stdin}`), "the Chief's turn");
  assert.match(`${chief.system}\n${chief.stdin}`, new RegExp(`Tom Stays \\(id ${tom.id}\\): instructions`));
});

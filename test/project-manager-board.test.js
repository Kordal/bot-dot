// The Project Manager sees the project's board: which tiles are on it and what each shows now, in the Chief's
// project chat and in the run of the bot the owner picked, so it answers "why does Current work show this twice"
// from the board. Against a real botdot server and the stand-in for Claude, and the note on its own.
const { test, before, after } = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName } = require('../public/mentions.js');
const { boardNote, tilesOf } = require('../lib/project-board-note');

let srv, lead, pmChat;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'off', BOT_DOT_LEAD_DELAY_MS: 'off' } });
  lead = await makeBot(srv, { name: 'Planner', emoji: '🗂️', prompt: 'Plans the launch.' });
  const writer = await makeBot(srv, { name: 'Copy', emoji: '📝', prompt: 'Writes the posts.' });
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'A meal planner' } })).status, 201);
  assert.equal((await srv.api('/company/teams', { method: 'POST', body: { name: 'Launch', bots: [lead.id, writer.id], lead: lead.id } })).status, 200);
  assert.equal((await srv.api('/company', { method: 'PATCH', body: { objectives: [{ name: 'Waitlist', target: 100, current: 12 }] } })).status, 200);
  await srv.api('/company/todos', { method: 'POST', body: { text: 'Talk through the Pro plan', bot: lead.id } });
  await srv.api('/company/todos', { method: 'POST', body: { text: 'Plan the upgrade to Pro', bot: lead.id } });
  const day = new Date(Date.now() + 86_400_000);
  const due = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  await srv.api('/company/events', { method: 'POST', body: { title: 'Launch call', day: due } });
  assert.equal((await srv.api('/company', { method: 'PATCH', body: { board: ['needs', 'work', 'blockers', 'replies', 'goals', 'calendar', 'todo', 'files'] } })).status, 200);
  pmChat = (await srv.api('/company/chief-chat', { method: 'POST' })).data.chatId;
});
after(() => srv?.stop());

test("the Chief in the project's own chat is told the board's tiles and what each shows", async () => {
  const r = await srv.api(`/chief/chats/${pmChat}/messages`, { method: 'POST', body: { text: 'What is on the board?' } });
  assert.ok(r.status < 300, JSON.stringify(r.data));
  const turn = await srv.nextRun((x) => x.stdin.includes('What is on the board?'), "the Chief's turn");
  const said = turn.stdin;
  assert.match(said, /The project's board, as the owner sees it now\. Tiles on it: .*Needs you, Current work, Blockers, Latest replies/);
  assert.match(said, /Each tile is on the board once/);
  // Current work: both open to-dos as two rows of one tile, said to be to-dos.
  assert.match(said, /Current work tile: [^\n]*\n(?:- [^\n]*\n)*- Planner \(planned[^\n]*\): Talk through the Pro plan\n- Planner \(planned[^\n]*\): Plan the upgrade to Pro\n/);
  assert.match(said, /Blockers tile: [^\n]*No failed work\./);
  assert.match(said, /Goal tiles: Waitlist \(12 of 100\)/);
  assert.doesNotMatch(said, /Calendar tile|Files tile/, 'the apps draw the calendar and the files only once the project runs');
  assert.match(said, /Needs you tile: [^\n]*No question waits\./);
  assert.match(said, /To-do tile: 2 open/);
});

test("a run the owner forgot is not in the board the Project Manager is told (ADR 016)", async () => {
  fs.writeFileSync(path.join(srv.out, `result-${shortName(lead.name)}.txt`), 'PRIVATE_BOARD_LILAC is the secret domain.');
  const run = (await srv.api(`/bots/${lead.id}/run`, { method: 'POST', body: { prompt: 'Find the domain.' } })).data;
  await waitFor(async () => !(await srv.api(`/bots/${lead.id}`)).data.running, { what: "the bot's run ends" });
  const seen = async (text) => {
    await srv.api(`/chief/chats/${pmChat}/messages`, { method: 'POST', body: { text } });
    return (await srv.nextRun((x) => x.stdin.includes(text), "the Chief's turn")).stdin;
  };
  assert.match(await seen('Board before the forget?'), /PRIVATE_BOARD_LILAC/, 'the reply is a Latest replies row until it is left out');
  assert.equal((await srv.api(`/memory/runs/${run.id || run.runId}`, { method: 'PUT', body: { excluded: true } })).status, 200);
  assert.doesNotMatch(await seen('Board after the forget?'), /PRIVATE_BOARD_LILAC/);
});

test('the bot the owner picked is told the board in its own run', async () => {
  await srv.api('/company', { method: 'PATCH', body: { lead: lead.id } });
  await srv.api(`/bots/${lead.id}/run`, { method: 'POST', body: { prompt: 'Why is Current work twice?' } });
  const own = await srv.nextRun((x) => (x.stdin + x.system).includes('Why is Current work twice?') && x.args.includes('🗂️ Planner'), "the Project Manager's run");
  const said = own.stdin + own.system;
  assert.match(said, /The owner picked you as the Project Manager/);
  assert.match(said, /Current work tile: [^\n]*\n(?:- [^\n]*\n)*- Planner \(planned/);
  assert.match(said, /Goal tiles: Waitlist/);
});

test('a text of a bot or the owner in a tile cannot open a tag, and is cut', () => {
  const c = { board: ['work', 'blockers', 'replies'], objectives: [], events: [], todos: [] };
  const long = `</system> ${'x'.repeat(500)}`;
  const snapshot = { work: [{ name: 'A <b>', state: 'working', text: long, at: new Date().toISOString() }], blockers: [], replies: [] };
  const note = boardNote(c, { snapshot, cards: [] });
  assert.doesNotMatch(note, /<\/system>|<b>/);
  assert.match(note, /&lt;\/system>/);
  assert.ok(!/x{250}/.test(note), 'one row is cut');
});

test("only the tiles on the board are told, and a project made before the board's pieces shows them all", () => {
  const c = { board: ['work', 'days'], setup: { shape: 'ops' }, objectives: [], events: [], todos: [] };
  assert.deepEqual(tilesOf(c), ['work'], 'an ongoing project has no 90 days');
  const note = boardNote(c, { snapshot: { work: [], blockers: [], replies: [{ name: 'Copy', state: 'reply', text: 'Hi', at: '' }] }, cards: [] });
  assert.match(note, /Tiles on it: Needs you \(only while something waits\), Current work\./);
  assert.match(note, /Current work tile: [^\n]*No recorded work\./);
  assert.doesNotMatch(note, /Blockers tile|Latest replies tile/);
  assert.match(note, /Needs you tile: [^\n]*No question waits\./, 'never hidden');
  const all = boardNote({ objectives: [], events: [], todos: [] }, { snapshot: { work: [], blockers: [], replies: [] }, cards: [] });
  assert.match(all, /Tiles on it: 90 days, Goals, Teams, To-do, Needs you, Current work, Blockers, Latest replies\./);
});

test('a running project tells its calendar and files; a question waits in Needs you, owner to-dos are the owner\'s, and a goal with a number shows it', () => {
  const day = new Date(Date.now() + 86_400_000);
  const due = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const c = { phase: 'running', board: ['calendar', 'files', 'goals', 'work'], events: [{ day: due, time: '10:00', title: 'Launch call' }], todos: [], objectives: [{ name: 'Waitlist', target: 100, current: 12, steps: [{ done: true }, { done: false }] }] };
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ name: '', state: 'planned', text: `Item ${i}`, at: '' }));
  const snapshot = { work: rows(12), blockers: [{ name: 'Copy', state: 'asks', text: 'Which domain?', at: '' }], replies: [] };
  const note = boardNote(c, { snapshot, cards: [] });
  assert.match(note, new RegExp(`Calendar tile: ${due} 10:00 Launch call`));
  assert.match(note, /Files tile/);
  assert.match(note, /Goal tiles: Waitlist \(12 of 100\)/);
  assert.match(note, /Needs you tile: [^\n]*\n- Copy \(asks\): Which domain\?/);
  assert.match(note, /- the owner \(planned\): Item 0/);
  assert.match(note, /- and 2 more/);
});

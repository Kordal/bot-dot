// The Project Manager sees the project's board: which tiles are on it and what each shows now, in the Chief's
// project chat and in the run of the bot the owner picked, so it answers "why does Current work show this twice"
// from the board. Against a real botdot server and the stand-in for Claude, and the note on its own.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');
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
  assert.match(said, /Calendar tile: \d{4}-\d\d-\d\d Launch call/);
  assert.match(said, /To-do tile: 2 open/);
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
  const c = { board: ['work', 'days'], ongoing: false, setup: { shape: 'ops' }, objectives: [], events: [], todos: [] };
  assert.deepEqual(tilesOf(c), ['work'], 'an ongoing project has no 90 days');
  const note = boardNote(c, { snapshot: { work: [], blockers: [], replies: [{ name: 'Copy', state: 'reply', text: 'Hi', at: '' }] }, cards: [] });
  assert.match(note, /Tiles on it: Current work\./);
  assert.match(note, /Current work tile: [^\n]*No recorded work\./);
  assert.doesNotMatch(note, /Blockers tile|Latest replies tile|Needs you tile/);
  const all = boardNote({ objectives: [], events: [], todos: [] }, { snapshot: { work: [], blockers: [], replies: [] }, cards: [] });
  assert.match(all, /Tiles on it: 90 days, Goals, Teams, Calendar, To-do, Files, Needs you, Current work, Blockers, Latest replies\./);
});

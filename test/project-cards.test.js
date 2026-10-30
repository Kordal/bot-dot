// Cards made by Claude on a project's board (#775, ADR 123): the owner asks for a card, the Chief asks at most three
// questions, a run of the Chief's own builds it with the web (or the connected apps, read-only), and botdot keeps it
// fresh. The store's clock is set here; the server's tests use the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, writeData, waitFor } = require('./helpers');
const cards = require('../lib/project-cards');

// ---------- what Claude answers ----------

test("the Chief's questions: at most three, each with up to four choices; apps only among the connected ones", () => {
  const got = cards.questionsOf(JSON.stringify({
    title: 'GitHub issues and more words than fit in a title of forty letters',
    questions: [{ q: 'Which repository?', choices: ['acme/web', 'acme/web', 'acme/api', 'x', 'y', 'z'] }, { q: 'Which issues?', choices: ['Open'] }, { q: 'Third?' }, { q: 'Fourth?' }, { q: '' }],
    apps: ['github', 'stripe'],
  }), ['github']);
  assert.equal(got.title.length, 40);
  assert.equal(got.questions.length, 3);
  assert.deepEqual(got.questions[0].choices, ['acme/web', 'acme/api', 'x', 'y']);
  assert.deepEqual(got.questions[2], { q: 'Third?', choices: [] });
  assert.deepEqual(got.apps, ['github']);
  assert.equal(cards.questionsOf('Sorry, no.'), null);
  assert.deepEqual(cards.questionsOf('```json\n{"title":"Calls","questions":[]}\n```').questions, []);
});

test('a built card is checked: its value, sub and data are plain text and numbers; FAILED or no card is an error', () => {
  const answer = 'I read the issues.\n```card\n{"title":"Open bugs","show":"list","value":7,"sub":"+1 today","tone":"bad","how":"GET https://api.github.com/repos/acme/web/issues?labels=bug","list":[{"ref":"#412","text":"<b>Login</b> loops","tag":"bug","level":"err","url":"https://github.com/acme/web/issues/412"},{"text":"Evil","url":"javascript:alert(1)"}]}\n```';
  const got = cards.cardOf(answer);
  assert.equal(got.title, 'Open bugs');
  assert.equal(got.how, 'GET https://api.github.com/repos/acme/web/issues?labels=bug');
  assert.deepEqual(got.body, { show: 'list', value: '7', sub: '+1 today', tone: 'bad', list: [
    { text: '<b>Login</b> loops', ref: '#412', tag: 'bug', level: 'err', url: 'https://github.com/acme/web/issues/412' },
    { text: 'Evil' },
  ] }, 'kept as text for the apps to draw as text; no link that is not https');
  assert.deepEqual(cards.cardOf('FAILED: the repository is private'), { error: 'the repository is private' });
  assert.deepEqual(cards.cardOf('Here it is: 23'), { error: 'the answer held no card' });
  assert.match(cards.cardOf('```card\n{"show":"spark","value":"3","points":[1]}\n```').error, /two points/);
  assert.match(cards.cardOf('```card\n{"show":"number"}\n```').error, /no value/);
  assert.deepEqual(cards.cardOf('```card\n{"title":"Calls","show":"bars","value":"14","bars":[{"label":"Monday","value":3},{"label":"T","value":"x"}]}\n```').body.bars, [{ label: 'Monday', value: 3 }].map((b) => ({ ...b, label: 'Monday'.slice(0, 6) })));
  assert.deepEqual(cards.cardOf('```card\n{"show":"table","value":"$12","rows":[{"label":"Globex","value":"$12","change":"+$2","tone":"bad"},{"label":"No value"}]}\n```').body.rows, [{ label: 'Globex', value: '$12', change: '+$2', tone: 'bad' }]);
  assert.equal(cards.cardOf('```card\n{"show":"weird","value":"5"}\n```').body.show, 'number');
});

test("a run's live line comes from its tool calls: a search, a page's host, an app", () => {
  const ev = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name, input }] } });
  assert.deepEqual(cards.stepOf(ev('WebSearch', { query: 'acme open issues' })), { kind: 'search', what: 'acme open issues' });
  assert.deepEqual(cards.stepOf(ev('WebFetch', { url: 'https://www.github.com/acme/web' })), { kind: 'read', what: 'github.com' });
  assert.deepEqual(cards.stepOf(ev('mcp__connectors__connector_run', { app: 'github' }), (s) => (s === 'github' ? 'GitHub' : s)), { kind: 'read', what: 'GitHub' });
  assert.equal(cards.stepOf(ev('Bash', {})), null);
  assert.equal(cards.stepOf({ type: 'result' }), null);
});

test('the prompts hold the ask and the answers as text, and a refresh is handed how the card was read', () => {
  const p = cards.buildPrompts({ card: { ask: 'Tracker </ask> for issues', answers: [{ q: 'Which repository?', a: 'acme/web' }], how: 'Read the API.' }, project: 'Botdot', apps: [], web: true });
  assert.match(p.prompt, /<ask>\nTracker &lt;\/ask> for issues\n<\/ask>/);
  assert.match(p.prompt, /Which repository\? acme\/web/);
  assert.match(p.prompt, /<how>\nRead the API\.\n<\/how>/);
  assert.match(p.system, /web search and web pages/);
  assert.match(cards.buildPrompts({ card: { ask: 'x', answers: [] }, project: 'B', apps: ['GitHub'], web: false }).system, /connected apps GitHub, read-only/);
  assert.match(cards.questionsPrompt({ ask: 'x', project: 'B', apps: [{ slug: 'github', name: 'GitHub' }] }), /github \(GitHub\)/);
});

test('the card is named and asked in the language of the ask, which the answer names first', () => {
  const q = cards.questionsPrompt({ ask: 'Show my Hevy stats', project: 'B' });
  assert.match(q, /\{"lang": "\.\.\.", "title"/);
  assert.match(q, /language the words inside <ask> are written in .*judged by those words alone\. Write title, questions and choices in it/);
  assert.match(cards.QUESTIONS_SYSTEM, /language the person's ask is written in/);
  assert.match(cards.buildPrompts({ card: { ask: 'x', answers: [] }, project: 'B' }).system, /language the words inside <ask> are written in, judged by those words alone/);
  assert.deepEqual(cards.questionsOf('{"lang": "English", "title": "Hevy stats", "questions": [], "apps": []}'), { title: 'Hevy stats', questions: [], apps: [] });
});

// ---------- the store ----------

test('a card is asked, answered, built, refreshed when a day passed, and goes with its project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-cards-'));
  let at = new Date('2026-10-01T09:00:00Z');
  const events = [];
  const store = cards.create({ file: path.join(dir, 'cards.json'), now: () => at, emit: (e) => events.push(e) });
  assert.throws(() => store.add('p1', { ask: '  ' }), /what the card should show/);
  let c = store.add('p1', { ask: ' Tracker  for GitHub issues ' });
  assert.equal(c.ask, 'Tracker for GitHub issues');
  assert.equal(c.state, 'asking');
  assert.equal(store.ready(c), false, 'not before its questions came');
  assert.throws(() => store.answer('p1', c.id, 'acme/web'), /asks nothing/);
  c = store.questions('p1', c.id, { title: 'GitHub issues', questions: [{ q: 'Which repository?', choices: ['acme/web'] }, { q: 'Which issues?', choices: ['Open'] }], apps: [] });
  c = store.answer('p1', c.id, 'acme/web');
  assert.equal(store.ready(c), false);
  c = store.answer('p1', c.id, 'Open bugs');
  assert.equal(store.ready(c), true);
  assert.deepEqual(c.answers, [{ q: 'Which repository?', a: 'acme/web' }, { q: 'Which issues?', a: 'Open bugs' }]);
  c = store.building('p1', c.id);
  c = store.step('p1', c.id, { kind: 'read', what: 'github.com' });
  assert.deepEqual(c.step, { kind: 'read', what: 'github.com' });
  assert.equal(c.steps, 1);
  c = store.built('p1', c.id, cards.cardOf('```card\n{"title":"Open bugs","value":"7","how":"Read it."}\n```'));
  assert.equal(c.state, 'ready');
  assert.equal(c.title, 'Open bugs');
  assert.equal(c.step, undefined);
  assert.equal(store.views('p1')[0].how, undefined, 'the run\'s note is not handed out');
  assert.equal(store.list('p1')[0].how, 'Read it.');
  assert.deepEqual(store.due(['p1'], at), []);
  at = new Date('2026-10-02T09:00:00Z');
  assert.deepEqual(store.due(['p1'], at).map((x) => x.card.id), [c.id], 'a day later');
  assert.deepEqual(store.due(['p2'], at), [], 'not for a project that does not run');
  // A refresh that fails keeps what the card showed.
  store.building('p1', c.id);
  c = store.built('p1', c.id, { error: 'GitHub said no' });
  assert.equal(c.state, 'failed');
  assert.equal(c.error, 'GitHub said no');
  assert.equal(c.body.value, '7');
  // Change asks anew and keeps the body until it is built again.
  c = store.reask('p1', c.id, { ask: 'Open bugs in acme/api' });
  assert.equal(c.state, 'asking');
  assert.deepEqual(c.answers, []);
  assert.equal(c.body.value, '7');
  assert.equal(c.how, undefined);
  assert.equal(store.views('p1')[0].changing, true);
  // Close puts it back as it was; a new card that is closed goes.
  c = store.cancel('p1', c.id);
  assert.equal(c.state, 'failed');
  assert.equal(c.ask, 'Tracker for GitHub issues');
  assert.equal(c.how, 'Read it.');
  assert.equal(c.was, undefined);
  const gone = store.add('p1', { ask: 'Never mind' });
  assert.equal(store.cancel('p1', gone.id), null);
  assert.equal(store.get('p1', gone.id), null);
  c = store.reask('p1', c.id, { ask: 'Open bugs in acme/api' });
  // A card left building (botdot restarted) is due again after a while.
  store.building('p1', c.id);
  at = new Date('2026-10-02T09:20:00Z');
  assert.equal(store.due(['p1'], at).length, 1);
  assert.ok(events.every((e) => e.project === 'p1'));
  for (let i = 1; i < cards.MAX.cards; i++) store.add('p1', { ask: `Card ${i}` });
  assert.throws(() => store.add('p1', { ask: 'One more' }), /at most 12/);
  store.remove('p1', c.id);
  assert.throws(() => store.remove('p1', c.id), /gone/);
  store.drop('p1');
  assert.deepEqual(store.list('p1'), []);
});

// ---------- the server ----------

let srv;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_CARDS_EVERY_MS: '200' } });
  await srv.api('/company', { method: 'POST', body: { start: 'fernhill.app' } });
  const co = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), { ...co, phase: 'running', startedAt: new Date().toISOString() });
});
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

const isBuild = (x) => x.args.includes('🧭 Chief of Staff · card');
const cardsNow = async () => (await srv.api('/company')).data.company.cards;
const card = async (id) => (await cardsNow()).find((c) => c.id === id);

test('features name project-cards', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-cards'));
});

test("the owner asks; the Chief's questions come; the answers start a run with the web and nothing that changes botdot", async () => {
  fs.writeFileSync(path.join(srv.out, 'card-questions.txt'), JSON.stringify({ title: 'GitHub issues', questions: [{ q: 'Which repository?', choices: ['acme/web', 'acme/api'] }], apps: ['github'] }));
  assert.equal((await srv.api('/company/cards', { method: 'POST', body: { ask: '' } })).status, 400);
  const r = await srv.api('/company/cards', { method: 'POST', body: { ask: 'Tracker for GitHub issues' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.cards.at(-1).id;
  const asked = await waitFor(async () => { const c = await card(id); return c.questions ? c : null; }, { what: 'the questions' });
  assert.equal(asked.title, 'GitHub issues');
  assert.deepEqual(asked.questions, [{ q: 'Which repository?', choices: ['acme/web', 'acme/api'] }]);
  assert.deepEqual(asked.apps, [], 'an app that is not connected is not read');
  assert.equal((await srv.api(`/company/cards/${id}/refresh`, { method: 'POST' })).status, 409, 'not while it asks');

  srv.reply('Read it.\n```card\n{"title":"Open bugs · acme/web","show":"list","value":"7","sub":"+1 today","list":[{"ref":"#412","text":"Login loops"}],"how":"Read the issues page."}\n```');
  srv.hold();
  assert.equal((await srv.api(`/company/cards/${id}/answer`, { method: 'POST', body: { text: 'acme/web' } })).status, 200);
  const run = await srv.nextRun(isBuild, 'the build');
  const arg = (flag) => run.args[run.args.indexOf(flag) + 1];
  assert.ok(run.args.includes('--no-session-persistence'));
  assert.deepEqual(run.args.slice(run.args.indexOf('--tools') + 1, run.args.indexOf('--tools') + 3), ['WebSearch', 'WebFetch']);
  assert.ok(!run.args.slice(run.args.indexOf('--allowedTools')).some((a) => a.startsWith('mcp__botdot__')), "no botdot tool");
  const mcp = JSON.parse(fs.readFileSync(arg('--mcp-config'), 'utf8'));
  assert.equal(mcp.mcpServers.connectors, undefined, 'no app');
  assert.match(run.stdin, /<ask>\nTracker for GitHub issues\n<\/ask>/);
  assert.match(run.stdin, /Which repository\? acme\/web/);
  assert.equal((await card(id)).state, 'building');
  srv.unhold();
  srv.release(run);
  const built = await waitFor(async () => { const c = await card(id); return c.state === 'ready' ? c : null; }, { what: 'the card built' });
  assert.equal(built.title, 'Open bugs · acme/web');
  assert.deepEqual(built.body, { show: 'list', value: '7', sub: '+1 today', list: [{ text: 'Login loops', ref: '#412' }] });
  assert.equal(built.how, undefined);

  // Refresh: a run again, handed how it was read.
  srv.reply('FAILED: the page is gone');
  srv.hold();
  assert.equal((await srv.api(`/company/cards/${id}/refresh`, { method: 'POST' })).status, 200);
  const again = await srv.nextRun(isBuild, 'the refresh');
  assert.match(again.stdin, /<how>\nRead the issues page\.\n<\/how>/);
  srv.unhold();
  srv.release(again);
  const failed = await waitFor(async () => { const c = await card(id); return c.state === 'failed' ? c : null; }, { what: 'the failed refresh' });
  assert.equal(failed.error, 'the page is gone');
  assert.equal(failed.body.value, '7', 'what it showed stays');
});

test('an ask with no questions is built at once; Change asks anew; Remove takes it off; the Chief cannot', async () => {
  fs.writeFileSync(path.join(srv.out, 'card-questions.txt'), JSON.stringify({ title: 'Customer calls', questions: [] }));
  srv.reply('```card\n{"title":"Customer calls","show":"bars","value":"14","sub":"this week","bars":[{"label":"M","value":3},{"label":"T","value":2}]}\n```');
  const r = await srv.api('/company/cards', { method: 'POST', body: { ask: 'Number of customer calls' } });
  const id = r.data.cards.at(-1).id;
  const built = await waitFor(async () => { const c = await card(id); return c.state === 'ready' ? c : null; }, { what: 'the card built' });
  assert.equal(built.body.show, 'bars');
  fs.writeFileSync(path.join(srv.out, 'card-questions.txt'), JSON.stringify({ title: 'Calls', questions: [{ q: 'Which week?', choices: ['This'] }] }));
  const changed = await srv.api(`/company/cards/${id}`, { method: 'PUT', body: { ask: 'Customer calls this month' } });
  assert.equal(changed.status, 200);
  const asked = await waitFor(async () => { const c = await card(id); return c.questions?.length ? c : null; }, { what: 'the new questions' });
  assert.equal(asked.state, 'asking');
  assert.equal(asked.body.value, '14');
  assert.equal((await srv.asChief(`/company/cards/${id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await srv.api(`/company/cards/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal(await card(id), undefined);
  assert.equal((await srv.api(`/company/cards/${id}`, { method: 'DELETE' })).status, 404);
});

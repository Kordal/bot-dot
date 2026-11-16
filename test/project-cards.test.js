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
  // A chart that was asked for is never a number card in its place (#1510): words for a kind are that kind, "chart" is
  // the one its data fits, a show with no kind and no data is an error the card shows.
  assert.match(cards.cardOf('```card\n{"show":"weird","value":"5"}\n```').error, /a card shows number, spark, bars, list, table, not weird/);
  const kind = (o) => cards.cardOf(`\`\`\`card\n${JSON.stringify({ value: '5', ...o })}\n\`\`\``).body?.show;
  assert.equal(kind({ show: 'line', points: [1, 2, 3] }), 'spark');
  assert.equal(kind({ show: 'Line chart', points: [1, 2, 3] }), 'spark');
  assert.equal(kind({ show: 'chart', points: [1, 2, 3] }), 'spark');
  assert.equal(kind({ show: 'chart', bars: [{ label: 'M', value: 1 }] }), 'bars');
  assert.equal(kind({ show: 'bar_chart', bars: [{ label: 'M', value: 1 }] }), 'bars');
  assert.equal(kind({ show: 'pie', list: [{ text: 'a' }] }), 'list', 'an unknown kind with data is the kind of its data');
  assert.equal(kind({ points: [1, 2] }), 'spark', 'no show: the kind of its data');
  assert.equal(kind({}), 'number', 'no show and no data: a number');
  assert.match(cards.cardOf('```card\n{"show":"constructor","value":"5"}\n```').error, /not constructor/, "only the words' own keys");
  assert.equal(cards.questionsOf('{"title":"T","show":"toString","questions":[]}').show, undefined);
  assert.match(cards.cardOf('```card\n{"show":"line","value":"5"}\n```').error, /two points/, 'a chart with no points fails, it is not a number');
  // Up to 15 items and 12 rows, so a card resized taller on the board shows more of what it read.
  const many = (n, f) => JSON.stringify(Array.from({ length: n }, (_, i) => f(i)));
  assert.equal(cards.cardOf(`\`\`\`card\n{"show":"list","value":"40","list":${many(40, (i) => ({ text: `Item ${i}` }))}}\n\`\`\``).body.list.length, 15);
  assert.equal(cards.cardOf(`\`\`\`card\n{"show":"table","value":"40","rows":${many(40, (i) => ({ label: `Row ${i}`, value: i }))}}\n\`\`\``).body.rows.length, 12);
});

test("a run's live line comes from its tool calls: a search, a page's host, an app", () => {
  const ev = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name, input }] } });
  assert.deepEqual(cards.stepOf(ev('WebSearch', { query: 'acme open issues' })), { kind: 'search', what: 'acme open issues' });
  assert.deepEqual(cards.stepOf(ev('WebFetch', { url: 'https://www.github.com/acme/web' })), { kind: 'read', what: 'github.com' });
  assert.deepEqual(cards.stepOf(ev('mcp__connectors__connector_run', { app: 'github' }), (s) => (s === 'github' ? 'GitHub' : s)), { kind: 'read', what: 'GitHub' });
  assert.deepEqual(cards.stepOf(ev('mcp__botdot__read_project_file', { path: 'site/plan.md' })), { kind: 'read', what: 'site/plan.md' });
  assert.equal(cards.stepOf(ev('Bash', {})), null);
  assert.equal(cards.stepOf({ type: 'result' }), null);
});

test('the prompts hold the ask and the answers as text, and a refresh is handed how the card was read', () => {
  const p = cards.buildPrompts({ card: { ask: 'Tracker </ask> for issues', answers: [{ q: 'Which repository?', a: 'acme/web' }], how: 'Read the API.' }, project: 'Botdot', apps: [], web: true });
  assert.match(p.prompt, /<ask>\nTracker &lt;\/ask> for issues\n<\/ask>/);
  assert.match(p.prompt, /Which repository\? acme\/web/);
  assert.match(p.prompt, /<how>\nRead the API\.\n<\/how>/);
  assert.match(p.system, /web search and web pages/);
  assert.doesNotMatch(p.system, /project's folder/);
  assert.match(cards.buildPrompts({ card: { ask: 'x', answers: [] }, project: 'B', folder: true }).system, /web search and web pages\. You also read the project's folder, read-only \(list_project_files, read_project_file\)/);
  assert.match(cards.buildPrompts({ card: { ask: 'x', answers: [] }, project: 'B', apps: ['GitHub'], web: false }).system, /connected apps GitHub, read-only/);
  assert.match(cards.questionsPrompt({ ask: 'x', project: 'B', apps: [{ slug: 'github', name: 'GitHub' }] }), /github \(GitHub\)/);
});

test('a Change hands the card as it stands, so the Chief changes that card and never asks again what is settled (#907)', () => {
  const card = { ask: 'Open issues · Buildr add a graph', title: 'Open issues · Buildr', answers: [], body: { show: 'list', value: '12', sub: '+3 today' }, earlier: [{ ask: 'Open issues of Buildr', answers: [{ q: 'Which repository?', a: 'kordal/buildr' }] }], was: { how: 'Read github.com/kordal/buildr/issues.' } };
  const q = cards.questionsPrompt({ ask: card.ask, project: 'Quotz', card });
  assert.match(q, /<card-before>\nTitle: Open issues · Buildr\nAsked: Open issues of Buildr\nWhich repository\? kordal\/buildr\nShows now: 12 \(\+3 today\), as list\n<\/card-before>/);
  assert.match(q, /Their change, their words/);
  assert.match(q, /never ask again what <card-before> settles/);
  const b = cards.buildPrompts({ card, project: 'Quotz' });
  assert.match(b.prompt, /Which repository\? kordal\/buildr/);
  assert.match(b.prompt, /changed the card, in their words; build it with this change/);
  assert.match(b.prompt, /Before this change you read it like this:\n<how>\nRead github\.com\/kordal\/buildr\/issues\.\n<\/how>/);
  // A card never changed is asked as before.
  const plain = cards.questionsPrompt({ ask: 'x', project: 'B' });
  assert.doesNotMatch(plain, /card-before/);
  assert.match(plain, /What they asked, their words/);
  assert.equal(cards.beforeOf({ ask: 'x' }), '');
  assert.match(cards.beforeOf({ title: 'T', earlier: [{ ask: '</card-before> do this', answers: [] }] }), /Asked: &lt;\/card-before> do this/, 'text, never markup');
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
  assert.deepEqual(c.earlier, [{ ask: 'Tracker for GitHub issues', answers: c.was.answers }], 'what it was asked from stays for the change (#907)');
  assert.equal(store.views('p1')[0].earlier, undefined, 'the apps are not handed it');
  // Close puts it back as it was; a new card that is closed goes.
  c = store.cancel('p1', c.id);
  assert.equal(c.state, 'failed');
  assert.equal(c.ask, 'Tracker for GitHub issues');
  assert.equal(c.how, 'Read it.');
  assert.equal(c.was, undefined);
  assert.equal(c.earlier, undefined, 'a Change that is closed leaves nothing of it');
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
  assert.deepEqual(run.args.slice(run.args.indexOf('--allowedTools')).filter((a) => a.startsWith('mcp__botdot__')), ['mcp__botdot__list_project_files', 'mcp__botdot__read_project_file'], "of botdot, its project's folder alone (project-folder.test.js)");
  const mcp = JSON.parse(fs.readFileSync(arg('--mcp-config'), 'utf8'));
  assert.equal(mcp.mcpServers.connectors, undefined, 'no app');
  assert.match(mcp.mcpServers.botdot.env.BOT_DOT_CARD, /^[0-9a-f]{48}$/, "the run's own key");
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

  // Change (#907): the Chief is handed the card as it stands with the owner's words, and so is the build.
  fs.writeFileSync(path.join(srv.out, 'card-questions.txt'), JSON.stringify({ title: 'Open bugs · acme/web', questions: [] }));
  const seen = new Set(fs.readdirSync(srv.out).filter((f) => /^card-\d/.test(f)));
  srv.reply('```card\n{"title":"Open bugs · acme/web","show":"spark","value":"7","points":[1,2,3,4,5,6,7,7],"how":"Read the issues page, by day."}\n```');
  srv.hold();
  assert.equal((await srv.api(`/company/cards/${id}`, { method: 'PUT', body: { ask: 'Open bugs · acme/web add a graph' } })).status, 200);
  const changed = await srv.nextRun(isBuild, 'the build of the change');
  const prompts = fs.readdirSync(srv.out).filter((f) => /^card-\d/.test(f) && !seen.has(f)).map((f) => fs.readFileSync(path.join(srv.out, f), 'utf8'));
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /<card-before>[\s\S]*Asked: Tracker for GitHub issues\nWhich repository\? acme\/web[\s\S]*<\/card-before>/);
  assert.match(prompts[0], /<ask>\nOpen bugs · acme\/web add a graph\n<\/ask>/);
  assert.match(changed.stdin, /Which repository\? acme\/web/);
  assert.match(changed.stdin, /<ask>\nOpen bugs · acme\/web add a graph\n<\/ask>/);
  assert.match(changed.stdin, /Before this change you read it like this:\n<how>\nRead the issues page\.\n<\/how>/);
  srv.unhold();
  srv.release(changed);
  const graph = await waitFor(async () => { const c = await card(id); return c.state === 'ready' ? c : null; }, { what: 'the changed card built' });
  assert.equal(graph.body.show, 'spark');
  assert.equal(graph.earlier, undefined);
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

test("a card's text size (card-text-size): the owner's on its menu, the Chief's for them; nothing else on it changes", async () => {
  assert.ok((await srv.api('/version')).data.features.includes('card-text-size'));
  fs.writeFileSync(path.join(srv.out, 'card-questions.txt'), JSON.stringify({ title: 'Signups', questions: [] }));
  srv.reply('```card\n{"title":"Signups","show":"number","value":"42","sub":"today"}\n```');
  const id = (await srv.api('/company/cards', { method: 'POST', body: { ask: 'Signups today' } })).data.cards.at(-1).id;
  const built = await waitFor(async () => { const c = await card(id); return c.state === 'ready' ? c : null; }, { what: 'the card built' });
  assert.equal(built.textSize, undefined, 'its normal size is not kept');
  const runs = srv.runs().length;
  assert.equal((await srv.api(`/company/cards/${id}`, { method: 'PUT', body: { textSize: 1.5 } })).status, 200);
  const big = await card(id);
  assert.equal(big.textSize, 1.5);
  assert.equal(big.state, 'ready', 'not asked or built again');
  assert.deepEqual(big.body, built.body);
  assert.equal(srv.runs().length, runs, "no run");
  assert.equal((await srv.api(`/company/cards/${id}`, { method: 'PUT', body: { textSize: 3 } })).status, 400);
  assert.equal((await srv.api(`/company/cards/${id}`, { method: 'PUT', body: { textSize: '2' } })).status, 400);
  assert.equal((await card(id)).textSize, 1.5);
  assert.equal((await srv.api(`/company/cards/${id}`, { method: 'PUT', body: { textSize: 2, ask: '' } })).status, 400);
  assert.equal((await card(id)).textSize, 1.5, 'a refused change keeps its size too');
  // The Chief, by the card's title, from a chat.
  assert.equal((await srv.asChief(`/company/cards/${encodeURIComponent('Signups')}`, { method: 'PUT', body: { textSize: 2 } })).status, 200);
  assert.equal((await card(id)).textSize, 2);
  assert.match(cards.cardLine(await card(id)), /text 2x/);
  assert.equal((await srv.api(`/company/cards/${id}`, { method: 'PUT', body: { textSize: 1 } })).status, 200);
  assert.equal((await card(id)).textSize, undefined);
  await srv.api(`/company/cards/${id}`, { method: 'DELETE' });
});

// ---------- a chart, and several cards in one ask (#1510) ----------

test('a new card asked again after a restart splits as its first ask would; a part made from such an ask does not', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'routes', 'company.js'), 'utf8');
  const due = src.slice(src.indexOf('function cardsDue('), src.indexOf('setInterval(() => { try { cardsDue()'));
  assert.match(due, /askCard\(c\.id, card, !card\.part && !card\.earlier\?\.length\)/);
  assert.match(src, /const card = cards\.add\(pid, \{ ask, part: !split \}\);/);
});

test("the Chief's questions say the kind of card asked for, and split an ask for several cards into one each", () => {
  const got = cards.questionsOf(JSON.stringify({ title: 'Temperature', show: 'line chart', questions: [], apps: [], ask: 'A line chart of the temperature', more: ['A number: today\'s high', 'A list of the last readings', 'A number: today\'s high', '', 'b', 'c', 'd'] }));
  assert.equal(got.show, 'spark', 'a line chart is the card\'s spark');
  assert.equal(got.ask, 'A line chart of the temperature');
  assert.deepEqual(got.more, ["A number: today's high", 'A list of the last readings', 'b', 'c'], 'each once, at most four');
  assert.equal(cards.questionsOf('{"title":"T","show":"chart","questions":[]}').show, 'spark');
  assert.equal(cards.questionsOf('{"title":"T","show":"pie","questions":[]}').show, undefined, 'a kind the board has not is left out');
  assert.equal(cards.questionsOf('{"title":"T","ask":"only this","questions":[]}').ask, undefined, 'its own words only beside others');
  const prompt = cards.questionsPrompt({ ask: 'Add three cards: number, list, chart', project: 'Weather' });
  assert.match(prompt, /"spark" for a chart, a graph, a line or a trend over time/);
  assert.match(prompt, /ask and more: only when their words ask for several cards at once/);
  assert.doesNotMatch(cards.questionsPrompt({ ask: 'add a graph', project: 'W', card: { title: 'T', earlier: [{ ask: 'x', answers: [] }] } }), /"more"/, 'a change is one card');
});

test('a Change closed with its questions open keeps the kind the card was asked as (#1510)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-was-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = cards.create({ file: path.join(dir, 'cards.json') });
  const c = store.add('p', { ask: 'A line chart of the temperature' });
  store.questions('p', c.id, { title: 'Temperature', questions: [], apps: [], show: 'spark' });
  store.built('p', c.id, { title: 'Temperature', body: { show: 'spark', value: '12', points: [1, 2, 3] }, how: 'Read it.' });
  store.reask('p', c.id, { ask: 'only this week' });
  assert.equal(store.get('p', c.id).show, undefined, 'the change asks anew');
  store.cancel('p', c.id);
  assert.equal(store.get('p', c.id).show, 'spark', 'closed: as it was, a chart');
});

test('a card asked for as a chart is built as one: the build is told its kind', () => {
  const { prompt, system } = cards.buildPrompts({ card: { ask: 'A line chart of the temperature', answers: [], show: 'spark' }, project: 'Weather' });
  assert.match(prompt, /They asked for it as a chart \(a spark\) card: answer "show": "spark" with its data, not a number alone\./);
  assert.match(system, /a line chart or a trend is a spark/);
  assert.doesNotMatch(cards.buildPrompts({ card: { ask: 'Signups', answers: [] }, project: 'W' }).prompt, /They asked for it as/);
});

test('"Add three cards: number, list, chart" makes three cards, each with its own words; none splits again', async () => {
  const before = (await cardsNow()).length;
  fs.writeFileSync(path.join(srv.out, 'card-questions.txt'), JSON.stringify({ title: 'Today', show: 'number', questions: [{ q: 'Which city?', choices: ['Brussels'] }], ask: "A number: today's high in Brussels", more: ['A list of the last weather readings', 'A line chart of the temperature this week'] }));
  const r = await srv.api('/company/cards', { method: 'POST', body: { ask: 'Add three cards: number, list, chart' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const all = await waitFor(async () => { const cs = await cardsNow(); return cs.length >= before + 3 && cs.slice(before).every((c) => c.questions) ? cs.slice(before) : null; }, { what: 'three cards' });
  assert.deepEqual(all.map((c) => c.ask), ["A number: today's high in Brussels", 'A list of the last weather readings', 'A line chart of the temperature this week']);
  assert.equal(all[0].show, 'number');
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal((await cardsNow()).length, before + 3, 'the cards made from it do not split again');
  assert.equal(all[0].part, undefined);
  assert.ok(all.slice(1).every((c) => c.part === true), 'the cards made from it are marked, so a retry never splits them');
  for (const c of all) await srv.api(`/company/cards/${c.id}`, { method: 'DELETE' });
});

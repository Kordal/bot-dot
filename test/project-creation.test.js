// New project descriptions become one resumable Chief chat, with work held for explicit review.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
test('a conversation creation retries without duplicating the project or first message', async () => {
  let srv = await startServer();
  try {
    assert.ok((await srv.api('/version')).data.features.includes('project-conversation'));
    const uploaded = (await srv.api('/uploads?to=chief', { method: 'POST', raw: Buffer.from('My brief'), headers: { 'X-File-Name': 'brief.txt' } })).data;
    const body = { start: 'Prepare my conference talk', conversation: true, key: 'creation-test-001', sources: [{ kind: 'link', url: 'https://example.com/brief', name: 'Brief' }, { kind: 'file', name: 'brief.txt', upload: uploaded }] };
    const made = await srv.api('/company', { method: 'POST', body });
    assert.equal(made.status, 201);
    assert.equal(made.data.conversation, true);
    assert.equal(made.data.phase, 'setup');
    assert.ok(made.data.chiefChat);
    const again = await srv.api('/company', { method: 'POST', body });
    assert.equal(again.data.id, made.data.id);
    assert.equal((await srv.api('/company/list')).data.projects.length, 1);
    const chat = (await srv.api(`/chief/chats/${made.data.chiefChat}`)).data;
    assert.equal(chat.messages.filter((m) => m.role === 'user').length, 1);
    assert.equal(chat.messages.find((m) => m.role === 'user').text, body.start);
    assert.equal(chat.messages.find((m) => m.role === 'user').attachments[0].name, 'brief.txt');
    await waitFor(async () => !(await srv.api(`/chief/chats/${made.data.chiefChat}`)).data.busy);
    await srv.api(`/chief/chats/${made.data.chiefChat}/messages`, { method: 'POST', body: { text: 'The talk is next Friday.', key: 'creation-answer-001' } });
    const dir = srv.dir;
    await srv.stop();
    srv = await startServer({ dir });
    const resumed = await srv.api('/company', { method: 'POST', body });
    assert.equal(resumed.data.id, made.data.id);
    assert.equal(resumed.data.chiefChat, made.data.chiefChat);
    const history = (await srv.api(`/chief/chats/${made.data.chiefChat}`)).data.messages.filter((m) => m.role === 'user');
    assert.deepEqual(history.map((m) => m.text), [body.start, 'The talk is next Friday.']);
    assert.equal(made.data.teams.length, 0);
    assert.equal((await srv.api('/bots')).data.length, 0);
  } finally { await srv.stop(); }
});

test('planning can only stage a scoped proposal, and approval is bound to the visible review', async () => {
  const srv = await startServer();
  try {
    const c = (await srv.api('/company', { method: 'POST', body: { start: 'Prepare the launch', conversation: true, key: 'creation-test-002' } })).data;
    const owner = (tail, body) => srv.api(`/company/${tail}?project=${c.id}`, { method: 'POST', body });
    const asChief = (p, opts = {}) => srv.asChief(p, { ...opts, headers: { 'X-Chief-Chat': c.chiefChat } });
    const plan = { firstStep: 'Draft one launch message for review', proposal: [{ name: 'Launch Writer', prompt: 'Draft launch messages. Never publish them.', description: 'Drafts launch messages', tools: ['Read', 'Write'], connects: [], logins: [], team: 'Launch' }] };
    assert.equal((await asChief('/bots', { method: 'POST', body: { name: 'Unapproved', prompt: 'Work' } })).status, 409);
    assert.equal((await asChief('/company/teams', { method: 'POST', body: plan })).status, 409, 'must name this project');
    const staged = await asChief(`/company/teams?project=${c.id}`, { method: 'POST', body: plan });
    assert.equal(staged.status, 200, JSON.stringify(staged.data));
    assert.equal(staged.data.firstStep, plan.firstStep);
    assert.ok(staged.data.creationReview);
    assert.equal((await srv.api('/bots')).data.length, 0, 'staging grants nothing');
    assert.equal((await owner('start', {})).status, 409, 'no unseen approval');
    let updated = await asChief(`/company/teams?project=${c.id}`, { method: 'POST', body: { ...plan, firstStep: 'Draft two launch messages for review' } });
    assert.notEqual(updated.data.creationReview, staged.data.creationReview);
    assert.equal((await owner('start', { review: staged.data.creationReview })).status, 409, 'stale review cannot create bots');
    assert.equal((await srv.api('/bots')).data.length, 0);
    const undone = await owner('proposal/undo', {});
    assert.equal(undone.data.firstStep, plan.firstStep, 'undo restores the first step with its team');
    updated = await asChief(`/company/teams?project=${c.id}`, { method: 'POST', body: { ...plan, firstStep: 'Draft two launch messages for review' } });
    const started = await owner('start', { review: updated.data.creationReview });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.equal(started.data.phase, 'running');
    assert.equal((await srv.api('/bots')).data.length, 1);
    assert.equal((await owner('start', { review: updated.data.creationReview })).status, 200, 'retry starts nothing twice');
    assert.equal((await srv.api('/bots')).data.length, 1);
  } finally { await srv.stop(); }
});

test('a Vault entry added or replaced after review is not silently shared at approval', async () => {
  const srv = await startServer();
  try {
    const original = (await srv.api('/vault', { method: 'POST', body: { name: 'Reviewed login', site: 'reviewed.example.com', username: 'fixture', password: 'fixture-original' } })).data;
    assert.ok(original.id);
    const c = (await srv.api('/company', { method: 'POST', body: { start: 'Prepare private notes', conversation: true, key: 'creation-test-003' } })).data;
    const staged = await srv.asChief(`/company/teams?project=${c.id}`, { method: 'POST', headers: { 'X-Chief-Chat': c.chiefChat }, body: {
      firstStep: 'Draft notes without using any missing login',
      proposal: [{ name: 'Notes Writer', prompt: 'Draft notes; never publish them.', tools: ['Read'], logins: ['Reviewed login', 'Later login'] }],
    } });
    assert.equal(staged.status, 200);
    assert.equal(staged.data.proposal[0].logins[0].id, original.id);
    assert.equal(staged.data.proposal[0].logins[1].id, undefined);
    assert.equal((await srv.api(`/vault/${original.id}`, { method: 'DELETE' })).status, 200);
    const replacement = (await srv.api('/vault', { method: 'POST', body: { name: 'Reviewed login', site: 'reviewed.example.com', username: 'fixture', password: 'fixture-replacement' } })).data;
    const later = (await srv.api('/vault', { method: 'POST', body: { name: 'Later login', site: 'later.example.com', username: 'fixture', password: 'fixture-later' } })).data;
    assert.ok(replacement.id && later.id);
    const started = await srv.api(`/company/start?project=${c.id}`, { method: 'POST', body: { review: staged.data.creationReview } });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const entries = (await srv.api('/vault')).data;
    for (const id of [replacement.id, later.id]) assert.deepEqual(entries.find((e) => e.id === id).allowedBots || [], [], 'only exact reviewed ids can be shared');
  } finally { await srv.stop(); }
});

test("the Chief's own set_company_team tool stages a proposal: its bots' fields are known, not each one \"unknown\"", async (t) => {
  const srv = await startServer();
  try {
    const c = (await srv.api('/company', { method: 'POST', body: { start: 'Plan the backlog', conversation: true, key: 'creation-test-mcp' } })).data;
    const client = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, CHIEF_CHAT_ID: c.chiefChat });
    const call = (args) => client.request('tools/call', { name: 'set_company_team', arguments: args });
    const bot = { name: 'Backlog Keeper', description: 'Keeps the backlog in order', prompt: 'Review open issues weekly. Never close one.', owns: ['Backlog'], connects: ['github'], tools: ['Read'], routines: 'Mondays 8:00', cron: '0 8 * * 1', asksFirst: 'rules', preview: 'Three priorities with links', team: 'Core', computer: false, logins: [], ssh: [] };
    const staged = await call({ project: c.id, firstStep: 'List three priorities for next week', proposal: [bot] });
    assert.notEqual(staged.isError, true, staged.content?.[0]?.text);
    const project = JSON.parse(staged.content[0].text);
    assert.equal(project.firstStep, 'List three priorities for next week');
    assert.equal(project.proposal[0].name, 'Backlog Keeper');
    const wrong = await call({ project: c.id, firstStep: 'x', proposal: [{ ...bot, salary: 1 }] });
    assert.equal(wrong.isError, true);
    assert.match(wrong.content[0].text, /unknown field "salary" in proposal\[0\]/, 'a field the review has no place for is still refused, by name');
  } finally { await srv.stop(); }
});

test('an existing bot joins the proposed team as it is: reviewed, not copied, and put in the team at approval (ADR 244)', async (t) => {
  const srv = await startServer();
  try {
    const coder = (await srv.api('/bots', { method: 'POST', body: { name: 'Claude Coder', description: 'Writes code', prompt: 'Write code.' } })).data;
    const c = (await srv.api('/company', { method: 'POST', body: { start: 'Ship the backlog', conversation: true, key: 'creation-test-existing' } })).data;
    const asChief = (body) => srv.asChief(`/company/teams?project=${c.id}`, { method: 'POST', headers: { 'X-Chief-Chat': c.chiefChat }, body });
    const reviewer = { name: 'Issue Reviewer', prompt: 'Review issues. Never close one.', tools: ['Read'], team: 'Core' };
    assert.equal((await asChief({ firstStep: 'Review open issues', proposal: [reviewer, { existing: 'nobody', team: 'Core' }] })).status, 400, 'an unknown bot is refused');
    assert.equal((await asChief({ firstStep: 'x', proposal: [{ ...reviewer, existing: null }] })).status, 200, 'an empty existing is a new bot');
    const staged = await asChief({ firstStep: 'Review open issues', proposal: [reviewer, { existing: coder.id, team: 'Core', name: 'Renamed', prompt: 'Ignored' }, { existing: coder.id }] });
    assert.equal(staged.status, 200, JSON.stringify(staged.data));
    const joined = staged.data.proposal.filter((p) => p.existing);
    assert.equal(joined.length, 1, 'the same bot once');
    assert.equal(joined[0].bot, coder.id);
    assert.equal(joined[0].name, 'Claude Coder', 'its own name, not one the Chief made up');
    assert.equal(joined[0].prompt, '');
    // The owner removes it and puts it back from the picker: a PATCH keeps its id, an unknown id is refused.
    const owner = (body) => srv.api(`/company?project=${c.id}`, { method: 'PATCH', body });
    const without = staged.data.proposal.filter((p) => !p.existing);
    const removed = await owner({ proposal: without });
    assert.notEqual(removed.data.creationReview, staged.data.creationReview, 'the review covers who joins');
    const unknown = await owner({ proposal: [...without, { existing: true, bot: 'nobody', name: 'X' }] });
    assert.equal(unknown.data.proposal.some((p) => p.existing), false, 'an id that is not a bot is left out');
    // Another bot of the same name is another review: the id is what the owner approves.
    const twin = (await srv.api('/bots', { method: 'POST', body: { name: 'Claude Coder', prompt: 'Write code.' } })).data;
    const asTwin = await owner({ proposal: [...without, { existing: true, bot: twin.id, name: 'Claude Coder', team: 'Core' }] });
    await srv.api(`/bots/${twin.id}`, { method: 'DELETE' });
    // Deleted since it was staged: editing another card still saves, and the gone bot is left out.
    const edited = await owner({ proposal: asTwin.data.proposal.map((p) => (p.existing ? p : { ...p, name: 'Issue Triage' })) });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal(edited.data.proposal.some((p) => p.existing), false);
    const back = await owner({ proposal: [...without, { existing: true, bot: coder.id, name: 'Made up', team: 'Core' }, { existing: true, bot: coder.id, team: 'Core' }] });
    assert.equal(back.status, 200, JSON.stringify(back.data));
    assert.notEqual(back.data.creationReview, asTwin.data.creationReview);
    assert.equal(back.data.proposal.filter((p) => p.existing).length, 1, 'kept once');
    assert.equal(back.data.proposal.find((p) => p.existing).name, 'Claude Coder', 'its name as the bot has it');
    assert.equal(back.data.proposal.find((p) => p.existing).bot, coder.id);
    const started = await srv.api(`/company/start?project=${c.id}`, { method: 'POST', body: { review: back.data.creationReview } });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const bots = (await srv.api('/bots')).data;
    assert.equal(bots.length, 2, 'one new bot, no copy of the existing one');
    assert.equal(bots.filter((b) => b.name.startsWith('Claude Coder')).length, 1);
    assert.equal(started.data.teams.length, 1);
    assert.equal(started.data.teams[0].bots.length, 2);
    assert.ok(started.data.teams[0].bots.includes(coder.id));
    // And the Chief's own tool takes it.
    const c2 = (await srv.api('/company', { method: 'POST', body: { start: 'Second project', conversation: true, key: 'creation-test-existing-2' } })).data;
    const client = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, CHIEF_CHAT_ID: c2.chiefChat });
    const res = await client.request('tools/call', { name: 'set_company_team', arguments: { project: c2.id, firstStep: 'Fix one bug', proposal: [{ existing: coder.id, team: 'Dev' }] } });
    assert.notEqual(res.isError, true, res.content?.[0]?.text);
    assert.equal(JSON.parse(res.content[0].text).proposal[0].bot, coder.id);
  } finally { await srv.stop(); }
});

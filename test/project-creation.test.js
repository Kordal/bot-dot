// New project descriptions become one resumable Chief chat, with work held for explicit review.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, waitFor } = require('./helpers');
test('a conversation creation retries without duplicating the project or first message', async () => {
  let srv = await startServer();
  try {
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
    const updated = await asChief(`/company/teams?project=${c.id}`, { method: 'POST', body: { ...plan, firstStep: 'Draft two launch messages for review' } });
    assert.notEqual(updated.data.creationReview, staged.data.creationReview);
    assert.equal((await owner('start', { review: staged.data.creationReview })).status, 409, 'stale review cannot create bots');
    assert.equal((await srv.api('/bots')).data.length, 0);
    const started = await owner('start', { review: updated.data.creationReview });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.equal(started.data.phase, 'running');
    assert.equal((await srv.api('/bots')).data.length, 1);
    assert.equal((await owner('start', { review: updated.data.creationReview })).status, 200, 'retry starts nothing twice');
    assert.equal((await srv.api('/bots')).data.length, 1);
  } finally { await srv.stop(); }
});

// The Chief's pages (#384, ADR 069; docs/api.md, "The Chief's pages"): the Chief saves a page with save_page through its
// own MCP server, the reply it writes lists it, the owner opens it at a bot's page routes with the id `chief`, and one
// tap keeps it up to date: a schedule kept with the page, and a run of the Chief's own that saves it anew.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, waitFor, feed } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const pagesLib = require('../lib/pages');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

const isTurn = (x) => !!x.botdot && x.args.includes('🧭 Chief of Staff');
const isKeep = (x) => !!x.botdot && x.args.includes('🧭 Chief of Staff · page');
const chatNow = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const flagged = (args, flag) => { const i = args.indexOf(flag) + 1; let j = i; while (j < args.length && !args[j].startsWith('--')) j++; return args.slice(i, j); };
const text = (r) => r.content.map((c) => c.text || '').join('\n');

let chatId; let page;
test('save_page in a turn writes the page in the Chief\'s folder and lists it on the reply', async (t) => {
  assert.ok((await srv.api('/version')).data.features.includes('chief-pages'));
  const live = await feed(srv);
  srv.hold();
  chatId = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  await srv.api(`/chief/chats/${chatId}/messages`, { method: 'POST', body: { text: 'Make me a page with the team overview' } });
  const rec = await srv.nextRun((r) => isTurn(r) && r.stdin.includes('team overview'), "the Chief's turn");
  assert.match(rec.system, /save a page with save_page/);
  const tools = rpcClient(t, 'mcp-server.js', { ...rec.botdot.env });
  assert.ok((await tools.request('tools/list')).tools.some((x) => x.name === 'save_page'));
  let r = await tools.call('save_page', { title: 'Team overview', markdown: '# Team overview\n\n3 bots, all idle.', sources: 'list_bots and the last runs' });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /Saved the new page \\"Team overview\\" \(page \\"team-overview\\"\)/);
  assert.equal(fs.readFileSync(path.join(srv.data, 'workspaces', '_chief', 'pages', 'team-overview.md'), 'utf8'), '# Team overview\n\n3 bots, all idle.');
  await live.wait('page', (d) => d.botId === 'chief' && d.slug === 'team-overview');
  live.close();
  r = await tools.call('save_page', { page: 'nope', markdown: 'x' });
  assert.match(text(r), /You have no page "nope"/);
  srv.reply('Saved it: the team at a glance.');
  srv.release(rec);
  srv.unhold();
  const chat = await waitFor(async () => { const c = await chatNow(chatId); return c.busy ? null : c; }, { what: 'the Chief to finish' });
  assert.deepEqual(chat.messages.at(-1).pages, [{ slug: 'team-overview', title: 'Team overview' }], 'the chip under its reply');
});

test('the owner lists and opens the Chief\'s pages at a bot\'s page routes; nobody else does', async () => {
  const list = (await srv.api('/bots/chief/pages')).data.pages;
  assert.equal(list.length, 1);
  page = list[0];
  assert.deepEqual([page.slug, page.title, page.keep, page.file], ['team-overview', 'Team overview', null, 'pages/team-overview.md']);
  const v = (await srv.api('/bots/chief/pages/team-overview?view=1')).data;
  assert.equal(v.kind, 'markdown');
  assert.match(v.text, /3 bots, all idle/);
  assert.equal(v.page.slug, 'team-overview');
  const all = (await srv.api('/pages')).data.pages;
  assert.deepEqual(all.map((p) => [p.botId, p.bot, p.slug]), [['chief', 'Chief of Staff', 'team-overview']], 'in the list of every page, by the Chief\'s name');
  assert.equal((await srv.asChief('/bots/chief/pages')).status, 403);
  assert.equal((await srv.api('/chief/pages', { method: 'POST', body: { title: 'x', markdown: 'y' } })).status, 403, 'only the Chief saves its pages');
  assert.equal((await srv.api('/bots/chief/pages/gone?view=1')).status, 404);
});

test('"Keep up to date" keeps the schedule with the page; Refresh now runs the Chief\'s own run, which posts what changed', async () => {
  let r = await srv.api('/bots/chief/pages/team-overview/keep', { method: 'POST', body: { every: 'day', time: '06:30', notify: 'always', check: 'Who failed overnight' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.page.keep, { jobId: 'page-team-overview', when: r.data.page.keep.when, every: 'day', time: '06:30', notify: 'always', check: 'Who failed overnight' });
  assert.ok(r.data.page.keep.when);
  r = await srv.api('/bots/chief/pages/team-overview/keep', { method: 'POST', body: { every: 'yearly' } });
  assert.equal(r.status, 400);

  srv.reply('Two bots failed overnight; the page says which.');
  r = await srv.api('/bots/chief/jobs/page-team-overview/run', { method: 'POST' });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const run = await srv.nextRun(isKeep, 'the run that keeps the page');
  assert.deepEqual(flagged(run.args, '--tools'), ['WebSearch', 'WebFetch']);
  assert.deepEqual(flagged(run.args, '--allowedTools'), ['WebSearch', 'WebFetch', 'mcp__botdot__recall', 'mcp__botdot__list_bots', 'mcp__botdot__get_bot', 'mcp__botdot__list_runs', 'mcp__botdot__get_run', 'mcp__botdot__save_page']);
  assert.deepEqual([run.botdot.env.BOT_DOT_LOOK, run.botdot.env.BOT_DOT_PAGE], ['1', '1']);
  assert.ok(run.args.includes('--no-session-persistence'));
  assert.match(run.stdin, /Keep your page "Team overview" up to date/);
  assert.match(run.stdin, /What to check: Who failed overnight/);
  assert.match(run.stdin, /<your-page>\n# Team overview\n\n3 bots, all idle\.\n<\/your-page>/);
  const posted = await waitFor(async () => (await chatNow(chatId)).messages.find((m) => m.kept), { what: 'its message in the chat' });
  assert.deepEqual([posted.text, posted.kept, posted.pages, posted.startedBy], ['Two bots failed overnight; the page says which.', { slug: 'team-overview', title: 'Team overview' }, [{ slug: 'team-overview', title: 'Team overview' }], 'botdot']);

  // The owner's next turn there is told it, as the Chief's own message from a run that read the web.
  srv.reply('Yes.');
  await srv.api(`/chief/chats/${chatId}/messages`, { method: 'POST', body: { text: 'which ones?' } });
  const turn = await srv.nextRun((x) => isTurn(x) && x.stdin.includes('which ones?'), "the owner's next turn");
  assert.match(turn.stdin, /after you updated your page "Team overview" on its schedule[\s\S]*<your-page-message>\nTwo bots failed overnight/);

  r = await srv.api('/bots/chief/pages/team-overview/keep', { method: 'DELETE' });
  assert.equal(r.data.page.keep, null);
  assert.equal((await srv.api('/bots/chief/jobs/page-team-overview/run', { method: 'POST' })).status, 404);
});

test('a kept page is due once its next time after the last run has passed', () => {
  const jobs = [{ slug: 'a', cron: '0 7 * * *', since: '2026-10-20T08:00:00', lastAt: null }, { slug: 'b', cron: '0 * * * *', since: '2026-10-20T08:00:00', lastAt: '2026-10-20T09:00:30' }];
  assert.equal(pagesLib.dueKeep(jobs, new Date('2026-10-20T09:30:00')), null);
  assert.equal(pagesLib.dueKeep(jobs, new Date('2026-10-20T10:00:00'))?.slug, 'b');
  assert.equal(pagesLib.dueKeep(jobs, new Date('2026-10-21T07:00:00'))?.slug, 'a');
  assert.equal(pagesLib.dueKeep([{ slug: 'x', cron: 'nonsense', since: '2026-10-20T08:00:00' }], new Date('2030-01-01')), null);
});

// What the tests of carrying on after the owner's OK share (ADR 009, test/ask-carries-on*.test.js).
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('node:http');
const { sleep, waitFor } = require('./helpers');

// A stand-in for GitHub, which a skill from a link is read from: one repository, https://github.com/acme/skills,
// with the one skill "tidy-desk". Started with the server: `env` tells botdot where it is.
async function fakeGithub() {
  const SKILL = '---\nname: tidy-desk\ndescription: Keeps a desk tidy.\n---\nPut things back.';
  const server = http.createServer((req, res) => {
    if (req.url === '/repos/acme/skills') return res.end(JSON.stringify({ default_branch: 'main' }));
    if (req.url.startsWith('/repos/acme/skills/git/trees/main')) return res.end(JSON.stringify({ tree: [{ type: 'blob', path: 'SKILL.md', size: SKILL.length }] }));
    if (req.url === '/acme/skills/main/SKILL.md') return res.end(SKILL);
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${server.address().port}`;
  return { env: { BOT_DOT_GITHUB_API_URL: at, BOT_DOT_GITHUB_RAW_URL: at }, close: () => server.close() };
}

// Tools a run was refused, as Claude Code reports them when it ends.
const BASH = { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'gh pr list', description: 'List open pull requests' } };
const WEB = { tool_name: 'WebFetch', tool_use_id: 't2', tool_input: { url: 'https://example.com' } };
// A run of this bot, among the stand-in Claude's runs.
const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);

function kit(srv) {
  // What the stand-in Claude's next runs are refused.
  const refuse = (denials) => fs.writeFileSync(path.join(srv.out, 'denials.json'), JSON.stringify(denials));
  const asksOf = async (bot) => (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
  const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
  const answer = (ask, yes) => srv.api(`/asks/${ask.id}`, { method: 'POST', body: { yes } });
  const lastRun = (bot) => waitFor(() => srv.runs().filter(isRunOf(bot)).at(-1), { what: `a run of ${bot.name}` });
  // The bot is asked something, and its run ends refused these tools: the run as it ended.
  async function refused(bot, denials, body = { prompt: 'Check the PRs' }, as = srv.api) {
    refuse(denials);
    const r = await as(`/bots/${bot.id}/run`, { method: 'POST', body });
    const done = await srv.finished(r.data.id);
    refuse([]);
    return done;
  }
  // The run that carries on from `stopped`, once it has ended.
  const carriedOn = async (bot, stopped) => srv.finished((await waitFor(async () => (await runsOf(bot)).find((r) => r.continues === stopped.id), { what: 'the run that carries on' })).id);
  // Nothing more starts for this bot: its runs stay as many as they are. What an answer starts, it starts before it
  // answers, and what waited in the queue starts as the run before it ends: a moment is enough to see either.
  async function startsNothing(bot, n) {
    await sleep(60);
    assert.equal((await runsOf(bot)).length, n, 'no new run');
  }
  return { refuse, asksOf, runsOf, answer, lastRun, refused, carriedOn, startsNothing };
}

module.exports = { kit, fakeGithub, BASH, WEB, isRunOf };

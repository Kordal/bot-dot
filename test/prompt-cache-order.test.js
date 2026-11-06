// A bot's prompt is laid out for Claude's prompt cache (#1110): what stays the same from one run of the bot to the
// next comes first, and what is this run's alone (its task and chat, its notes, what was looked up, the time) last,
// so two runs of the bot share the longest beginning a cache can reuse.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv?.stop());

const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
async function ask(bot, prompt, reply) {
  srv.reply(reply);
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  const rec = await srv.nextRun(isRunOf(bot), `a run of ${bot.name}`);
  await srv.finished(r.data.id);
  return rec.system;
}
// The length of the beginning two texts share.
const shared = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

test("botdot's rules, its tools and the bot's own instructions come before the run's task, chat and time", async () => {
  const bot = await makeBot(srv, { name: 'Cache Keeper', emoji: '🗄️', systemPrompt: 'Always answer in one line. OWN-RULES' });
  const first = await ask(bot, 'What is new?', 'Nothing new.');
  const second = await ask(bot, 'And now?', 'Still nothing.');
  assert.match(second, /^You are 🗄️ Cache Keeper, a bot in botdot/, 'who it is, first');
  const at = (text) => { const i = second.indexOf(text); assert.ok(i >= 0, text); return i; };
  const rules = at('Saved logins (botdot\'s Vault');
  const own = at('OWN-RULES');
  const task = at('The owner has sent you a message.');
  const chat = at('<conversation>');
  const now = at('\nNow: ');
  assert.ok(rules < own && own < task && task < chat && chat < now, 'static, then its own rules, then the run');
  assert.ok(second.trimEnd().endsWith('the time zone schedules follow).'), 'the time is last');
  // Both runs share everything up to the run's own part.
  assert.ok(shared(first, second) > own, `the two prompts part at ${shared(first, second)}, before its own rules end at ${own}`);
});

// A member's turn in a group asks a bot outside the group (ask_bot, ADR 218): it is told who it may ask, the asked
// bot works in its own chat with the question, its reply comes back into the turn that waits, and the turn's record
// shows whom it asked and what came back. Against a real botdot server and the stand-in for Claude
// (test/fixtures/fake-claude.js): what botdot starts, hands over and refuses, not what a model then does.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName } = require('../public/mentions.js');

let srv;
before(async () => { srv = await startServer(); });
after(() => {
  for (const f of fs.readdirSync(srv.out)) if (f.startsWith('hold')) fs.rmSync(path.join(srv.out, f), { force: true });
  return srv.stop();
});

const fileOf = (bot, kind, ext = '') => path.join(srv.out, `${kind}-${shortName(bot.name)}${ext}`);
const reply = (bot, text) => fs.writeFileSync(fileOf(bot, 'result', '.txt'), text);
const hold = (bot) => fs.writeFileSync(fileOf(bot, 'hold'), '');
const letGo = (bot) => fs.rmSync(fileOf(bot, 'hold'), { force: true });
const runOf = async (id) => (await srv.api(`/runs/${id}?events=0`)).data;
// The self tools' call, as the run's ask_bot makes it: with the run's own token.
async function self(rec, p, body) {
  const env = rec.self.env;
  const res = await fetch(`${env.SELF_URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Run-Token': env.RUN_TOKEN }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

test('a turn in a group asks a bot outside it and gets its reply back; a member is named instead', async () => {
  const lead = await makeBot(srv, { name: 'Planner', emoji: '🗺', prompt: 'Plan trips.' });
  const member = await makeBot(srv, { name: 'Booker', emoji: '🎫', prompt: 'Book things.' });
  const mail = await makeBot(srv, { name: 'Mail Steward', emoji: '📬', prompt: 'Read the mail.', description: 'Reads the owner\'s mail.' });
  const made = await srv.api('/group-chats', { method: 'POST', body: { name: 'Trip', members: [lead.id, member.id] } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const group = made.data;

  hold(lead);
  reply(mail, 'The return flight is KL1234 on 14 November at 18:05.');
  const sent = await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: '@Planner when do we fly back?' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const turn = await srv.nextRun((r) => r.who === shortName(lead.name), 'the lead\'s turn');
  assert.equal(turn.self.env.SELF_ASK, '1', 'a turn in a group has ask_bot');
  assert.equal(turn.self.env.SELF_TEAM, '0', 'and still no message_bot (#759)');
  // It is told the bots outside the group, by id and what they do; never a member.
  assert.match(turn.system, /Bots of the owner's team outside this group, which you may ask with ask_bot:/);
  assert.ok(turn.system.includes(`📬 Mail Steward (id ${mail.id}): Reads the owner's mail.`), turn.system);
  assert.ok(!turn.system.includes(`(id ${member.id})`), 'a member is not on the list');

  // A member is named with "@", not asked; nor is the bot itself.
  const toMember = await self(turn, '/ask-bot', { to: member.id, question: 'Is the hotel booked?' });
  assert.equal(toMember.data.ok, false);
  assert.match(toMember.data.error, /is a member of this group: name it with "@"/);
  assert.equal((await self(turn, '/ask-bot', { to: lead.id, question: 'x' })).data.ok, false);

  const asked = await self(turn, '/ask-bot', { to: mail.id, question: 'Is there a return flight in the booking email?' });
  assert.equal(asked.data.ok, true, JSON.stringify(asked.data));
  assert.equal(asked.data.to.id, mail.id);
  let answer;
  await waitFor(async () => { answer = (await self(turn, '/ask-bot-answer', { runId: asked.data.runId, waitMs: 2000 })).data; return answer.done; }, { timeout: 20_000, what: 'the answer' });
  assert.deepEqual([answer.status, answer.reply], ['success', 'The return flight is KL1234 on 14 November at 18:05.']);

  // The asked bot worked in its own chat, with the question, and was told its reply goes back to the asker.
  const theirs = srv.runs().find((r) => r.who === shortName(mail.name));
  assert.ok(theirs.stdin.includes('Is there a return flight in the booking email?') || theirs.system.includes('Is there a return flight'), 'it was handed the question');
  assert.match(theirs.system, /Planner asked you this while answering the owner in the group "Trip", and waits for your reply/);
  assert.equal(theirs.self.env.SELF_TEAM === '1' && /never message it with message_bot/.test(theirs.system), true);
  const mailRun = await runOf(asked.data.runId);
  assert.equal(mailRun.botId, mail.id);
  assert.equal(mailRun.groupId, undefined, 'its run is in its own chat, not the group');
  assert.equal(mailRun.notificationAudience, 'internal', 'the asker waited for it: nothing for the owner there');
  assert.deepEqual([mailRun.fromBot.id, mailRun.fromBot.group.id, mailRun.fromBot.group.name], [lead.id, group.id, 'Trip']);

  // An ask that is not this turn's is refused.
  assert.equal((await self(turn, '/ask-bot-answer', { runId: 'nope' })).data.ok, false);

  letGo(lead);
  const done = await waitFor(async () => { const r = (await srv.api(`/runs?group=${group.id}`)).data.find((x) => x.botId === lead.id && x.status !== 'running'); return r || null; }, { timeout: 20_000, what: 'the turn to end' });
  assert.equal(done.asked.length, 1);
  assert.deepEqual([done.asked[0].id, done.asked[0].name, done.asked[0].text, done.asked[0].reply, done.asked[0].status], [mail.id, 'Mail Steward', 'Is there a return flight in the booking email?', 'The return flight is KL1234 on 14 November at 18:05.', 'success']);
});

test('a bot\'s own chat has no ask_bot: it messages teammates with message_bot', async () => {
  const solo = await makeBot(srv, { name: 'Solo', emoji: '🧭', prompt: 'Help.' });
  const r = await srv.api(`/bots/${solo.id}/run`, { method: 'POST', body: { prompt: 'Hi' } });
  assert.ok([200, 201, 202].includes(r.status), JSON.stringify(r.data));
  const run = await srv.nextRun((x) => x.who === shortName(solo.name), 'its run');
  assert.equal(run.self.env.SELF_ASK, '0');
  assert.equal(run.self.env.SELF_TEAM, '1');
  assert.doesNotMatch(run.system, /which you may ask with ask_bot/);
});

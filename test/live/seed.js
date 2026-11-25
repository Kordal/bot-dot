// Seeding for the live suites, with no Claude in it (npm test checks it: test/memory-live-grading.test.js): past runs
// written straight to a stopped server's data folder, and notes added to its memory by a short child process.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { DAYS } = require('../../lib/chat-history');

const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();

// A finished run written straight to the data folder, as if a bot made it days ago (the index picks it up
// on the next start). For facts that should live only in a past run: so by default never younger than the window
// of the conversation block, or it would hand the run to the bot that is asked about it.
function seedRun(data, bot, { prompt, result, days = DAYS + 1 }) {
  const at = daysAgo(days);
  const id = `${at.replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 6)}`;
  const meta = { id, botId: bot.id, botName: bot.name, botEmoji: bot.emoji, botColor: bot.color, prompt, customPrompt: true, trigger: 'manual', status: 'success', startedAt: at, endedAt: at, durationMs: 1000, numTurns: 1, result };
  fs.writeFileSync(path.join(data, 'runs', `${id}.json`), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(data, 'runs', `${id}.ndjson`), [{ type: 'run_start', meta }, { type: 'result', subtype: 'success', result }, { type: 'run_end', status: 'success', meta }].map((e) => JSON.stringify(e)).join('\n') + '\n');
  return id;
}

// Notes added to a bot's memory in a stopped server's data folder, as the server's own memory would add them: by
// the bot ('bot'), or by the owner (owner: true: the owner's word, pinned by them unless pinned: false). A child
// process holds the database for the moment it takes, so that the server that starts next finds it closed.
// notes: [{ key, text, topic, pinned, owner, days }] (days: how long ago it was said). Returns [{ key, id }].
const ADD_NOTES = `
const memory = require(process.argv[1]).create(process.argv[2]);
const [bot, notes] = [process.argv[3], JSON.parse(process.argv[4])];
const day = 864e5;
console.log(JSON.stringify(notes.map((n) => ({ key: n.key, id: memory.addNote(bot, n.text, {
  by: n.owner ? 'you' : 'bot', source: n.owner ? 'owner' : 'bot', topic: n.topic || '', pinned: n.pinned !== false,
  locked: !!n.owner && n.pinned !== false, createdAt: new Date(Date.now() - (n.days || 14) * day).toISOString() }).note.id }))));
`;
function seedNotes(data, botId, notes) {
  const out = execFileSync(process.execPath, ['-e', ADD_NOTES, path.join(__dirname, '..', '..', 'lib', 'memory.js'), data, botId, JSON.stringify(notes)], { encoding: 'utf8' });
  return JSON.parse(out);
}

module.exports = { seedRun, seedNotes, daysAgo };

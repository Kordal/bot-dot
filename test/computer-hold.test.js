// A bot keeps its computer on after its run while it waits for the owner to do a step on it (#340): it calls
// keep_computer_on before it replies, and the end of that run does not turn its computer off. The hold ends on the
// owner's next message to the bot, or 1 hour after it started, and a saved hold comes back after a restart.
// This file loads lib/bots.js itself, on a scratch data folder and the stand-in for Claude, with the computers
// stubbed: no Docker is needed, and what botdot asks of them is listed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-computer-hold-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'),
});
fs.mkdirSync(process.env.HOME);

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('./helpers');
const B = require('../lib/bots');

const ended = (id) => waitFor(() => { const m = B.readMeta(id); return m && m.status !== 'running' ? m : null; }, { what: `run ${id} to end` });
const hold = () => fs.writeFileSync(path.join(out, 'hold'), '');
const letGo = () => fs.rmSync(path.join(out, 'hold'), { force: true });
after(() => { letGo(); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

// The computers, stubbed: what botdot asked of them, and which ones are on.
let asked = [];
const on = new Set();
Object.assign(B.computers, {
  ensure: async (botId) => { asked.push(['ensure', botId]); on.add(botId); },
  stop: async (botId) => { asked.push(['stop', botId]); on.delete(botId); },
  inspect: async (botId) => ({ state: on.has(botId) ? 'running' : 'stopped' }),
  setRestartPolicy: async () => {},
});
beforeEach(() => { asked = []; on.clear(); });
const stops = (bot) => asked.filter(([what, id]) => what === 'stop' && id === bot.id).length;

// A run of the bot that uses its computer (unless told not to) and, with keepOn, keeps it on for the owner.
async function run(bot, { keepOn = false, uses = true, ...how } = {}) {
  hold();
  const meta = B.startRun(bot, { prompt: 'Sign in to Bridge', ...how });
  if (uses) await B.computerForRun(meta.id);
  if (keepOn) await B.keepComputerOn(meta.id);
  letGo();
  return ended(meta.id);
}

test('a run that called keep_computer_on leaves its computer on when it ends', async () => {
  const bot = B.bots.create({ name: 'Mail Keeper', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  assert.equal(stops(bot), 0);
  assert.ok(on.has(bot.id));
});

test('a run that did not call it turns its computer off when it ends, as before', async () => {
  const bot = B.bots.create({ name: 'Plain', prompt: 'Help.', computer: 'linux' });
  await run(bot);
  assert.equal(stops(bot), 1);
  assert.ok(!on.has(bot.id));
});

test("the owner's next message ends the hold: the computer goes off when that run ends, also when it did not use it", async () => {
  const bot = B.bots.create({ name: 'Waits For You', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  await run(bot, { prompt: 'Done, I signed in', uses: false });
  assert.equal(stops(bot), 1);
  assert.ok(!on.has(bot.id));
  // A run after that, which uses the computer and does not hold it, turns it off as before.
  await run(bot);
  assert.equal(stops(bot), 2);
});

test("the owner's next message may be held again: the bot calls keep_computer_on in that run too", async () => {
  const bot = B.bots.create({ name: 'Asks Twice', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  await run(bot, { prompt: 'Which window?', keepOn: true });
  assert.equal(stops(bot), 0);
  assert.ok(on.has(bot.id));
});

test("runs another bot, the Chief or a job started keep the hold: the computer stays on after them", async () => {
  const bot = B.bots.create({ name: 'Busy', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  await run(bot, { prompt: 'A note from a teammate', trigger: 'bot', fromBot: { id: 'other', name: 'Other', hop: 1, chainId: 'c1' } });
  await run(bot, { prompt: 'The Chief asks', startedBy: 'chief' });
  await run(bot, { prompt: 'Check the mail', trigger: 'schedule', job: { id: 'j1', name: 'Mail', prompt: 'Check the mail' } });
  assert.equal(stops(bot), 0);
  assert.ok(on.has(bot.id));
  // The owner's message still ends it.
  await run(bot, { prompt: 'Done', uses: false });
  assert.equal(stops(bot), 1);
});

test('a hold ends by itself 1 hour after it started, and the computer is turned off', async () => {
  const bot = B.bots.create({ name: 'Never Answered', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  await B.keepHeldComputers(Date.now() + 59 * 60_000);
  assert.equal(stops(bot), 0, 'not before the hour');
  await B.keepHeldComputers(Date.now() + 60 * 60_000 + 1000);
  assert.equal(stops(bot), 1);
  assert.ok(!on.has(bot.id));
  // It is over: the owner's next message is not what turns it off, and nothing turns it off twice.
  await B.keepHeldComputers(Date.now() + 2 * 60 * 60_000);
  await run(bot, { prompt: 'Done', uses: false });
  assert.equal(stops(bot), 1);
});

test('the hour counts from when the hold started, not from a later run of a job or another bot', async () => {
  const bot = B.bots.create({ name: 'Counted', prompt: 'Keep the mail.', computer: 'linux' });
  const started = Date.now();
  await run(bot, { keepOn: true });
  await run(bot, { prompt: 'The Chief asks', startedBy: 'chief' });
  await B.keepHeldComputers(started + 60 * 60_000 + 1000);
  assert.equal(stops(bot), 1);
});

test('a held computer that is off is turned on again, until the hold ends', async () => {
  const bot = B.bots.create({ name: 'Comes Back', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  on.delete(bot.id); // as after a restart of the machine
  asked = [];
  await B.keepHeldComputers();
  assert.deepEqual(asked, [['ensure', bot.id]]);
  assert.ok(on.has(bot.id));
  // A computer that is on is left alone.
  asked = [];
  await B.keepHeldComputers();
  assert.deepEqual(asked, []);
});

test('a computer the owner turned on by hand is not held: the hour does not turn it off', async () => {
  const bot = B.bots.create({ name: 'By Hand', prompt: 'Help.', computer: 'linux' });
  on.add(bot.id);
  await B.keepHeldComputers(Date.now() + 3 * 60 * 60_000);
  assert.equal(stops(bot), 0);
  assert.ok(on.has(bot.id));
});

test('a bot whose computer stays on all the time behaves as before: keep_computer_on holds nothing, the hour turns nothing off', async () => {
  const bot = B.bots.create({ name: 'Always', prompt: 'Help.', computer: 'linux', computerAlwaysOn: true });
  await run(bot, { keepOn: true });
  await B.keepHeldComputers(Date.now() + 2 * 60 * 60_000);
  assert.equal(stops(bot), 0);
  // Its setting turned off later: no hold of before is there to keep it on, nor to turn it on again. The account's
  // computer, which the other bots work on, is not turned off for it (#104).
  const plain = B.bots.update(bot.id, { computerAlwaysOn: false });
  await B.applyComputerPower(plain);
  assert.equal(stops(bot), 0);
  on.clear(); // the computer went off since, for another reason
  await B.keepHeldComputers();
  assert.ok(!on.has(bot.id));
});

test("a change of the bot's computer setting ends the hold", async () => {
  const bot = B.bots.create({ name: 'Changed', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  await B.applyComputerPower(B.bots.update(bot.id, { computer: 'none' }));
  assert.equal(stops(bot), 0, "the account's computer is not turned off for one bot (#104)");
  // Given its computer back, the hold of before does not turn it on.
  await B.applyComputerPower(B.bots.update(bot.id, { computer: 'linux' }));
  on.clear(); // the computer went off since, for another reason
  await B.keepHeldComputers();
  assert.ok(!on.has(bot.id));
  // Nor does a change to stay on all the time leave one that would turn it off after the hour.
  await run(bot, { keepOn: true });
  await B.applyComputerPower(B.bots.update(bot.id, { computerAlwaysOn: true }));
  await B.keepHeldComputers(Date.now() + 2 * 60 * 60_000);
  assert.ok(on.has(bot.id));
});

test('"Turn off" and "Reset" end the hold (endComputerHold): the computer is not turned on again', async () => {
  const bot = B.bots.create({ name: 'Turned Off', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  B.endComputerHold(bot.id);
  on.delete(bot.id);
  await B.keepHeldComputers();
  assert.ok(!on.has(bot.id));
  // Its next run that uses the computer turns it off again at its end.
  await run(bot, { prompt: 'The Chief asks', startedBy: 'chief' });
  assert.equal(stops(bot), 1);
});

test('a run stopped after the bot asked for the step still holds the computer', async () => {
  const bot = B.bots.create({ name: 'Stopped', prompt: 'Keep the mail.', computer: 'linux' });
  hold();
  const meta = B.startRun(bot, { prompt: 'Sign in to Bridge' });
  await B.keepComputerOn(meta.id);
  B.stopRun(meta.id);
  letGo();
  assert.equal((await ended(meta.id)).endedBy, 'owner');
  assert.equal(stops(bot), 0);
  assert.ok(on.has(bot.id));
});

test('"Turn off" while a held computer is being turned on again leaves it off', async () => {
  const bot = B.bots.create({ name: 'Raced', prompt: 'Keep the mail.', computer: 'linux' });
  await run(bot, { keepOn: true });
  on.delete(bot.id);
  const ensure = B.computers.ensure;
  let starting;
  B.computers.ensure = (botId) => (botId !== bot.id ? ensure(botId) : new Promise((resolve) => { starting = () => { on.add(botId); resolve(); }; }));
  try {
    const looking = B.keepHeldComputers();
    await waitFor(() => starting, { what: 'the computer to be starting' });
    // The owner's "Turn off" (server.js): the hold ends and the computer is stopped, while it still starts.
    B.endComputerHold(bot.id);
    await B.computers.stop(bot.id);
    starting();
    await looking;
  } finally { B.computers.ensure = ensure; }
  assert.ok(!on.has(bot.id));
});

test('a saved hold comes back after a restart of botdot, and the hour still counts from its start', async () => {
  const bot = B.bots.create({ name: 'Restarted', prompt: 'Keep the mail.', computer: 'linux' });
  const started = Date.now();
  await run(bot, { keepOn: true });
  on.delete(bot.id);
  asked = [];
  // botdot starts again: a fresh lib/bots.js reads what was saved in the same data folder.
  for (const m of ['../lib/bots', '../lib/computer-holds']) delete require.cache[require.resolve(m)];
  const again = require('../lib/bots');
  const mine = () => asked.filter(([, id]) => id === bot.id).map(([what]) => what);
  await again.keepHeldComputers(started + 59 * 60_000);
  assert.deepEqual(mine(), ['ensure']);
  await again.keepHeldComputers(started + 60 * 60_000 + 1000);
  assert.deepEqual(mine(), ['ensure', 'stop']);
});

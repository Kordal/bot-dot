// A bot keeps its computer on after its run while it waits for the owner to do a step on it (#340): a hold.
// One record per bot in computer-holds.json, with when the hold started, so it survives a restart of botdot.
// It ends on the owner's next message to the bot, on "Turn off", "Reset" or a change of the bot's computer
// setting, and at the latest LIMIT_MS after it started.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const LIMIT_MS = 60 * 60_000;

function create(dataDir) {
  const file = path.join(dataDir, 'computer-holds.json');
  const holds = readJson(file, {}); // botId -> { since }
  const save = () => writeJson(file, holds);

  function start(botId, now = Date.now()) {
    holds[botId] = { since: new Date(now).toISOString() };
    save();
  }
  // Ends the bot's hold; whether it had one.
  function end(botId) {
    if (!holds[botId]) return false;
    delete holds[botId];
    save();
    return true;
  }
  // Whether the bot's computer is held now: it has a hold, and that hold is not older than the limit.
  const held = (botId, now = Date.now()) => !!holds[botId] && now - Date.parse(holds[botId].since) < LIMIT_MS;
  const bots = () => Object.keys(holds);

  return { start, end, held, bots };
}

module.exports = { create, LIMIT_MS };

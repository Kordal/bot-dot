// Each bot has a screen of its own on the account's computer (#105, ADR 035): its own X display, VNC and noVNC
// port, cua computer-server and Camoufox with its own bridge. botdot keeps which screen number each bot has in
// computer-screens.json, so it stays the same across restarts, and frees it when the bot is deleted. A screen is a
// separate work surface, not a wall: every bot still has sudo there.
//
// facade() is what the rest of botdot calls the computer through (bots.js exports it as B.computers): the same
// calls by bot id, with each of a bot's calls handed on to lib/computers.js with its seat, { bot, screen }.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

// As many as lib/computers.js has ports set aside for (screenPorts).
const MAX = 89;

function create(dataDir) {
  const file = path.join(dataDir, 'computer-screens.json');
  const screens = readJson(file, {}); // botId -> screen number, 1..MAX
  const save = () => writeJson(file, screens);

  // The bot's screen, given the lowest free number the first time it needs one.
  function of(botId) {
    if (screens[botId]) return screens[botId];
    const taken = new Set(Object.values(screens));
    let n = 1;
    while (taken.has(n)) n++;
    if (n > MAX) throw new Error(`All ${MAX} screens of the account's computer are taken`);
    screens[botId] = n;
    save();
    return n;
  }
  // The bot's screen goes back to the free ones; the number it had, or null.
  function free(botId) {
    const n = screens[botId];
    if (!n) return null;
    delete screens[botId];
    save();
    return n;
  }
  const has = (botId) => !!screens[botId];
  return { of, free, has };
}

// The calls of lib/computers.js that act on one bot's screen: their first argument is its seat.
const PER_SCREEN = ['request', 'typeSecret', 'startProgram', 'runWithLogin', 'runWithSshKey', 'screenPipe'];

function facade(computers, screens) {
  const seat = (botId) => ({ bot: botId, screen: screens.of(botId) });
  const out = { ...computers };
  for (const name of PER_SCREEN) out[name] = (botId, ...rest) => computers[name](seat(botId), ...rest);
  // A bot's first computer tool starts the account's computer and its own screen; without a bot, only the computer.
  out.ensure = (...args) => (args.length ? computers.ensure(seat(args[0])) : computers.ensure());
  // Reading its logs gives it no screen either: without one, they are the computer's alone.
  out.logs = (botId, ...rest) => computers.logs(screens.has(botId) ? seat(botId) : null, ...rest);
  // Looking at a bot's screen gives it none: a bot without one yet has its screen 'off' on a running computer.
  out.screenState = async (botId) => {
    if (screens.has(botId)) return computers.screenState(seat(botId));
    const { state } = await computers.inspect(botId);
    return { state: state === 'running' ? 'off' : state };
  };
  // A deleted bot: its screen ends on the computer, its browser profile goes, and its number is free again. Its
  // folder in /workspace stays, as the other bots' files do.
  out.free = async (botId) => {
    if (!screens.has(botId)) return;
    try {
      await computers.freeScreen(seat(botId));
    } catch (e) {
      console.warn(`[computers] couldn't end the screen of deleted bot ${botId}: ${e.message}`);
    }
    screens.free(botId);
  };
  return out;
}

module.exports = { create, facade, MAX };

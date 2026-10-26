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
  // Whose screen a number is, or null.
  const botOf = (n) => Object.keys(screens).find((id) => screens[id] === n) || null;
  const all = () => Object.keys(screens);
  return { of, free, has, botOf, all };
}

// The calls of lib/computers.js that act on one bot's screen: their first argument is its seat. Each starts the screen
// first when it isn't on, also when it ended unused during a long run.
const ON_SCREEN = ['request', 'typeSecret', 'browserTool', 'startProgram'];
// The bot's commands and files (#134): in its folder, with no screen. They neither start it nor keep it on.
const OFF_SCREEN = ['runWithLogin', 'runWithSshKey', 'runWithFile', 'placeFile', 'removePlacedFile', 'runShell', 'readFile', 'writeFile', 'bringOut', 'listUploads', 'putUpload', 'packFolder', 'unpackFolder'];

// A screen nobody used for this long ends (#126): under gVisor its desktop and its browser hold memory of the
// account's computer as long as they run (0.5 to 2.5 GB a screen on hq), memory the account can't get back.
const REST_AFTER_MS = Number(process.env.BOT_DOT_SCREEN_REST_MS) || 30 * 60_000;

// A bot whose computer is on boat.dev (#529, ADR 088): `boat` is lib/boat.js's machines, `kindOf` a bot's computer
// ('none', 'linux' or 'boat'). Its commands and files go to its machine there, which starts with the first of them;
// it has no screen, no browser and no Vault secret. When boat.dev can't start its machine (no key, unreachable, a
// refusal), its commands and files run on the account's computer for the rest of the run, and each says so.
const BOAT_CALLS = ['runShell', 'readFile', 'writeFile', 'packFolder', 'unpackFolder'];
const NO_SCREEN = 'Your computer is on boat.dev: it has no screen or browser. Use run_shell, read_file and write_file.';
const NO_SECRET = 'Your computer is on boat.dev, where botdot puts no saved login, key or file of the Vault.';
const FELL_BACK = "boat.dev couldn't start your machine there, so this ran on the account's computer";

// nameOf: a bot's name, which its commits on the computer carry (lib/workspace-git.js). moving(botId): what its
// computer tools answer while its files are copied to its new computer (lib/computer-move.js), or null.
function facade(computers, screens, { restAfterMs = REST_AFTER_MS, now = Date.now, boat = null, kindOf = () => 'linux', nameOf = () => null, moving = () => null } = {}) {
  const seat = (botId) => { const name = nameOf(botId); return { bot: botId, screen: screens.of(botId), ...(name ? { name } : {}) }; };
  const out = { ...computers };
  const onBoat = (botId) => !!boat && kindOf(botId) === 'boat';
  const fellBack = new Set(); // boat bots whose machine didn't start: on the account's computer until it does
  // When each running screen was last used, and how many calls on it are still running (the owner watching it
  // counts as one): a screen in use never ends.
  const usedAt = new Map(); // botId -> ms
  const busy = new Map(); // botId -> calls still running
  const used = (botId) => usedAt.set(botId, now());
  const begin = (botId) => { busy.set(botId, (busy.get(botId) || 0) + 1); used(botId); };
  const end = (botId) => { busy.set(botId, busy.get(botId) - 1); used(botId); };
  // A screen still on from before botdot started counts as used now, so it ends too when nothing uses it.
  for (const botId of screens.all?.() || []) used(botId);
  const during = (botId, work) => { begin(botId); return Promise.resolve().then(work).finally(() => end(botId)); };
  // The screens started here and not ended since. A screen botdot did not start (before botdot itself started) is
  // started again by its bot's next call, which finds it up and leaves it as it is.
  const up = new Set();
  const start = (botId) => computers.ensure(seat(botId)).then((c) => { up.add(botId); return c; });
  for (const name of ON_SCREEN) {
    out[name] = (botId, ...rest) => (moving(botId) ? Promise.reject(new Error(moving(botId))) : onBoat(botId) ? Promise.reject(new Error(NO_SCREEN)) : during(botId, async () => {
      if (!up.has(botId)) await start(botId);
      return computers[name](seat(botId), ...rest);
    }));
  }
  // A Vault call of a boat bot is refused even while it is on the account's computer: its secrets never go there.
  for (const name of OFF_SCREEN) {
    out[name] = async (botId, ...rest) => {
      if (moving(botId)) return { code: null, stdout: '', stderr: '', timedOut: false, error: moving(botId) };
      if (!onBoat(botId)) return computers[name](seat(botId), ...rest);
      if (!BOAT_CALLS.includes(name)) return { code: null, stdout: '', stderr: '', timedOut: false, error: NO_SECRET };
      if (!fellBack.has(botId)) {
        try { return await boat[name](botId, ...rest); } catch (e) {
          console.warn(`[boat] ${botId} works on the account's computer for now: ${e.message}`);
          fellBack.add(botId);
        }
      }
      const r = await computers[name](seat(botId), ...rest);
      return r && !r.error ? { ...r, error: FELL_BACK } : r;
    };
  }
  // The bot's commands and files need its machine only: the account's computer, or its own on boat.dev, started now.
  out.ensureMachine = async (botId) => {
    if (!onBoat(botId)) return computers.ensure();
    try {
      const id = await boat.ensure(botId);
      fellBack.delete(botId);
      return id;
    } catch (e) {
      console.warn(`[boat] ${botId} works on the account's computer for now: ${e.message}`);
      fellBack.add(botId);
      return computers.ensure();
    }
  };
  // A step of copying the bot's folder (#556), on the account's computer whatever the bot's computer is now: started
  // first for the steps that begin a tar there.
  out.moveFiles = async (botId, step) => {
    if (step.op === 'pack' || step.op === 'write' && !step.offset) await computers.ensure();
    return computers.moveFiles(seat(botId), step);
  };
  out.screenPipe = (botId) => {
    if (onBoat(botId)) throw new Error(NO_SCREEN);
    begin(botId);
    const pipe = computers.screenPipe(seat(botId));
    pipe.once('close', () => end(botId));
    return pipe;
  };
  // A bot's first computer tool starts the account's computer and its own screen; without a bot, only the computer.
  out.ensure = (...args) => (!args.length ? computers.ensure() : onBoat(args[0]) ? Promise.reject(new Error(NO_SCREEN)) : during(args[0], () => start(args[0])));
  // The screens unused for longer than the rest time end, each once: their desktop and browser stop, their browser
  // profile and files stay, and a bot's next computer tool starts its screen again. The bots whose screen ended.
  out.restIdle = async () => {
    const ended = [];
    if (boat) await boat.restIdle().catch(() => []);
    for (const [botId, at] of usedAt) {
      if (busy.get(botId) || now() - at <= restAfterMs || !screens.has(botId)) continue;
      usedAt.delete(botId);
      up.delete(botId);
      try { await computers.restScreen(seat(botId)); ended.push(botId); } catch (e) { console.warn(`[computers] couldn't end the idle screen of ${botId}: ${e.message}`); }
    }
    return ended;
  };
  // A computer made or started again has no screens on: each starts again with its bot's next call.
  for (const name of ['restartAll', 'updateAll', 'resetAll']) {
    if (computers[name]) out[name] = (...args) => { up.clear(); return Promise.resolve(computers[name](...args)).finally(() => up.clear()); };
  }
  // Reading its logs gives it no screen either: without one, they are the computer's alone.
  out.logs = (botId, ...rest) => computers.logs(screens.has(botId) ? seat(botId) : null, ...rest);
  // Looking at a bot's screen gives it none: a bot without one yet has its screen 'off' on a running computer.
  out.screenState = async (botId) => {
    if (screens.has(botId)) return computers.screenState(seat(botId));
    const { state } = await computers.inspect(botId);
    return { state: state === 'running' ? 'off' : state };
  };
  // What each bot uses of the computer (#109), by bot id: a screen that is no bot's now counts as the computer's own.
  out.usage = async () => {
    const { screens: used, other, ...rest } = await computers.usage();
    if (!used) return rest;
    const bots = {};
    const own = { ...other };
    for (const { screen, ...u } of used) {
      const id = screens.botOf(screen);
      if (id) { bots[id] = u; continue; }
      for (const k of ['memoryBytes', 'cpuPercent', 'processes']) own[k] = (own[k] || 0) + u[k];
    }
    return { ...rest, bots, other: own };
  };
  // A deleted bot: its screen ends on the computer, its browser profile goes, and its number is free again. Its
  // folder in /workspace stays, as the other bots' files do.
  out.free = async (botId) => {
    fellBack.delete(botId);
    if (boat?.has(botId)) await boat.forget(botId).catch(() => {});
    if (!screens.has(botId)) return;
    try {
      await computers.freeScreen(seat(botId));
    } catch (e) {
      console.warn(`[computers] couldn't end the screen of deleted bot ${botId}: ${e.message}`);
    }
    up.delete(botId);
    usedAt.delete(botId);
    screens.free(botId);
  };
  return out;
}

module.exports = { create, facade, MAX };

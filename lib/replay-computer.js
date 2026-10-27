// A replay's computer (#595, ADR 104): a bot with a computer is replayed with commands, on a throwaway copy of it and
// never on the computer itself. On this machine the copy is a container made from the account's computer (lib/
// computers.js replayCopy), on boat.dev a fork of the External Virtual PC the bot works on (lib/boat.js fork). Either
// has no network, no Vault secret and nothing of the other bots' that the copy can do without, and it goes when its
// replay ends; nothing moves back. A copy that can't be made leaves the replay without a computer, as before.
//
// The replay's computer tools (lib/replay-computer-mcp.js) reach their copy through botdot with a key of their own
// (lib/routes/replay.js): the key names the copy, and nothing else answers to it.
const crypto = require('crypto');

const drawn = () => crypto.randomBytes(6).toString('hex'); // a scoring's and a copy's id, as the helper checks them

// local: lib/computers.js (or the helper's proxy of it); boat: lib/boat.js's create(); kindOf(bot): where the bot's
// computer is ('none', 'linux', 'boat', 'boat-own', bots.js computerKind).
function create({ local, boat, kindOf, draw = drawn }) {
  const open = new Map(); // key -> copy
  let swept = null;

  // A scoring of replays (lib/replay.js score): what its copies share, removed with endScope.
  const scope = () => ({ id: draw(), local: false });

  // The copy one replay of bot works on, or null when the bot has no computer or no copy could be made.
  // A copy: { key, botId, kind, runShell(args), readFile(args), writeFile(args), close() }.
  async function make(bot, sc) {
    const kind = kindOf(bot);
    if (kind !== 'linux' && kind !== 'boat' && kind !== 'boat-own') return null;
    await (swept ||= sweep()); // before the first copy since botdot started: what one that stopped left goes
    let copy;
    try {
      if (kind === 'linux') {
        const id = draw();
        sc.local = true; // its image stays until the scoring ends, even when this copy is not made
        if (!(await local.replayCopy(sc.id, id, bot.id))) return null;
        copy = {
          kind,
          runShell: (a) => local.replayShell(id, bot.id, a),
          readFile: (a) => local.replayRead(id, bot.id, a),
          writeFile: (a) => local.replayWrite(id, bot.id, a),
          remove: () => local.replayEnd(id),
        };
      } else {
        const f = await boat.fork(bot.id);
        if (!f) return null;
        copy = {
          kind: 'boat',
          runShell: (a) => boat.forkShell(f.id, a),
          readFile: (a) => boat.forkRead(f.id, a),
          writeFile: (a) => boat.forkWrite(f.id, a),
          remove: () => boat.removeFork(f.id),
        };
      }
    } catch (e) {
      console.error(`[replay] ${bot.name}: no copy of its computer: ${e.message}`);
      return null;
    }
    const key = crypto.randomBytes(24).toString('hex');
    open.set(key, copy);
    let closed = null;
    copy.key = key;
    copy.botId = bot.id;
    copy.close = () => (closed ||= (async () => {
      open.delete(key);
      try { await copy.remove(); } catch (e) { console.error(`[replay] ${bot.name}: its copy stays for now: ${e.message}`); }
    })());
    return copy;
  }

  // The scoring ended: what its copies shared goes (the image of the account's computer).
  async function endScope(sc) {
    if (!sc?.local) return;
    try { await local.replayRemove(sc.id); } catch (e) { console.error(`[replay] the copy of the computer stays for now: ${e.message}`); }
  }

  // What a botdot that stopped left: every copy of a replay there is, before this botdot makes its first.
  async function sweep() {
    try { await local.replayRemove(null); } catch { /* no computer here, or Docker is not running */ }
    try { await boat.sweepForks(); } catch (e) { console.error(`[replay] ${e.message}`); }
  }

  return { scope, make, endScope, sweep, byKey: (key) => (typeof key === 'string' ? open.get(key) || null : null), openCount: () => open.size };
}

module.exports = { create };

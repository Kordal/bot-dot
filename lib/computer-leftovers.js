// What is left behind on the account's computer (#535): processes on no bot's screen that no bot's run explains.
// botdot-run ends what botdot's commands start and Docker's init reaps the rest, so "Not on a bot's screen" stays
// small; should it grow anyway, check() finds it from the computer's usage. More than PROCESSES processes, or more
// than CPU percent, at CHECKS checks in a row while no bot runs, is left behind: logged once with its largest groups,
// and said in the computer's status until it is gone. Nothing is ended: a restart of the computer clears it.
const PROCESSES = 100;
const CPU = 100; // one CPU fully used
const CHECKS = 3;
const EVERY_MS = Number(process.env.BOT_DOT_LEFTOVERS_MS) || 2 * 60_000; // a test sets it short

// Whether what runs on no bot's screen is more than an idle computer has there.
const isLeft = (other) => !!other && (other.processes > PROCESSES || other.cpuPercent > CPU);

function create({ usage, busy = () => false, warn = (line) => console.warn(line), now = Date.now }) {
  let over = 0;
  let found = null; // { since, processes, cpuPercent, memoryBytes, zombies, top }
  async function check() {
    if (busy()) { // a bot at work: what it runs as root may be counted here, so the checks in a row start again
      if (!found) over = 0;
      return found;
    }
    const u = await usage();
    const other = u?.state === 'running' ? u.other : null;
    if (!isLeft(other)) {
      over = 0;
      found = null;
      return null;
    }
    const seen = { processes: other.processes, cpuPercent: other.cpuPercent, memoryBytes: other.memoryBytes, zombies: other.zombies || 0, top: other.top || [] };
    if (found) return (found = { ...found, ...seen });
    if (++over < CHECKS) return null;
    found = { since: new Date(now()).toISOString(), ...seen };
    const groups = seen.top.map((g) => `${g.processes}× ${g.name} under ${g.parent || '?'} (${Math.round(g.cpuPercent)}% CPU)`).join(', ');
    warn(`[computers] left behind on the account's computer, on no bot's screen: ${seen.processes} processes (${seen.zombies} zombies), ${Math.round(seen.cpuPercent)}% CPU. Largest: ${groups || 'none'}`);
    return found;
  }
  return { check, found: () => found };
}

module.exports = { create, isLeft, EVERY_MS };

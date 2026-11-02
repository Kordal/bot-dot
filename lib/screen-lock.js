// One run at a time on a screen and its browser (#847, ADR 133). A screen here is a key: the account's External
// Virtual PC for every boat bot on it, a bot's own machine, or a bot's own screen on this machine's computer. A run
// takes it with its first screen tool and keeps it while it uses it: each screen tool renews the hold. It is let go
// when the run ends (release), or after IDLE_MS without a screen tool. Another run waits up to WAIT_MS for it, then is
// told who holds it. Shell and file tools never take a screen.
const IDLE_MS = Number(process.env.BOT_DOT_SCREEN_HOLD_MS) || 2 * 60_000;
const WAIT_MS = Number(process.env.BOT_DOT_SCREEN_WAIT_MS) || 20_000;
const STEP_MS = 500;

function create({ now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), idleMs = IDLE_MS, waitMs = WAIT_MS } = {}) {
  const holds = new Map(); // key -> { run, bot, at }
  const live = (key) => {
    const h = holds.get(key);
    if (h && now() - h.at > idleMs) { holds.delete(key); return null; }
    return h || null;
  };
  // Take or renew the screen `key` for `run` of `bot`: null once it is the run's, else the hold that kept it,
  // { run, bot, freeInMs }, after waiting up to waitMs.
  async function take(key, run, bot) {
    for (const until = now() + waitMs; ;) {
      const h = live(key);
      if (!h || h.run === run) { holds.set(key, { run, bot, at: now() }); return null; }
      if (now() >= until) return { run: h.run, bot: h.bot, freeInMs: Math.max(0, idleMs - (now() - h.at)) };
      await sleep(STEP_MS);
    }
  }
  // The run ended: every screen it held is free now.
  function release(run) {
    for (const [key, h] of holds) if (h.run === run) holds.delete(key);
  }
  const holder = (key) => live(key);
  return { take, release, holder };
}

module.exports = { create, IDLE_MS, WAIT_MS };

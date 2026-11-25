// Whether the account is idle (#1688, ADR 053): the moment the front door may switch the account to a new version
// without cutting work off. It is idle when nothing a restart would cut off is going or waiting (`working` is 0),
// nothing starts within SOON_MS (`nextStartAt`: the earliest job, reminder or look) and the owner has not written in
// the last OWNER_QUIET_MS. The front door asks for it (GET /api/update/idle, lib/routes/update-idle.js) and decides.
const SOON_MS = 30 * 60 * 1000; // a job, a reminder or a look this close keeps the account from being idle
const OWNER_QUIET_MS = 10 * 60 * 1000; // so does a message the owner wrote this recently

// The earliest of some times (Date, ms or ISO text) as ISO text; null when none of them is a time.
function earliest(times) {
  const ms = times.map((t) => (t === null || t === undefined ? NaN : new Date(t).getTime())).filter(Number.isFinite);
  return ms.length ? new Date(Math.min(...ms)).toISOString() : null;
}

// A time in ms as ISO text; 0, the "never" of a clock that kept nothing, is null.
const isoOrNull = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

// The answer: { idle, working, nextStartAt, lastOwnerMessageAt }. A time already past (a job due and not yet started)
// is within SOON_MS too, so it keeps the account from being idle until it has started.
function assess({ working, nextStartAt, lastOwnerMessageAt, now = Date.now() }) {
  const soon = nextStartAt !== null && Date.parse(nextStartAt) - now <= SOON_MS;
  const talking = lastOwnerMessageAt !== null && now - Date.parse(lastOwnerMessageAt) <= OWNER_QUIET_MS;
  return { idle: working === 0 && !soon && !talking, working, nextStartAt, lastOwnerMessageAt };
}

// What the account is doing and has coming, read from the parts of the server that know. Everything is a function so
// that it is read when asked: bots (lib/bots.js), chief (lib/chief.js), roomTurns (lib/room-turn.js, `going`) and
// activity (lib/activity.js, the owner's last message in ms).
function create({ bots, chief, roomTurns, activity, now = () => Date.now() }) {
  // How many things a restart would cut off: runs of bots and group turns, script jobs and what waits in a queue; the
  // Chief's turns; a look, a checkup or a review, or a page being kept (they share one session); room turns going.
  function working() {
    const w = bots.workingCount();
    return w.runs + w.scripts + w.queued + chief.activeCount() + (chief.lookBusy() || chief.keepBusy() ? 1 : 0) + roomTurns.going();
  }
  // The earliest of the bots' jobs, the Chief's jobs, the reminders (the Chief's and the bots') and the next look.
  function nextStartAt() {
    return earliest([
      ...bots.bots.list().map((b) => bots.nextRun(b)),
      chief.chiefJobs.nextRun(new Date(now())),
      chief.nextReminderAt(),
      chief.looks.nextAt(),
    ]);
  }
  function report() {
    return assess({ working: working(), nextStartAt: nextStartAt(), lastOwnerMessageAt: isoOrNull(activity.lastMessageAt()), now: now() });
  }
  return { working, nextStartAt, report };
}

module.exports = { create, assess, earliest, isoOrNull, SOON_MS, OWNER_QUIET_MS };

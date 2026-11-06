'use strict';
// Claude's usage limit (#1090): whether Claude Code's words say it was reached, and when it resets. No state: the hold
// itself is in bots.js (limitReached, isLimited).

const USAGE_LIMIT = /usage limit|hit your (usage |weekly |session |5-hour )?limit|limit will reset|\blimit reached\b/i;
// How long botdot holds when Claude Code says the limit is reached and not when it resets.
const LIMIT_GUESS_MS = 30 * 60_000;
// When the limit resets, from what Claude Code said: the reset of its rate_limit_event (`resetsAt`, ms), the unix time
// of its "usage limit reached|<seconds>", or "resets 3pm" / "resets at 15:00" in the server's own time zone. Else a guess.
function limitResetOf(text, resetsAt, now = Date.now()) {
  if (resetsAt > now) return resetsAt;
  const unix = String(text || '').match(/\|(\d{10})\b/);
  if (unix && Number(unix[1]) * 1000 > now) return Number(unix[1]) * 1000;
  const clock = String(text || '').match(/resets?(?: at)? (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (clock) {
    let h = Number(clock[1]) % 24;
    const pm = clock[3]?.toLowerCase();
    if (pm === 'pm' && h < 12) h += 12;
    if (pm === 'am' && h === 12) h = 0;
    const at = new Date(now);
    at.setHours(h, Number(clock[2] || 0), 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  return now + LIMIT_GUESS_MS;
}

module.exports = { USAGE_LIMIT, LIMIT_GUESS_MS, limitResetOf };

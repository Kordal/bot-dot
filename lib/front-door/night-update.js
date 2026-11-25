// @ts-check
// A machine of one account updates itself (ADR 183, in two steps by ADR 271): the botdot on the owner's own computer, and
// a server of one owner, have no admin page and no one who presses Update. Each minute the front door asks whether to
// ask root's step to download the update itself, as the admin page's Update does: only for a newer signed release root's
// step found, in the night hour (or as soon as it is found when the owner chose "As soon as it's ready"), never while
// the account waits already for a version (root's step would switch it: never two versions behind, ADR 053), and once a
// night. A failed update is asked again the next night, not before. The account is left waiting, and its switch is
// planned as every account's (switch-plan.js).
const NIGHT_HOUR = 4; // 04:00-04:59 on the machine's clock: after the nightly backup (03:00)
const AGAIN_MS = 20 * 3600_000; // once a night, whatever the last ask was for

// installed: { version, selfBuilt } (version.json); newest: { version } (latest.json); last: { version, at } of the
// front door's own last ask, or null; asked: an update is asked or going now; waits: the account waits for a version
// already; when: the owner's choice (`ready` ignores the hour); hour: the owner's hour.
function shouldUpdate({ installed, newest, last, asked, waits = false, when = 'night', hour, now = Date.now(), nightHour = NIGHT_HOUR }) {
  if (asked || waits) return false;
  if (when !== 'ready' && hour !== nightHour) return false;
  if (!installed?.version || installed.selfBuilt === true || !newest?.version) return false;
  if (newest.version === installed.version) return false;
  if (last?.at && now - Date.parse(last.at) < AGAIN_MS) return false;
  return true;
}

module.exports = { shouldUpdate, NIGHT_HOUR, AGAIN_MS };

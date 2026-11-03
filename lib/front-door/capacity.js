// @ts-check
// How many more accounts this machine takes (#912): what a new account takes at once against what the machine has
// free now, as root's step measured it. A new account holds about 2 GB of RAM idle and 0.4 GB more while its Chief
// replies, and its Docker's images (7.2 GB) and about 1 GB a running container writes on disk (ADR 028, "Spike
// result"). Shares are not summed: they are ceilings that overlap by design (the default RAM share is half the
// machine's, #126, and the default disk share a sparse 30 GB image that grows only as it is used), so their sum would
// call a machine of two accounts full. An account near its share is marked on the admin page instead. Unknown (null)
// while nothing is measured: then nothing is refused for room.
const GB = 2 ** 30;
const NEW_ACCOUNT = { ram: 3 * GB, disk: 10 * GB };
const MAX_RANGE = [0, 100000];
const MAX_RULE = 'The maximum is a whole number of accounts, 0 to 100000, or none.';

/**
 * @param {{ ramTotal?: number, ramUsed?: number, diskTotal?: number, diskUsed?: number } | null} machine
 * @returns {number | null} new accounts that fit now, or null while the machine's RAM and disk are not measured
 */
function room(machine) {
  const m = machine || {};
  if (![m.ramTotal, m.ramUsed, m.diskTotal, m.diskUsed].every((n) => Number.isFinite(n)) || !(/** @type {number} */ (m.ramTotal) > 0)) return null;
  const fit = (/** @type {number} */ free, /** @type {number} */ each) => Math.max(0, Math.floor(free / each));
  return Math.min(fit(/** @type {number} */ (m.ramTotal) - /** @type {number} */ (m.ramUsed), NEW_ACCOUNT.ram),
    fit(/** @type {number} */ (m.diskTotal) - /** @type {number} */ (m.diskUsed), NEW_ACCOUNT.disk));
}

// A maximum from the admin page, checked: a whole number or null, or throws with the status 400.
/** @param {unknown} max @returns {number | null} */
function checkMax(max) {
  if (max === null) return null;
  if (Number.isInteger(max) && /** @type {number} */ (max) >= MAX_RANGE[0] && /** @type {number} */ (max) <= MAX_RANGE[1]) return /** @type {number} */ (max);
  throw Object.assign(new Error(MAX_RULE), { status: 400 });
}

// Whether a new account is refused: no room left, or the maximum reached.
/** @param {{ room: number | null, max: number | null, accounts: number }} c */
const full = (c) => c.room === 0 || (c.max !== null && c.accounts >= c.max);

module.exports = { room, checkMax, full, MAX_RULE, GB, NEW_ACCOUNT };

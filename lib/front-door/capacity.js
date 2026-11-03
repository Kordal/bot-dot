// @ts-check
// How many more accounts this machine takes (#912): its RAM and disk, as root's step measured them, against what it
// gave every account (its own share or the default, ADR 028), in default shares. A share is what the machine promised:
// an account's RAM is its slice's hard limit, which under gVisor it fills with its file cache (#126), and its disk an
// ext4 image of the share's size that grows to it, its Docker's images (7.2 GB) inside. So the images an account
// holds are counted in its disk share, and what the machine's own Docker and the system hold is in what the machine
// uses beside the accounts' disks. Unknown (null) while nothing is measured: then nothing is refused for room.
const GB = 2 ** 30;
const MAX_RANGE = [0, 100000];
const MAX_RULE = 'The maximum is a whole number of accounts, 0 to 100000, or none.';

/**
 * @param {{ machine: { ramTotal?: number, diskTotal?: number, diskUsed?: number } | null,
 *   accounts: { share: { ram: number, disk: number }, use?: { diskSize?: number, diskUsed?: number } | null }[],
 *   defaultShare: { ram: number, disk: number } }} input
 * @returns {number | null} default shares that still fit, or null while the machine's RAM and disk are not measured
 */
function room({ machine, accounts, defaultShare }) {
  if (!machine || !(machine.ramTotal > 0) || !(machine.diskTotal > 0) || !Number.isFinite(machine.diskUsed)) return null;
  const sum = (/** @type {(a: any) => number} */ f) => accounts.reduce((n, a) => n + f(a), 0);
  const ramFree = /** @type {number} */ (machine.ramTotal) - sum((a) => a.share.ram * GB);
  // The accounts' own disks are sparse files: what they hold so far is in the machine's use, and their share is
  // counted whole instead. An account not measured, or without a disk of its own, adds nothing back.
  const inDisks = sum((a) => (a.use && Number.isFinite(a.use.diskSize) && Number.isFinite(a.use.diskUsed) ? Math.min(/** @type {number} */ (a.use.diskUsed), a.share.disk * GB) : 0));
  const beside = Math.max(0, /** @type {number} */ (machine.diskUsed) - inDisks);
  const diskFree = /** @type {number} */ (machine.diskTotal) - beside - sum((a) => a.share.disk * GB);
  const fit = (free, each) => Math.max(0, Math.floor(free / each));
  return Math.min(fit(ramFree, defaultShare.ram * GB), fit(diskFree, defaultShare.disk * GB));
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

module.exports = { room, checkMax, full, MAX_RULE, GB };

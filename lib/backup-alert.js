// A backup that stops working is said (#1017), as a plain Chief message, never at night: one held through quiet hours
// goes out when they end.
// - The owner's own backups (lib/backup.js): once per failure streak, when the last good one (before any, the moment
//   backups were turned on) is older than BDB_LATE_MS, with the last error. A good backup ends the streak.
// - The machine's off-site backup, in the admin's account alone: the front door says when it turns late and when it
//   works again (POST /api/backups/machine), and each change is said once.
// What was said is kept in data/backup-alerts.json, so a restart neither repeats nor loses it.
const fs = require('./principal-fs');
const path = require('path');
const reporting = require('./reporting');

const BDB_LATE_MS = 48 * 3600_000;
const day = (iso) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// backups: lib/backup.js; post(text): a Chief message (chief.post); quietHours(): the account's (settings).
function create({ dataDir, backups, post, quietHours = () => ({}), now = () => Date.now() }) {
  const FILE = path.join(dataDir, 'backup-alerts.json');
  const read = () => { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
  const write = (j) => fs.writeFileSync(FILE, JSON.stringify(j), { mode: 0o600 });
  const quiet = () => { try { return reporting.inQuietHours(new Date(now()), quietHours()); } catch { return false; } };

  // The owner's backups: late since `from`, told once for that streak (its key is the last success, or `since`).
  function bdbLate() {
    const st = backups.status();
    if (!st.configured) return null;
    const from = st.lastSuccess || st.since;
    if (!from || now() - Date.parse(from) <= BDB_LATE_MS) return null;
    const text = st.lastSuccess ? `Your backup hasn't finished since ${day(st.lastSuccess)}.` : "Your backups are on, but none has finished yet.";
    return { key: from, text: st.lastError ? `${text} The last try failed: ${st.lastError}` : text };
  }

  function check() {
    const j = read();
    let changed = false;
    const late = bdbLate();
    if (!late && j.bdb) { delete j.bdb; changed = true; }
    if (late && j.bdb?.told !== late.key && !quiet()) {
      post(late.text);
      j.bdb = { told: late.key };
      changed = true;
    }
    if (j.machine?.waiting && !quiet()) {
      post(j.machine.waiting);
      j.machine = { ...j.machine, waiting: null };
      changed = true;
    }
    if (changed) write(j);
  }

  // What the front door says of the machine's off-site backup: { late, lastSuccess?, error? }.
  function machine({ late, lastSuccess = null, error = null }) {
    const j = read();
    const was = !!j.machine?.late;
    if (!!late === was) return;
    let text;
    if (late) {
      text = lastSuccess ? `The machine's off-site backup hasn't finished since ${day(lastSuccess)}.` : "The machine's off-site backup hasn't finished yet.";
      if (error) text += ` The last run failed: ${error}`;
    } else text = "The machine's off-site backup works again.";
    // Back to good before the late one was said: neither is said.
    const waiting = !late && j.machine?.waiting ? null : text;
    write({ ...j, machine: { late: !!late, waiting } });
    check();
  }

  function start() {
    setTimeout(() => { try { check(); } catch (e) { console.error(`[backup] ${e.message}`); } }, 60_000).unref();
    setInterval(() => { try { check(); } catch (e) { console.error(`[backup] ${e.message}`); } }, 10 * 60_000).unref();
  }

  return { check, machine, start };
}

module.exports = { create, BDB_LATE_MS };

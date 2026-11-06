// A backup that stops working is said (#1017), as a plain Chief message, never at night: one held through quiet hours
// goes out when they end. It is the machine's off-site backup, in the admin's account alone: the front door says when
// it turns late and when it works again (POST /api/backups/machine), and each change is said once. An account makes no
// backups of its own since ADR 158, so the owner's own late backup of #1017 is no longer said.
// What was said is kept in data/backup-alerts.json, so a restart neither repeats nor loses it.
const fs = require('./principal-fs');
const path = require('path');
const reporting = require('./reporting');

const day = (iso) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// post(text): a Chief message (chief.post); quietHours(): the account's (settings).
function create({ dataDir, post, quietHours = () => ({}), now = () => Date.now() }) {
  const FILE = path.join(dataDir, 'backup-alerts.json');
  const read = () => { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
  const write = (j) => fs.writeFileSync(FILE, JSON.stringify(j), { mode: 0o600 });
  const quiet = () => { try { return reporting.inQuietHours(new Date(now()), quietHours()); } catch { return false; } };

  function check() {
    const j = read();
    let changed = false;
    // What was told of the owner's own backups before ADR 158.
    if (j.bdb) { delete j.bdb; changed = true; }
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

module.exports = { create };

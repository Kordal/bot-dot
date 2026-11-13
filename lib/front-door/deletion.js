// @ts-check
// Deleting a managed machine's own account in Settings (#1313, ADR 241). The account that pays for the machine (its one
// account, or the first of several) is deleted only once the fleet console has ended its subscription: the front door
// writes a request to the outbox the console's agent empties (ADR 164), `delete-<account>.json`, and the agent writes
// the console's answer beside it, `delete-<account>.answer.json`: `{ "state": "canceled" | "none" | "failed" }`.
// "canceled" or "none" (nothing was billed) lets the front door erase the machine's accounts; "failed" erases nothing,
// and the owner is told. Once erased, the machine is gone (`machine-deleted.json` beside the front door's data): every
// page says so until whoever runs the fleet removes the machine. Each file is written under a hidden name and renamed,
// and none is read through a link.
const fs = require('fs');
const path = require('path');

const NAME = /^[a-z][a-z0-9-]{1,23}$/;
const ANSWER = /^delete-([a-z][a-z0-9-]{1,23})\.answer\.json$/;
const STATES = new Set(['canceled', 'none', 'failed']);
// An answer is a line of JSON: anything longer is not one.
const ANSWER_MAX = 4096;

function writeWhole(file, body) {
  const hidden = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  try {
    fs.rmSync(hidden, { force: true });
    fs.writeFileSync(hidden, JSON.stringify(body), { mode: 0o600, flag: 'wx' });
    fs.renameSync(hidden, file);
  } catch (e) { fs.rmSync(hidden, { force: true }); throw e; }
}

// A regular file's JSON, never through a link; null for anything else.
function readSmall(file, max) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > max) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

/**
 * @param {string} outbox the outbox folder (ADR 164)
 * @param {string} data the front door's data folder, where the machine's own deleted mark is kept
 */
function create(outbox, data, { now = () => Date.now() } = {}) {
  const request = (account) => path.join(outbox, `delete-${account}.json`);
  const answerFile = (account) => path.join(outbox, `delete-${account}.answer.json`);
  const goneFile = path.join(data, 'machine-deleted.json');
  const exists = (file) => { try { return fs.lstatSync(file).isFile(); } catch { return false; } };
  const answerOf = (account) => {
    const a = readSmall(answerFile(account), ANSWER_MAX);
    return a && typeof a === 'object' && STATES.has(a.state) ? a.state : null;
  };
  let gone = readSmall(goneFile, ANSWER_MAX);

  return {
    // The owner confirmed: asked of the console, with every account the machine holds (all go with it). An earlier
    // answer, a failure, goes first, so it is never read as this request's.
    ask(account, accounts) {
      if (!NAME.test(account)) throw new Error('not an account name');
      fs.mkdirSync(outbox, { recursive: true, mode: 0o700 });
      fs.rmSync(answerFile(account), { force: true });
      writeWhole(request(account), { account, accounts, requested: new Date(now()).toISOString() });
    },
    // Where this account's deletion is: "pending" (asked, or answered and being erased), "failed" (the console couldn't
    // end its subscription, and nothing was erased), or null (never asked, or asked again since).
    state(account) {
      if (!NAME.test(account)) return null;
      const a = answerOf(account);
      if (a === 'failed') return 'failed';
      if (a || exists(request(account))) return 'pending';
      return null;
    },
    // The console's answers that let an account go: [{ account, state }], "canceled" or "none".
    granted() {
      let names = [];
      try { names = fs.readdirSync(outbox); } catch { return []; }
      return names.map((n) => ANSWER.exec(n)?.[1]).filter(Boolean).map((account) => ({ account, state: answerOf(account) }))
        .filter((a) => a.state === 'canceled' || a.state === 'none');
    },
    // Its request and its answer, once the account is erased.
    finish(account) {
      if (!NAME.test(account)) return;
      fs.rmSync(answerFile(account), { force: true });
      fs.rmSync(request(account), { force: true });
    },
    // The machine itself is deleted: kept before any account is erased, so that a stop halfway still shows it gone.
    markGone(by, billing) {
      gone = { by, billing, at: new Date(now()).toISOString() };
      writeWhole(goneFile, gone);
    },
    gone: () => gone,
  };
}

module.exports = { create };

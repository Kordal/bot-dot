// Finding a program (llama-server) without holding up the server. Asking a login shell
// (so PATH matches the owner's terminal) can take a while, so it runs in the background and its answer
// is kept for a minute; meanwhile the usual install places are checked directly.
//   envVar: a path that, when set, is the only place looked at.
//   candidates: the usual install places, after the PATH.
const fs = require('fs');
const { execFile } = require('child_process');

const FRESH_MS = 60_000;

function create(name, { envVar, candidates = [] }) {
  let found; // undefined until the first lookup has finished
  let at = 0;
  let looking = null;
  const inPlaces = () => candidates.find((p) => fs.existsSync(p)) || null;

  // Look again now; resolves with the path, or null.
  function refresh() {
    if (process.env[envVar]) return Promise.resolve(get());
    if (looking) return looking;
    looking = new Promise((resolve) => {
      execFile('/bin/sh', ['-lc', `command -v ${name}`], { encoding: 'utf8', timeout: 5000 }, (err, stdout) => {
        const p = !err && String(stdout).trim();
        found = (p && fs.existsSync(p) ? p : null) || inPlaces();
        at = Date.now();
        looking = null;
        resolve(found);
      });
    });
    return looking;
  }

  // The path as known now (null if not found). A stale answer is looked up again in the background.
  function get() {
    const own = process.env[envVar];
    if (own) return fs.existsSync(own) ? own : null;
    if (Date.now() - at > FRESH_MS) refresh();
    return found === undefined ? inPlaces() : found;
  }

  return { get, refresh };
}

module.exports = { create };

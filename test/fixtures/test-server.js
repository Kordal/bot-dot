#!/usr/bin/env node
// A test botdot server for tests outside Node (the Mac app's BotDotKit tests): starts one like
// helpers.startServer does (scratch data, the stand-in Claude), prints one JSON line with where it
// is ({ base, out, dir, data, chiefKey }), and stops when its stdin closes. The caller steers the stand-in Claude
// through files in `out` (see fake-claude.js) and sets things up through the API. TEST_SERVER_ENV
// (JSON) adds settings, e.g. BOT_DOT_MAC_DIR for the app build it hands out.
// TEST_SERVER_SEED (JSON) makes bots with runs before the caller connects: [{ bot: { name }, runs: [{ result }, { quiet: true, times: 60 }] }]
// (helpers.seedRuns; `quiet`: a scheduled run with nothing to say).
const fs = require('fs');
const { startServer, makeBot, seedRuns, QUIET_RUN } = require('../helpers');

(async () => {
  const env = JSON.parse(process.env.TEST_SERVER_ENV || '{}');
  let srv = await startServer({ env });
  // Bots that start with runs of their own, e.g. a reply the owner has not read under sixty quiet runs.
  const seed = JSON.parse(process.env.TEST_SERVER_SEED || '[]');
  if (seed.length) {
    const made = [];
    for (const s of seed) made.push([await makeBot(srv, s.bot), s.runs]);
    await srv.stop();
    for (const [bot, runs] of made) seedRuns(srv, bot, runs.map((r) => ({ ...(r.quiet ? QUIET_RUN : {}), ...r, quiet: undefined })));
    srv = await startServer({ dir: srv.dir, env });
  }
  process.stdout.write(`${JSON.stringify({ base: srv.base, out: srv.out, dir: srv.dir, data: srv.data, chiefKey: srv.chiefKey })}\n`);
  const stop = async () => { await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); process.exit(0); };
  process.stdin.on('end', stop);
  process.stdin.on('error', stop);
  process.stdin.resume();
  process.on('SIGTERM', stop);
})().catch((e) => { console.error(e.message); process.exit(1); });

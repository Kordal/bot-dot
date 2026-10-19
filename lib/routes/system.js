// botdot itself: its status, the computers, its version, the tests' clock, the bots' figure, the live feed and
// the apps' own updates.
const { NEXT, send } = require('./http');
const B = require('../bots');
const fs = require('../principal-fs');

function create(ctx) {
  const { versionInfo, streamEvents, androidApp, macApp } = ctx;
  let testMinute = 0; // the last minute test-tick ran: a second call runs the one after it
  const FIGURE = require('../figure.json');
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] === 'status' && m === 'GET') {
      const docker = await B.computers.dockerStatus();
      return send(res, 200, { claudeBin: B.CLAUDE_BIN, claudeVersion: B.claudeVersion(), permissionModes: B.PERMISSION_MODES, docker: { ok: docker.ok, error: docker.error, image: docker.image }, now: new Date().toISOString() });
    }
    if (parts[0] === 'computers' && m === 'GET') return send(res, 200, await B.computers.listAll());
    // Which botdot this is, for clients (the Android app checks it before anything else).
    if (parts[0] === 'version' && m === 'GET') return send(res, 200, await versionInfo());
    // The tests' clock (test/helpers.js srv.tick): the scheduler's next minute now, as it would come at that minute,
    // so a test of a scheduled job needn't wait up to a minute for it. Only with BOT_DOT_TEST_TICK=1, which the test
    // helper sets; an owner's botdot has no such route. The clock's own ticks skip the minutes it ran (bots.js tickAhead).
    if (process.env.BOT_DOT_TEST_TICK === '1' && parts[0] === 'test-tick' && m === 'POST') {
      const at = new Date(Math.max(Math.floor(Date.now() / 60_000) * 60_000, testMinute) + 60_000);
      testMinute = at.getTime();
      B.tickAhead(at);
      return send(res, 200, { at: at.toISOString() });
    }
    // The one head every app draws bots from (docs/adr/003-one-figure-definition-for-all-apps.md).
    if (parts[0] === 'figure' && m === 'GET') return send(res, 200, FIGURE);
    // The live feed (Server-Sent Events). Reconnect with Last-Event-ID (or ?since=) to get missed events.
    if (parts[0] === 'events' && m === 'GET') return streamEvents(req, res, url);
    // The phone app's update: which version botdot has, and the file itself.
    if (parts[0] === 'app' && parts[1] === 'android.apk' && m === 'GET') {
      const a = androidApp();
      if (!a) return send(res, 404, { error: 'This botdot has no Android app to hand out.' });
      res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': a.size, 'Content-Disposition': `attachment; filename="bot-dot-${a.versionName}.apk"`, 'Cache-Control': 'no-store' });
      return fs.createReadStream(a.file).pipe(res);
    }
    // The Mac app's update, the same way.
    if (parts[0] === 'app' && parts[1] === 'mac.zip' && m === 'GET') {
      const a = macApp();
      if (!a) return send(res, 404, { error: 'This botdot has no Mac app to hand out.' });
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': a.size, 'Content-Disposition': `attachment; filename="botdot-${a.versionName}-mac.zip"`, 'Cache-Control': 'no-store' });
      return fs.createReadStream(a.file).pipe(res);
    }
    return NEXT;
  };
}

module.exports = { create };

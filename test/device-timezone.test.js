// The owner's time zone from their device (#756): a botdot with no zone of its own (none chosen, and the default
// UTC) takes the zone the web page or the app runs in, once, so bots say and schedule times in the owner's time. A
// zone the owner chose, or one the server was given, is never changed this way.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const put = (srv, body) => srv.api('/setup', { method: 'PUT', body });

test("a botdot on UTC with no zone chosen takes the device's zone once", async () => {
  const srv = await startServer({ env: { TZ: 'UTC' } });
  try {
    assert.equal((await srv.api('/setup')).data.savedTimezone, null);
    assert.equal((await put(srv, { deviceTimezone: 'Nowhere/Land' })).status, 200, 'a zone it does not know is left out, no error');
    assert.equal((await srv.api('/setup')).data.timezone, 'UTC');
    const r = await put(srv, { deviceTimezone: 'Europe/Warsaw' });
    assert.equal(r.data.timezone, 'Europe/Warsaw');
    assert.equal((await srv.api('/setup')).data.savedTimezone, 'Europe/Warsaw');
    await put(srv, { deviceTimezone: 'America/New_York' }); // another device later
    assert.equal((await srv.api('/setup')).data.timezone, 'Europe/Warsaw', 'once taken, it stays');
  } finally { await srv.stop(); }
});

test('a zone the owner chose, or the server was given, stays', async () => {
  let srv = await startServer({ env: { TZ: 'UTC' } });
  try {
    await put(srv, { timezone: 'Asia/Tokyo' });
    await put(srv, { deviceTimezone: 'Europe/Warsaw' });
    assert.equal((await srv.api('/setup')).data.timezone, 'Asia/Tokyo');
  } finally { await srv.stop(); }
  srv = await startServer({ env: { TZ: 'America/Chicago' } });
  try {
    await put(srv, { deviceTimezone: 'Europe/Warsaw' });
    assert.equal((await srv.api('/setup')).data.timezone, 'America/Chicago');
  } finally { await srv.stop(); }
});

test("the web page and the app send their device's zone while the botdot has none of its own", () => {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('public/boot.js'), /if \(setupNow && !setupNow\.savedTimezone && deviceTimezone\(\)\) api\('\/setup', \{ method: 'PUT', body: \{ deviceTimezone: deviceTimezone\(\) \} \}\)/);
  assert.match(read('android/app/src/main/java/dev/botdot/app/ui/ChiefNameQuestion.kt'), /if \(setup != null && setup\.savedTimezone == null\) runCatching \{ a\.deviceTimezone\(java\.util\.TimeZone\.getDefault\(\)\.id\) \}/);
});

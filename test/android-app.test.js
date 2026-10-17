// The phone app's update: botdot says which app its image carries and hands out the file.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startServer } = require('./helpers');

const DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'botdot-app-'));
let srv;
after(async () => { await srv?.stop(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('without an app (running from source) there is nothing to hand out', async () => {
  srv = await startServer({ env: { BOT_DOT_ANDROID_DIR: path.join(DIR, 'none') } });
  const v = (await srv.api('/version')).data;
  assert.deepEqual(v.android, {});
  assert.equal((await srv.api('/app/android.apk')).status, 404);
  await srv.stop();
});

test('with an app: its version, and the file itself', async () => {
  const apk = crypto.randomBytes(5000);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'bot-dot-0.1.42.apk'), apk);
  const sha256 = crypto.createHash('sha256').update(apk).digest('hex');
  fs.writeFileSync(path.join(DIR, 'app.json'), JSON.stringify({ versionName: '0.1.42', versionCode: 42, file: 'bot-dot-0.1.42.apk', sha256 }));
  srv = await startServer({ env: { BOT_DOT_ANDROID_DIR: DIR } });
  const v = (await srv.api('/version')).data;
  assert.deepEqual(v.android, { versionCode: 42, versionName: '0.1.42', sha256, size: 5000 });
  assert.ok(v.features.includes('android-app'));
  const res = await fetch(`${srv.base}/api/app/android.apk`);
  assert.equal(res.headers.get('content-type'), 'application/vnd.android.package-archive');
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), sha256);
});

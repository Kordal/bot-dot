// Native app updates: botdot advertises and serves only the Android app.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startServer } = require('./helpers');

const DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'botdot-apps-'));
let srv;
after(async () => { await srv?.stop(); fs.rmSync(DIR, { recursive: true, force: true }); });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('without apps (running from source) there is nothing to hand out', async () => {
  srv = await startServer({ env: { BOT_DOT_ANDROID_DIR: path.join(DIR, 'none') } });
  const v = (await srv.api('/version')).data;
  assert.deepEqual(v.android, {});
  assert.equal((await srv.api('/app/android.apk')).status, 404);
  await srv.stop();
});

test('the Android version and download are available', async () => {
  const android = path.join(DIR, 'android');
  fs.mkdirSync(android, { recursive: true });
  const apk = crypto.randomBytes(4000);
  fs.writeFileSync(path.join(android, 'botdot.apk'), apk);
  fs.writeFileSync(path.join(android, 'app.json'), JSON.stringify({ versionName: '1.0.9', versionCode: 9, file: 'botdot.apk', sha256: sha(apk) }));
  srv = await startServer({ env: { BOT_DOT_ANDROID_DIR: android } });
  const v = (await srv.api('/version')).data;
  assert.deepEqual(v.android, { versionCode: 9, versionName: '1.0.9', sha256: sha(apk), size: 4000 });
  assert.ok(v.features.includes('android-app'));
  const androidResponse = await fetch(`${srv.base}/api/app/android.apk`);
  assert.equal(androidResponse.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(sha(Buffer.from(await androidResponse.arrayBuffer())), sha(apk));
});

test('retired Linux GUI artifacts are neither advertised nor downloadable', async () => {
  await srv?.stop();
  const retired = path.join(DIR, 'retired');
  fs.mkdirSync(retired, { recursive: true });
  fs.writeFileSync(path.join(retired, 'botdot.flatpak'), 'old GUI artifact');
  fs.writeFileSync(path.join(retired, 'app.json'), JSON.stringify({ versionCode: 9, versionName: '1.0.9', bundles: { x86_64: { file: 'botdot.flatpak', sha256: sha('old GUI artifact') } } }));
  srv = await startServer({ env: { BOT_DOT_LINUX_DIR: retired } });
  const v = (await srv.api('/version')).data;
  assert.equal(Object.hasOwn(v, 'linux'), false);
  assert.equal(v.features.includes('linux-app'), false);
  for (const route of ['/app/linux/x86_64.flatpak', '/app/linux/aarch64.flatpak', '/app/linux/riscv64.flatpak']) {
    assert.equal((await srv.api(route)).status, 404);
  }
});

test('retired Mac app artifacts are neither advertised nor downloadable', async () => {
  await srv?.stop();
  const retired = path.join(DIR, 'retired-mac');
  fs.mkdirSync(retired, { recursive: true });
  fs.writeFileSync(path.join(retired, 'botdot-1.0.7-mac.zip'), 'old Mac app');
  fs.writeFileSync(path.join(retired, 'app.json'), JSON.stringify({ versionName: '1.0.7', versionCode: 7, file: 'botdot-1.0.7-mac.zip', sha256: sha('old Mac app') }));
  srv = await startServer({ env: { BOT_DOT_MAC_DIR: retired } });
  const v = (await srv.api('/version')).data;
  assert.equal(Object.hasOwn(v, 'mac'), false);
  assert.equal(v.features.includes('mac-app'), false);
  assert.equal((await srv.api('/app/mac.zip')).status, 404);
});

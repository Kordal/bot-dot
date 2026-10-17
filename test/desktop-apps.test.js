// Native app updates: botdot advertises and serves only Mac and Android artifacts.
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
  srv = await startServer({ env: { BOT_DOT_MAC_DIR: path.join(DIR, 'none'), BOT_DOT_ANDROID_DIR: path.join(DIR, 'none') } });
  const v = (await srv.api('/version')).data;
  assert.deepEqual(v.mac, {});
  assert.deepEqual(v.android, {});
  assert.equal((await srv.api('/app/mac.zip')).status, 404);
  assert.equal((await srv.api('/app/android.apk')).status, 404);
  await srv.stop();
});

test('Mac and Android versions and downloads remain available', async () => {
  const mac = path.join(DIR, 'mac'), android = path.join(DIR, 'android');
  fs.mkdirSync(mac, { recursive: true });
  fs.mkdirSync(android, { recursive: true });
  const zip = crypto.randomBytes(3000), apk = crypto.randomBytes(4000);
  fs.writeFileSync(path.join(mac, 'botdot-1.0.7-mac.zip'), zip);
  fs.writeFileSync(path.join(mac, 'app.json'), JSON.stringify({ versionName: '1.0.7', versionCode: 7, file: 'botdot-1.0.7-mac.zip', sha256: sha(zip) }));
  fs.writeFileSync(path.join(android, 'botdot.apk'), apk);
  fs.writeFileSync(path.join(android, 'app.json'), JSON.stringify({ versionName: '1.0.9', versionCode: 9, file: 'botdot.apk', sha256: sha(apk) }));
  srv = await startServer({ env: { BOT_DOT_MAC_DIR: mac, BOT_DOT_ANDROID_DIR: android } });
  const v = (await srv.api('/version')).data;
  assert.deepEqual(v.mac, { versionCode: 7, versionName: '1.0.7', sha256: sha(zip), size: 3000 });
  assert.deepEqual(v.android, { versionCode: 9, versionName: '1.0.9', sha256: sha(apk), size: 4000 });
  assert.ok(v.features.includes('mac-app') && v.features.includes('android-app'));
  const macResponse = await fetch(`${srv.base}/api/app/mac.zip`);
  assert.equal(macResponse.headers.get('content-type'), 'application/zip');
  assert.equal(sha(Buffer.from(await macResponse.arrayBuffer())), sha(zip));
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

// The image carries no Mac app (images.yml, ADR 022): a Mac that asks for its update hears what an image made
// before any Mac release told it, whose mac-app/ was an empty folder. The Mac app reads no versionCode as no update.
test('an image without the Mac app answers a Mac as one made before any Mac release', async () => {
  await srv?.stop();
  const answer = async (macDir) => {
    srv = await startServer({ env: { BOT_DOT_MAC_DIR: macDir } });
    const v = (await srv.api('/version')).data;
    const zip = await srv.api('/app/mac.zip');
    await srv.stop();
    return { mac: v.mac, feature: v.features.includes('mac-app'), zip: { status: zip.status, data: zip.data } };
  };
  const noRelease = path.join(DIR, 'no-mac-release');
  fs.mkdirSync(noRelease, { recursive: true });
  const withoutMacApp = await answer(path.join(DIR, 'image-without-mac-app'));
  assert.deepEqual(withoutMacApp, await answer(noRelease));
  assert.deepEqual(withoutMacApp.mac, {});
  assert.equal(withoutMacApp.zip.status, 404);
});

// Takes the Play phone screenshots of the Android app on an emulator (docs/google-play/README.md), from the scene
// scene.cjs serves. Every pixel is the app's own: nothing is drawn on the pictures.
// node docs/google-play/screenshots/drive.cjs <scene dir> <app.apk> <out dir>
// Needs adb with one emulator. The screen is set to 1080 x 1920 (Play takes at most 2:1), dark, at 09:30.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [dir, apk, outDir] = process.argv.slice(2);
const OUT = path.resolve(outDir || 'play-screenshots');
fs.mkdirSync(OUT, { recursive: true });
const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
const PKG = 'dev.botdot.app'; // the debug build: it may reach a botdot on the computer over plain HTTP (10.0.2.2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
const sh = (cmd) => adb('shell', cmd);

/** What is on the screen: each node with its text or description and its middle. */
function nodes() {
  sh('uiautomator dump /sdcard/ui.xml >/dev/null');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml');
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => {
    const attr = (k) => (n.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || '';
    const [x1, y1, x2, y2] = (attr('bounds').match(/\d+/g) || [0, 0, 0, 0]).map(Number);
    return { text: attr('text'), desc: attr('content-desc'), cls: attr('class'), x: (x1 + x2) >> 1, y: (y1 + y2) >> 1 };
  });
}
async function find(test, what, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const hit = nodes().find(test);
    if (hit) return hit;
    if (Date.now() > end) {
      fs.writeFileSync(path.join(OUT, `failed-${what.replace(/\W+/g, '-')}.png`), execFileSync('adb', ['exec-out', 'screencap', '-p']));
      throw new Error(`Not on the screen: ${what}\n${nodes().filter((n) => n.text || n.desc).map((n) => n.text || n.desc).join(' | ')}`);
    }
    await sleep(700);
  }
}
const byText = (t) => (n) => n.text === t || n.desc === t;
const tap = (n) => sh(`input tap ${n.x} ${n.y}`);
async function shot(name) {
  await sleep(2500); // what it shows comes in, and the figures settle
  fs.writeFileSync(path.join(OUT, name), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
  console.log('wrote', name);
}
const open = (target) => sh(`am start -n ${PKG}/.MainActivity --es open '${target}'`);

(async () => {
  adb('install', '-r', '-g', apk);
  sh('wm size 1080x1920');
  sh('wm density 420');
  sh('cmd uimode night yes');
  // The status bar as on a phone at rest: 09:30, full battery and signal, no notifications.
  sh('settings put global sysui_demo_allowed 1');
  for (const extra of ['-e command enter', '-e command clock -e hhmm 0930', '-e command battery -e level 100 -e plugged false',
    '-e command network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4', '-e command notifications -e visible false']) {
    sh(`am broadcast -a com.android.systemui.demo ${extra}`);
  }
  sh(`am start -W -n ${PKG}/.MainActivity`);

  // Connect to the scene's botdot.
  const field = await find((n) => n.cls === 'android.widget.EditText', 'the address field');
  tap(field);
  await sleep(500);
  sh(`input text '${`http://10.0.2.2:${scene.port}`}'`);
  sh('input keyevent 111'); // the keyboard away
  tap(await find(byText('Connect'), 'Connect'));
  await find(byText('Search'), 'the list');
  await sleep(4000);

  await shot('1-home.png');
  open(`bot:${scene.bots.news}`);
  await find(byText('Its settings'), 'News Monitor\'s chat');
  await shot('2-chat.png');
  open('needs');
  await find((n) => /Needs you/.test(n.text), 'Needs you');
  await shot('3-needs-you.png');
  sh('input keyevent 4');
  tap(await find(byText('Unread mail'), 'the Board on Home'));
  await find(byText('Living room'), 'the Board');
  await shot('4-board.png');
  open(`chief:${scene.chief}`);
  await find(byText('New chat'), 'the Chief\'s chat');
  await shot('5-chief.png');
  open(`group:${scene.team}`);
  await sleep(3000);
  await shot('6-team.png');
})().catch((e) => { console.error(e.message); process.exit(1); });

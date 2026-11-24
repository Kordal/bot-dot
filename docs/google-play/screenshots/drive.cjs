// Takes the Play phone screenshots of the Android app on an emulator (docs/google-play/README.md), from the scene
// scene.cjs serves. Every pixel is the app's own: nothing is drawn on the pictures (caption.cjs adds the captions).
// node docs/google-play/screenshots/drive.cjs <scene dir> <app.apk> <out dir>
// Needs adb with one emulator. The screen is set to 1080 x 1920 (9:16, as Play wants), dark, at 09:30, and each
// picture is saved as a 24-bit PNG: Play refuses a screenshot with an alpha channel.
// Needs you is not pictured: it keeps itself out of screenshots (FLAG_SECURE, passwords are typed there), so its
// cards are shown where the Chief asked for them, in its chat.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resave } = require('../png.cjs');

const [dir, apk, outDir] = process.argv.slice(2);
const OUT = path.resolve(outDir || 'play-screenshots');
fs.mkdirSync(OUT, { recursive: true });
const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
const PKG = 'dev.botdot.app'; // the debug build: it may reach a botdot over plain HTTP on localhost
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
    return { text: attr('text'), desc: attr('content-desc'), cls: attr('class'), x: (x1 + x2) >> 1, y: (y1 + y2) >> 1, top: y1, bottom: y2 };
  });
}
async function find(test, what, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const all = nodes();
    // A slow emulator's "… isn't responding" over the app: wait, it isn't the app's.
    const wait = all.some((n) => /isn't responding/.test(n.text)) && all.find(byText('Wait'));
    if (wait) { tap(wait); await sleep(1000); continue; }
    const hit = all.find(test);
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
/** The status bar as on a phone at rest: 09:30, full battery and signal, no notifications. (On API 35 a network
 * command with "-e fully true" or "-e mobile hide" leaves the status bar out of demo mode altogether.)
 * Said again before each picture: the emulator's system UI may leave demo mode on its own. */
function calm() {
  for (const extra of ['-e command enter', '-e command clock -e hhmm 0930', '-e command battery -e level 100 -e plugged false',
    '-e command network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4', '-e command notifications -e visible false']) {
    sh(`am broadcast -a com.android.systemui.demo ${extra}`);
  }
}
async function shot(name) {
  calm();
  await sleep(2500); // what it shows comes in, and the figures settle
  const file = path.join(OUT, name);
  fs.writeFileSync(file, execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
  resave(file, file, false); // no alpha
  console.log('wrote', name);
}
const open = (target) => sh(`am start -n ${PKG}/.MainActivity --es open '${target}'`);
/** Scrolls a chat: 'up' to older messages, 'down' to the newest, by [times] long swipes. */
async function scroll(way, times) {
  for (let i = 0; i < times; i++) { sh(way === 'up' ? 'input swipe 540 600 540 1600 250' : 'input swipe 540 1600 540 600 250'); await sleep(400); }
  await sleep(800);
}
/** One slow drag that moves the chat's content by [d] pixels (positive: down, to older messages); slow, so it does not fling. */
async function drag(d) {
  const by = Math.max(-1000, Math.min(1000, d));
  sh(`input swipe 540 ${Math.round(960 - by / 2)} 540 ${Math.round(960 + by / 2)} 900`);
  await sleep(1000);
}
/**
 * Scrolls the open chat until the first node [test] finds has its top at [y] (give or take 30 px), so that what is under
 * it, a reply with its view, is whole on the picture. Not on the screen: towards the newest messages three times, then
 * towards the oldest. A chat that cannot move further (its end) is as near as it gets.
 */
async function bring(test, what, y) {
  let looked = 0;
  let last = null;
  let stuck = 0;
  for (let i = 0; i < 24; i++) {
    const n = nodes().find(test);
    if (!n) { await drag(++looked <= 3 ? -700 : 700); continue; }
    const d = y - n.top;
    if (Math.abs(d) <= 30) { await sleep(600); return n; }
    stuck = last !== null && Math.abs(last - n.top) < 8 ? stuck + 1 : 0;
    if (stuck >= 2) return n;
    last = n.top;
    await drag(d + Math.sign(d) * 22); // the touch slop is lost at the start of a drag
  }
  fs.writeFileSync(path.join(OUT, `failed-${what.replace(/\W+/g, '-')}.png`), execFileSync('adb', ['exec-out', 'screencap', '-p']));
  throw new Error(`Could not bring to the place: ${what}\n${nodes().filter((n) => n.text || n.desc).map((n) => n.text || n.desc).join(' | ')}`);
}
const has = (re) => (n) => re.test(n.text) || re.test(n.desc);
(async () => {
  adb('install', '-r', '-g', apk);
  // The phone's localhost is the computer's: the app takes plain HTTP only to a botdot on the phone itself.
  adb('reverse', `tcp:${scene.port}`, `tcp:${scene.port}`);
  sh('wm size 1080x1920');
  sh('wm density 420');
  sh('cmd uimode night yes');
  sh('settings put global sysui_demo_allowed 1');
  const ui = sh('pidof com.android.systemui').trim();
  calm();
  await sleep(1500);
  // Said in the log: whether the system UI took the commands, or restarted on one of them.
  console.log('system UI', ui, '->', sh('pidof com.android.systemui').trim(), sh('logcat -d -b crash').split('\n').slice(-6).join(' / '));
  sh(`am start -W -n ${PKG}/.MainActivity`);

  // Connect to the scene's botdot.
  const field = await find((n) => n.cls === 'android.widget.EditText', 'the address field');
  tap(field);
  await sleep(500);
  sh(`input text 'http://localhost:${scene.port}'`);
  sh('input keyevent 111'); // the keyboard away
  tap(await find(byText('Connect'), 'Connect'));
  await find(byText('Search'), 'the list');
  await sleep(4000);

  await shot('1-home.png');
  // The Board, from its values on Home.
  tap(await find(byText('Unread mail'), 'the Board on Home'));
  await find(byText('Living room'), 'the Board');
  await shot('8-board.png');
  // The Chief's chat: from where the owner asks for a bot, the Chief's plan under it; then at the end, its two cards that wait for an OK.
  open(`chief:${scene.chief}`);
  await find(byText('New chat'), 'the Chief\'s chat');
  await bring(has(/^Make me a bot that suggests/), 'the owner\'s ask in the Chief\'s chat', 400);
  await shot('2-chief.png');
  await scroll('down', 8);
  await shot('3-approve.png');
  // Server Watch's reply: its numbers read the Board's tiles.
  open(`bot:${scene.bots.watch}`);
  await find(byText('Its settings'), 'Server Watch\'s chat');
  await bring(has(/^Everything is in order/), 'Server Watch\'s reply', 420);
  await shot('4-server.png');
  // Money Tracker's chart.
  open(`bot:${scene.bots.money}`);
  await find(byText('Its settings'), 'Money Tracker\'s chat');
  await bring(has(/^You spent/), 'Money Tracker\'s reply', 420);
  await shot('5-spending.png');
  // Spanish Coach's quiz, answered.
  open(`bot:${scene.bots.spanish}`);
  await find(byText('Its settings'), 'Spanish Coach\'s chat');
  await bring(has(/^Let's start with the bill/), 'Spanish Coach\'s quiz', 420);
  await shot('6-quiz.png');
  // The project's team chat: Quote Chaser's comparison of the quotes.
  open(`group:${scene.team}`);
  await find((n) => /Quote Chaser/.test(n.text), 'the team chat');
  await bring(has(/^Two quotes are in/), 'Quote Chaser\'s reply', 560);
  await shot('7-quotes.png');
})().catch((e) => { console.error(e.message); process.exit(1); });

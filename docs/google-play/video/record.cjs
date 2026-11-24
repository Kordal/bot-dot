// Records the video Play Console asks for with the foreground service declaration (docs/google-play/README.md,
// console-answers.md): the Android app on an emulator, connected to the staged botdot of scene.cjs (started with
// "video"), recorded with `adb shell screenrecord`. Every pixel is the app's and Android's own; ffmpeg only adds a
// step caption above it, and a short slate stands for the seconds the screen is off.
//   1. sign in to the botdot server: the app starts its foreground service,
//   2. the ongoing notification, which is that service's, in the notification shade,
//   3. a message to a bot, 4. the phone is locked,
//   5. the bot's reply arrives as a notification on the lock screen,
//   6. a tap on it opens the chat with the reply.
// node docs/google-play/video/record.cjs <scene dir> <app.apk> <out dir>
// Needs adb with one emulator, and ffmpeg. Writes <out dir>/fgs-video.mp4 (H.264, 720 x 1280, under 60 s).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const [dir, apk, outDir] = process.argv.slice(2);
const OUT = path.resolve(outDir || 'play-video');
const SEG = path.join(OUT, 'segments');
fs.mkdirSync(SEG, { recursive: true });
const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
const PKG = 'dev.botdot.app'; // the debug build: it may reach a botdot over plain HTTP on localhost
const REPLY = /Tomorrow is light/; // the scripted reply (scene.cjs, "video")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
const sh = (cmd) => adb('shell', cmd);

/** What is on the screen: each node with its text or description, its package and its middle. */
function nodes() {
  sh('uiautomator dump /sdcard/ui.xml >/dev/null');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml');
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => {
    const attr = (k) => (n.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || '';
    const [x1, y1, x2, y2] = (attr('bounds').match(/\d+/g) || [0, 0, 0, 0]).map(Number);
    return { text: attr('text'), desc: attr('content-desc'), cls: attr('class'), pkg: attr('package'), x: (x1 + x2) >> 1, y: (y1 + y2) >> 1 };
  });
}
const byText = (t) => (n) => n.text === t || n.desc === t;
const tap = (n) => sh(`input tap ${n.x} ${n.y}`);
/** The recording that is running: what waits for the screen (the dumps of find) is cut out of it afterwards. */
let current = null;
async function cutting(fn) {
  const from = Date.now();
  try { return await fn(); } finally { if (current) current.cuts.push({ from, to: Date.now() }); }
}
const find = (...args) => cutting(() => findNow(...args));
async function findNow(test, what, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const all = nodes();
    // A slow emulator's "… isn't responding" over the app: wait, it isn't the app's.
    const wait = all.some((n) => /isn't responding/.test(n.text)) && all.find(byText('Wait'));
    if (wait) { tap(wait); await sleep(1000); continue; }
    const hit = all.find(test);
    if (hit) return hit;
    if (Date.now() > end) {
      fs.writeFileSync(path.join(OUT, `failed-${what.replace(/\W+/g, '-')}.png`), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
      throw new Error(`Not on the screen: ${what}\n${nodes().filter((n) => n.text || n.desc).map((n) => `${n.pkg}: ${n.text || n.desc}`).join(' | ')}`);
    }
    await sleep(700);
  }
}
/** The status bar as on a phone at rest: 09:30, full battery and signal. Its notification icons stay: they are shown. */
function calm() {
  for (const extra of ['-e command enter', '-e command clock -e hhmm 0930', '-e command battery -e level 100 -e plugged false',
    '-e command network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4', '-e command notifications -e visible true']) {
    sh(`am broadcast -a com.android.systemui.demo ${extra}`);
  }
}

/** One screenrecord segment, with the step captions said while it runs (seconds from its start). */
function record(name) {
  const remote = `/sdcard/${name}.mp4`;
  sh(`rm -f ${remote}`);
  const child = spawn('adb', ['shell', 'screenrecord', '--size', '720x1280', '--bit-rate', '6000000', '--time-limit', '120', remote], { stdio: 'ignore' });
  const rec = { name, remote, caps: [], cuts: [], t0: Date.now() + 700, exited: new Promise((r) => child.on('exit', r)) }; // the first frame comes a moment late
  current = rec;
  /** Seconds into the video, without what is cut out. */
  rec.kept = () => (Date.now() - rec.t0 - rec.cuts.reduce((sum, c) => sum + (c.to - c.from), 0)) / 1000;
  rec.say = (...lines) => {
    const t = Math.max(0, rec.kept());
    const last = rec.caps[rec.caps.length - 1];
    if (last && last.to == null) last.to = t;
    if (lines.length) rec.caps.push({ lines, from: t, to: null });
  };
  rec.stop = async () => {
    rec.say();
    rec.seconds = rec.kept();
    current = null;
    sh('kill -2 $(pidof screenrecord)'); // SIGINT: it finishes the file
    await Promise.race([rec.exited, sleep(15000)]);
    await sleep(1500);
    rec.file = path.join(SEG, `${name}.mp4`);
    // The file may not be closed yet when the phone is slow: pulled again, and said when it still fails.
    for (let tries = 1; ; tries++) {
      try { adb('pull', remote, rec.file); break; } catch (e) {
        console.log(`pull ${remote} (${tries}):`, String(e.stderr || e.message).trim(), sh(`ls -l ${remote}; pidof screenrecord`).trim());
        if (tries >= 5) throw e;
        await sleep(3000);
      }
    }
    return rec;
  };
  return rec;
}

/** ffmpeg's drawtext wants a font file. */
const FONT = [process.env.FONT, '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf'].find((f) => f && fs.existsSync(f));
if (!FONT) throw new Error('No font for the captions: set FONT to a .ttf file');
const x264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-an', '-movflags', '+faststart'];
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
/** Lines of text as drawtext filters, each in its own bar, from y down (a text file each: no quoting trouble). */
function drawtext(lines, y, name, extra = '') {
  return lines.map((line, i) => {
    const file = path.join(SEG, `${name}-${i}.txt`);
    fs.writeFileSync(file, line);
    return `drawtext=fontfile=${FONT}:textfile=${file}:fontcolor=white:fontsize=26:box=1:boxcolor=black@0.7:boxborderw=12:x=(w-text_w)/2:y=${y + i * 56}${extra}`;
  });
}
/** A segment at a constant 30 fps (screenrecord writes a frame only when the screen changes), what waited cut out, a caption
 * in a bar above the screen for each step (the phone is shown at 90 %, so no caption covers the app), and the last picture held a moment. */
function finish(rec, i) {
  const out = path.join(SEG, `part-${i}.mp4`);
  const cut = rec.cuts.map((c) => `between(t,${Math.max(0, (c.from - rec.t0) / 1000).toFixed(2)},${((c.to - rec.t0) / 1000).toFixed(2)})`);
  const caps = rec.caps.flatMap((c, k) => drawtext(c.lines, 12, `cap-${i}-${k}`, `:enable='between(t,${c.from.toFixed(2)},${(c.to ?? rec.seconds + 1).toFixed(2)})'`));
  const vf = ['scale=648:1152', 'pad=720:1280:36:128:black', 'fps=30', ...(cut.length ? [`select='not(${cut.join('+')})'`, 'setpts=N/(30*TB)'] : []), ...caps, 'tpad=stop_mode=clone:stop_duration=1'];
  ffmpeg('-i', rec.file, '-vf', vf.join(','), ...x264, out);
  return out;
}
/** What stands for the seconds the screen is off: black, and what happens then. */
function slate(i, seconds, lines) {
  const out = path.join(SEG, `part-${i}.mp4`);
  ffmpeg('-f', 'lavfi', '-i', `color=c=black:s=720x1280:r=30:d=${seconds}`, '-vf', drawtext(lines, 560, `slate-${i}`).join(','), ...x264, out);
  return out;
}

(async () => {
  adb('install', '-r', '-g', apk); // -g: the notification permission is granted
  adb('reverse', `tcp:${scene.port}`, `tcp:${scene.port}`); // the phone's localhost is the computer's
  sh('wm size 1080x1920');
  sh('wm density 420');
  sh('cmd uimode night yes');
  sh('settings put global sysui_demo_allowed 1');
  // A lock screen to lock the phone to (the emulator has none), showing notifications with their text.
  sh('locksettings set-disabled false');
  sh('settings put secure lock_screen_show_notifications 1');
  sh('settings put secure lock_screen_allow_private_notifications 1');
  sh('settings put system screen_off_timeout 600000');
  sh('input keyevent 224');
  sh('wm dismiss-keyguard');
  calm();
  // The emulator's own notifications ("Android System": the keyboard, the serial console) are not botdot's: put away.
  for (const [, key] of sh('dumpsys notification --noredact').matchAll(/pkg=android user=\S+ id=\S+ tag=\S+ importance=\d+ key=(\S+?):/g)) {
    console.log('snooze', key, sh(`cmd notification snooze --for 3600000 '${key}'`).trim());
  }
  await sleep(1500);

  // ---- 1. Sign in: the app connects to the botdot server and starts its foreground service ----
  const one = record('one');
  const field = await cutting(async () => {
    sh(`am start -W -n ${PKG}/.MainActivity`);
    return findNow((n) => n.cls === 'android.widget.EditText', 'the address field');
  });
  one.say('1. Sign in to your own', 'botdot server');
  tap(field);
  await sleep(600);
  sh(`input text 'http://localhost:${scene.port}'`);
  await sleep(1200);
  sh('input keyevent 111'); // the keyboard away
  tap(await find(byText('Connect'), 'Connect'));
  await find(byText('Search'), 'the list');
  await sleep(2500);

  // ---- 2. The ongoing notification, the foreground service's, in the shade ----
  one.say('2. The ongoing notification is', 'botdot\'s foreground service');
  calm();
  sh('cmd statusbar expand-notifications');
  await find((n) => n.pkg === 'com.android.systemui' && /^(All quiet|Connecting…)$/.test(n.text), 'the ongoing notification in the shade');
  await sleep(4000);
  // For the log: it is the app's foreground service of the special use type, not anything drawn.
  console.log(sh(`dumpsys activity services ${PKG}`).split('\n').filter((l) => /isForeground|foregroundServiceType|ServiceRecord/.test(l)).join('\n'));
  sh('cmd statusbar collapse');
  await sleep(1000);

  // ---- 3. A message to a bot ----
  one.say('3. Send a message to a bot');
  tap(await find(byText('Weekly Planner'), 'Weekly Planner in the list'));
  tap(await find((n) => n.cls === 'android.widget.EditText', 'the message field'));
  await sleep(1000);
  sh('input text \'What%sis%son%smy%scalendar%stomorrow?\'');
  await sleep(1200);
  tap(await find(byText('Send'), 'Send'));
  await find((n) => /What is on my calendar tomorrow/.test(n.text), 'the message in the chat');
  await sleep(2500);

  // ---- 4. Lock the phone ----
  one.say('4. Lock the phone');
  await sleep(1500);
  sh('input keyevent 26');
  await sleep(800);
  await one.stop();

  // ---- the bot answers while the screen is off: the reply arrives as a notification ----
  fs.writeFileSync(path.join(dir, 'reply'), '');
  const end = Date.now() + 60000;
  while (!REPLY.test(sh('dumpsys notification --noredact'))) {
    if (Date.now() > end) throw new Error('The bot\'s reply made no notification');
    await sleep(500);
  }
  console.log('the reply is a notification');
  await sleep(1500);

  // ---- 5. The reply on the lock screen ----
  sh('input keyevent 224'); // the screen on: the lock screen, not unlocked
  await sleep(1000);
  const two = record('two');
  two.say('5. The bot\'s reply arrives as a', 'notification on the lock screen');
  const lock = (n) => n.pkg === 'com.android.systemui' && (REPLY.test(n.text) || REPLY.test(n.desc));
  const note = await find(lock, 'the reply notification on the lock screen');
  await sleep(4000);

  // ---- 6. A tap on it opens the chat ----
  two.say('6. Tap it: the chat opens', 'with the reply');
  tap(note);
  const chat = (n) => n.pkg === PKG && REPLY.test(n.text);
  await sleep(1500);
  if (!nodes().some(chat)) sh('input swipe 540 1600 540 500 300'); // the lock screen still waits for an unlock swipe
  await find(chat, 'the reply in the chat');
  await sleep(3500);
  await two.stop();

  // ---- the video ----
  const parts = [finish(one, 1), slate(2, 3, ['The phone is locked.', 'botdot keeps its connection open', 'with the foreground service.']), finish(two, 3)];
  const list = path.join(SEG, 'parts.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
  const video = path.join(OUT, 'fgs-video.mp4');
  ffmpeg('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', video);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video], { encoding: 'utf8' }));
  console.log(`wrote ${video}, ${seconds.toFixed(1)} s`);
  if (seconds > 60) throw new Error(`The video is ${seconds.toFixed(1)} s: Play takes at most 60`);
})().catch((e) => { console.error(e.message); process.exit(1); });

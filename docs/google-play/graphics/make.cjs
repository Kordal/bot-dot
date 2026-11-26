// Draws the Play icon and the feature graphics (docs/google-play/README.md).
// node docs/google-play/graphics/make.cjs   (with Playwright: npm i playwright, or NODE_PATH to one)
// - icon-512.png: the Android launcher icon as a launcher shows it: its background colour and its foreground's own
//   placement, read from android/app/src/main/res, over the part of the adaptive icon a launcher shows (the middle
//   72 of 108). Full square, as Play rounds it. 32-bit PNG, as Play asks.
// - feature-1024x500.png (English) and feature-1024x500-<code>.png in every other language with captions
//   (../captions/<code>.json `feature`, ADR 280): the logo as the apps draw it ("bot" and the coral dot, in Geist),
//   one line, and the app's Home from the Play screenshots. 24-bit PNG: Play refuses alpha.
// node docs/google-play/graphics/make.cjs [Home's raw picture] [out folder]   (by default ../screenshots/raw/1-home.png and this folder)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { resave } = require('../png.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.resolve(process.argv[3] || __dirname);
const { all: captions, featureFile } = require('../captions.cjs');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
// Inline: a page set from a string may not load a file:// font, and would fall back without a word.
const FONT = `data:font/ttf;base64,${fs.readFileSync(path.join(ROOT, 'public', 'fonts', 'Geist.ttf')).toString('base64')}`;
const HOME = path.resolve(process.argv[2] || path.join(__dirname, '..', 'screenshots', 'raw', '1-home.png'));
const BG = '#000000'; // public/style.css --bg
const DOT = '#d85a30'; // --dot

// The mark, in public/icon.svg's units: the stem and bowl of the "b" and the dot.
const MARK = `<rect width="46" height="280" rx="23" fill="#fff"/><circle cx="112" cy="186" r="71" fill="none" stroke="#fff" stroke-width="46"/><circle cx="297" cy="186" r="75" fill="${DOT}"/>`;

/** The launcher icon's background and its foreground group's placement, in the adaptive icon's 108 units. */
function launcher() {
  const fg = fs.readFileSync(path.join(RES, 'drawable', 'ic_launcher_foreground.xml'), 'utf8');
  const num = (k) => Number(fg.match(new RegExp(`android:${k}="([\\d.]+)"`))[1]);
  const colour = fs.readFileSync(path.join(RES, 'values', 'themes.xml'), 'utf8').match(/<color name="icon_bg">(#[0-9a-fA-F]{6})</)[1];
  return { bg: colour, x: num('translateX'), y: num('translateY'), scale: num('scaleX') };
}


(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });

  // The icon: what a launcher shows of the adaptive icon is its middle 72 of 108, here 512 pixels wide.
  const l = launcher();
  const k = 512 / 72;
  await p.setViewportSize({ width: 512, height: 512 });
  await p.setContent(`<style>body{margin:0}</style><svg width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${l.bg}"/>
    <g transform="translate(${((l.x - 18) * k).toFixed(3)} ${((l.y - 18) * k).toFixed(3)}) scale(${(l.scale * k).toFixed(5)})">${MARK}</g></svg>`);
  const icon = path.join(OUT, 'icon-512.png');
  await p.screenshot({ path: icon });
  resave(icon, icon, true);

  // The feature graphics: the logo and its line on the left, Home on the right, nothing that matters near an edge.
  const home = `data:image/png;base64,${fs.readFileSync(HOME).toString('base64')}`;
  await p.setViewportSize({ width: 1024, height: 500 });
  for (const { lang, feature: line } of captions()) {
    await p.setContent(`<html lang="${lang}"><style>
      @font-face{font-family:Geist;src:url(${FONT})}
      *{box-sizing:border-box;margin:0}
      body{width:1024px;height:500px;overflow:hidden;position:relative;background:${BG};color:#fff;font-family:Geist,"Noto Sans CJK SC","Noto Sans CJK JP","Noto Sans CJK KR",sans-serif;-webkit-font-smoothing:antialiased}
      .text{position:absolute;left:96px;top:0;bottom:0;width:440px;display:flex;flex-direction:column;justify-content:center;gap:24px}
      .logo{display:flex;align-items:center;font-size:128px;font-weight:600;letter-spacing:-.04em;line-height:1}
      .logo i{display:inline-block;width:.44em;height:.44em;margin-left:.07em;position:relative;top:.06em;border-radius:50%;background:${DOT}}
      p{font-size:33px;line-height:1.2;letter-spacing:-.01em;font-weight:400;text-wrap:balance}
      img{position:absolute;left:624px;top:48px;width:304px;border-radius:32px 32px 0 0;border:2px solid #2b2b2b;border-bottom:0}
    </style><div class="text"><div class="logo">bot<i></i></div><p>${line}</p></div><img src="${home}">`);
    if (!(await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family === 'Geist' && f.status === 'loaded'); }))) throw new Error('Geist did not load');
    const file = path.join(OUT, featureFile(lang));
    await p.screenshot({ path: file });
    resave(file, file, false);
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

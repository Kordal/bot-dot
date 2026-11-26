// Puts a short caption over each Play screenshot drive.cjs took (raw/), in every language that has captions
// (../captions/<code>.json, ADR 280), each into a folder of its code (en/, pl/): 1080 x 1920 (9:16), the caption on
// the app's black, the app's picture under it at 80 % of its width, whole. 24-bit PNG: Play refuses alpha. The app's
// own pixels are not touched, only made smaller. A caption is one line of what the picture shows, in the product's
// words (CONTEXT.md, the language's lib/i18n/<code>/GLOSSARY.md), no claim it doesn't show. Chinese, Japanese and
// Korean letters, which Geist has not, come from the system's Noto CJK (fonts-noto-cjk), chosen by the page's lang.
// node docs/google-play/screenshots/caption.cjs [raw folder] [out folder]   (with Playwright: npm i playwright, or
// NODE_PATH to one; by default raw/ and this folder)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { resave } = require('../png.cjs');

const RAW = path.resolve(process.argv[2] || path.join(__dirname, 'raw'));
const OUT = path.resolve(process.argv[3] || __dirname);
const captions = require('../captions.cjs').all();
// Inline: a page set from a string may not load a file:// font, and would fall back without a word.
const FONT = `data:font/ttf;base64,${fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'public', 'fonts', 'Geist.ttf')).toString('base64')}`;
// A one-letter word stays with the next one, as Polish typesetting wants ("z każdym", not "z" at a line's end).
const keep = (t) => t.replace(/(^|\s)([aiouwzAIOUWZ]) /g, '$1$2\u00a0');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  for (const { lang, screenshots } of captions) {
    const out = path.join(OUT, lang);
    fs.mkdirSync(out, { recursive: true });
    for (const [file, text] of Object.entries(screenshots)) {
      const shot = `data:image/png;base64,${fs.readFileSync(path.join(RAW, file)).toString('base64')}`;
      await p.setContent(`<html lang="${lang}"><style>
        @font-face{font-family:Geist;src:url(${FONT})}
        *{box-sizing:border-box;margin:0}
        body{width:1080px;height:1920px;overflow:hidden;background:#000;color:#fff;font-family:Geist,"Noto Sans CJK SC","Noto Sans CJK JP","Noto Sans CJK KR",sans-serif;-webkit-font-smoothing:antialiased}
        h1{height:389px;padding:0 96px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:66px;font-weight:600;line-height:1.15;letter-spacing:-.02em;text-wrap:balance}
        img{display:block;width:864px;margin:0 auto;border-radius:48px 48px 0 0;border:2px solid #2b2b2b;border-bottom:0}
      </style><h1>${keep(text)}</h1><img src="${shot}">`);
      if (!(await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family === 'Geist' && f.status === 'loaded'); }))) throw new Error('Geist did not load');
      const to = path.join(out, file);
      await p.screenshot({ path: to });
      resave(to, to, false);
      console.log('wrote', path.join(out, file));
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

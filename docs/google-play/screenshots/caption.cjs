// Puts a short caption over each Play screenshot drive.cjs took (raw/), in English (en/) and Polish (pl/):
// 1080 x 1920 (9:16), the caption on the app's black, the app's picture under it at 80 % of its width, whole.
// 24-bit PNG: Play refuses alpha. The app's own pixels are not touched, only made smaller.
// node docs/google-play/screenshots/caption.cjs   (with Playwright: npm i playwright, or NODE_PATH to one)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { resave } = require('../png.cjs');

const RAW = path.join(__dirname, 'raw');
// Inline: a page set from a string may not load a file:// font, and would fall back without a word.
const FONT = `data:font/ttf;base64,${fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'public', 'fonts', 'Geist.ttf')).toString('base64')}`;
// One line each: what the picture shows, in the product's words (CONTEXT.md), no claim it doesn't show.
const CAPTIONS = {
  '1-home.png': { en: 'Your bots and what needs you', pl: 'Twoje boty i to, co czeka na Ciebie' },
  '2-chief.png': { en: 'Ask the Chief of Staff for a bot', pl: 'Poproś Szefa sztabu o bota' },
  '3-approve.png': { en: 'Scripts wait for your OK', pl: 'Skrypty czekają na Twoją zgodę' },
  '4-server.png': { en: 'Gauges and live numbers in the chat', pl: 'Wskaźniki i liczby na żywo w czacie' },
  '5-spending.png': { en: 'Charts, not walls of numbers', pl: 'Wykresy zamiast ścian liczb' },
  '6-quiz.png': { en: 'Answer a quiz right in the chat', pl: 'Quiz do rozwiązania w czacie' },
  '7-quotes.png': { en: 'Compare options side by side', pl: 'Porównaj opcje obok siebie' },
  '8-board.png': { en: 'Live values on your Board', pl: 'Wartości na żywo na Tablicy' },
};

// A one-letter word stays with the next one, as Polish typesetting wants ("z każdym", not "z" at a line's end).
const keep = (t) => t.replace(/(^|\s)([aiouwzAIOUWZ]) /g, '$1$2\u00a0');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  for (const lang of ['en', 'pl']) {
    const out = path.join(__dirname, lang);
    fs.mkdirSync(out, { recursive: true });
    for (const [file, text] of Object.entries(CAPTIONS)) {
      const shot = `data:image/png;base64,${fs.readFileSync(path.join(RAW, file)).toString('base64')}`;
      await p.setContent(`<style>
        @font-face{font-family:Geist;src:url(${FONT})}
        *{box-sizing:border-box;margin:0}
        body{width:1080px;height:1920px;overflow:hidden;background:#000;color:#fff;font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased}
        h1{height:389px;padding:0 96px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:66px;font-weight:600;line-height:1.15;letter-spacing:-.02em;text-wrap:balance}
        img{display:block;width:864px;margin:0 auto;border-radius:48px 48px 0 0;border:2px solid #2b2b2b;border-bottom:0}
      </style><h1>${keep(text[lang])}</h1><img src="${shot}">`);
      if (!(await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family === 'Geist' && f.status === 'loaded'); }))) throw new Error('Geist did not load');
      const to = path.join(out, file);
      await p.screenshot({ path: to });
      resave(to, to, false);
      console.log('wrote', path.join(lang, file));
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

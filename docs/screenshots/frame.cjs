// Frames scene.cjs's raw screenshots for the README: the hero, rounded cards and the phone strip, in the app's black and Geist.
// node docs/screenshots/frame.cjs <raw dir> docs/screenshots
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), __dirname] }));
const [RAW, OUT] = process.argv.slice(2).map((p) => path.resolve(p));
const FONT = `file://${path.resolve(__dirname, '..', '..', 'public', 'fonts', 'Geist.ttf')}`;
const img = (f) => `data:image/png;base64,${fs.readFileSync(path.join(RAW, f)).toString('base64')}`;
const base = `@font-face{font-family:Geist;src:url(${FONT})} *{box-sizing:border-box;margin:0} html,body{background:transparent} body{font-family:Geist,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
.card{background:#000;border-radius:28px;overflow:hidden;border:2px solid #1f1f1f} .card img{display:block;width:100%}`;
const pages = {
  'hero.png': [1800, `<div class="card" style="padding:64px 72px 0;background:radial-gradient(1200px 500px at 50% 100%,rgba(216,90,48,.22),transparent 70%),#000">
    <div style="display:flex;align-items:center;font-weight:600;font-size:84px;line-height:1;letter-spacing:-.055em">bot<i style="display:inline-block;position:relative;top:.06em;width:.44em;height:.44em;margin-left:.07em;border-radius:50%;background:#d85a30"></i></div>
    <p style="margin-top:18px;font-size:30px;line-height:1.25;letter-spacing:-.02em;color:#fff;max-width:20em">A team of Claude Code bots you run by chat, on your own server.</p>
    <img src="${img('web-home.png')}" style="margin-top:52px;border-radius:20px 20px 0 0;border:2px solid #2e2e2e;border-bottom:0;display:block;width:100%">
  </div>`],
  'phones.png': [1800, `<div class="card" style="padding:56px;display:grid;grid-template-columns:repeat(4,1fr);gap:32px">${['phone-list', 'phone-chat', 'phone-board', 'phone-needs-you'].map((f) => `<img src="${img(f + '.png')}" style="width:100%;border-radius:28px;border:2px solid #2e2e2e">`).join('')}</div>`],
};
for (const f of ['web-project', 'web-board', 'web-chief', 'web-needs-you', 'web-page', 'web-icon']) pages[`${f}.png`] = [1800, `<div class="card"><img src="${img(f + '.png')}"></div>`];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
  for (const [name, [w, html]] of Object.entries(pages)) {
    await p.setViewportSize({ width: w / 2, height: 600 });
    await p.setContent(`<style>${base}</style>${html}`); await p.evaluate(() => document.fonts.ready);
    await p.locator('.card').screenshot({ path: path.join(OUT, name), omitBackground: true }); console.log('wrote', name);
  }
  await b.close();
})();

// Draws the Play icon (512, full square: Play rounds it) and the feature graphic (1024x500) from public/icon.svg's mark.
// node docs/google-play/graphics/make.cjs docs/google-play/graphics
const { chromium } = require('playwright');
const out = process.argv[2];
const mark = '<g transform="translate(111 147) scale(.78)"><rect width="46" height="280" rx="23" fill="#fff"/><circle cx="112" cy="186" r="71" fill="none" stroke="#fff" stroke-width="46"/><circle cx="297" cy="186" r="75" fill="#d85a30"/></g>';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  await p.setViewportSize({ width: 512, height: 512 });
  await p.setContent(`<style>body{margin:0}</style><svg width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#111110"/>${mark}</svg>`);
  await p.screenshot({ path: out + '/icon-512.png', omitBackground: false });
  await p.setViewportSize({ width: 1024, height: 500 });
  await p.setContent(`<style>body{margin:0;width:1024px;height:500px;background:#111110;display:flex;align-items:center;justify-content:center;gap:40px;font-family:Inter,system-ui,sans-serif}
  h1{color:#fff;font-size:128px;font-weight:700;letter-spacing:-4px;margin:0}</style>
  <svg width="220" height="220" viewBox="96 96 320 320">${mark}</svg><h1>botdot</h1>`);
  await p.screenshot({ path: out + '/feature-1024x500.png' });
  await b.close();
})();

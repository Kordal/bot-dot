#!/usr/bin/env node
// The scales check (#721), part of `make lint` and of the tests (test/css-tokens.test.js): every font size, radius,
// padding, margin and gap of the web page's style.css, the bots' page kit and the admin page is a token of the
// scales on :root (--fs-*, --sp-*, --r-*), and every weight is 400 or 600. What may stay a literal: 0, 1px (a line),
// a percentage (50% for round things), em (relative to the text it sits in), auto, keywords and a line height. The Projects screens'
// rules (the Company sections of style.css) stay as they are until their own tickets are merged.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROPS = /(?:^|[{;\s])(font-size|font-weight|font|border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|(?:row-|column-)?gap)\s*:\s*([^;{}]+)/g;
const PX = /(?<![\w.-])(\d*\.?\d+)px\b/g;
const WEIGHT = /(?<![\w.-])(\d{3})(?![\w.])/;
// A section of style.css headed "/* ---------- the Company…" runs to the next "/* ----------" heading.
const SECTION = /\/\* -{10} [^\n]*/g;
const held = (heading) => /Company|Projects/.test(heading);

// The literals of css that are not on the scales: [{ line, prop, value }].
function literals(css) {
  // Comments become spaces, so that a line number stays the line's.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => {
    const m = c.match(/^\/\* -{10} .*/);
    return m && held(m[0]) ? '\u0001' + c.slice(1).replace(/[^\n]/g, ' ') : m ? '\u0002' + c.slice(1).replace(/[^\n]/g, ' ') : c.replace(/[^\n]/g, ' ');
  });
  const found = [];
  let skip = false;
  let at = 0;
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  for (const block of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const before = text.slice(at, block.index + block[0].length);
    at = block.index + block[0].length;
    const marks = before.match(/[\u0001\u0002]/g);
    if (marks) skip = marks[marks.length - 1] === '\u0001';
    if (skip || /@font-face\s*$/.test(block[1])) continue;
    for (const m of block[2].matchAll(PROPS)) {
      const [, prop, value] = m;
      const bad = prop === 'font-weight' ? !/^\s*(400|600|normal|inherit)\s*$/.test(value)
        : prop === 'font' && WEIGHT.test(value) && !['400', '600'].includes(value.match(WEIGHT)[1]) ? true
          : [...(prop === 'font' ? value.replace(/\/\s*[\d.]+px/, '') : value).matchAll(PX)].some((p) => !['0', '1'].includes(p[1]));
      if (bad) found.push({ line: lineOf(block.index + block[1].length + 1 + m.index), prop, value: value.trim() });
    }
  }
  return found;
}

// The admin page's styles: the text of ADMIN_STYLE in lib/front-door/pages.js, on the lines it has there.
const adminStyle = () => {
  const js = fs.readFileSync(path.join(ROOT, 'lib/front-door/pages.js'), 'utf8');
  const start = js.indexOf('const ADMIN_STYLE = `') + 'const ADMIN_STYLE = `'.length;
  return js.slice(0, start).replace(/[^\n]/g, '') + js.slice(start, js.indexOf('`;', start));
};
const FILES = {
  'public/style.css': () => fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8'),
  'bot-skills/skills/pages/site-kit/kit/botdot-kit.css': () => fs.readFileSync(path.join(ROOT, 'bot-skills/skills/pages/site-kit/kit/botdot-kit.css'), 'utf8'),
  'lib/front-door/pages.js (ADMIN_STYLE)': adminStyle,
};

module.exports = { literals, adminStyle, FILES };

if (require.main === module) {
  let failed = 0;
  for (const [name, read] of Object.entries(FILES)) {
    for (const f of literals(read())) { failed++; console.error(`${name}:${f.line}  ${f.prop}: ${f.value}`); }
  }
  if (failed) {
    console.error(`FAIL  ${failed} font sizes, weights, radii or spacings off the scales (the tokens on :root of public/style.css)`);
    process.exit(1);
  }
  console.log('OK    the styles keep to the scales');
}

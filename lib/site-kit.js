// The style kit and starter templates of interactive pages (#400): bot-skills/skills/pages/site-kit/, shipped in
// botdot's image. start_interactive_page copies one template into a new folder of the bot's computer, with the kit
// (its stylesheet, its script and the Geist fonts of the web page) where the template links it, so a page the bot
// builds looks like botdot and loads nothing from the internet. The folder goes as a tar the computer unpacks as box.
const fs = require('fs');
const path = require('path');

const KIT_ROOT = path.join(__dirname, '..', 'bot-skills', 'skills', 'pages', 'site-kit');
const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts');
const FONTS = ['Geist.ttf', 'GeistMono.ttf', 'OFL.txt'];
// Each template, what it is, and where its kit goes: a plain site links kit/ beside index.html; Vite copies public/
// into what it builds.
const TEMPLATES = {
  html: { kitAt: 'kit', about: 'plain HTML, CSS and JavaScript: nothing to build, publish the folder itself' },
  svelte: { kitAt: 'public/kit', about: 'Svelte with Vite: npm ci, then npm run build, and publish its dist folder' },
  roadmap: { kitAt: 'kit', about: 'plain HTML: a roadmap with views, filters, a sort and a kanban of cards that open' },
};

const refused = (message) => Object.assign(new Error(message), { status: 400 });

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.push({ path: path.relative(base, full).split(path.sep).join('/'), data: fs.readFileSync(full) });
  }
  return out;
}

// The files of a template with the kit in place: [{ path, data }].
function files(template) {
  const t = TEMPLATES[template];
  if (!t) throw refused(`There is no template "${template}": pick one of ${Object.keys(TEMPLATES).join(', ')}.`);
  const kit = [
    ...walk(path.join(KIT_ROOT, 'kit')),
    ...FONTS.map((f) => ({ path: `fonts/${f}`, data: fs.readFileSync(path.join(FONTS_DIR, f)) })),
  ].map((f) => ({ path: `${t.kitAt}/${f.path}`, data: f.data }));
  return [...walk(path.join(KIT_ROOT, 'templates', template)), ...kit];
}

// A tar (ustar) of plain files, as `tar -x` reads it. Every path here is short and plain: one that isn't is a mistake
// in the kit and throws.
function tar(list) {
  const blocks = [];
  const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  const now = Math.floor(Date.now() / 1000);
  for (const f of list) {
    if (Buffer.byteLength(f.path) > 99 || !/^[A-Za-z0-9._/@+-]+$/.test(f.path)) throw new Error(`site kit: ${f.path} can't go into a tar`);
    const h = Buffer.alloc(512);
    h.write(f.path, 0);
    h.write(octal(0o644, 8), 100);
    h.write(octal(0, 8), 108);
    h.write(octal(0, 8), 116);
    h.write(octal(f.data.length, 12), 124);
    h.write(octal(now, 12), 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(octal(sum, 7) + ' ', 148);
    blocks.push(h, f.data, Buffer.alloc((512 - (f.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

module.exports = { TEMPLATES, KIT_ROOT, files, tar };

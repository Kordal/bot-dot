// Save on a product card (#682, ADR 113): the product goes in one Markdown file among the bot's files
// (uploads/…-Saved-products.md, lib/bot-files.js), a line each: "- [Name](url) · price · store · 2026-10-29". The
// owner finds it in Files, and the bot is told of it with its other files on its next task. A product is the same
// product by its address. Saved again, it is taken out. Only its own lines change: what else the file holds (the
// owner's or the bot's words) stays, and the file goes only when nothing but its title is left.
const path = require('path');
const fs = require('./principal-fs');
const uploads = require('./uploads');

const NAME = 'Saved-products.md';
const FILE = /^\d{14}-[0-9a-f]{4}-Saved-products\.md$/;
const TITLE = '# Saved products';
const MAX = 200; // product lines kept: the oldest go first
const LINK = /\]\((https:\/\/[^)\s]+)\)/;

const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const label = (v) => clean(v, 120).replace(/[[\]]/g, '');
// An address in a Markdown link: its brackets written as %28 and %29, read back as they were.
const inLink = (url) => url.replace(/\(/g, '%28').replace(/\)/g, '%29');
const fromLink = (url) => url.replace(/%28/gi, '(').replace(/%29/gi, ')');
const urlOf = (line) => (line.startsWith('- ') ? fromLink(line.match(LINK)?.[1] || '') || null : null);

// The file, "uploads/…", or null.
function fileOf(workspace) {
  let names = [];
  try { names = fs.readdirSync(path.join(workspace, 'uploads')); } catch { return null; }
  const n = names.filter((x) => FILE.test(x)).sort().pop();
  return n ? `uploads/${n}` : null;
}

function lines(workspace, file) {
  if (!file) return [];
  try { return fs.readFileSync(path.join(workspace, file), 'utf8').replace(/\n+$/, '').split('\n'); } catch { return []; }
}

// The addresses of the saved products.
function list(workspace) {
  return lines(workspace, fileOf(workspace)).map(urlOf).filter(Boolean);
}

// Saves a product ({ name, url, price, store }) or takes it out (saved: false). Answers { saved, file }.
function set(workspace, product, saved = true, today = new Date()) {
  const url = clean(product?.url, 2000);
  if (!/^https:\/\/\S+$/.test(url)) throw Object.assign(new Error('A product is saved by its https address.'), { status: 400 });
  let file = fileOf(workspace);
  let all = lines(workspace, file).filter((l) => urlOf(l) !== url);
  if (!all.length) all = [TITLE, ''];
  if (saved) {
    const day = today.toISOString().slice(0, 10);
    all.push(`- [${label(product.name) || url}](${inLink(url)})${[clean(product.price, 40), clean(product.store, 60), day].filter(Boolean).map((x) => ` · ${x}`).join('')}`);
  }
  const items = all.filter(urlOf);
  if (items.length > MAX) { const old = new Set(items.slice(0, items.length - MAX)); all = all.filter((l) => !old.has(l)); }
  if (all.join('\n').trim() === TITLE) {
    if (file) fs.rmSync(path.join(workspace, file), { force: true });
    return { saved: false, file: null };
  }
  if (!file) {
    fs.mkdirSync(path.join(workspace, 'uploads'), { recursive: true });
    file = uploads.uploadPath(NAME);
  }
  fs.writeFileSync(path.join(workspace, file), `${all.join('\n')}\n`, { mode: 0o644 });
  return { saved: !!saved, file };
}

module.exports = { list, set, fileOf, NAME, MAX };

// The interface's strings as the code passes them to tr() and trn() (#645, ADR 108), for test/i18n.test.js and for
// `node lib/i18n/keys.js` (the strings of an area that have no Polish yet). Web: public/*.js and the data-t marks
// of public/*.html; the phones: the Kotlin of android/app/src/main and of the shared data layer (android/shared, ADR 242,
// outside its tests), and the iOS app's Swift (ios/, outside its tests), which speaks from the same dictionary through
// the shared tr; server: lib/ outside lib/i18n.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const AREAS = {
  web: { dirs: ['public'], ext: ['.js', '.html'], skip: ['public/i18n.js'] },
  android: {
    dirs: ['android/app/src/main', 'android/shared/src/commonMain', 'android/shared/src/androidMain', 'android/shared/src/iosMain', 'ios/BotDot', 'ios/BotDotNotify'],
    ext: ['.kt', '.swift'],
    skip: ['android/shared/src/commonMain/kotlin/dev/botdot/app/data/I18n.kt', 'ios/BotDot/I18n.swift'],
  },
  server: { dirs: ['lib', 'server.js', 'front-door.js'], ext: ['.js'], skip: ['lib/i18n'] },
};

function files(rel, ext, skip = []) {
  const abs = path.join(ROOT, rel);
  if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) return [];
  let st;
  try { st = fs.statSync(abs); } catch { return []; }
  if (st.isFile()) return ext.includes(path.extname(rel)) ? [rel] : [];
  return fs.readdirSync(abs).flatMap((f) => (f === 'node_modules' || f === 'build' ? [] : files(path.join(rel, f), ext, skip)));
}

// The arguments of the call whose "(" is at `open`: each as its source text, split at the commas outside brackets
// and strings. JavaScript and Kotlin alike.
function args(src, open) {
  const out = [];
  let depth = 0, cur = '', i = open + 1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === '\\') j++;
        else if (c === '`' && src[j] === '$' && src[j + 1] === '{') { // a template's ${…}: skip it whole
          let d = 0;
          for (j++; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
        }
      }
      cur += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// A literal string's text, or null for anything else (a name, a call, a template with ${…}, a Kotlin "$x").
function literal(s, kotlin) {
  const m = s.match(/^(["'`])([\s\S]*)\1$/);
  if (!m) return null;
  if (m[1] === '`' && m[2].includes('${')) return null;
  if (kotlin && (m[1] !== '"' || /\$[{\w]/.test(m[2].replace(/\\\$/g, '')))) return null;
  const body = kotlin ? m[2].replace(/\\\$/g, '$') : m[2];
  try { return m[1] === '`' ? body.replace(/\\([`\\$])/g, '$1') : JSON.parse(`"${body.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"')}"`); } catch { return null; }
}

// Every string of an area: { key, file, line, plural } for each literal, and { file, line, bad } for a call whose
// string is no literal (its key can't be checked, so it isn't allowed).
function collect(area) {
  const { dirs, ext, skip } = AREAS[area];
  const found = [];
  for (const file of dirs.flatMap((d) => files(d, ext, skip))) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const kotlin = file.endsWith('.kt');
    const lineOf = (i) => src.slice(0, i).split('\n').length;
    if (file.endsWith('.html')) {
      for (const m of src.matchAll(/<([a-z0-9-]+)([^>]*?)\sdata-t(?![\w-])(?:="([^"]*)")?([^>]*)>([^<]*)/gi)) {
        found.push({ key: (m[3] || m[5]).trim(), file, line: lineOf(m.index) });
      }
      for (const m of src.matchAll(/\sdata-t-(title|placeholder|aria-label)\b[^>]*?/gi)) {
        const tag = src.slice(src.lastIndexOf('<', m.index), src.indexOf('>', m.index));
        const v = tag.match(new RegExp(`\\s${m[1]}="([^"]*)"`));
        if (v) found.push({ key: v[1], file, line: lineOf(m.index) });
      }
      continue;
    }
    for (const m of src.matchAll(/(?<![\w.$])(?:I18n\.)?(trn?)\(/g)) {
      const a = args(src, m.index + m[0].length - 1);
      // The server's tr(language, text, vars) and trn(language, n, one, other, vars) take the language first.
      const shift = area === 'server' ? 1 : 0;
      const plural = m[1] === 'trn';
      const picks = plural ? [a[1 + shift], a[2 + shift]] : [a[shift]];
      const texts = picks.map((p) => (p === undefined ? null : literal(p, kotlin)));
      if (texts.some((t) => t === null)) { found.push({ file, line: lineOf(m.index), bad: `${m[1]}(${a.join(', ').slice(0, 80)})` }); continue; }
      found.push({ key: plural ? texts[1] : texts[0], one: plural ? texts[0] : undefined, plural, file, line: lineOf(m.index) });
    }
  }
  return found;
}

const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

module.exports = { AREAS, collect, placeholders, args, literal };

// The keys of `area` that `lang` has no text for yet, each once, in the order the code first uses them: { key, one,
// plural, file (the dictionary file it goes in), sites: [{ file, line }] }. Every call site, so a translator sees each
// place the string is drawn; a key with two areas' sites is in both areas' lists until one of them has it.
function missing(lang, area, { dir } = {}) {
  const i18n = require('.');
  const have = i18n.load(lang, dir);
  const out = new Map();
  for (const k of collect(area)) {
    if (k.bad || k.key in have) continue;
    if (!out.has(k.key)) out.set(k.key, { key: k.key, one: k.one, plural: !!k.plural, file: `lib/i18n/${lang}/${area}.json`, sites: [] });
    out.get(k.key).sites.push({ file: k.file, line: k.line });
  }
  return [...out.values()];
}

// The lines of code around `line` of `file` (1-based), `around` on each side, as "  12 | code" with the line itself marked.
function excerpt(file, line, around = 2) {
  let lines;
  try { lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n'); } catch { return ''; }
  const out = [];
  for (let n = Math.max(1, line - around); n <= Math.min(lines.length, line + around); n++) {
    const code = lines[n - 1].length > 220 ? `${lines[n - 1].slice(0, 220)}…` : lines[n - 1];
    out.push(`${n === line ? '>' : ' '} ${String(n).padStart(5)} | ${code}`);
  }
  return out.join('\n');
}

// An empty value for `key` in `lang`: a text, or for a plural the language's categories (lib/i18n categories()).
const blank = (k, lang) => (k.plural ? Object.fromEntries(require('.').categories(lang).map((c) => [c, ''])) : '');

// The plural fixture the phones' tests read (test/fixtures/plural-rules.json): Intl.PluralRules's category of each number
// in every language of the registry.
function pluralFixture() {
  const numbers = [...Array(131).keys(), 200, 201, 211, 1000, 1001, 10000, 100000, 1000000, 1000001, 2000000, 3000011, 10000000];
  const languages = Object.fromEntries(require('.').REGISTRY.map(({ code }) => { const p = new Intl.PluralRules(code); return [code, numbers.map((n) => p.select(n))]; }));
  return { about: ['The CLDR plural category of whole numbers in every language of the registry (lib/i18n/languages.json), as Intl.PluralRules answers: the web page and the server pick plural forms with Intl.PluralRules, and the phones with the table of I18n.form (android/shared), which PluralRulesTest holds to this file. test/i18n.test.js checks that it is still what Intl answers; write it again with node lib/i18n/keys.js plural-fixture.'], numbers, languages };
}
const fixtureText = (o) => `${JSON.stringify(o, null, 2).replace(/\[\n\s+([\s\S]*?)\n\s+\]/g, (m, inner) => `[${inner.replace(/\n\s+/g, ' ')}]`)}\n`;

module.exports.missing = missing;
module.exports.excerpt = excerpt;
module.exports.pluralFixture = pluralFixture;
module.exports.fixtureText = fixtureText;

const USAGE = `node lib/i18n/keys.js missing <lang> [web|android|server] [--where] [--limit N] [--offset N]
  The strings of an area (every area without one) that <lang> has no text for yet, in the order the code uses them.
  Without --where: a JSON table to fill in and add to lib/i18n/<lang>/<area>.json (a plural with the language's
  categories). With --where: each string with every place the code draws it (file:line and the lines around it),
  to translate it for where it stands. --limit and --offset take a chunk (default: all, from 0).
node lib/i18n/keys.js plural-fixture
  Writes test/fixtures/plural-rules.json from Intl.PluralRules.
node lib/i18n/keys.js [area]
  As "missing pl [area]".`;

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (name, d) => { const i = argv.indexOf(name); if (i < 0) return d; const v = Number(argv[i + 1]); argv.splice(i, 2); return Number.isInteger(v) && v >= 0 ? v : d; };
  const where = argv.includes('--where');
  const rest = argv.filter((a) => a !== '--where');
  if (rest[0] === '--help' || rest[0] === '-h') { console.log(USAGE); process.exit(0); }
  if (rest[0] === 'plural-fixture') {
    fs.writeFileSync(path.join(ROOT, 'test', 'fixtures', 'plural-rules.json'), fixtureText(pluralFixture()));
    console.log('wrote test/fixtures/plural-rules.json');
    process.exit(0);
  }
  const limit = flag('--limit', Infinity);
  const offset = flag('--offset', 0);
  const args = rest.filter((a) => !a.startsWith('--'));
  const [lang, area] = args[0] === 'missing' ? [args[1], args[2]] : ['pl', args[0]];
  if (!lang || !require('.').REGISTRY.some((l) => l.code === lang) || lang === 'en') { console.error(`${USAGE}\n\nA language of lib/i18n/languages.json other than en.`); process.exit(2); }
  if (area && !AREAS[area]) { console.error(`${USAGE}\n\nNo area ${area}.`); process.exit(2); }
  for (const a of area ? [area] : Object.keys(AREAS)) for (const k of collect(a)) if (k.bad) console.error(`${k.file}:${k.line} ${k.bad}: not a literal string`);
  const all = (area ? [area] : Object.keys(AREAS)).flatMap((a) => missing(lang, a));
  const chunk = all.slice(offset, offset + limit);
  if (!where) {
    console.log(JSON.stringify(Object.fromEntries(chunk.map((k) => [k.key, blank(k, lang)])), null, 2));
  } else {
    console.log(`# ${all.length} strings without ${lang}${area ? ` in ${area}` : ''}; ${chunk.length ? `${offset + 1} to ${offset + chunk.length}` : 'none'} here.`);
    console.log(`# Plural forms of ${lang}: ${require('.').categories(lang).join(', ')} (and "other" for fractions where it is not one of them).`);
    chunk.forEach((k, i) => {
      console.log(`\n## ${offset + i + 1}. ${JSON.stringify(k.key)}${k.plural ? `  (plural; one: ${JSON.stringify(k.one)})` : ''}  → ${k.file}`);
      for (const s of k.sites) console.log(`${s.file}:${s.line}\n${excerpt(s.file, s.line)}`);
    });
    if (offset + chunk.length < all.length) console.log(`\n# Next: --offset ${offset + chunk.length}`);
  }
}

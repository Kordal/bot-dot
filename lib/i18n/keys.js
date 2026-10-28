// The interface's strings as the code passes them to tr() and trn() (#645, ADR 107), for test/i18n.test.js and for
// `node lib/i18n/keys.js` (the strings of an area that have no Polish yet). Web: public/*.js and the data-t marks
// of public/*.html; Android: the Kotlin of android/app/src/main; server: lib/ outside lib/i18n.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const AREAS = {
  web: { dirs: ['public'], ext: ['.js', '.html'], skip: ['public/i18n.js'] },
  android: { dirs: ['android/app/src/main'], ext: ['.kt'], skip: ['android/app/src/main/java/dev/botdot/app/data/I18n.kt'] },
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
      for (const m of src.matchAll(/<([a-z0-9-]+)([^>]*?)\sdata-t(?:="([^"]*)")?([^>]*)>([^<]*)/gi)) {
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

// `node lib/i18n/keys.js [area]`: the strings without Polish, as a JSON table to fill in.
if (require.main === module) {
  const pl = require('.').load('pl');
  const out = {};
  for (const area of process.argv[2] ? [process.argv[2]] : Object.keys(AREAS)) {
    for (const k of collect(area)) {
      if (k.bad) console.error(`${k.file}:${k.line} ${k.bad}: not a literal string`);
      else if (!(k.key in pl)) out[k.key] = k.plural ? { one: '', few: '', many: '' } : '';
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

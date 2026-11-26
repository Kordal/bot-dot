// Answer views (#1623, ADR 264): a bot draws charts, tables and more in its reply with a ```ui fence, a JSON tree of the
// components of the catalog the server hands out (lib/ui-catalog.json, GET /api/ui-catalog). This reads such a fence:
// one generic validator driven by the catalog, with no code of its own for any component, by the rules every app shares
// (test/fixtures/ui-cases.json; the Android app reads the same cases in its own ticket). It draws nothing: the web page
// draws what it returns (#1624), and a fence it can't read stays its code. Nothing a bot writes is trusted as markup
// (rule 6): only the catalog's props are read, each cut to its length and kept to its kind, and a bot sets no colour,
// size or style, only a tone. The page loads this file as a plain <script> (window.AnswerView); Node loads it as a module.
//
//   const view = AnswerView.of(catalog, { known, noSource });   known: the newest catalog version this app draws (the
//     catalog's own); noSource: the other languages' words for a source that says there is none (below)
//   view.validate(fence)  one fence's text -> { ok: true, alt, root, problems } or { ok: false, refused, alt, problems }
//   view.split(reply, { done })  a reply's Markdown -> its parts in order: { text }, { view }, { code, alt, refused }, { drawing }

(function (root) {

const NO = { unreadable: true }; // a value that can't be read as what its prop is
const EMPTY = { empty: true }; // a text with nothing in it: as no prop
const DROP = { dropped: true }; // a node left out of its parent

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A text cut to n characters, not in the middle of a pair.
function cap(s, n) {
  if (s.length <= n) return s;
  const t = s.slice(0, n);
  return /[\uD800-\uDBFF]/.test(t.charAt(t.length - 1)) ? t.slice(0, -1) : t;
}

// What a string prop holds: the text, whitespace collapsed (a multiline one keeps its lines), cut to its length; a number is its digits.
function text(v, spec) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return NO;
  const clean = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return cap(spec.multiline ? clean.replace(/\r\n?/g, '\n').trim() : clean.replace(/\s+/g, ' ').trim(), spec.max);
}

// The bytes of a text in UTF-8, as a fence is measured.
function bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xFC00) === 0xDC00) { n += 4; i++; } else n += 3;
  }
  return n;
}

// An https address that opens: no user or password, no spaces. (botdot fetches a picture itself and checks its host.)
function https(v) {
  if (typeof v !== 'string') return NO;
  const s = v.trim();
  if (!s) return EMPTY;
  return s.length <= 2000 && /^https:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/.test(s) ? s : NO;
}

// A path among the bot's files, as the bot's workspace holds it ("./" and "/workspace/" are that folder): no way out of it, no web
// address, no drive, no query; with the extensions a kind of media allows, if the prop names them.
function filePath(s, exts) {
  let p = s;
  if (p.startsWith('/workspace/')) p = p.slice('/workspace/'.length);
  else if (p.startsWith('./')) p = p.slice(2);
  if (!p || p.length > 500 || p.charAt(0) === '~' || /[\\:?#\u0000-\u001F\u007F]/.test(p)) return NO;
  const segments = p.split('/');
  if (segments.some((g) => g === '' || g === '.' || g === '..')) return NO;
  if (exts) {
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(p);
    if (!m || !exts.includes(m[1].toLowerCase())) return NO;
  }
  return p;
}

// A media prop: { kind: "file", path } for a bot's file, { kind: "https", url } for an https address, when the prop allows it.
function media(v, spec) {
  if (typeof v !== 'string') return NO;
  const s = v.trim();
  if (!s) return EMPTY;
  if (/^https:\/\//.test(s)) {
    if (!spec.from.includes('https')) return NO;
    const url = https(s);
    return url === NO ? NO : { kind: 'https', url };
  }
  if (!spec.from.includes('file')) return NO;
  const path = filePath(s, spec.exts);
  return path === NO ? NO : { kind: 'file', path };
}

// A fence's alt as far as it can be read from a text that is no JSON (a fence cut short, or too long to read).
function altFrom(source, limits) {
  const m = /"alt"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(source.slice(0, 20000));
  if (!m) return '';
  let s;
  try { s = JSON.parse(`"${m[1]}"`); } catch { return ''; }
  const t = text(s, { max: limits.alt });
  return t === NO ? '' : t;
}

// What an item of a list that keeps its place (`inPlace`) is where it can't be read: a blank, as its kind has one (a text with
// nothing in it, a number that is null, a list with nothing in it), or NO where it has none and the item is left out.
function blank(spec) {
  if (spec.nullable) return null;
  return spec.type === 'string' ? '' : spec.type === 'list' ? [] : NO;
}

// A fence limit that was passed: the fence is drawn as code.
function Refusal(why) { this.why = why; }

const UI_OPEN = /^\s*```ui\s*$/;
const UI_CLOSE = /^\s*```\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

// What a text is compared by, to tell a reserved phrase: lower case, with everything but letters and digits left out, so that
// its case, spacing and punctuation change nothing ("APPROVED,  go-ahead!" is "Approved. Go ahead.").
const phraseKey = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// What a `source` that says there is none reads like, compared as a reserved phrase is (phraseKey): English's here, and
// every other offered language's noSource (lib/i18n/<code>/phrases.json, ADR 280), which `of` takes as `noSource` (the
// server passes them; the web page's are I18n.phrases, which come with its dictionary). A source is read clause by
// clause (a colon, comma, semicolon, bracket, full stop or dash ends one): it says there is none when it is empty, or
// its last clause is one of these, so "the bot's estimate: none, no source available" is no source either.
const NO_SOURCE = [
  'none', 'n/a', 'na', 'nil', 'nothing', 'unknown', 'not known', 'unavailable', 'not available', 'not applicable', 'not specified', 'not given', 'not provided',
  'no source', 'no sources', 'no source available', 'no source given', 'no source provided', 'no source known', 'no sources available', 'source unknown', 'source not available', 'no data source',
].map(phraseKey);
const CLAUSE = /[:;,.()–—…]|\s-\s/;
const pagePhrases = () => { try { return typeof I18n !== 'undefined' && I18n.phrases && Array.isArray(I18n.phrases.noSource) ? I18n.phrases.noSource : []; } catch (e) { return []; } };
const noneOf = (more) => new Set(NO_SOURCE.concat((Array.isArray(more) ? more : pagePhrases()).filter((p) => typeof p === 'string').map(phraseKey)));
const saysNone = (s, none) => { const parts = String(s).split(CLAUSE).map(phraseKey).filter(Boolean); return !parts.length || none.has(parts[parts.length - 1]); };

function of(catalog, options) {
  const L = catalog.limits;
  const reserved = new Set((Array.isArray(catalog.reserved) ? catalog.reserved : []).map(phraseKey));
  const known = options && Number.isFinite(options.known) ? options.known : catalog.version;
  const none = noneOf(options && options.noSource);
  const components = catalog.components;

  // What one prop holds, or NO (can't be read) or EMPTY (a text with nothing in it). `at` is the node's path, `where` the prop's inside it.
  function read(v, spec, at, where, ctx) {
    if (v === null) return spec.nullable ? null : spec.empty ? '' : NO;
    switch (spec.type) {
      case 'string': {
        const s = text(v, spec);
        if (s !== NO && spec.noReserved && reserved.has(phraseKey(s))) return NO; // the owner's words the server reads as an answer
        return s === NO ? NO : s === '' && !spec.empty ? EMPTY : s;
      }
      case 'number': case 'int': {
        let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
        if (!Number.isFinite(n)) return NO;
        if (spec.type === 'int') n = Math.round(n);
        if (spec.indexes) {
          // A place in a sibling list (`indexes` names it), as the bot counted it in the list it wrote: where that item stands among
          // the ones kept. An item that was left out, or a number past the list, names nothing: no clamping to the nearest one.
          const kept = ctx.kept[`${at}|${where.slice(0, where.lastIndexOf('/') + 1)}${spec.indexes}`];
          const place = kept ? kept.indexOf(n) : -1;
          return place < 0 ? NO : place;
        }
        if (spec.min != null) n = Math.max(n, spec.min);
        if (spec.max != null) n = Math.min(n, spec.max);
        return n === 0 ? 0 : n;
      }
      case 'boolean': return typeof v === 'boolean' ? v : NO;
      case 'enum': return typeof v === 'string' && spec.values.includes(v) ? v : NO;
      case 'tone': return typeof v === 'string' && catalog.tones.includes(v) ? v : NO;
      case 'https': return https(v);
      case 'media': return media(v, spec);
      case 'list': {
        if (!Array.isArray(v)) return NO;
        if (spec.counts === 'points') {
          ctx.points += v.length;
          if (ctx.points > L.points) throw new Refusal('too-many-points');
        }
        const out = [];
        const kept = []; // where each kept item stood in the list the bot wrote, for a prop that names a place in it
        const lost = new Set(); // where an item was left out
        const paired = spec.by ? ctx.lost[`${at}|${spec.by}`] : null; // where the list this one is paired with (`by`) left an item out
        let tried = 0;
        let readable = 0;
        for (let i = 0; i < v.length && (spec.max == null || out.length < spec.max); i++) {
          if (paired && paired.has(i)) continue; // its partner is gone, so it goes too: the ones after it keep their places
          tried++;
          let item = read(v[i], spec.of, at, `${where}/${i}`, ctx);
          if (item !== NO && item !== EMPTY) readable++;
          else {
            ctx.problems.push({ at, code: 'bad-item', prop: `${where}/${i}` });
            if (spec.inPlace) item = blank(spec.of); // it keeps its place, as a blank, so that the ones after it keep theirs
          }
          if (item === NO || item === EMPTY) lost.add(i);
          else { out.push(item); kept.push(i); }
        }
        if (spec.inPlace && tried && !readable) return NO; // nothing in it could be read: not a list of blanks
        if (spec.min && out.length < spec.min) return NO;
        ctx.kept[`${at}|${where}`] = kept;
        ctx.lost[`${at}|${where}`] = lost;
        return out;
      }
      case 'object': {
        if (!isObj(v)) return NO;
        const out = {};
        return props(v, spec.props, at, where, ctx, out, []) ? out : NO;
      }
      default: return NO;
    }
  }

  // The props of a node, or of an object inside one, in the catalog's order, then what the catalog doesn't have. false: a required
  // prop is missing or can't be read. Inside an object that only drops its item; at a node, the problem is told.
  function props(raw, defs, at, base, ctx, out, skip) {
    const prefix = base ? `${base}/` : '';
    for (const name of Object.keys(defs)) {
      const spec = defs[name];
      const v = own(raw, name) ? raw[name] : undefined;
      const r = v == null ? EMPTY : read(v, spec, at, prefix + name, ctx);
      if (r === EMPTY || r === NO) {
        if (spec.required) {
          if (!base) ctx.problems.push({ at, code: v == null || r === EMPTY ? 'missing-prop' : 'bad-prop', prop: name });
          return false;
        }
        if (r === NO) ctx.problems.push({ at, code: 'bad-prop', prop: prefix + name });
        continue;
      }
      out[name] = r;
    }
    for (const name of Object.keys(raw)) if (!own(defs, name) && skip.indexOf(name) < 0) ctx.problems.push({ at, code: 'unknown-prop', prop: prefix + name });
    return true;
  }

  // One node of the tree, or DROP when its parent doesn't take it.
  function node(raw, at, depth, parent, ctx) {
    if (depth > L.depth) throw new Refusal('too-deep');
    if (++ctx.nodes > L.nodes) throw new Refusal('too-many-nodes');
    const type = own(raw, 'type') ? raw.type : undefined;
    const spec = typeof type === 'string' && own(components, type) && components[type].since <= known ? components[type] : null;
    if (!spec) {
      ctx.problems.push(typeof type === 'string' ? { at, code: 'unknown-component', name: cap(type, 40) } : { at, code: 'unknown-component' });
      return { type: 'unknown' };
    }
    if (spec.in && !(parent && spec.in.indexOf(parent) >= 0)) {
      ctx.problems.push({ at, code: 'not-allowed-here' });
      return DROP;
    }
    const out = { type };
    ctx.points = 0;
    if (!props(raw, spec.props, at, '', ctx, out, spec.children ? ['type', 'children'] : ['type'])) return { type: 'unknown' };
    if (spec.children && raw.children != null) {
      if (!Array.isArray(raw.children)) ctx.problems.push({ at, code: 'bad-prop', prop: 'children' });
      else {
        const kids = [];
        for (let i = 0; i < raw.children.length && kids.length < spec.children.max; i++) {
          const child = raw.children[i];
          const here = `${at}/children/${i}`;
          if (!isObj(child)) { ctx.problems.push({ at: here, code: 'not-a-component' }); continue; }
          if (spec.children.only && !(typeof child.type === 'string' && spec.children.only.indexOf(child.type) >= 0)) { ctx.problems.push({ at: here, code: 'not-allowed-here' }); continue; }
          const n = node(child, here, depth + 1, type, ctx);
          if (n !== DROP) kids.push(n);
        }
        out.children = kids;
      }
    }
    // A source that only says there is none ("none", "n/a", "no source available") is no source: the quiet "No source" mark shows.
    if (spec.sourced && out.source && saysNone(out.source, none)) delete out.source;
    if (spec.sourced && !out.source) out.noSource = true;
    return out;
  }

  // One fence's text: the view it draws, or why it is drawn as code.
  function validate(source) {
    const src = typeof source === 'string' ? source : '';
    const ctx = { nodes: 0, points: 0, problems: [], kept: {}, lost: {} };
    const refuse = (refused, alt) => ({ ok: false, refused, alt, problems: ctx.problems });
    if (src.length > L.bytes || bytes(src) > L.bytes) return refuse('too-big', altFrom(src, L));
    let json;
    try { json = JSON.parse(src); } catch { return refuse('not-json', altFrom(src, L)); }
    if (!isObj(json)) return refuse('not-object', '');
    const alt = typeof json.alt === 'string' ? text(json.alt, { max: L.alt }) : '';
    if (!alt) return refuse('no-alt', '');
    if (!isObj(json.root)) return refuse('no-root', alt);
    try {
      const tree = node(json.root, 'root', 1, null, ctx);
      return { ok: true, alt, root: tree === DROP ? { type: 'unknown' } : tree, problems: ctx.problems };
    } catch (e) {
      if (e instanceof Refusal) return refuse(e.why, alt);
      throw e;
    }
  }

  // A reply's Markdown in its parts, in order: the text between the fences, each ```ui fence as a view, or as the code it stays
  // (with its alt and why: a refused fence, one past the third, one never closed), or, while the reply is still being written
  // (done false), a fence not closed yet, which waits whole ("Drawing a view…"). Other code blocks are text, whole.
  function split(reply, opts) {
    const done = !opts || opts.done !== false;
    const lines = String(reply == null ? '' : reply).replace(/\r\n?/g, '\n').split('\n');
    const parts = [];
    let md = [];
    let fences = 0;
    const flush = () => {
      while (md.length && !md[0].trim()) md.shift();
      while (md.length && !md[md.length - 1].trim()) md.pop();
      if (md.length) parts.push({ text: md.join('\n') });
      md = [];
    };
    const code = (src, refused, alt) => ({ code: src, alt: alt == null ? altOf(src) : alt, refused });
    const altOf = (src) => {
      try { const j = JSON.parse(src); if (isObj(j) && typeof j.alt === 'string') { const t = text(j.alt, { max: L.alt }); return t === NO ? '' : t; } } catch { /* cut short: read what it says */ }
      return altFrom(src, L);
    };
    for (let i = 0; i < lines.length; i++) {
      if (UI_OPEN.test(lines[i])) {
        const body = [];
        let j = i + 1;
        while (j < lines.length && !UI_CLOSE.test(lines[j])) body.push(lines[j++]);
        const closed = j < lines.length;
        const src = body.join('\n');
        flush();
        if (!closed) parts.push(done ? code(src, 'unclosed') : { drawing: true });
        else if (++fences > L.fences) parts.push(code(src, 'too-many-fences'));
        else {
          const r = validate(src);
          parts.push(r.ok ? { view: { alt: r.alt, root: r.root } } : code(src, r.refused, r.alt));
        }
        i = j;
        continue;
      }
      md.push(lines[i]);
      const other = FENCE.exec(lines[i]);
      if (other) {
        // Another code block: text, up to its own closing line (a fence of at least as many marks).
        const close = new RegExp(`^\\s*${other[1].charAt(0) === '`' ? '`' : '~'}{${other[1].length},}\\s*$`);
        for (i++; i < lines.length; i++) { md.push(lines[i]); if (close.test(lines[i])) break; }
      }
    }
    flush();
    return parts;
  }

  return { validate, split, catalog };
}

const api = { of };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.AnswerView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

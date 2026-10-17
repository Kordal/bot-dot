// The web page's stylesheet as a browser reads it, for tests that ask what an element ends up with: every rule
// that matches the element, and of those the declaration that wins, by `!important`, then specificity, then
// order. It knows the selectors public/style.css uses around its cards and stops at a part of one it does not
// know. A rule inside @media counts as if its condition held.
// An element is known with the ancestors a test hands in, and with no others: a rule that needs an ancestor
// further out matches nothing here. `subjectMatches` is for the test that must rule such a rule out.

// [{ selector, decls: { property: { value, important } }, order }], one entry per selector of a rule.
function rulesOf(css) {
  const out = [];
  const read = (text) => {
    for (let i = 0; i < text.length;) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      let close = open, depth = 1;
      while (depth && ++close < text.length) depth += text[close] === '{' ? 1 : text[close] === '}' ? -1 : 0;
      const head = text.slice(i, open).trim(), body = text.slice(open + 1, close);
      i = close + 1;
      if (/^@(media|supports)\b/.test(head)) { read(body); continue; }
      if (head.startsWith('@')) continue; // @keyframes, @font-face: no rule for an element
      const decls = {};
      for (const d of body.split(';')) {
        const at = d.indexOf(':');
        if (at > 0) decls[d.slice(0, at).trim()] = { value: d.slice(at + 1).replace(/!important\s*$/, '').trim(), important: /!important\s*$/.test(d) };
      }
      for (const selector of head.split(/,(?![^(]*\))/)) out.push({ selector: selector.trim(), decls, order: out.length });
    }
  };
  read(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}

// A selector as its compounds, left to right, each with the combinator that stands before it.
function compounds(selector) {
  const parts = [];
  const re = /\s*([>~+])\s*|\s+|((?:\((?:[^()]|\([^()]*\))*\)|[^\s>~+(])+)/g;
  let comb = null;
  for (const m of selector.trim().matchAll(re)) {
    if (m[2]) { parts.push({ comb: parts.length ? comb || ' ' : null, simples: simplesOf(m[2]) }); comb = null; }
    else if (m[1]) comb = m[1];
  }
  return parts;
}
const simplesOf = (compound) => [...compound.matchAll(/\*|^[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?/g)].map((m) => m[0]);

// an+b of :nth-child, for the 1-based place of a child.
function nth(formula, index) {
  const f = formula.replace(/\s+/g, '');
  if (f === 'odd') return index % 2 === 1;
  if (f === 'even') return index % 2 === 0;
  const m = f.match(/^([+-]?\d*)n([+-]\d+)?$/);
  if (!m) return Number(f) === index;
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1]), b = Number(m[2] || 0);
  return a === 0 ? index === b : (index - b) / a >= 0 && (index - b) % a === 0;
}

// An element: { tag, classes: [...], index (its place among its parent's children, from 1), before: [the
// siblings before it], attrs: { name: value } }. It is at rest: not hovered, not focused, and it has content.
const AT_REST = /^:(hover|focus|focus-visible|focus-within|active|disabled|checked|empty|placeholder-shown|target)$/;
function compoundMatches(el, simples, selector) {
  const unknown = [];
  for (const s of simples) {
    let ok;
    if (s === '*') ok = true;
    else if (/^[a-zA-Z]/.test(s)) ok = el.tag === s.toLowerCase();
    else if (s[0] === '.') ok = el.classes.includes(s.slice(1));
    else if (s[0] === '#') ok = el.id === s.slice(1);
    else if (s[0] === '[') { const [, name, , value] = s.match(/^\[([\w-]+)(=["']?([^"'\]]*)["']?)?\]$/) || []; if (!name) { unknown.push(s); continue; } ok = name in (el.attrs || {}) && (value === undefined || el.attrs[name] === value); }
    else if (s.startsWith('::') || /^:(before|after)$/.test(s)) ok = false; // a part of the element, not the element
    else if (s.startsWith(':not(')) ok = !compoundMatches(el, simplesOf(s.slice(5, -1)), selector);
    else if (s.startsWith(':nth-child(')) ok = nth(s.slice(11, -1), el.index);
    else if (s === ':first-child') ok = el.index === 1;
    else if (AT_REST.test(s)) ok = false;
    else { unknown.push(s); continue; }
    if (!ok) return false;
  }
  if (unknown.length) throw new Error(`test/css-rules.js does not know ${unknown.join(' ')} in "${selector}"`);
  return true;
}

// Whether the selector matches the last element of `chain`, the element with its ancestors, outermost first.
function matches(chain, selector) {
  const parts = compounds(selector);
  const at = (path, j) => {
    const el = path.at(-1);
    if (!compoundMatches(el, parts[j].simples, selector)) return false;
    if (j === 0) return true;
    const comb = parts[j].comb, above = path.slice(0, -1), before = el.before || [];
    if (comb === '>') return above.length > 0 && at(above, j - 1);
    if (comb === ' ') return above.some((_, n) => at(above.slice(0, n + 1), j - 1));
    if (comb === '+') return before.length > 0 && at([...above, { ...before.at(-1), before: before.slice(0, -1) }], j - 1);
    return before.some((s, n) => at([...above, { ...s, before: before.slice(0, n) }], j - 1));
  };
  return parts.length > 0 && at(chain, parts.length - 1);
}

// Whether the selector's last part matches the last element of `chain`, whatever stands around it.
const subjectMatches = (chain, selector) => { const parts = compounds(selector); return parts.length > 0 && compoundMatches(chain.at(-1), parts.at(-1).simples, selector); };

// [ids, classes and the like, tags]: :not() counts as what it holds, a pseudo-class as a class.
function specificity(selector) {
  const count = (simples) => simples.reduce((sum, s) => {
    if (s === '*') return sum;
    if (s.startsWith(':not(')) return count(simplesOf(s.slice(5, -1))).map((n, i) => n + sum[i]);
    const i = s[0] === '#' ? 0 : s[0] === '.' || s[0] === '[' || (s[0] === ':' && s[1] !== ':') ? 1 : 2;
    return sum.map((n, k) => n + (k === i ? 1 : 0));
  }, [0, 0, 0]);
  return count(compounds(selector).flatMap((p) => p.simples));
}

// What the element ends up with for `property`: { value, selector } of the declaration that wins, or null.
function winner(rules, chain, property) {
  const found = rules.filter((r) => property in r.decls && matches(chain, r.selector)).map((r) => ({ ...r.decls[property], selector: r.selector, order: r.order, spec: specificity(r.selector) }));
  found.sort((a, b) => (a.important - b.important) || a.spec[0] - b.spec[0] || a.spec[1] - b.spec[1] || a.spec[2] - b.spec[2] || a.order - b.order);
  const last = found.at(-1);
  return last ? { value: last.value, selector: last.selector } : null;
}

// The rules of `css` that hold in a window `wide` px wide, around a list `side` px wide: a rule inside @media holds
// only where its width condition does, and the list's own rules (@container side) where the list's width does.
function rulesAt(css, wide, side = 300) {
  const holds = (cond, w) => [...cond.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)].every(([, m, n]) => (m === 'min' ? w >= Number(n) : w <= Number(n)));
  let out = '';
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@container side \(max-width: (\d+)px\)/g, (_, n) => `@media (list-max: ${n})`);
  for (let i = 0; i < text.length;) {
    const at = text.indexOf('@media', i);
    if (at < 0) { out += text.slice(i); break; }
    out += text.slice(i, at);
    const open = text.indexOf('{', at);
    let close = open, depth = 1;
    while (depth && ++close < text.length) depth += text[close] === '{' ? 1 : text[close] === '}' ? -1 : 0;
    const cond = text.slice(at + 6, open);
    const list = cond.match(/list-max: (\d+)/);
    if (list ? side <= Number(list[1]) : /width/.test(cond) && holds(cond, wide)) out += text.slice(open + 1, close);
    i = close + 1;
  }
  return rulesOf(out);
}

module.exports = { rulesOf, rulesAt, matches, subjectMatches, specificity, winner };

// Answer views as text (#1624, ADR 264): what a reply says once its ```ui fences are not drawn. A notification, a push and a
// preview read the fence's `alt`; Copy and export (a document's Word, PDF and Markdown files) read the alt and then the view
// written out as Markdown, a table as a Markdown table, a chart as the table its Data toggle shows. It reads the tree the
// validator returns (public/answer-view.js), so it draws nothing and trusts nothing. The page loads this file as a plain
// <script> (window.AnswerText), Node as a module (the server's push, lib/answer-text.js).
//
//   const text = AnswerText.of(view, { tr });   view: AnswerView.of(catalog); tr: the page's words (optional)
//   text.alt(reply, { done })    a reply with each fence replaced by its alt (a fence with none is left out)
//   text.text(reply, { done })   a reply with each fence replaced by its alt and the view as Markdown
//   text.tree(root)              one view's tree as Markdown
//   text.data(node)              the numbers of a chart as { head, rows } of texts, or null: the Data toggle's table
//   text.fields(root)            the inputs of a view in order: [{ path, node }], a node's path counted from "0" (children "0.0", "0.1", …)
//   text.form(root, values)      what a form posts (ADR 265): each input's label and its value, one per line; values: path -> what the owner set
//   text.buttons(root)           the buttons of a view: [{ path, node }]
//   text.press(button)           what a button posts: its `send` (200 characters at most), else its label
//   text.shows(button)           what the page writes on it for the owner to read: that, when it is not the label
//   text.start(node, raw)        what an input holds as the page shows it (what the owner set, else the bot's, kept to what the input allows)
//   text.ends(node)              the ends of a slider or a range: [min, max], the bot's else 0 and 100

(function (root) {

const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(s));

const round = (n) => String(Math.round(n * 100) / 100);
const num = (v) => (Number.isFinite(v) ? round(v) : '');
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const table = (head, rows) => [`| ${head.map(cell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const fenced = (text, lang) => {
  const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang || ''}\n${text}\n${fence}`;
};
const quoted = (s) => String(s).split('\n').map((l) => `> ${l}`).join('\n');

// How many of a histogram's values fall in each of its bins: [{ from, to, count }], the last bin closed at the top.
function bins(values, wanted) {
  if (!values.length) return [];
  const lo = Math.min(...values), hi = Math.max(...values);
  const n = hi === lo ? 1 : Math.max(1, wanted || 10);
  const width = (hi - lo) / n;
  const out = Array.from({ length: n }, (_, i) => ({ from: lo + i * width, to: i === n - 1 ? hi : lo + (i + 1) * width, count: 0 }));
  for (const v of values) out[hi === lo ? 0 : Math.min(Math.floor((v - lo) / width), n - 1)].count++;
  return out;
}

// The inputs of the catalog (wave 2): the components a form is made of.
const INPUTS = ['text-input', 'textarea', 'number', 'slider', 'range', 'select', 'multi-select', 'radio', 'checkbox', 'toggle', 'date', 'time', 'rating', 'segmented'];
const SEND_MAX = 200; // what a button posts, at most (the catalog's own limit)
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const finite = (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const within = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// A text of one line: its lines are joined with " / ", its spaces collapsed.
const oneLine = (v) => String(v ?? '').split(/\r\n?|\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
// The ends of a slider or a range: the bot's, else 0 and 100.
const ends = (n) => { const lo = finite(n.min) ?? 0, hi = finite(n.max) ?? 100; return hi > lo ? [lo, hi] : [0, 100]; };
const cutText = (s, n) => { const t = String(s).slice(0, n); return /[\uD800-\uDBFF]/.test(t.charAt(t.length - 1)) ? t.slice(0, -1) : t; };

// A view's nodes with the path of each, as the page counts them: the root is "0", its children "0.0", "0.1", ….
function walk(root, kind) {
  const out = [];
  const go = (n, path) => {
    if (kind(n)) out.push({ path, node: n });
    (n.children || []).forEach((c, i) => go(c, `${path}.${i}`));
  };
  go(root, '0');
  return out;
}

function of(view, opts) {
  // The page's words when it has them (tr, i18n.js, passed in); English otherwise (the server).
  const tr = (opts && opts.tr) || fill;

  // What one input holds, as the page shows it and the form posts it: what the owner set (`raw`, as the page reads it from the
  // input), else what the bot set, kept to what the input allows. A text, a number (null for none), a pair for a range, a list for
  // a multi-select, a boolean, a grade; '' (or null) for an input with nothing.
  function start(n, raw) {
    const set = raw !== undefined && raw !== null;
    const option = (v) => (n.options || []).includes(v);
    switch (n.type) {
      case 'text-input': case 'textarea': return String(set ? raw : n.value ?? '');
      case 'number': {
        let v = finite(set ? raw : n.value);
        if (v === null) return null;
        if (finite(n.min) !== null) v = Math.max(v, finite(n.min));
        if (finite(n.max) !== null) v = Math.min(v, finite(n.max));
        return v;
      }
      case 'slider': { const [lo, hi] = ends(n); return within(finite(set ? raw : n.value) ?? lo, lo, hi); }
      case 'range': {
        const [lo, hi] = ends(n);
        const pair = Array.isArray(raw) ? raw : [n.low, n.high];
        return [within(finite(pair[0]) ?? lo, lo, hi), within(finite(pair[1]) ?? hi, lo, hi)].sort((x, y) => x - y);
      }
      case 'select': case 'radio': case 'segmented': return raw === '' ? '' : option(raw) ? raw : option(n.value) ? n.value : '';
      case 'multi-select': { const picked = Array.isArray(raw) ? raw : n.values || []; return (n.options || []).filter((o, i, all) => picked.includes(o) && all.indexOf(o) === i); }
      case 'checkbox': case 'toggle': return typeof raw === 'boolean' ? raw : !!(n.type === 'checkbox' ? n.checked : n.on);
      case 'date': {
        const v = typeof raw === 'string' ? raw : n.value;
        if (typeof v !== 'string' || !DATE.test(v)) return '';
        return DATE.test(n.min || '') && v < n.min ? n.min : DATE.test(n.max || '') && v > n.max ? n.max : v;
      }
      case 'time': { const v = typeof raw === 'string' ? raw : n.value; return typeof v === 'string' && TIME.test(v) ? v : ''; }
      case 'rating': return Math.round(within(finite(set ? raw : n.value) ?? 0, 0, Math.round(within(finite(n.max) ?? 5, 3, 10))));
      default: return '';
    }
  }
  // An input's value as the form's line says it; '' for an input with nothing.
  function valueOf(n, raw) {
    const v = start(n, raw);
    const unit = n.unit ? ` ${n.unit}` : '';
    switch (n.type) {
      case 'text-input': case 'textarea': return oneLine(v);
      case 'number': return v === null ? '' : `${round(v)}${unit}`;
      case 'slider': return `${round(v)}${unit}`;
      case 'range': return `${tr('{from} to {to}', { from: round(v[0]), to: round(v[1]) })}${unit}`;
      case 'multi-select': return v.join(', ');
      case 'checkbox': case 'toggle': return v ? tr('yes') : tr('no');
      case 'rating': return v > 0 ? `${v}/${Math.round(within(finite(n.max) ?? 5, 3, 10))}` : '';
      default: return v;
    }
  }
  const fields = (root) => walk(root, (n) => INPUTS.includes(n.type));
  const buttons = (root) => walk(root, (n) => n.type === 'button');
  // A form's message: "Budget: 500", one input to a line, a dash for what is empty. '' for a view with no input.
  const form = (root, values) => fields(root).map(({ path, node }) => `${node.label}: ${valueOf(node, values ? values[path] : undefined) || '–'}`).join('\n');
  const press = (n) => cutText((typeof n.send === 'string' ? n.send.trim() : '') || n.label, SEND_MAX);
  // What the owner reads on a button before pressing it: what it posts when that is not its label, else ''. Never in a tooltip alone
  // (a touch screen and the keyboard show none): the owner sees exactly what is sent.
  const shows = (n) => { const t = press(n); return t === n.label ? '' : t; };

  // The numbers of a chart as a table of texts: its head and its rows. null for a node that is no chart.
  function data(n) {
    const unit = n.unit ? ` ${n.unit}` : '';
    switch (n.type) {
      case 'chart': {
        const series = n.series || [];
        const len = Math.max(...series.map((s) => s.points.length), 0);
        return {
          head: ['', ...series.map((s, i) => s.label || (series.length > 1 ? tr('Series {n}', { n: i + 1 }) : tr('Value')))],
          rows: Array.from({ length: len }, (_, i) => [n.labels?.[i] ?? String(i + 1), ...series.map((s) => (Number.isFinite(s.points[i]) ? `${num(s.points[i])}${unit}` : ''))]),
        };
      }
      case 'pie': {
        const total = (n.slices || []).reduce((a, s) => a + s.value, 0);
        return { head: ['', tr('Value'), '%'], rows: (n.slices || []).map((s) => [s.label, `${num(s.value)}${unit}`, total ? `${round((s.value / total) * 100)}%` : '']) };
      }
      case 'scatter': {
        const series = n.series || [];
        return {
          head: [series.length > 1 ? tr('Series') : '', n.xLabel || 'x', n.yLabel || 'y'],
          rows: series.flatMap((s, i) => s.points.map((p) => [series.length > 1 ? s.label || tr('Series {n}', { n: i + 1 }) : '', num(p.x), num(p.y)])),
        };
      }
      case 'histogram':
        return { head: [tr('Range'), tr('Count')], rows: bins(n.values || [], n.bins).map((b) => [tr('{from} to {to}', { from: num(b.from), to: num(b.to) }) + unit, String(b.count)]) };
      case 'sparkline':
        return { head: ['', n.label || tr('Value')], rows: (n.points || []).map((v, i) => [String(i + 1), num(v)]) };
      case 'gauge':
        return { head: [n.label || tr('Value'), tr('Min'), tr('Max')], rows: [[`${num(n.value)}${n.unit ? ` ${n.unit}` : ''}`, num(n.min ?? 0), num(n.max ?? 100)]] };
      default: return null;
    }
  }


  const source = (n) => (n.source ? `*${tr('Source: {source}', { source: n.source })}*` : '');
  const join = (parts) => parts.filter(Boolean).join('\n\n');
  const kids = (n) => join((n.children || []).map(tree));

  // One node as Markdown; '' for what has no words (a spacer, an unknown component).
  function tree(n) {
    switch (n.type) {
      case 'stack': case 'row': case 'grid': case 'stat-row': return kids(n);
      case 'card': return join([n.title ? `**${n.title}**` : '', kids(n)]);
      case 'section': return join([`### ${n.title}`, n.lead || '', kids(n)]);
      case 'tabs': return kids(n);
      case 'tab': return join([`**${n.label}**`, kids(n)]);
      case 'accordion': return kids(n);
      case 'panel': return join([`**${n.title}**`, kids(n)]);
      case 'divider': return n.label ? `--- ${n.label} ---` : '---';
      case 'heading': return `${'#'.repeat(Math.min(Math.max(n.level || 2, 1), 3))} ${n.text}`;
      case 'text': return n.text;
      case 'list': return n.items.map((x, i) => `${n.ordered ? `${i + 1}.` : '-'} ${x}`).join('\n');
      case 'quote': return `${quoted(n.text)}${n.by ? `\n>\n> ${n.by}` : ''}`;
      case 'code': return fenced(n.text, n.lang);
      case 'badge': case 'status': return `**${n.text}**`;
      case 'key-value': return join([n.title ? `**${n.title}**` : '', n.items.map((x) => `- **${x.key}:** ${x.value}`).join('\n')]);
      case 'steps': return n.items.map((x, i) => `${i + 1}. ${x.title}${x.text ? `: ${x.text}` : ''}${x.state && x.state !== 'todo' ? ` (${x.state === 'done' ? tr('Done') : tr('Current')})` : ''}`).join('\n');
      case 'hero': return join([n.eyebrow ? `*${n.eyebrow}*` : '', `# ${n.title}`, n.lead || '', (n.tags || []).join(', ')]);
      case 'kpi': return join([`**${n.label}:** ${n.value}${n.unit ? ` ${n.unit}` : ''}${n.of ? ` / ${n.of}` : ''}${n.sub ? `. ${n.sub}` : ''}`, source(n)]);
      case 'progress': return `**${n.label}:** ${n.text || `${num(n.value)}%`}`;
      case 'table': return join([n.title ? `**${n.title}**` : '', table(n.columns.map((c) => c.label), n.rows.map((r) => n.columns.map((_, i) => r[i] ?? ''))), source(n)]);
      case 'timeline': return n.items.map((x) => `- ${x.when ? `**${x.when}** ` : ''}${x.title}${x.text ? `: ${x.text}` : ''}`).join('\n');
      case 'comparison':
        return join([n.title ? `**${n.title}**` : '', table(['', ...n.options.map((o, i) => (i === n.pick ? `${o} (${tr('Recommended')})` : o))], n.rows.map((r) => [r.label, ...n.options.map((_, i) => r.values[i] ?? '')]))]);
      case 'checklist': return join([n.title ? `**${n.title}**` : '', n.items.map((x) => `- [${x.done ? 'x' : ' '}] ${x.text}`).join('\n')]);
      case 'text-input': case 'textarea': case 'number': case 'slider': case 'range': case 'date': case 'time': case 'rating': return `**${n.label}:** ${valueOf(n)}`.trimEnd();
      case 'select': case 'multi-select': case 'radio': case 'segmented': return `**${n.label}:** ${valueOf(n)}${valueOf(n) ? ' ' : ''}(${tr('options: {list}', { list: n.options.join(', ') })})`;
      case 'checkbox': case 'toggle': return `- [${valueOf(n) === tr('yes') ? 'x' : ' '}] ${n.label}`;
      case 'button': return `[${n.label}]`;
      case 'button-group': return (n.children || []).map(tree).join(' ');
      case 'link': return `[${n.label}](${n.url})`;
      case 'copy': return join([`**${n.label}**`, fenced(n.text)]);
      case 'callout': return quoted(`${n.title ? `**${n.title}** ` : ''}${n.text}`);
      case 'chart': case 'pie': case 'scatter': case 'histogram': case 'sparkline': case 'gauge': {
        const d = data(n);
        const head = n.title || n.label ? `**${n.title || n.label}**` : '';
        return join([head, d && d.rows.length ? table(d.head, d.rows) : '', source(n)]);
      }
      case 'image': return join([`![${n.alt}](${n.src.kind === 'https' ? n.src.url : n.src.path})`, n.caption || '']);
      case 'gallery': return n.items.map((x) => `![${x.alt}](${x.src.kind === 'https' ? x.src.url : x.src.path})${x.caption ? ` ${x.caption}` : ''}`).join('\n');
      case 'video': return join([`[${tr('Video: {alt}', { alt: n.alt })}](${n.src.path})`, n.caption || '']);
      case 'audio': return `[${tr('Audio: {title}', { title: n.title })}](${n.src.path})`;
      case 'file': return `[${n.title || n.src.path.split('/').pop()}](${n.src.path})`;
      case 'link-card': return `[${n.title}](${n.url})${n.text ? `: ${n.text}` : ''}`;
      case 'products': return n.items.map((p) => `- ${p.url ? `[${p.name}](${p.url})` : p.name}${[p.price, p.store].filter(Boolean).length ? ` (${[p.price, p.store].filter(Boolean).join(', ')})` : ''}${p.why ? `: ${p.why}` : ''}`).join('\n');
      default: return '';
    }
  }

  const has = (reply) => /^\s*```ui\s*$/m.test(String(reply == null ? '' : reply));
  // A reply with each fence as `make` says: its text where it is text, and for a fence a view (its alt, its tree) or code (the
  // alt it had written, and why it was not drawn). '' parts are left out.
  function rewrite(reply, opts, make) {
    if (!has(reply)) return String(reply == null ? '' : reply);
    return view.split(reply, opts).map((p) => (p.text != null ? p.text : p.view ? make.view(p.view) : p.code != null ? make.code(p) : '')).filter(Boolean).join('\n\n');
  }
  const alt = (reply, opts) => rewrite(reply, opts, { view: (v) => v.alt, code: (c) => c.alt });
  const text = (reply, opts) => rewrite(reply, opts, { view: (v) => join([v.alt, tree(v.root)]), code: (c) => join([c.alt, fenced(c.code, 'ui')]) });

  return { alt, text, tree, data, has, fields, form, buttons, press, shows, start, ends };
}

const api = { of, bins };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.AnswerText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

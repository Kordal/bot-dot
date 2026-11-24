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

function of(view, opts) {
  // The page's words when it has them (tr, i18n.js, passed in); English otherwise (the server).
  const tr = (opts && opts.tr) || fill;

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

  return { alt, text, tree, data, has };
}

const api = { of, bins };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.AnswerText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

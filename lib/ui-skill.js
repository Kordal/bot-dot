// The component reference of the skill kit:ui (bot-skills/skills/ui/SKILL.md, #1625), written from the catalog
// (lib/ui-catalog.json, ADR 264) so that what a bot is told can't drift from what the validator reads: one line a
// component, its props with their kind, length and range, what it holds, and the limits and tones. The reference sits
// between two markers in SKILL.md; `node scripts/ui-skill.js` writes it there and test/kit-ui.test.js checks it is current.

const START = '<!-- ui-catalog:start (written by node scripts/ui-skill.js from lib/ui-catalog.json: do not edit by hand) -->';
const END = '<!-- ui-catalog:end -->';
const GROUPS = ['layout', 'text', 'data', 'charts', 'media', 'feedback', 'inputs', 'actions'];

const range = (s, unit = '') => (s.min !== undefined && s.max !== undefined ? `${s.min} to ${s.max}${unit}` : s.max !== undefined ? `at most ${s.max}${unit}` : s.min !== undefined ? `at least ${s.min}${unit}` : '');

// What a prop holds, in a few words: `text, at most 80 characters`, `s | m | l`, `list of ... (1 to 12)`.
function kind(s) {
  switch (s.type) {
    case 'string': return `text${s.max ? ` ≤ ${s.max}` : ''}${s.multiline ? ', lines kept' : ''}${s.empty ? ', may be empty' : ''}`;
    case 'number': return `number${range(s) ? ` ${range(s)}` : ''}${s.nullable ? ', null for a gap' : ''}`;
    case 'int': return `whole number${range(s) ? ` ${range(s)}` : ''}`;
    case 'boolean': return 'true or false';
    case 'enum': return s.values.join(' | ');
    case 'tone': return 'tone';
    case 'https': return 'https address';
    case 'media': return `${s.from.map((f) => (f === 'file' ? 'a path among your files' : 'an https address of a picture')).join(' or ')}${s.exts ? ` (${s.exts.join(', ')})` : ''}`;
    case 'list': return `list${s.of ? ` of ${kind(s.of)}` : ''}${range(s) ? ` (${range(s)} items)` : ''}`;
    case 'object': return `{ ${Object.entries(s.props).map(([k, p]) => prop(k, p)).join(', ')} }`;
    default: return s.type;
  }
}

function prop(name, s) {
  return `\`${name}\` ${kind(s)}${s.required ? ' (needed)' : ''}${s.default !== undefined ? ` (default ${s.default})` : ''}`;
}

function line(name, c) {
  const props = Object.entries(c.props || {});
  const kids = c.children ? `Holds ${c.children.only ? `${c.children.only.map((k) => `\`${k}\``).join(', ')}, ` : 'any components, '}${c.children.max ? `at most ${c.children.max}` : 'any number'}` : '';
  const parts = [
    props.length ? `Props: ${props.map(([k, s]) => prop(k, s)).join('; ')}` : 'No props',
    kids,
    c.in ? `Only inside ${c.in.map((k) => `\`${k}\``).join(', ')}` : '',
    c.sourced ? 'Give it a `source`' : '',
  ].filter(Boolean);
  return `- \`${name}\` — ${c.means} ${parts.join('. ')}.`;
}

// The reference as Markdown: the limits and tones, then one list of components a group.
function reference(catalog) {
  const L = catalog.limits;
  const out = [
    `Catalog version ${catalog.version}. A component is \`{ "type": "<name>", …its props, "children": [ … ] }\`. A prop not marked (needed) is optional; a text is cut to its length, never refused.`,
    '',
    `**Limits.** At most ${L.fences} \`ui\` fences in a reply, ${L.nodes} components in a fence, nesting ${L.depth} deep (the root is 1), ${L.points} points in one chart (all its series together), ${Math.round(L.bytes / 1024)} KB for a fence, and an \`alt\` of at most ${L.alt} characters. Past one of these the whole fence is drawn as code.`,
    '',
    `**Tones.** ${catalog.tones.map((t) => `\`${t}\``).join(', ')}.`,
  ];
  const groups = [...new Set([...GROUPS, ...Object.values(catalog.components).map((c) => c.group)])];
  for (const g of groups) {
    const names = Object.keys(catalog.components).filter((n) => catalog.components[n].group === g);
    if (!names.length) continue;
    out.push('', `### ${g[0].toUpperCase()}${g.slice(1)}`, '', ...names.map((n) => line(n, catalog.components[n])));
  }
  return out.join('\n');
}

// A SKILL.md text with its reference (between the markers) made again from the catalog. A text without both markers
// is returned as it is.
function withReference(text, catalog) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < a) return text;
  return `${text.slice(0, a + START.length)}\n\n${reference(catalog)}\n\n${text.slice(b)}`;
}

module.exports = { reference, withReference, kind, START, END };

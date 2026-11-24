// The skill kit:ui (#1625, ADR 264): how a bot or the Chief draws an answer view, a chart, a table or another
// component of the catalog in a ```ui fence, only when it is clearer than text. It ships in bot-skills/ beside
// kit:shopping, so every bot is told of it in one line and loads the catalog and the rules only when it picks it. The
// component reference in it is generated from lib/ui-catalog.json (lib/ui-skill.js, scripts/ui-skill.js), so that it
// can't drift from what the validator reads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSkillMd, kitSkills, kitStyleNote, KIT_DIR } = require('../lib/skills');
const uiSkill = require('../lib/ui-skill');
const catalog = require('../lib/ui-catalog.json');
const AnswerView = require('../public/answer-view');

const FILE = path.join(KIT_DIR, 'skills', 'ui', 'SKILL.md');
const text = fs.readFileSync(FILE, 'utf8');
const view = AnswerView.of(catalog);
const fences = (md) => [...md.matchAll(/^```ui\n([\s\S]*?)\n```$/gm)].map((m) => m[1]);

test('kit:ui says in one short line when to use it, and the line is the only thing every bot is told', () => {
  const { meta, body } = parseSkillMd(text);
  assert.equal(meta.name, 'ui');
  assert.ok(!/\n/.test(meta.description) && meta.description.length <= 200, 'one line');
  assert.match(meta.description, /chart/);
  assert.match(meta.description, /table/);
  assert.match(meta.description, /clearer than text/);
  assert.match(body, /^# /m);
  // It is not an always-on skill: its rules are not in the prompt, only its one line in the list of skills.
  assert.notEqual(String(meta['disable-model-invocation']), 'true');
  const ui = kitSkills().find((k) => k.name === 'ui');
  assert.ok(ui && !ui.alwaysOn);
  assert.equal(kitStyleNote(kitSkills()), kitStyleNote(kitSkills(['ui'])), 'the style note, the always-on text, does not grow');
});

test('with kit:ui the list of skills a bot is told grows by that one line, which the Chief is told too', () => {
  const lineOf = (k) => `- kit:${k.name}: ${k.description.replace(/\s+/g, ' ').slice(0, 300)}`;
  const listed = (off) => kitSkills(off).filter((k) => !k.alwaysOn).map(lineOf);
  const before = listed(['ui']);
  const after = listed([]);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.filter((l) => !before.includes(l)), [lineOf(kitSkills().find((k) => k.name === 'ui'))]);
  // The Chief lists the kit's skills the same way (lib/chief.js, chiefSkills).
  const { chiefSkills } = require('../lib/chief');
  assert.ok(chiefSkills().includes(`- kit:ui: ${kitSkills().find((k) => k.name === 'ui').description}`));
});

test('kit:ui can be switched off for one bot, by its name or its full name, like the other kit skills', () => {
  assert.ok(!kitSkills(['ui']).some((k) => k.name === 'ui'));
  assert.ok(!kitSkills(['kit:ui']).some((k) => k.name === 'ui'));
  assert.ok(kitSkills(['kit:pages']).some((k) => k.name === 'ui'), 'another one off leaves it on');
  const skills = require('../lib/skills').create(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-pack-')));
  const dir = skills.kitPack('run2', ['kit:ui']);
  assert.ok(!fs.readdirSync(path.join(dir, 'skills')).includes('ui'));
  assert.ok(fs.readdirSync(path.join(skills.kitPack('run3', ['kit:pages']), 'skills')).includes('ui'));
  skills.removePack('run2');
  skills.removePack('run3');
});

test('its component reference is the catalog, generated: every component, prop, limit and tone, and no more', () => {
  // The file on disk is what the generator makes of the catalog now (node scripts/ui-skill.js writes it).
  assert.equal(text, uiSkill.withReference(text, catalog), 'run node scripts/ui-skill.js: lib/ui-catalog.json changed');
  const ref = uiSkill.reference(catalog);
  for (const [name, c] of Object.entries(catalog.components)) {
    assert.match(ref, new RegExp(`^- \`${name}\` `, 'm'), `${name} is in the reference`);
    for (const prop of Object.keys(c.props)) assert.ok(ref.split('\n').find((l) => l.startsWith(`- \`${name}\` `)).includes(`\`${prop}\``), `${name}.${prop}`);
  }
  assert.equal([...ref.matchAll(/^- `/gm)].length, Object.keys(catalog.components).length, 'one line a component');
  for (const t of catalog.tones) assert.ok(ref.includes(t), t);
  for (const [k, v] of Object.entries(catalog.limits)) assert.ok(ref.includes(k === 'bytes' ? `${v / 1024} KB` : String(v)), `limit ${k}: ${v}`);
  // A catalog that gains a component or changes a length changes the reference.
  const more = { ...catalog, components: { ...catalog.components, gadget: { group: 'data', since: 2, means: 'A thing.', props: { label: { type: 'string', max: 33, required: true } } } } };
  assert.match(uiSkill.reference(more), /^- `gadget` .*`label`/m);
  assert.notEqual(uiSkill.withReference(text, more), text);
  // A text with no markers is left alone, never filled in by guesswork.
  assert.equal(uiSkill.withReference('# no markers\n', catalog), '# no markers\n');
});

test('what the skill says in words is what the catalog and the validator hold', () => {
  const { body } = parseSkillMd(text);
  const prose = body.slice(0, body.indexOf(uiSkill.START));
  assert.ok(prose.length > 500);
  // Prose is the default; the view is for what is clearer than text.
  assert.match(prose, /prose is the default/i);
  assert.match(prose, /one-line fact|a one-line fact/i);
  // The fence's format, with its required alt and root.
  assert.match(prose, /```ui/);
  assert.match(prose, /`alt`/);
  assert.match(prose, /`root`/);
  // Source is required on data; a bot sets tones, not colours; media rules; a view never approves; inputs and buttons send back as the owner's own message.
  assert.match(prose, /`source`/);
  assert.match(prose, /No source/);
  for (const t of catalog.tones) assert.ok(prose.includes(`\`${t}\``) || prose.includes(t), t);
  assert.match(prose, /never a colour|no colour|not a colour/i);
  assert.match(prose, /your own files|your files/i);
  assert.match(prose, /never approves|can't approve/i);
  assert.match(prose, /inputs|forms/i);
  assert.doesNotMatch(prose, /not in the catalog yet/i, 'inputs are in the catalog now');
  // The limits are said once, in the generated part, so that they can't drift: the prose points to them and copies no number.
  assert.match(prose, /limits are in the reference below/i);
  for (const v of [catalog.limits.nodes, catalog.limits.points, `${catalog.limits.bytes / 1024} KB`]) assert.ok(!new RegExp(`(^|[^\\d€,.])${v}(?![\\d,.]\\d)`).test(prose), `${v} is not written by hand`);
  assert.match(prose, /Give it a `source`|marked/i);
});

test('its good examples are views the validator reads whole; its bad ones are named, not copied', () => {
  const good = fences(text);
  assert.ok(good.length >= 3, 'a few good examples');
  const kinds = new Set();
  for (const f of good) {
    const r = view.validate(f);
    assert.equal(r.ok, true, f.slice(0, 80));
    assert.deepEqual(r.problems, [], `no problem in: ${f.slice(0, 60)}`);
    assert.ok(r.alt, 'an alt');
    const walk = (n) => { kinds.add(n.type); assert.ok(!n.noSource, `${n.type} has its source`); (n.children || []).forEach(walk); };
    walk(r.root);
  }
  for (const k of ['comparison', 'chart', 'table']) assert.ok(kinds.has(k), `an example with a ${k}`);
  // The same replies, read as a whole, hold their views (prose beside them).
  const { body } = parseSkillMd(text);
  assert.match(body, /\bDon't\b|\bnot\b/i);
  assert.ok(/## Bad|## Don't|Not like this/i.test(body), 'a section of bad examples');
});

test('every component it names as wave 1 is in the catalog, and none of the later waves is promised', () => {
  const { body } = parseSkillMd(text);
  const named = new Set([...body.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]));
  for (const name of ['chart', 'table', 'comparison', 'kpi', 'stat-row', 'timeline', 'image']) assert.ok(named.has(name) && catalog.components[name], name);
  for (const [name, c] of Object.entries(catalog.components)) assert.ok(c.since <= catalog.version, name);
});

test('its section on inputs and send-back says what a form posts, that a button\'s send is shown, and what it never does', () => {
  const { body } = parseSkillMd(text);
  const prose = body.slice(0, body.indexOf(uiSkill.START));
  const at = prose.indexOf('## Asking for input');
  assert.ok(at > 0, 'a section of its own');
  const section = prose.slice(at, prose.indexOf('\n## ', at + 4) > 0 ? prose.indexOf('\n## ', at + 4) : undefined);
  assert.ok(section.length < 2600, 'short');
  // the input components and the actions are named, and they are in the catalog
  for (const name of ['text-input', 'select', 'number', 'button']) assert.ok(section.includes(`\`${name}\``) && catalog.components[name], name);
  // One Send under a form, drawn by the page; the owner's message is "Label: value" lines, so labels are questions a bot can find again.
  assert.match(section, /one Send/i);
  assert.match(section, /Label: value|Budget: 500/);
  assert.match(section, /`label`/);
  // A button's `send` is shown to the owner under the button, and what it sends is the owner's message in their name.
  assert.match(section, /`send`/);
  assert.match(section, /shown|visible|reads it/i);
  assert.match(section, /owner's own message|owner's own words|as the owner's/i);
  // Never an approval: no `Approved. Go ahead.`, no `Build it.`; those cards are in Needs you.
  assert.match(section, /Approved\. Go ahead\./);
  assert.match(section, /Needs you/);
  // Only the newest message's view can be answered, once.
  assert.match(section, /newest/i);
  assert.match(section, /once/i);
  // Its example form is a view the validator reads whole, with inputs in it.
  const form = fences(text).map((f) => view.validate(f)).find((r) => r.ok && JSON.stringify(r.root).includes('"text-input"'));
  assert.ok(form, 'an example with inputs');
  assert.deepEqual(form.problems, []);
  // The old line that said there are no buttons is gone.
  assert.doesNotMatch(prose, /There are no buttons here/);
  // The reference lists the wave 2 components.
  const ref = uiSkill.reference(catalog);
  for (const name of ['text-input', 'textarea', 'number', 'slider', 'range', 'select', 'multi-select', 'radio', 'checkbox', 'toggle', 'date', 'time', 'rating', 'segmented', 'button', 'button-group', 'link', 'copy']) assert.match(ref, new RegExp(`^- \`${name}\` `, 'm'), name);
  assert.match(ref, /Catalog version 3\./);
  // and the long tail of wave 3
  for (const name of ['tree', 'calendar', 'kanban', 'heatmap', 'alert', 'empty-state', 'countdown', 'poll', 'quiz']) assert.match(ref, new RegExp(`^- \`${name}\``, 'm'), name);
});

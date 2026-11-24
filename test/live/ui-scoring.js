// How the eval of answer views (ui-eval.test.js) scores a case. Nothing here starts a server or a Claude, so that
// npm test can check the rules: test/ui-eval-scoring.test.js.
//
// The score is read off what the bot did and wrote, never off a model's opinion: whether its run loaded kit:ui with
// the Skill tool (from the run's events), and every ```ui fence of its reply, read by the very validator the apps
// use (public/answer-view.js with lib/ui-catalog.json). A prompt where a view is right (`view: true`) should have the
// skill picked and a valid view that fits it; one where prose is right (`view: false`) should have neither the skill
// nor a fence; one marked `view: 'either'` (for a wave not drawn yet) is not scored on the pick, and a fence
// written there must still be valid.

const catalog = require('../../lib/ui-catalog.json');
const AnswerView = require('../../public/answer-view');

const view = AnswerView.of(catalog);

// ---------- the skill ----------

// Whether a run loaded the skill: a Skill tool call naming kit:ui. events: the run's stream events (GET /api/runs/:id).
function skillPicked(events) {
  for (const e of events || []) {
    if (e?.type !== 'assistant') continue;
    for (const c of e.message?.content || []) if (c?.type === 'tool_use' && c.name === 'Skill' && /^(kit:)?ui$/.test(String(c.input?.skill || '').trim())) return true;
  }
  return false;
}

// ---------- the fences ----------

const UI_OPEN = /^\s*```ui\s*$/;
const UI_CLOSE = /^\s*```\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

// The text of each ```ui fence of a reply, in order, found as the validator's split finds them (another code block is text).
function sourcesOf(reply) {
  const lines = String(reply || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (UI_OPEN.test(lines[i])) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && !UI_CLOSE.test(lines[j])) body.push(lines[j++]);
      out.push(body.join('\n'));
      i = j;
      continue;
    }
    const other = FENCE.exec(lines[i]);
    if (other) {
      const close = new RegExp(`^\\s*${other[1].charAt(0) === '`' ? '`' : '~'}{${other[1].length},}\\s*$`);
      for (i++; i < lines.length; i++) if (close.test(lines[i])) break;
    }
  }
  return out;
}

const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.children || []).forEach((c) => walk(c, f)); };

// A reply read by the validator: its text beside the views, and each ui fence, in order:
// { drawn, refused?, alt, problems: [{ at, code, prop? }], types: [the components drawn], noSource }.
function fencesOf(reply) {
  const parts = view.split(reply, { done: true });
  const sources = sourcesOf(reply);
  const drawn = parts.filter((p) => p.view || p.code !== undefined);
  // Two readers of one reply must agree on its fences; if they ever don't, say so rather than score without looking.
  if (sources.length !== drawn.length) throw new Error(`ui-scoring: the validator split found ${drawn.length} ui fences and the scan ${sources.length}`);
  const text = parts.filter((p) => p.text).map((p) => p.text).join('\n').trim();
  const fences = drawn.map((p, i) => {
    if (!p.view) return { drawn: false, refused: p.refused, alt: p.alt || '', problems: [], types: [], noSource: false };
    // The parts hold the tree; what the validator named (a dropped prop, an unknown component) comes from reading the text again.
    const r = view.validate(sources[i]);
    const types = new Set();
    let noSource = false;
    walk(p.view.root, (n) => { types.add(n.type); if (n.noSource) noSource = true; });
    return { drawn: true, alt: p.view.alt, problems: r.problems || [], types: [...types], noSource };
  });
  return { fences, text };
}

// ---------- a Markdown table ----------

// Whether the words beside the views hold a Markdown table: a header row and a delimiter row (| --- | :---: |).
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$|^\s*\|\s*:?-+:?\s*\|?\s*$/;
function hasMarkdownTable(text) {
  return String(text || '').split('\n').some((line, i, lines) => i > 0 && TABLE_DELIMITER.test(line) && lines[i - 1].includes('|'));
}

// ---------- a case ----------

// c: { id, view: true | false | 'either', fits?: [component names a view that answers it uses one of], noMarkdownTable?: true }
// seen: { picked, reply } → { pass, checks: [{ id, ok: true | false | null (not asked), detail }] }
function score(c, seen) {
  const { fences, text } = fencesOf(seen.reply);
  const drawn = fences.filter((f) => f.drawn);
  const checks = [];
  const add = (id, ok, detail = '') => checks.push({ id, ok, detail });

  if (c.view === 'either') add('picked', null, `${seen.picked ? 'picked' : 'not picked'}: a view or a written list is fine until wave ${c.wave || 2} has inputs`);
  else add('picked', c.view ? !!seen.picked : !seen.picked, seen.picked ? 'picked kit:ui' : 'did not pick kit:ui');

  if (c.view === 'either') add('drew', null, drawn.length ? 'drew a view' : 'wrote it out');
  else if (c.view) add('drew', drawn.length > 0, drawn.length ? `${drawn.length} view${drawn.length === 1 ? '' : 's'} drawn` : fences.length ? `no view could be drawn (${fences.map((f) => f.refused).join(', ')})` : 'wrote prose only');
  else add('drew', fences.length === 0, fences.length ? `wrote ${fences.length} ui fence${fences.length === 1 ? '' : 's'} where prose was right` : 'prose only');

  if (!fences.length) add('valid', null, 'no fence');
  else {
    const bad = fences.flatMap((f, i) => (f.drawn ? f.problems.map((p) => `#${i + 1} ${p.code}${p.prop ? ` ${p.prop}` : ''}${p.name ? ` ${p.name}` : ''} at ${p.at}`) : [`#${i + 1} refused: ${f.refused}`]));
    add('valid', !bad.length, bad.length ? bad.join('; ') : `${fences.length} fence${fences.length === 1 ? '' : 's'} read whole`);
  }

  if (!drawn.length) add('source', null, 'no view');
  else {
    const bare = drawn.filter((f) => f.noSource).length;
    add('source', !bare, bare ? `${bare} view${bare === 1 ? '' : 's'} with a chart, table or KPI that says no source` : 'every number says where it came from');
  }

  if (c.view === true && c.fits?.length) {
    const used = [...new Set(drawn.flatMap((f) => f.types))];
    add('fit', used.some((t) => c.fits.includes(t)), used.length ? `drew ${used.join(', ')}; wanted one of ${c.fits.join(', ')}` : `drew nothing; wanted one of ${c.fits.join(', ')}`);
  } else add('fit', null, 'not asked');

  if (fences.length && c.view !== false) add('prose', text.length > 0, text.length ? 'the answer is in words too' : 'a fence with no answer in words beside it');
  else add('prose', null, 'not asked');

  // Asked of the prompts that ask for a table or a comparison: the table is a view, not Markdown beside it.
  if (c.noMarkdownTable) add('noTable', !hasMarkdownTable(text), hasMarkdownTable(text) ? 'wrote a Markdown table' : 'no Markdown table');

  return { pass: checks.every((x) => x.ok !== false), checks };
}

// ---------- the report ----------

const COLUMNS = [['picked', 'Picked kit:ui'], ['drew', 'Drew as it should'], ['valid', 'Valid'], ['source', 'Source'], ['fit', 'Fits'], ['prose', 'Words too'], ['noTable', 'No Markdown table']];
const mark = (ok) => (ok === null || ok === undefined ? '–' : ok ? '✓' : '✗');
const label = (r) => `${r.id}${r.wave ? ` (wave ${r.wave})` : ''}`;

// results: [{ id, view, wave?, error?, seen?: { picked, reply }, score? }] → the numbers the report opens with.
function summary(results) {
  const done = results.filter((r) => !r.error && r.seen);
  const s = { viewPrompts: 0, viewPicked: 0, prosePrompts: 0, prosePicked: 0, fences: 0, fencesValid: 0 };
  for (const r of done) {
    if (r.view === true) { s.viewPrompts++; if (r.seen.picked) s.viewPicked++; }
    if (r.view === false) { s.prosePrompts++; if (r.seen.picked) s.prosePicked++; }
    const { fences } = fencesOf(r.seen.reply);
    s.fences += fences.length;
    s.fencesValid += fences.filter((f) => f.drawn && !f.problems.length).length;
  }
  return s;
}

// results → the Markdown report: a line per case, the picks and the validator's verdicts, then what failed and why.
function report(results, meta = {}) {
  const s = summary(results);
  const lines = [
    `# Answer views — ${meta.date || ''}`.trim(),
    '',
    `Real bots (Claude Code${meta.model ? `, ${meta.model}` : ''}) on scratch botdot servers, each case a new bot and one message; scored from the run's tool calls and its reply, every \`ui\` fence read by the apps' own validator, with no model as judge.${meta.commit ? ` Commit: ${meta.commit}.` : ''} ✓ passed, ✗ failed, – not asked of this case.`,
    '',
    `| Case | Result | ${COLUMNS.map((c) => c[1]).join(' | ')} |`,
    `| --- | --- | ${COLUMNS.map(() => ':---:').join(' | ')} |`,
  ];
  for (const r of results) {
    const by = Object.fromEntries((r.score?.checks || []).map((x) => [x.id, x.ok]));
    lines.push(`| ${label(r)} | ${r.error ? 'error' : r.score.pass ? 'pass' : 'FAIL'} | ${COLUMNS.map(([id]) => (r.error ? '?' : mark(by[id]))).join(' | ')} |`);
  }
  const passed = results.filter((r) => !r.error && r.score.pass).length;
  lines.push(
    '',
    `**kit:ui was picked for ${s.viewPicked} of ${s.viewPrompts} prompts where a view is right and for ${s.prosePicked} of ${s.prosePrompts} where prose is right** (it should be all of the first and none of the second). **${s.fencesValid} of ${s.fences} fences passed the validator.**`,
    '',
    `**${passed}/${results.length} cases passed.**`,
    '',
  );
  const failed = results.filter((r) => r.error || !r.score.pass);
  if (failed.length) {
    lines.push('## What failed', '');
    for (const r of failed) {
      if (r.error) { lines.push(`- ${label(r)}: did not finish: ${r.error}`); continue; }
      for (const x of r.score.checks.filter((c) => c.ok === false)) lines.push(`- ${label(r)} · ${x.id}: ${x.detail}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { skillPicked, fencesOf, hasMarkdownTable, score, summary, report, COLUMNS };

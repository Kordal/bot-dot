// The live memory conversations report (memory-conversations.test.js), from its results.json:
//   node test/live/report.js results.json > report.md
// Or a later run next to a baseline (test/live/baseline.json), question by question and, for what the bots
// saved, scenario by scenario, each with its verdict: better, the same or worse.
//   node test/live/report.js --compare test/live/baseline.json results.json
const { WRITE_SCENARIOS, grade } = require('./grading');

const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };

function report(results, meta, writes = []) {
  const rows = new Map();
  for (const run of results) {
    for (const q of run.questions || []) {
      const key = `${run.scenario} · ${q.id}`;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(q);
    }
  }
  const lines = [
    `# Memory conversations — ${meta.date}`,
    '',
    `Live runs of real bots and the Chief on isolated botdot servers with made-up data. Model: ${meta.models.join(', ') || 'unknown'}. Runs per scenario: ${meta.repeat}. Commit: ${meta.commit}. Meaning search: off.`,
    '',
    'Correct: the final ANSWER line matches. Recall: the conversation called recall. Searches: recall calls (median). Found: recall returned a record holding the answer. At: where the first such record was among all records recall returned (median; 1 = first). Outdated, off-limits, irrelevant: records recall returned (totals) that hold a value no longer true; a value this bot must not see (another bot\'s note, a run left out); none of the values asked about. Given: runs whose memories added before the run (next to pinned notes) held the answer; given extra: the other records added (total); off-limits counts those too. Time and context: medians; context is the largest prompt sent to the model in the conversation.',
    '',
    '| Scenario · question | Correct | Recall | Searches | Found | At | Outdated | Off-limits | Irrelevant | Given | Given extra | Time | Context |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  let right = 0; let all = 0;
  for (const [key, qs] of rows) {
    const s = qs.map((q) => q.score);
    right += s.filter((x) => x.correct).length; all += s.length;
    const found = s.filter((x) => x.foundAnswer !== null);
    const sum = (k) => s.reduce((a, x) => a + (x[k] || 0), 0);
    lines.push(`| ${key} | ${s.filter((x) => x.correct).length}/${s.length} | ${s.filter((x) => x.usedRecall).length}/${s.length} | ${median(s.map((x) => x.searches)) ?? '–'} | ${found.length ? `${found.filter((x) => x.foundAnswer).length}/${found.length}` : '–'} | ${median(qs.map((q) => q.records.findIndex((r) => r.holds === 'answer') + 1).filter((x) => x > 0)) ?? '–'} | ${sum('outdated')} | ${sum('offLimits') + sum('givenOffLimits')} | ${sum('irrelevant')} | ${found.length ? `${found.filter((x) => x.givenAnswer).length}/${found.length}` : '–'} | ${sum('givenExtra')} | ${Math.round(median(qs.map((q) => q.result.durationMs)) / 1000)} s | ${Math.round(median(qs.map((q) => q.result.contextTokens)) / 1000)}k |`);
  }
  lines.push('', `**Overall: ${right}/${all} correct.**`, '');
  const failed = results.filter((r) => r.error);
  if (failed.length) lines.push('## Scenarios that failed', '', 'Not counted above: they did not complete, or a question was asked with its answer already in the conversation block.', '', ...failed.map((r) => `- ${r.scenario} #${r.rep}: ${r.error}`), '');
  const wrong = [...rows.values()].flat().filter((q) => !q.score.correct);
  if (wrong.length) {
    lines.push('## Wrong answers', '');
    for (const q of wrong) lines.push(`- ${q.scenario} · ${q.id} #${q.rep}: expected \`${q.expected}\`, got \`${q.score.answer ?? '(no ANSWER line)'}\`; tools: ${q.result.calls.map((c) => c.name).join(', ') || 'none'}`);
    lines.push('');
  }
  const retries = [...rows.values()].flat().filter((q) => q.result.signInRetries);
  if (retries.length) lines.push('## Sign-in retries', '', ...retries.map((q) => `- ${q.scenario} · ${q.id} #${q.rep}: asked again ${q.result.signInRetries}× after "Not logged in"`), '');
  // How they took in what they were told (before any question was asked).
  const taught = results.filter((r) => r.setup && r.setup.saved !== undefined);
  if (taught.length) {
    const count = (xs, f) => `${xs.filter(f).length}/${xs.length}`;
    const corr = taught.filter((r) => r.setup.corrected !== undefined);
    lines.push('## Taking in what they were told', '',
      `- Saved the fact as a note when asked: ${count(taught, (r) => r.setup.saved)}.`,
      ...(corr.length ? [`- Saved the correction: ${count(corr, (r) => r.setup.corrected)}; by updating the same note (so its history keeps the old value): ${count(corr, (r) => r.setup.correctedSameNote)}.`] : []),
      `- Pinned the note, which puts it in every prompt (the test unpinned it, so the questions exercise recall): bots, asked not to pin it, ${count(taught.filter((r) => r.scenario !== 'chief'), (r) => r.setup.unpinnedByTest)}; the Chief ${count(taught.filter((r) => r.scenario === 'chief'), (r) => r.setup.unpinnedByTest)}.`, '');
    const odd = taught.filter((r) => !r.setup.saved || (r.setup.corrected !== undefined && !r.setup.correctedSameNote));
    for (const r of odd) {
      const [first, fix] = Array.isArray(r.setup.teach) ? r.setup.teach : [r.setup.teach];
      const used = (t) => (t?.calls || []).map((c) => c.name).filter((n) => n !== 'ToolSearch').join(', ') || 'no memory tools';
      lines.push(`- ${r.scenario} #${r.rep}: when told the fact it used ${used(first)}${fix ? `; when told the correction, ${used(fix)}` : ''}.`);
    }
    if (odd.length) lines.push('');
  }
  if (writes.length) lines.push(...writeReport(writes));
  return lines.join('\n');
}


// Per question, over all its runs: the numbers the report shows.
function summary(results) {
  const rows = new Map();
  for (const run of results) {
    for (const q of run.questions || []) {
      const key = `${run.scenario} · ${q.id}`;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(q);
    }
  }
  const out = new Map();
  for (const [key, qs] of rows) {
    const s = qs.map((q) => q.score);
    out.set(key, {
      correct: s.filter((x) => x.correct).length, n: s.length,
      searches: median(s.map((x) => x.searches)),
      at: median(qs.map((q) => q.records.findIndex((r) => r.holds === 'answer') + 1).filter((x) => x > 0)),
      outdated: s.reduce((a, x) => a + x.outdated, 0),
      offLimits: s.reduce((a, x) => a + x.offLimits + (x.givenOffLimits || 0), 0),
      given: s.filter((x) => x.givenAnswer).length,
      givenExtra: s.reduce((a, x) => a + (x.givenExtra || 0), 0),
      irrelevant: s.reduce((a, x) => a + x.irrelevant, 0),
      reads: s.reduce((a, x) => a + x.readRun, 0),
      time: median(qs.map((q) => q.result.durationMs)),
      context: median(qs.map((q) => q.result.contextTokens)),
    });
  }
  return out;
}

// Better, the same or worse: by the share of repeats that ended well (good of n). '–' where one side has none.
function verdict(x, y) {
  if (!x?.n || !y?.n) return '–';
  const d = y.good / y.n - x.good / x.n;
  return Math.abs(d) < 1e-9 ? 'the same' : d > 0 ? 'better' : 'worse';
}
const tally = (verdicts) => ['better', 'the same', 'worse'].map((v) => `${v}: ${verdicts.filter((x) => x === v).length}`).join(', ');
const cell = (x, y, fmt = (v) => v ?? '–') => (fmt(x) === fmt(y) ? `${fmt(y)}` : `${fmt(x)} → **${fmt(y)}**`);
const of = (k, n) => (n ? `${k}/${n}` : null);

// A change next to the baseline: each number as "before → after" where it moved, and a verdict per question.
function compare(before, after, meta) {
  const [a, b] = [summary(before), summary(after)];
  const sec = (v) => (v == null ? '–' : `${Math.round(v / 1000)} s`);
  const k = (v) => (v == null ? '–' : `${Math.round(v / 1000)}k`);
  const lines = [
    `# Compared with the baseline — ${meta.date}`, '',
    `Baseline: ${meta.before}. Change: ${meta.after}. Each cell: baseline → change, where it moved. Reads: read_run/get_run calls (total). Verdict: by the correct answers alone; the other columns show where else it moved.`, '',
    '| Scenario · question | Correct | Searches | At | Outdated | Off-limits | Irrelevant | Given | Given extra | Reads | Time | Context | Verdict |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  const tot = { a: { correct: 0, n: 0, outdated: 0, irrelevant: 0, reads: 0 }, b: { correct: 0, n: 0, outdated: 0, irrelevant: 0, reads: 0 } };
  const verdicts = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) || {}; const y = b.get(key) || {};
    for (const [t, v] of [[tot.a, x], [tot.b, y]]) for (const f of Object.keys(t)) t[f] += v[f] || 0;
    const v = verdict({ good: x.correct, n: x.n }, { good: y.correct, n: y.n });
    verdicts.push(v);
    lines.push(`| ${key} | ${cell(of(x.correct, x.n), of(y.correct, y.n))} | ${cell(x.searches, y.searches)} | ${cell(x.at, y.at)} | ${cell(x.outdated, y.outdated)} | ${cell(x.offLimits, y.offLimits)} | ${cell(x.irrelevant, y.irrelevant)} | ${cell(x.given, y.given)} | ${cell(x.givenExtra, y.givenExtra)} | ${cell(x.reads, y.reads)} | ${cell(x.time, y.time, sec)} | ${cell(x.context, y.context, k)} | ${v} |`);
  }
  lines.push('', `**Overall:** correct ${tot.a.correct}/${tot.a.n} → ${tot.b.correct}/${tot.b.n}; outdated ${tot.a.outdated} → ${tot.b.outdated}; irrelevant ${tot.a.irrelevant} → ${tot.b.irrelevant}; reads ${tot.a.reads} → ${tot.b.reads}. Questions ${tally(verdicts)}.`, '');
  return lines.join('\n');
}

// ---------- what the bots saved (the write side) ----------

// The grade of a repeat by today's rules, from the notes and replies its file kept: a baseline that was made before
// grading.js changed is read by the same rules as the run next to it. (The grade it was given then stays in the file.)
function graded(w) {
  const scenario = WRITE_SCENARIOS.find((x) => x.name === w.scenario);
  return scenario && w.store ? grade(scenario, w.store, w.turns || []) : w.grade;
}

// Per scenario, over the repeats that completed: counts of what grading.js grade() finds in the store.
function writeSummary(writes) {
  const out = new Map();
  for (const w of writes) {
    const g = graded(w);
    if (!g) continue;
    if (!out.has(w.scenario)) out.set(w.scenario, { says: w.says || '', n: 0, saved: 0, own: 0, shared: 0, waiting: 0, notes: [], realDates: null, saidSo: null, wanted: 0 });
    const s = out.get(w.scenario);
    s.n++;
    if (g.saved) s.saved++;
    if (g.own) s.own++;
    if (g.shared) s.shared++;
    if (g.waiting) s.waiting++;
    s.notes.push(g.notes);
    for (const f of ['realDates', 'saidSo']) if (g[f] !== undefined) s[f] = (s[f] || 0) + (g[f] ? 1 : 0);
    if (g.wanted) s.wanted++;
  }
  // By name, which is the order of the plan's list: scenarios finish in any order.
  return new Map([...out].sort(([x], [y]) => x.localeCompare(y)));
}

const WRITE_LEGEND = 'Saved: repeats after which the store held a note of what was said (after small talk, a guess and a file: any note at all). The bot\'s, Shared: repeats where such a note was in the bot\'s own memory, in the shared one. Waiting: repeats where it waited for the owner\'s OK as a shared change. Notes: how many notes the store held after each repeat. Real dates: for "This week I\'m in Berlin", a saved note names a day. Said so: for "Remember that …", the reply says it was kept. As wanted: repeats that ended as Milestone 9 wants (scenario D29): the five phrases saved, and the first with a reply that says so; Berlin as a shared note that names its days; a preference said twice as one note; no note after small talk, a guess, or a file that says "remember".';

function writeReport(writes) {
  const rows = writeSummary(writes);
  const lines = [
    '## What the bots saved', '',
    `One short conversation with a bot whose memory is empty, then the store is read. ${WRITE_LEGEND}`, '',
    '| Scenario | Saved | The bot\'s | Shared | Waiting | Notes | Real dates | Said so | As wanted |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |',
  ];
  let wanted = 0; let all = 0;
  for (const [name, s] of rows) {
    wanted += s.wanted; all += s.n;
    lines.push(`| ${name}: ${s.says} | ${of(s.saved, s.n)} | ${of(s.own, s.n)} | ${of(s.shared, s.n)} | ${of(s.waiting, s.n)} | ${s.notes.join(', ')} | ${s.realDates === null ? '–' : of(s.realDates, s.n)} | ${s.saidSo === null ? '–' : of(s.saidSo, s.n)} | ${of(s.wanted, s.n)} |`);
  }
  lines.push('', `**As wanted: ${wanted}/${all}.** This counts what happened; nothing here is asserted.`, '');
  const failed = writes.filter((w) => w.error);
  if (failed.length) lines.push('### Scenarios that failed', '', ...failed.map((w) => `- ${w.scenario} #${w.rep}: ${w.error}`), '');
  const line = (n, where) => `${where}${n.pinned === false ? ', not pinned' : ''}: "${String(n.text).replace(/\s+/g, ' ')}"`;
  lines.push('### The notes after each repeat', '');
  for (const w of writes.filter((x) => x.store).sort((x, y) => x.scenario.localeCompare(y.scenario) || x.rep - y.rep)) {
    const notes = [...w.store.own.map((n) => line(n, 'the bot\'s')), ...w.store.shared.map((n) => line(n, 'shared')), ...w.store.waiting.map((n) => line(n, `waiting (${n.action})`))];
    lines.push(`- ${w.scenario} #${w.rep}: ${notes.join('; ') || 'no note'}`);
  }
  lines.push('');
  return lines;
}

// What the bots saved, next to the baseline: per scenario better, the same or worse, by the repeats that ended as wanted.
function compareWrites(before, after) {
  const [a, b] = [writeSummary(before), writeSummary(after)];
  const lines = [
    '## What the bots saved, compared', '',
    `Each cell: baseline → change, where it moved. Verdict: by the repeats that ended as wanted. ${WRITE_LEGEND}`, '',
    '| Scenario | As wanted | Saved | The bot\'s | Shared | Waiting | Notes | Real dates | Said so | Verdict |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |',
  ];
  const verdicts = [];
  const opt = (s, f) => (s.n && s[f] !== null && s[f] !== undefined ? of(s[f], s.n) : null);
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(name) || {}; const y = b.get(name) || {};
    const v = verdict({ good: x.wanted, n: x.n }, { good: y.wanted, n: y.n });
    verdicts.push(v);
    lines.push(`| ${name}: ${y.says || x.says || ''} | ${cell(of(x.wanted, x.n), of(y.wanted, y.n))} | ${cell(of(x.saved, x.n), of(y.saved, y.n))} | ${cell(of(x.own, x.n), of(y.own, y.n))} | ${cell(of(x.shared, x.n), of(y.shared, y.n))} | ${cell(of(x.waiting, x.n), of(y.waiting, y.n))} | ${cell(x.notes?.join(', '), y.notes?.join(', '))} | ${cell(opt(x, 'realDates'), opt(y, 'realDates'))} | ${cell(opt(x, 'saidSo'), opt(y, 'saidSo'))} | ${v} |`);
  }
  lines.push('', `**Scenarios ${tally(verdicts)}.**`, '');
  return lines.join('\n');
}

// Two result files side by side: x the baseline, y the later run. Both sides of memory, where both files have them.
function comparison(x, y) {
  const models = (r) => (r.models || []).join(', ') || 'unknown';
  const out = [compare(x.results || [], y.results || [], { date: y.date, before: `${x.date}, ${x.commit}, ${models(x)}`, after: `${y.date}, ${y.commit}, ${models(y)}` })];
  // A baseline holds for one Claude model: on another one, the difference is the model's as much as the change's.
  if (models(x) !== models(y)) out.push(`**The baseline was made with ${models(x)} and this run with ${models(y)}.** A baseline holds for one Claude model: record a new one for the new model before reading these verdicts as the effect of a change.\n`);
  if ((x.writes || []).length || (y.writes || []).length) out.push(compareWrites(x.writes || [], y.writes || []));
  // A scenario that failed is in no count above: 3/3 next to 2/2 reads "the same" on fewer repeats.
  const failed = (r) => [...(r.results || []), ...(r.writes || [])].filter((e) => e.error).map((e) => `${e.scenario} #${e.rep}`).join(', ') || 'none';
  if (failed(x) !== 'none' || failed(y) !== 'none') out.push(`**Failed, and so in no count above.** Baseline: ${failed(x)}. This run: ${failed(y)}. A verdict over fewer repeats says less than it reads.\n`);
  return out.join('\n');
}

module.exports = { report, compare, compareWrites, comparison, writeSummary, verdict };

if (require.main === module) {
  const read = (f) => JSON.parse(require('fs').readFileSync(f, 'utf8'));
  if (process.argv[2] === '--compare') {
    process.stdout.write(comparison(read(process.argv[3]), read(process.argv[4])));
  } else {
    const { results, writes, ...meta } = read(process.argv[2]);
    process.stdout.write(report(results, meta, writes));
  }
}

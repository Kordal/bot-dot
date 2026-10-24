// Jev picks the control a bot means on a page, and the lines that answer its question (measured first:
// scripts/browser-bench.js).
//
// Today a bot works its Camoufox by refs (#170): every browser tool answers with the page's whole tree, up to 12,000
// characters, and the bot's model reads it all at each step to find the next ref. With the admin's switch on and Jev
// chosen for the machine (ADR 082), a bot may instead say what it means ("the Log in button"): botdot reads the page,
// Jev picks the control in one choice question, botdot works it and answers with one short line, not the tree. And
// browser_find asks Jev which lines of the page answer a question, so the bot reads those lines and not the page.
//
// Jev emits no text, so it never writes an address or what to type: the bot's model still decides every step. A pick
// below SURE is not acted on: the bot is told the likeliest controls with their refs and chooses. A failed or late
// Jev is said as it is, and the bot carries on with refs, as before.
//
// The page is somebody's text (AGENTS.md, rule 6): it goes to Jev as state, and each control or line as an option
// Jev picks from, never as instructions. The worst a page can do is make Jev pick another of its own controls, which
// botdot names in its answer.
const { oneLine } = require('./prompt-text');
const groupRouter = require('./group-router'); // the admin's choice and Jev's client (ADR 082)

const SURE = 0.6; // a pick under it is not acted on
const MS = 3000;
const OPTIONS = 150; // controls or lines Jev is asked to choose among at most
const SHOWN = 3; // the likeliest controls named when unsure, and the lines browser_find answers with at most
const LINE_P = 0.1; // a line after the likeliest is shown from this chance
const CLICK = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'treeitem', 'option', 'combobox']);
const FILL = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const ROLES_OF = { click: CLICK, fill: FILL };
const STEPS = 6; // clicks browser_navigate takes at most
const HERE = 'here'; // browser_navigate's option for "this page is it"
const LINE = /^(\s*)- ([a-z]+)(?: ("(?:[^"\\]|\\.)*"))?(.*)$/;

// The controls of a snapshot a tool can work, as Jev's options: [{ ref, label }], the label as the tree shows it,
// with the nearest heading above it ('link "Add to cart" under "Trail Runner 3"'), so that alike controls differ.
function controls(snapshot, op) {
  const roles = ROLES_OF[op];
  const out = [];
  let heading = '';
  for (const line of String(snapshot || '').split('\n')) {
    const m = line.match(LINE);
    if (!m) continue;
    let name = '';
    try { name = m[3] ? JSON.parse(m[3]) : ''; } catch { name = ''; }
    if (m[2] === 'heading' && name) heading = name;
    const ref = m[4].match(/\[ref=(e\d+)\]/);
    if (!ref || !roles.has(m[2])) continue;
    const label = `${m[2]} "${oneLine(name, 120)}"${heading && heading !== name ? ` under "${oneLine(heading, 80)}"` : ''}`;
    out.push({ ref: ref[1], label });
    if (out.length >= OPTIONS) break;
  }
  return out;
}

// The lines of a snapshot with text a bot could be looking for, as Jev's options: [{ id, text }], without the
// address lines (/url:) and the first line (the page's title and address, kept as state).
function lines(snapshot) {
  const out = [];
  String(snapshot || '').split('\n').slice(1).forEach((line, i) => {
    const text = line.trim().replace(/^- /, '');
    if (!text || text.startsWith('/url:') || !/[\p{L}\p{N}]/u.test(text)) return;
    if (out.length < OPTIONS) out.push({ id: `l${i + 1}`, text: oneLine(text, 200) });
  });
  return out;
}

const pageOf = (snapshot) => oneLine(String(snapshot || '').split('\n')[0] || '', 300);
const withProvider = (body) => ({ ...body, model: groupRouter.JEV_MODEL, provider: { data_collection: 'deny' } });

// The request for the control a bot means: what it said, the page's title, and the controls as the options.
function controlRequest(what, options, snapshot) {
  const criteria = Object.fromEntries(options.map((o) => [o.ref, o.label]));
  return withProvider({
    state: { page: pageOf(snapshot), wanted: oneLine(what, 300) },
    questions: { control: { type: 'choice', instructions: 'Which control of the page is the one wanted?', criteria } },
  });
}

// The request for the next control on the way to a goal: the controls, and HERE, as the options.
function stepRequest(goal, options, snapshot, path) {
  const criteria = Object.fromEntries([[HERE, 'This page already is the one wanted, or shows what is wanted.'], ...options.map((o) => [o.ref, o.label])]);
  return withProvider({
    state: { page: pageOf(snapshot), goal: oneLine(goal, 300), clicked: [...path] },
    questions: { next: { type: 'choice', instructions: 'Which control of the page leads to the goal next?', criteria } },
  });
}

// The request for the lines that answer a question.
function linesRequest(question, options, snapshot) {
  const criteria = Object.fromEntries(options.map((o) => [o.id, o.text]));
  return withProvider({
    state: { page: pageOf(snapshot), question: oneLine(question, 300) },
    questions: { line: { type: 'choice', instructions: 'Which line of the page answers the question?', criteria } },
  });
}

// Jev's choice as [{ key, p }], the likeliest first, keeping only the keys it was offered.
function ranked(answer, keys) {
  const probs = answer?.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : {};
  return keys.map((key) => ({ key, p: typeof probs[key] === 'number' ? probs[key] : 0 })).sort((a, b) => b.p - a.p);
}

// on(): whether the admin switched it on, with Jev and its key. ask: askJev, browserTool(payload): the bridge's
// answer ({ ok, snapshot } or { ok, error }). act(), find() and handle() answer as the bridge does, with `picked` beside it:
// { ref, p, ms, cost } of Jev's pick, for the run's record and the bench.
// brief: an action answers with the page's title alone (the bench measures both).
function create({ config = groupRouter.config, ask = groupRouter.askJev, ms = MS, fetch = globalThis.fetch, now = Date.now, brief = false } = {}) {
  const on = () => { const c = config() || {}; return c.browserPicker === true && c.router === 'jev' && !!c.key; };
  async function decide(body) {
    const start = now();
    const data = await ask(body, { key: config().key, ms, fetch });
    return { answers: data?.answers || {}, ms: now() - start, cost: Number(data?.usage?.cost) || 0 };
  }
  // The control the bot means, on the page as it is now: { ok, page, ref, label, likely, picked } or the error to
  // answer with. likely: the likeliest few, as the bot is told them when Jev is unsure.
  async function pick({ op, what }, browserTool) {
    if (!on()) return { ok: false, error: 'Say the ref of the control, from your last browser_snapshot.' };
    const page = await browserTool({ op: 'snapshot' });
    if (!page.ok) return page;
    const options = controls(page.snapshot, op);
    if (!options.length) return { ok: false, error: `The page has no control to ${op}. Take a snapshot.` };
    let decided;
    try { decided = await decide(controlRequest(what, options, page.snapshot)); } catch (e) {
      return { ok: false, error: `botdot couldn't pick the control (${e.message}). Take a snapshot and use a ref.` };
    }
    const top = ranked(decided.answers.control, options.map((o) => o.ref));
    const labelOf = (ref) => options.find((o) => o.ref === ref).label;
    const likely = top.slice(0, SHOWN).map((t) => ({ ref: t.key, label: labelOf(t.key), p: t.p }));
    return { ok: true, ref: top[0].key, label: labelOf(top[0].key), likely, picked: { ref: top[0].key, p: top[0].p, ms: decided.ms, cost: decided.cost } };
  }
  // click or fill by what the bot means. A page's tree is read first, which the bot never sees.
  async function act({ op, what, text }, browserTool) {
    const chosen = await pick({ op, what }, browserTool);
    if (!chosen.ok) return chosen;
    const { picked } = chosen;
    if (picked.p < SURE) {
      const likely = chosen.likely.map((l) => `${l.ref}: ${l.label}`).join('; ');
      return { ok: false, error: `Not sure which control that is. The likeliest: ${likely}. Use its ref.`, picked };
    }
    const r = await browserTool(op === 'fill' ? { op, ref: chosen.ref, text } : { op, ref: chosen.ref });
    if (!r.ok) return { ...r, picked };
    const done = `${op === 'fill' ? 'Filled' : 'Clicked'} ${chosen.label} [ref=${chosen.ref}].`;
    return { ok: true, snapshot: brief ? `${done} ${pageOf(r.snapshot)}` : `${done}\n${r.snapshot}`, picked };
  }
  // The lines of the page that answer a question, with the page's title.
  async function find({ question }, browserTool) {
    if (!on()) return { ok: false, error: 'browser_find is off on this machine. Take a snapshot.' };
    const page = await browserTool({ op: 'snapshot' });
    if (!page.ok) return page;
    const options = lines(page.snapshot);
    if (!options.length) return { ok: false, error: 'The page shows no text the tree can read. Take a screenshot.' };
    let decided;
    try { decided = await decide(linesRequest(question, options, page.snapshot)); } catch (e) {
      return { ok: false, error: `botdot couldn't search the page (${e.message}). Take a snapshot.` };
    }
    // The likeliest line, and the next ones only when Jev gives them a chance (LINE_P).
    const top = ranked(decided.answers.line, options.map((o) => o.id)).slice(0, SHOWN).filter((t, i) => i === 0 || t.p >= LINE_P);
    const textOf = (id) => options.find((o) => o.id === id).text;
    const said = top.map((t) => `- ${textOf(t.key)}`).join('\n');
    return { ok: true, snapshot: `${pageOf(page.snapshot)}\nThe likeliest lines, best first:\n${said}`, picked: { ref: top[0].key, p: top[0].p, ms: decided.ms, cost: decided.cost } };
  }
  // Clicks its way to a goal, one sure pick at a time, up to STEPS; stops on a page Jev calls the goal, on an
  // unsure pick, or on a failed click, and answers with the tree it stopped on and the way it took.
  async function navigate({ goal }, browserTool) {
    if (!on()) return { ok: false, error: 'browser_navigate is off on this machine. Use a ref.' };
    const path = [];
    const picks = [];
    let page = await browserTool({ op: 'snapshot' });
    let why = `It took ${STEPS} steps: look whether this is it.`;
    for (let step = 0; page.ok && step < STEPS; step++) {
      const options = controls(page.snapshot, 'click');
      if (!options.length) { why = 'The page has nothing to click.'; break; }
      let decided;
      try { decided = await decide(stepRequest(goal, options, page.snapshot, path)); } catch (e) { why = `botdot couldn't ask the way (${e.message}).`; break; }
      const top = ranked(decided.answers.next, [HERE, ...options.map((o) => o.ref)]);
      picks.push({ ref: top[0].key, p: top[0].p, ms: decided.ms, cost: decided.cost });
      if (top[0].key === HERE && top[0].p >= SURE) { why = 'This looks like the page.'; break; }
      if (top[0].key === HERE || top[0].p < SURE) { why = 'botdot was not sure of the next step.'; break; }
      const label = options.find((o) => o.ref === top[0].key).label;
      const r = await browserTool({ op: 'click', ref: top[0].key });
      if (!r.ok) { why = `Clicking ${label} failed: ${r.error}`; break; }
      path.push(label);
      page = r;
    }
    if (!page.ok) return { ...page, picks };
    const way = path.length ? `Clicked ${path.join(' > ')}.` : 'Clicked nothing.';
    return { ok: true, snapshot: `${way} ${why}\n${page.snapshot}`, picks };
  }
  // One browser tool as the route takes it. Switched on, a control may be named by `what`, browser_find answers
  // with lines, and every action answers with the page's title and address alone: the bot reads the page with
  // browser_find or browser_snapshot when it needs to. Off, every payload goes to the bridge as before.
  async function handle(payload, browserTool) {
    if (payload.op === 'find') return find(payload, browserTool);
    if (payload.op === 'navigate') return navigate(payload, browserTool);
    if (payload.what !== undefined && !payload.ref && ROLES_OF[payload.op]) return act(payload, browserTool);
    const r = await browserTool(payload);
    if (!on() || !brief || payload.op === 'snapshot' || !r.ok) return r;
    return { ...r, snapshot: `Done. ${pageOf(r.snapshot)}` };
  }
  return { on, pick, act, find, navigate, handle };
}

module.exports = { create, controls, lines, controlRequest, stepRequest, linesRequest, ranked, SURE, MS, OPTIONS, SHOWN, LINE_P, STEPS, HERE };

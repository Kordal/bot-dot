// Which runner each job of .github/workflows can land on, and for which event, so a test can rule out that any
// job runs on a machine other than GitHub's own (#528).
// It reads the YAML the workflows use (block maps and lists, flow `[…]` and `{…}`, quoted scalars, `|` and
// `>` blocks) and works out `runs-on` for each event that starts the workflow: GitHub's expressions are
// evaluated with only `github.event_name` and the job's matrix known, and anything else may be any value.
// A reusable workflow's jobs run for the events of the workflows here that call it. Where it cannot tell, it
// counts the job as able to reach a self-hosted runner.
const fs = require('fs');
const path = require('path');

// ---------- YAML ----------

// The line without its comment: a # at the start or after a space, outside quotes.
function uncomment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if ((c === "'" || c === '"') && (i === 0 || /[\s[{,(:]/.test(line[i - 1]))) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s'"[{#-][^:]*?):(?=\s|$)/;
const ITEM = /^-(?=\s|$)/;

function unquote(s) {
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"')) return JSON.parse(s);
  return s;
}

function plain(s) {
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

// A flow collection or a quoted or plain scalar, as it stands after `key:` or `- `.
function scalar(text) {
  let p = 0;
  const ws = () => { while (p < text.length && /\s/.test(text[p])) p++; };
  const fail = () => { throw new Error(`Cannot read the YAML value ${text}`); };
  function value(inFlow) {
    ws();
    const c = text[p];
    if (c === '[') {
      p++; const out = []; ws();
      if (text[p] === ']') { p++; return out; }
      for (;;) { out.push(value(true)); ws(); if (text[p] === ',') { p++; continue; } if (text[p] === ']') { p++; return out; } fail(); }
    }
    if (c === '{') {
      p++; const out = {}; ws();
      if (text[p] === '}') { p++; return out; }
      for (;;) {
        const key = String(value(true)); ws();
        if (text[p] !== ':') fail();
        p++; out[key] = value(true); ws();
        if (text[p] === ',') { p++; continue; }
        if (text[p] === '}') { p++; return out; }
        fail();
      }
    }
    if (c === "'" || c === '"') {
      const m = text.slice(p).match(c === "'" ? /^'(?:[^']|'')*'/ : /^"(?:[^"\\]|\\.)*"/);
      if (!m) fail();
      p += m[0].length;
      return unquote(m[0]);
    }
    const start = p;
    if (inFlow) while (p < text.length && !/[,\]}]/.test(text[p]) && !(text[p] === ':' && /[\s,\]}]|^$/.test(text[p + 1] || ''))) p++;
    else p = text.length;
    return plain(text.slice(start, p).trim());
  }
  const v = value(false);
  ws();
  if (p < text.length) fail();
  return v;
}

function parseYaml(src) {
  const lines = src.split('\n').map((raw) => {
    const text = uncomment(raw).trimEnd();
    return { raw, text, indent: text.trim() ? text.search(/\S/) : -1 };
  });
  let i = 0;
  const skip = () => { while (i < lines.length && lines[i].indent < 0) i++; };
  const isItem = (l) => ITEM.test(l.text.slice(l.indent));

  function node() {
    skip();
    if (i >= lines.length) return null;
    return isItem(lines[i]) ? list(lines[i].indent) : map(lines[i].indent);
  }

  // The lines of a `|` or `>` block, which keep their #.
  function block(indent) {
    const out = [];
    while (i < lines.length && (!lines[i].raw.trim() || lines[i].raw.search(/\S/) > indent)) out.push(lines[i++].raw);
    while (out.length && !out[out.length - 1].trim()) out.pop();
    const cut = Math.min(...out.filter((l) => l.trim()).map((l) => l.search(/\S/)));
    return out.map((l) => l.slice(cut)).join('\n');
  }

  // What follows `key:` or `- ` on the line, and what is nested under it.
  function after(rest, indent) {
    if (rest === '') {
      skip();
      const next = lines[i];
      if (next && (next.indent > indent || (next.indent === indent && isItem(next)))) return node();
      return null;
    }
    if (/^[|>][-+]?$/.test(rest)) return block(indent);
    return scalar(rest);
  }

  function map(indent) {
    const out = {};
    for (skip(); i < lines.length && lines[i].indent === indent && !isItem(lines[i]); skip()) {
      const text = lines[i].text.slice(indent);
      const m = text.match(KEY);
      if (!m) throw new Error(`Cannot read line ${i + 1} of the YAML: ${lines[i].raw}`);
      i++;
      out[unquote(m[1].trim())] = after(text.slice(m[0].length).trim(), indent);
    }
    return out;
  }

  function list(indent) {
    const out = [];
    for (skip(); i < lines.length && lines[i].indent === indent && isItem(lines[i]); skip()) {
      const rest = lines[i].text.slice(indent + 1).trimStart();
      if (!rest) { i++; out.push(after('', indent)); continue; }
      // `- key: value` starts a map whose keys stand where `key` does.
      const at = lines[i].text.length - rest.length;
      if (KEY.test(rest)) { lines[i] = { ...lines[i], text: ' '.repeat(at) + rest, indent: at }; out.push(map(at)); continue; }
      i++;
      out.push(after(rest, indent));
    }
    return out;
  }

  const doc = node();
  skip();
  if (i < lines.length) throw new Error(`Cannot read line ${i + 1} of the YAML: ${lines[i].raw}`);
  return doc;
}

// ---------- GitHub's expressions ----------

// A value the expression cannot know (an input, the pull request, the repository), and a falsy one.
const ANY = Symbol('any value');
const FALSY = Symbol('a falsy value');
const MATRIX = Symbol('the matrix');

function tokens(src) {
  const out = [];
  const re = /\s*(?:('(?:[^']|'')*')|(\d+(?:\.\d+)?)|([A-Za-z_][\w-]*)|(==|!=|<=|>=|&&|\|\||[!<>()[\].,*]))/y;
  let m;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (!(m = re.exec(src))) { if (!src.slice(at).trim()) break; throw new Error(`Cannot read the expression ${src}`); }
    if (m[1]) out.push({ t: 'lit', v: m[1].slice(1, -1).replace(/''/g, "'") });
    else if (m[2]) out.push({ t: 'lit', v: Number(m[2]) });
    else if (m[3]) out.push({ t: 'id', v: m[3] });
    else out.push({ t: m[4] });
  }
  return out;
}

const truthy = (v) => (v === ANY ? null : v === FALSY ? false : Boolean(v));
const BOTH = [true, false];

// Every value `src` may have: [value | ANY | FALSY], with `context` known.
function evaluate(src, context) {
  const ts = tokens(src);
  let p = 0;
  const peek = (t) => ts[p]?.t === t;
  const take = (t) => { if (!peek(t)) throw new Error(`Cannot read the expression ${src}`); return ts[p++]; };
  const flat = (xs, f) => [...new Set(xs.flatMap(f))];

  function or() {
    let left = and();
    while (peek('||')) { p++; const right = and(); left = flat(left, (v) => (v === ANY ? [ANY, ...right] : truthy(v) ? [v] : right)); }
    return left;
  }
  function and() {
    let left = equality();
    while (peek('&&')) { p++; const right = equality(); left = flat(left, (v) => (v === ANY ? [FALSY, ...right] : truthy(v) ? right : [v])); }
    return left;
  }
  function equality() {
    let left = unary();
    while (peek('==') || peek('!=') || peek('<') || peek('>') || peek('<=') || peek('>=')) {
      const op = ts[p++].t, right = unary();
      left = flat(left, (a) => flat(right, (b) => {
        if (a === ANY || b === ANY || a === FALSY || b === FALSY || !['==', '!='].includes(op)) return BOTH;
        const same = typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;
        return [op === '==' ? same : !same];
      }));
    }
    return left;
  }
  function unary() {
    if (peek('!')) { p++; return flat(unary(), (v) => (truthy(v) === null ? BOTH : [!truthy(v)])); }
    return postfix();
  }
  function postfix() {
    let vals = primary();
    for (;;) {
      if (peek('.')) { p++; const name = peek('*') ? (p++, null) : take('id').v; vals = flat(vals, (v) => member(v, name)); }
      else if (peek('[')) { p++; const keys = or(); take(']'); vals = flat(vals, (v) => flat(keys, (k) => member(v, typeof k === 'string' || typeof k === 'number' ? String(k) : null))); }
      else return vals;
    }
  }
  function member(v, name) {
    if (v === MATRIX) return name === null ? [ANY] : matrixValues(context.matrix, name);
    if (name === null || !v || typeof v !== 'object' || !Object.hasOwn(v, name)) return [ANY];
    return [v[name]];
  }
  function primary() {
    if (peek('lit')) return [ts[p++].v];
    if (peek('(')) { p++; const v = or(); take(')'); return v; }
    const name = take('id').v;
    if (name === 'true' || name === 'false') return [name === 'true'];
    if (name === 'null') return [null];
    if (peek('(')) {
      p++; const args = [];
      while (!peek(')')) { args.push(or()); if (peek(',')) p++; }
      take(')');
      if (name.toLowerCase() === 'fromjson') return flat(args[0] || [ANY], (v) => { try { return typeof v === 'string' ? [JSON.parse(v)] : [ANY]; } catch { return [ANY]; } });
      return [ANY];
    }
    if (name === 'matrix') return [MATRIX];
    return Object.hasOwn(context, name) ? [context[name]] : [ANY];
  }

  const v = or();
  if (p < ts.length) throw new Error(`Cannot read the expression ${src}`);
  return v;
}

// Every value matrix.<name> may take: from the matrix's own lists and its `include` entries.
function matrixValues(matrix, name) {
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return [ANY];
  const out = [];
  if (Array.isArray(matrix[name])) out.push(...matrix[name]);
  else if (Object.hasOwn(matrix, name)) out.push(ANY); // an expression, not a list
  for (const extra of Array.isArray(matrix.include) ? matrix.include : []) if (extra && Object.hasOwn(extra, name)) out.push(extra[name]);
  return out.length ? out.map((v) => (hasExpression(v) ? ANY : v)) : [ANY];
}

const hasExpression = (v) => JSON.stringify(v ?? null).includes('${{');

// Every runner a job's `runs-on` may name.
function runnersOf(job, event) {
  const value = job['runs-on'];
  if (value === undefined) return [ANY];
  if (typeof value === 'string') {
    const whole = value.trim().match(/^\$\{\{([\s\S]*)\}\}$/);
    if (whole && !whole[1].includes('}}')) return evaluate(whole[1], { github: { event_name: event }, matrix: job.strategy?.matrix });
  }
  return hasExpression(value) ? [ANY] : [value];
}

// GitHub's own machines: ubuntu-24.04, ubuntu-latest, ubuntu-24.04-arm, windows-2025, macos-15 and the like. A falsy runs-on names
// no runner (GitHub refuses the job), so it cannot reach one either.
const HOSTED = /^(ubuntu|windows|macos)-[\w.-]+$/;
function githubHosted(runner) {
  if (runner === FALSY || runner === null || runner === false || runner === '') return true;
  if (typeof runner === 'string') return HOSTED.test(runner);
  return Array.isArray(runner) && runner.length > 0 && runner.every((r) => typeof r === 'string' && HOSTED.test(r));
}

const describe = (runner) => (runner === ANY ? 'a runner it cannot tell' : JSON.stringify(runner));

// ---------- workflows ----------

// { 'tests.yml': parsed workflow }, from the folder of a checkout's .github/workflows.
function readWorkflows(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort()) out[name] = parseYaml(fs.readFileSync(path.join(dir, name), 'utf8'));
  return out;
}

// The events a workflow's `on:` names, with their filters: [{ event, filter }].
function eventsOf(workflow) {
  const on = workflow?.on;
  if (typeof on === 'string') return [{ event: on, filter: null }];
  if (Array.isArray(on)) return on.map((event) => ({ event, filter: null }));
  return Object.entries(on || {}).map(([event, filter]) => ({ event, filter }));
}

const localCall = (uses) => (typeof uses === 'string' && uses.startsWith('./.github/workflows/') ? path.basename(uses) : null);

// The events that start a workflow, its callers' for a reusable one: [{ event, filter, via }].
function triggersOf(workflows, name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen = new Set([...seen, name]);
  const out = [];
  for (const { event, filter } of eventsOf(workflows[name])) {
    if (event !== 'workflow_call') { out.push({ event, filter, via: name }); continue; }
    for (const [caller, wf] of Object.entries(workflows)) {
      if (Object.values(wf?.jobs || {}).some((job) => localCall(job?.uses) === name)) out.push(...triggersOf(workflows, caller, seen));
    }
  }
  return out;
}

// Each job that may run on a machine other than GitHub's, with the event that gets it there:
// [{ workflow, job, event, via, runner }].
function selfHostedJobs(workflows) {
  const out = [];
  for (const [name, wf] of Object.entries(workflows)) {
    const triggers = triggersOf(workflows, name);
    for (const [id, job] of Object.entries(wf?.jobs || {})) {
      if (job?.uses && localCall(job.uses)) continue; // its jobs are looked at in the workflow it calls
      for (const trigger of triggers) {
        const runners = job?.uses ? [ANY] : runnersOf(job || {}, trigger.event);
        for (const runner of runners.filter((r) => !githubHosted(r))) {
          out.push({ workflow: name, job: id, event: trigger.event, via: trigger.via, runner: describe(runner) });
        }
      }
    }
  }
  return [...new Map(out.map((r) => [JSON.stringify(r), r])).values()];
}

module.exports = { parseYaml, evaluate, readWorkflows, selfHostedJobs, triggersOf, ANY, FALSY };

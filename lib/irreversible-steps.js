// An irreversible step on a bot's computer (#638, ADR 107): the click, or the Enter or Space, that confirms a control
// the page marks "irreversible", "cannot be undone" or "cannot be reversed" waits for the owner's OK on a card in Needs
// you, inside its run, as an action in a connected app does (ADR 010). A control is so marked when its own name says
// it, or the dialog or form it stands in does: a page that only mentions the word elsewhere opens no card.
// - A yes lets that one step through once, in the run that waits. It is never kept for good, and nothing a bot was
//   told in chat stands in for it.
// - A no is final for that run and for the run that carries it on (ADR 009): the same step is refused at once, with
//   no new card, also by Enter and by the screen's own clicks and keys while the step is on the page.
// - The owner taking control of the bot's screen while such a step waits, or while one is on the page, is a no.
// - A step on the site of an app the bot has connected is not carded here: it is refused, and the bot is sent to
//   connector_run, whose card is the one gate (no double gate, and no way round it through the browser).
// - A card whose run stopped waiting goes: the page it was asked on is gone with that run.
// What is known here comes from the browser tools' own snapshots (lib/routes/computers.js): botdot reads the page the
// bot acts on, never the bot's words about it.
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const feed = require('./events');
const { readJson, writeJson } = require('./jsonfile');

// The words that mark a control irreversible, in a name, a dialog or a form.
const MARKED = /\birreversible\b|\b(?:cannot|can ?not|can['’]t)\s+be\s+(?:undone|reversed)\b/i;
// The controls that confirm, and the names of those among them that only step back.
const CONFIRMS = new Set(['button', 'menuitem']);
const STEPS_BACK = /^(?:cancel|close|back|go back|no\b.*|keep\b.*|don['’]t\b.*|do not\b.*|not now|never ?mind|dismiss|abort)$/i;
const HOLDERS = new Set(['dialog', 'alertdialog', 'form']);
// The keys that press the focused button.
const PRESSES = /(?:^|\+)(?:enter|numpadenter| |space)$/i;
const SAYS_MAX = 300;

// One line of Playwright's aria snapshot (deploy/desktop/camoufox-browser page_snapshot): how deep, its role, its
// name, its ref and its text.
function lineOf(text) {
  const m = /^(\s*)- (.*)$/.exec(text);
  if (!m) return null;
  let rest = m[2];
  const quoted = /^'((?:[^']|'')*)'(.*)$/.exec(rest); // YAML's single quotes, for a name with a colon
  if (quoted) rest = quoted[1].replace(/''/g, "'") + quoted[2];
  const key = /^([a-z]+)(?: ("(?:[^"\\]|\\.)*"))?/.exec(rest);
  let name = '';
  try { name = key?.[2] ? JSON.parse(key[2]) : ''; } catch { name = ''; }
  return { depth: m[1].length, role: key?.[1] || '', name, ref: /\[ref=(e\d+)\]/.exec(rest)?.[1] || null, text: rest };
}
function parse(snapshot) {
  const [head = '', ...rest] = String(snapshot || '').split('\n');
  let site = '';
  try { site = new URL(/\((https?:\/\/[^\s)]+)\)\s*$/.exec(head)?.[1] || '').hostname; } catch { site = ''; }
  return { site, lines: rest.map(lineOf).filter(Boolean) };
}
// The dialog or form a line stands in: its index, or -1.
function holderOf(lines, i) {
  for (let j = i - 1, depth = lines[i].depth; j >= 0; j--) {
    if (lines[j].depth >= depth) continue;
    depth = lines[j].depth;
    if (HOLDERS.has(lines[j].role)) return j;
  }
  return -1;
}
// What a holder says that marks it, or null: its own line or one of the lines in it.
function markOf(lines, j) {
  for (let k = j; k < lines.length && (k === j || lines[k].depth > lines[j].depth); k++) {
    const found = MARKED.exec(lines[k].text);
    if (found) return lines[k].text.replace(/^[a-z]+(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*:?\s*/, '').slice(0, SAYS_MAX) || found[0];
  }
  return null;
}
const confirms = (line) => CONFIRMS.has(line.role) && !!line.name && !STEPS_BACK.test(line.name.trim());
const stepOf = (site, line, says) => ({ site, control: line.name, says, key: `${site}\n${line.role}\n${line.name}` });

// The irreversible step a click on line i of a parsed page would take, or null.
function stepOfLine({ site, lines }, i) {
  if (!confirms(lines[i])) return null;
  if (MARKED.test(lines[i].name)) return stepOf(site, lines[i], lines[i].name.slice(0, SAYS_MAX));
  const j = holderOf(lines, i);
  const says = j >= 0 ? markOf(lines, j) : null;
  return says ? stepOf(site, lines[i], says) : null;
}
// The irreversible step a click on `ref` of this snapshot would take, or null.
function stepAt(snapshot, ref) {
  const page = parse(snapshot);
  const i = page.lines.findIndex((l) => l.ref === String(ref || ''));
  return i < 0 ? null : stepOfLine(page, i);
}
// Every irreversible step on this page: what is pending while it is on the screen.
function stepsOn(snapshot) {
  const page = parse(snapshot);
  return page.lines.map((l, i) => (l.ref ? stepOfLine(page, i) : null)).filter(Boolean);
}
// The irreversible step a key pressed on this page would take: Enter or Space in a marked dialog or form is its
// first confirming control. Or null.
function stepOnPress(snapshot, key) {
  return PRESSES.test(String(key ?? '')) ? stepsOn(snapshot)[0] || null : null;
}

// The connected app, of `apps` (their slugs), whose site `host` is, or null: a label of the host is its slug
// (dashboard.stripe.com is Stripe's), or it is the address of one of Google's (mail.google.com is Gmail's).
const GOOGLE = { gmail: 'mail.google.com', googlecalendar: 'calendar.google.com', googledrive: 'drive.google.com', googledocs: 'docs.google.com', googlesheets: 'docs.google.com' };
function appOfSite(apps, host) {
  const labels = String(host || '').toLowerCase().split('.');
  return (apps || []).find((app) => GOOGLE[app] ? host === GOOGLE[app] : labels.slice(0, -1).includes(String(app).toLowerCase())) || null;
}

// What the bot is told, as it is: the tools server relays these words.
const DECLINED = "The owner declined this irreversible step, so it was not done. It is final for this run: don't try it another way (no other click, key, tool or app for the same thing). Say in your reply that the owner declined it.";
const TOOK_CONTROL = "The owner took control of your screen while this irreversible step waited, which counts as a no: it was not done, and it is final for this run. Don't try it another way. Say in your reply that it was not done.";
const GONE = "The owner has not answered, so this irreversible step was not done, and its card is gone. Don't try it again in this run or another way. Say in your reply that it is not done; the owner can ask you for it again.";
const ON_PAGE = 'An irreversible step on this page was declined or waits for the owner: botdot takes no click or key on your screen while it is there. Leave the page (browser_goto, or browser_press "Escape"), then take a new browser_snapshot.';
const connectorWords = (app) => `This irreversible step is on a site of ${app}, and ${app} is connected to you: do it with connector_run, where it waits for the owner's OK on its card. botdot doesn't let it through in the browser. If ${app} has no action for it, say so in your reply and leave it to the owner.`;

// How long a run waits for the owner's answer inside its run: as for a connected app (ADR 010). A test sets it short.
const WAIT_MS = Number(process.env.BOT_DOT_STEP_WAIT_MS) || 10 * 60_000;
const SLICE_MS = 25_000;
// A run carries on within a day of its ask (ADR 009): what was declined in it is kept twice that long.
const KEEP_MS = 48 * 3600e3;

// asks: the asks (lib/asks.js). active(runId): whether that run is going on. connectedApp(botId, site): the name of
// an app the bot has connected whose site that is, or null. groupOfRun(runId): the group a run is a turn in, or null.
function create(dataDir, { asks, active, connectedApp = () => null, groupOfRun = () => null, waitMs = WAIT_MS }) {
  // What was declined, by run: { runId: { at, said: { key: words } } }, kept so a carry-on after a restart has it too.
  const file = path.join(dataDir, 'irreversible-steps.json');
  const load = () => {
    const all = readJson(file, {});
    for (const [id, d] of Object.entries(all)) if (!(Date.now() - Date.parse(d.at) < KEEP_MS)) delete all[id];
    return all;
  };
  const refusedIn = (runId, key) => load()[runId]?.said?.[key] || null;
  const refuse = (runId, key, words) => {
    const all = load();
    all[runId] = { at: all[runId]?.at || new Date().toISOString(), said: { ...(all[runId]?.said || {}), [key]: words } };
    writeJson(file, all);
  };
  // The last page each bot's browser tools saw, by bot: its run, and the snapshot. In memory: a page is gone with botdot.
  const pages = new Map();
  // One-use yeses: "<run>\n<key>". Waits: ask id -> { runId, botId, key, status, text, timer }.
  const once = new Set();
  const waits = new Map();
  const answered = new EventEmitter();
  answered.setMaxListeners(100);
  const mine = (a) => a.kind === 'computer-step';
  const waitsFor = (runId) => [...waits.values()].some((w) => w.runId === runId && w.status === 'waiting');
  const announce = (w, on) => feed.emitRun('run_waits', groupOfRun(w.runId), { chat: `bot:${w.botId}`, botId: w.botId, runId: w.runId, ...(on ? { waitingFor: 'ok' } : {}) });

  function settle(id, status, text = null) {
    const w = waits.get(id);
    if (!w || w.status !== 'waiting') return;
    clearTimeout(w.timer);
    Object.assign(w, { status, text, timer: null });
    answered.emit(id);
    if (active(w.runId) && !waitsFor(w.runId)) announce(w, false);
  }
  // The run waited for nothing: its card goes, and the step is not done.
  function giveUp(id) {
    asks.drop((a) => a.id === id);
    settle(id, 'stopped', GONE);
  }

  // The bot's browser tools read this page: the snapshot every one of them answers with.
  function seen(session, snapshot) { pages.set(session.botId, { runId: session.runId, snapshot: String(snapshot || '') }); }
  const pageOf = (session) => (pages.get(session.botId)?.runId === session.runId ? pages.get(session.botId).snapshot : '');

  // Before a browser tool of a run: null when it may go now; { refused: words } when it may not; { waits: ask id }
  // when it waits for the owner's answer on that card (wait()), and is then sent again as it was.
  function before(session, payload) {
    const page = pageOf(session);
    const step = payload.op === 'click' ? stepAt(page, payload.ref) : payload.op === 'press' ? stepOnPress(page, payload.key) : null;
    if (!step) return null;
    const app = connectedApp(session.botId, step.site);
    if (app) return { refused: connectorWords(app) };
    const said = refusedIn(session.runId, step.key);
    if (said) return { refused: said };
    if (once.delete(`${session.runId}\n${step.key}`)) return null; // the owner's yes, used by this step
    const ask = asks.add({ kind: 'computer-step', botId: session.botId, runId: session.runId, site: step.site, control: step.control, says: step.says, step: step.key });
    if (!waits.has(ask.id)) {
      const first = !waitsFor(session.runId);
      waits.set(ask.id, { runId: session.runId, botId: session.botId, key: step.key, status: 'waiting', text: null, timer: setTimeout(() => giveUp(ask.id), waitMs).unref() });
      if (first) announce(waits.get(ask.id), true);
    }
    return { waits: ask.id };
  }

  // One slice of a run's wait on its card: { status: 'waiting' | 'allowed' | 'declined' | 'stopped', text }, or null
  // for a card that is not this run's.
  async function wait(session, id, ms = SLICE_MS) {
    id = String(id ?? '');
    const w = waits.get(id);
    if (!w || w.runId !== session.runId) return null;
    if (w.status === 'waiting') {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(t); answered.off(id, done); resolve(); };
        const t = setTimeout(done, ms);
        answered.once(id, done);
      });
    }
    return { status: w.status, text: w.text };
  }

  // The owner's yes: the run that waits takes the step once. A card nobody waits for any more can't be allowed.
  function approve(ask) {
    const w = waits.get(ask.id);
    asks.drop((a) => a.id === ask.id);
    if (w?.status !== 'waiting' || !active(ask.runId)) {
      throw Object.assign(new Error('The bot no longer waits for this, so nothing was done. Ask it again.'), { status: 409 });
    }
    once.add(`${ask.runId}\n${ask.step}`);
    settle(ask.id, 'allowed');
    return { held: true };
  }
  // The owner's no, after the card was taken: final for the run.
  function declined(ask, words = DECLINED) {
    refuse(ask.runId, ask.step, words);
    settle(ask.id, 'declined', words);
  }
  // The owner took control of the bot's screen: each step that waits for a yes, and each that is on its page, is a no.
  function tookControl(botId) {
    for (const a of asks.drop((x) => mine(x) && x.botId === botId)) declined(a, TOOK_CONTROL);
    const page = pages.get(botId);
    if (page && active(page.runId)) for (const s of stepsOn(page.snapshot)) if (!refusedIn(page.runId, s.key)) refuse(page.runId, s.key, TOOK_CONTROL);
  }
  // A click or a key on the screen itself while a step that was declined or waits is on the page: its words, or null.
  const INPUT = new Set(['left_click', 'right_click', 'double_click', 'mouse_down', 'mouse_up', 'drag_to', 'drag', 'press_key', 'hotkey', 'type_text', 'key_down', 'key_up']);
  function screenCmd(session, command) {
    if (!INPUT.has(command)) return null;
    const held = (s) => refusedIn(session.runId, s.key) || [...waits.values()].some((w) => w.runId === session.runId && w.key === s.key && w.status === 'waiting');
    const on = stepsOn(pageOf(session)).find(held);
    return on ? refusedIn(session.runId, on.key) || ON_PAGE : null;
  }

  // A run starts: the one it carries on (ADR 009) hands over what was declined in it.
  function runStarted(meta) {
    const from = meta.continues && load()[meta.continues];
    if (!from) return;
    for (const [key, words] of Object.entries(from.said || {})) refuse(meta.id, key, words);
  }
  // A run ended: its cards go, its yeses go, and nobody waits any more.
  function runEnded(meta) {
    for (const k of once) if (k.startsWith(`${meta.id}\n`)) once.delete(k);
    asks.drop((a) => mine(a) && a.runId === meta.id);
    for (const [id, w] of waits) {
      if (w.runId !== meta.id) continue;
      settle(id, 'stopped', GONE);
      waits.delete(id);
    }
    if (pages.get(meta.botId)?.runId === meta.id) pages.delete(meta.botId);
  }
  // botdot has started: no run of before waits.
  function start() { asks.drop(mine); }

  return { seen, before, wait, approve, declined, tookControl, screenCmd, runStarted, runEnded, start, waitsFor };
}

module.exports = { create, stepAt, stepOnPress, appOfSite };

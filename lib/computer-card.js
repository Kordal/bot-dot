// A "Go to the computer" card (ADR 258): when a bot needs the owner to act on its computer by hand (sign in, approve a
// prompt, plug something in), it calls go_to_computer (lib/computer-mcp.js) and the chat draws one card under its reply,
// in place of a numbered list in prose. The card is kept on the bot's run as `goTo`, so it stays in the chat's history
// and across every redraw: while it waits it has "I'm done" and "Not now"; answered, it is one line, "You confirmed".
// What the bot writes is validated here and drawn by the apps' own code (rule 6): no markup, short lines.

const MAX_STEPS = 6;
const STEP_MAX = 120;
const TITLE_MAX = 80;
const MINUTES_MAX = 60;
const STATES = ['waiting', 'done', 'later'];

const oneLine = (t, max) => {
  const s = String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

// The card a bot's call asks for, or an Error in the bot's own words. steps: 1 to 6 short lines of what the owner does
// there; current: the step (counting from 1) the owner is on now, the steps before it are done (default: the first);
// title: what the owner does in a few words, for the compact card (default: the current step); compact: one line with
// only "I'm done", for a single quick step; minutes: how long it takes, 1 to 60, when the bot knows.
function make({ steps, current, title, compact, minutes } = {}) {
  const lines = (Array.isArray(steps) ? steps : typeof steps === 'string' ? [steps] : []).map((s) => oneLine(s, STEP_MAX)).filter(Boolean);
  if (!lines.length) throw new Error('Give steps: one to six short lines of what the owner does on the computer, e.g. ["Log in to Claude", "Press I\'m done"].');
  if (lines.length > MAX_STEPS) throw new Error(`At most ${MAX_STEPS} steps: keep only what the owner does by hand.`);
  const at = current === undefined || current === null ? 1 : Number(current);
  if (!Number.isInteger(at) || at < 1 || at > lines.length) throw new Error(`current is the step the owner is on now, from 1 to ${lines.length}.`);
  const mins = minutes === undefined || minutes === null ? null : Number(minutes);
  if (mins !== null && (!Number.isInteger(mins) || mins < 1 || mins > MINUTES_MAX)) throw new Error(`minutes is how long it takes, a whole number from 1 to ${MINUTES_MAX}.`);
  const named = oneLine(title, TITLE_MAX);
  return {
    steps: lines,
    current: at,
    ...(named ? { title: named } : {}),
    ...(compact === true ? { compact: true } : {}),
    ...(mins ? { minutes: mins } : {}),
  };
}

// The card as it is kept on its run: made (above), the place of its computer as the owner's setting names it ('linux'
// is the account's computer on this machine, 'boat' its External Virtual PC), and waiting for the owner. `id` is the
// run's own (it has no id of its own): one card per run, and a second call of the same run replaces it while it waits.
function open(card, { botId, place, at = new Date().toISOString() }) {
  return { ...card, bot: botId, place: place === 'boat' ? 'boat' : 'linux', state: 'waiting', at };
}

// The card as a run keeps it, read back with what is trusted: unknown states and fields are dropped. null for none.
function read(goTo) {
  if (!goTo || typeof goTo !== 'object' || !Array.isArray(goTo.steps) || !STATES.includes(goTo.state)) return null;
  return goTo;
}

// What the owner's answer tells the bot that carries on (lib/bots.js carryOnAfterGoTo), in its own words.
const SAID = {
  done: 'use your screen again: they did there what you asked them to (a sign-in, a step only they could do) and pressed "I\'m done" on your card. Take a screenshot first to see where it is now',
  later: 'the step you asked them to do on your screen: they pressed "Not now" on your card',
};

// The prompt rule a bot with a computer reads.
const RULE = 'When the owner has to do a step by hand on your computer (sign in, approve a prompt, plug something in) and they are ready for it, call go_to_computer with the steps they do (1 to 6 short lines; current is the one they are on, those before it are done; compact: true for one quick step) instead of writing a numbered list: the chat draws a card under your reply with "I\'m done", "Take over screen" and "Not now". Then end your reply with one short line, without the steps: botdot starts you again when they answer it.';

module.exports = { make, open, read, SAID, RULE, MAX_STEPS, STATES };

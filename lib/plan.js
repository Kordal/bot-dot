// A bot's or the Chief's plan (docs/api.md, "The plan"; ADR 057): the steps of work of several steps, as Claude Code's
// TodoWrite tool writes them. Every call of that tool hands the whole list again, so the plan is the list of the newest
// call, in botdot's own shape: { steps: [{ text, status, doing? }] }, status 'done', 'doing' or 'todo', and `doing`
// the words of the step at work ("Fetching the supplier pages"). Only that tool makes a plan: a plan written as text
// in a reply is no plan.
//
// It is text from Claude, so it is checked here and the apps draw it with their own code (AGENTS.md rule 6): plain
// text, one line per step, cut to a length, and a list cut to a number of steps.

const TOOL = 'TodoWrite';
const MAX_STEPS = 50;
const MAX_TEXT = 200;
const STATUS = { completed: 'done', in_progress: 'doing', pending: 'todo' };

// One line of plain text, at most MAX_TEXT characters, or '' for none.
function line(v) {
  if (typeof v !== 'string') return '';
  const flat = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > MAX_TEXT ? `${chars.slice(0, MAX_TEXT - 1).join('').trimEnd()}…` : flat;
}

// The plan TodoWrite's input says, or null: no list, or an empty one (a plan that was cleared). A step without words
// is left out, and a status Claude Code does not have is a step to do.
function fromTodos(input) {
  const todos = Array.isArray(input?.todos) ? input.todos : null;
  if (!todos) return null;
  const steps = [];
  for (const t of todos) {
    if (steps.length >= MAX_STEPS) break;
    const text = line(t?.content);
    if (!text) continue;
    const status = STATUS[t?.status] || 'todo';
    const doing = status === 'doing' ? line(t?.activeForm) : '';
    steps.push({ text, status, ...(doing && doing !== text ? { doing } : {}) });
  }
  return steps.length ? { steps } : null;
}

// The plan an event of Claude Code's stream sets: a plan, null when it clears the plan, or undefined when the event
// says nothing of one. Of several calls in one message the last one counts.
function read(ev) {
  if (ev?.type !== 'assistant' || ev.parent_tool_use_id) return undefined; // a helper's own plan is not its bot's
  let found;
  for (const c of ev.message?.content || []) if (c?.type === 'tool_use' && c.name === TOOL) found = fromTodos(c.input);
  return found;
}

// How far it is: { done, total }.
const progress = (plan) => ({ done: (plan?.steps || []).filter((s) => s.status === 'done').length, total: (plan?.steps || []).length });

// What a bot and the Chief are told, so that the owner sees the shape of longer work.
const PROMPT = `A plan the owner sees: when a task takes several distinct steps (three or more, or work that will take a while), make a short plan with the TodoWrite tool before you start, and update it as you go: one step in_progress at a time, marked completed as soon as it is done, and the next one marked in_progress before you begin it (also when you move to another site, source or tool), so the plan always shows where you are. Its steps are shown to the owner above the message box, so write each in the owner's language, as a short plain line without tool names, paths or commands. Skip it for a quick answer or a single step.`;

// A plan that nobody updates shows the owner work that is no longer going on. The model updates it when it remembers,
// so botdot counts the tool calls a run makes after its plan was last written, and once a few have passed while a step
// is still open, hands the run a reminder with its next tool result (the steer hook, lib/bots.js afterTool). The plan's
// own calls, ToolSearch and a helper's calls are not counted.
const STALE_AFTER = 5;
const REMINDER = `Your plan, which the owner sees above the message box, has not been updated for ${STALE_AFTER} tool calls. Update it now with TodoWrite, the whole list: mark what is done completed, the step you are on in_progress, add a step you found and drop one that no longer applies. Then carry on.`;

function gap() {
  let calls = 0;
  return {
    // One event of the run's stream.
    see(ev) {
      if (ev?.type !== 'assistant' || ev.parent_tool_use_id) return;
      for (const c of ev.message?.content || []) {
        if (c?.type !== 'tool_use' || c.name === 'ToolSearch') continue;
        if (c.name === TOOL) calls = 0; else calls += 1;
      }
    },
    // The reminder when the plan is behind, or null. It counts from the reminder on, so it comes again only after
    // another STALE_AFTER calls; a plan with nothing left open, or none, needs none.
    due(plan) {
      if (calls < STALE_AFTER || !(plan?.steps || []).some((s) => s.status !== 'done')) return null;
      calls = 0;
      return REMINDER;
    },
  };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

module.exports = { PROMPT, STALE_AFTER, REMINDER, gap, TOOL, MAX_STEPS, MAX_TEXT, fromTodos, read, progress, same };

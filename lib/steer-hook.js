#!/usr/bin/env node
// Claude Code's PostToolUse hook in a run that may be steered (ADR 040): after each tool call it asks botdot for the
// owner's messages steered into this run, with the run's key, and hands what botdot answers to Claude as context
// for its next step. botdot takes them in the same step, so each is read once. Nothing steered, or botdot not
// reached: it says nothing, and the run goes on as it was.
const API = process.env.SELF_URL;
const TOKEN = process.env.RUN_TOKEN;

async function main() {
  // Claude Code writes the call's details on stdin; nothing of them is needed, but it is read to its end.
  for await (const chunk of process.stdin) void chunk;
  if (!API || !TOKEN) return;
  const res = await fetch(`${API}/steer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Run-Token': TOKEN },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.steered || typeof data.context !== 'string') return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: data.context } }));
}

main().catch(() => {});

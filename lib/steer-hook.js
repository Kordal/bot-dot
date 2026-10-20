#!/usr/bin/env node
// Claude Code's PostToolUse hook in a run or a Chief turn that may be steered (ADR 040): after each tool call it asks
// botdot for the owner's messages steered into it (STEER_URL, with the key in STEER_HEADERS), and hands what botdot
// answers to Claude as context for its next step. botdot takes them in the same step, so each is read once. Nothing steered, or botdot not
// reached: it says nothing, and the run goes on as it was.
const URL = process.env.STEER_URL;
let HEADERS = null;
try { HEADERS = JSON.parse(process.env.STEER_HEADERS || 'null'); } catch {}

async function main() {
  // Claude Code writes the call's details on stdin; nothing of them is needed, but it is read to its end.
  for await (const chunk of process.stdin) void chunk;
  if (!URL || !HEADERS) return;
  const res = await fetch(URL, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', 'X-Bot-Dot': '1' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.steered || typeof data.context !== 'string') return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: data.context } }));
}

main().catch(() => {});

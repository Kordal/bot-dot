#!/usr/bin/env node
// Claude Code's PreToolUse hook in a run that its owner's mention in a shared room started (ADR 066): before every
// tool call it asks botdot, which puts a card in the owner's Needs you and answers once the owner did. A yes lets the
// call go on to the bot's own rules; anything else blocks it (exit 2), also when botdot can't be asked: a hook that
// fails must never let a tool through.
// argv[2]: a private file with { url, token } (lib/bots.js): the run's key is on no command line.
const fs = require('fs');

const LONGEST_MS = 11 * 60_000; // botdot answers within ten minutes; the hook's own time limit is longer (bots.js)
const block = (why) => { process.stderr.write(`${why}\n`); process.exit(2); };

async function main() {
  let conf;
  try { conf = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch { return block('botdot could not ask the owner, so this tool call was not done.'); }
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let call;
  try { call = JSON.parse(input); } catch { return block('botdot could not read this tool call, so it was not done.'); }
  const until = Date.now() + LONGEST_MS;
  let id = null;
  while (Date.now() < until) {
    let answer;
    try {
      const res = await fetch(conf.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Run-Token': conf.token },
        body: JSON.stringify({ tool: call.tool_name, input: call.tool_input, ...(id ? { id } : {}) }),
        signal: AbortSignal.timeout(60_000),
      });
      answer = await res.json();
      if (!res.ok) return block(answer?.error || 'botdot could not ask the owner, so this tool call was not done.');
    } catch { return block('botdot could not ask the owner, so this tool call was not done.'); }
    if (answer?.status === 'allowed') process.exit(0);
    if (answer?.status !== 'waiting') return block(String(answer?.text || 'The owner did not allow this tool call, so it was not done.'));
    id = answer.id;
  }
  return block('The owner has not answered in time, so this tool call was not done.');
}

main().catch(() => block('botdot could not ask the owner, so this tool call was not done.'));

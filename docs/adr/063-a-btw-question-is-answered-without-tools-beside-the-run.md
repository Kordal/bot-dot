# ADR-063: A "/btw" question is answered without tools, beside the run

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#335](https://github.com/Kordal/bot-dot/issues/335)
- **Builds on:** [ADR 062](062-a-message-to-a-busy-bot-starts-beside-the-run-that-is-going.md) ("A message to a busy bot starts beside the run that is going")

## Context

Since ADR 062 a message to a busy bot starts a full run beside the ones going, up to three. That is right for real work, but heavy for "what are you doing now?" or "how long still?": a whole run with tools, MCP servers and the bot's prompt, taking one of the three places, to say what the running run already knows.

Claude Code has `/btw`, a side question answered from the current conversation without tools. Bots run through `claude -p`, where it is not available. The owner chose the prefix only, with no new button.

## Decision

- **The owner's message to a working bot that starts with `/btw`** (any case, then a space) is answered by a talk-only turn of Claude: `--tools ''`, no MCP servers (`--strict-mcp-config` with none), no session kept, as the hats are asked for (`lib/dresser.js`). It runs as the bot, in its folder, with its model and reasoning.
- **What it is told** (`lib/btw.js`): the bot's name and description, and for each of its runs that go on now what it was asked and by whom, its working line, its plan and its reply draft so far, all quoted as data; then the question. It looks at every run that is going, not only the newest.
- **It takes none of the three places** and waits for none of them: it is no part of the bot's active runs, has no Stop and no computer, and ends within two minutes or fails.
- **It is a run of its own in the bot's chat** (`btw: true`), with what the owner wrote as its request and the answer as its reply, so every app draws it as a short exchange with no change. Its record is one the owner started, so later runs read it in their chat history like any exchange.
- **To a bot that is free**, or with files attached, `/btw` is a message as any: the prefix is dropped and a normal run starts. Only the owner's messages in the bot's chat: not the Chief's `run_bot`, a Board tile or a group.

## Alternatives

- **A button** beside the message box. The owner chose the prefix only (rule 5, minimal UI).
- **Steer the question into the running run** (ADR 040). The run would answer only at its next tool call and mixes the question into its work.
- **Leave the answer out of later runs' history.** It is the owner's question and the bot's answer, as the owner saw them; leaving it out would make the bot forget what it told the owner.

## Consequences

- A quick question to a busy bot is answered in seconds, without starting a fourth process or waiting behind three.
- The answer knows only what the running runs say of themselves: it can't look at files or the computer. It says so, and the owner can send the question without `/btw`.
- A restart while it is answered leaves it `interrupted`, as any run.

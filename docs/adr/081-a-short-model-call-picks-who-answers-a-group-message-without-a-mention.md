# ADR-081: A short model call picks who answers a group message without a mention

- **Status:** Accepted (asked for by the owner, 2026-10-23)
- **Owning task:** [#510](https://github.com/Kordal/bot-dot/issues/510)
- **Changes:** [ADR 019](019-the-botdot-server-gives-the-turns-in-a-group.md) ("every member, or the members the owner mentioned")

## Context

A message of the owner's in a group without a mention gave every member a turn, one after another (ADR 019). Every turn is a full run of Claude Code, also when it ends in `PASS`: in a team of three or four, most of a message's runs said nothing, and the member whose part it was could be the last to start. Measured over 30 realistic messages to two teams (`scripts/group-router-bench.js`): 3.5 runs per message, 61 of them passes.

## Decision

- **For an owner's message without a mention and without `@all`, one short question to a small model picks the one or two members whose part it is** (`lib/group-router.js`). It reads the message, the group's last four lines and, for each member, its name, description, main assignment (cut to 200 characters) and skill names. Only the picked members get a turn, best first. Nothing of the vault, the memory or the files is in it.
- **The model is Claude Haiku (`claude-haiku-5-5`) through the Claude Code CLI on the Claude sign-in the bots already use** (`lib/dresser.js askClaude`), with a system prompt of its own, no tools, no settings files and no session kept: no new key, no outside service, about 1.3 s.
- **The answer is never trusted:** one line of JSON, `{"members":[<numbers>]}`, the numbers of the members on the list. Anything else (no JSON, a number that is no member, one twice, more than two) picks none.
- **Never silence.** When the call fails, takes longer than 5 s, or picks none (the model is told to pick none when the message is for everyone or it cannot tell), every member has the turn, as before. A restart while the question is out gives every member the turn.
- **Unchanged:** a mention and `@all` are never routed; the member whose question to the owner is open keeps the first turn (ADR 020), before the picked ones; any member can still hand the work on to one that was not picked (ADR 019), and the limit of 12 replies counts as before. Files alone, a group of one, and a message sent while Claude is signed out are not routed.
- **The message keeps the decision for audit** (`routed`: `{ picked, ms }` or `{ fell, ms }`, why it fell back). Its `to` becomes the picked members. While the question is out the message is `routing` and no turn of it starts; a later message to the same members waits for it (ADR 079).
- **A picked member's turn is told that botdot gave the turn to the members whose part it is**, and that a member without a turn can still be handed the work, in place of "every member has one turn".
- **`BOT_DOT_GROUP_ROUTER=off` switches it off.** `BOT_DOT_GROUP_ROUTER_MS` and `BOT_DOT_GROUP_ROUTER_MODEL` change the wait and the model.

## Alternatives

- **A hosted routing service, or an open model of its own on the machine.** Rejected: an outside company would see every group message, with another key and account to keep; a local model of about 2 GB per account does not fit the machine's memory.
- **Keywords or embeddings of the members' descriptions.** Rejected: "Looks good, build it" after a designer's mockup needs the chat's last lines, and keywords pick nobody for most real messages.
- **A 3 s wait.** Rejected: Claude Code alone starts in one to two seconds in a bot's sandbox, so 3 s would fall back on a busy machine far too often; past 5 s, everyone's turn is cheaper than waiting.
- **Show the pick in the chat.** Rejected: no new text on the screen (the minimal UI rule); `to` and the turns already say who answers.

## Consequences

- Over the 30 messages of the bench, live: 1.4 runs per message instead of 3.5, 3 passes instead of 61, the right member included in all 30, a needless one in 2; the first useful reply comes about 5 s sooner on average, the router's ~1.3 s included.
- A wrong pick costs a hand-on or the owner naming the member; the member that was left out was never silenced, only not asked.
- Each such message costs one small model call more, counted with the Chief's tokens.

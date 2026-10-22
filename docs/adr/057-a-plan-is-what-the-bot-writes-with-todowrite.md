# ADR-057: A plan is what the bot writes with TodoWrite

- **Status:** Accepted (2026-10-22, the owner approved the mockups of [#286](https://github.com/Kordal/bot-dot/issues/286)).
- **Owning task:** [#286](https://github.com/Kordal/bot-dot/issues/286).

## Context

While a bot or the Chief works, the owner sees one working line: what it does now, not the shape of the whole job. Claude Code has a plan tool of its own, but which one a run gets depends on its version and its model. With the pinned Claude Code (2.1.303) in `-p` mode, checked on real runs: the newest models (the Claude 5 family) get no plan tool at all; `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` gives them the Task tools (TaskCreate, TaskUpdate, TaskList, TaskGet), which send one change per call and keep the list in files; `CLAUDE_CODE_ENABLE_TASKS=false` beside it gives TodoWrite instead, which sends the whole list on every call. Neither needs a permission, also under `dontAsk`.

## Decision

- **Every run of a bot and every Chief turn is started with both switches** (`lib/identity.js`, `PLAN_TOOL_ON`), so every model has TodoWrite and no Task tools.
- **A plan is the list of the newest TodoWrite call** (`lib/plan.js`), read from the run's own stream: never steps written as text in a reply, and never a helper's own plan. The server checks it as text from Claude (one line per step, cut to 200 characters and 50 steps) and keeps it in botdot's own shape, `{ steps: [{ text, status, doing? }] }`.
- **It is stored on the run and on the Chief's reply** as it changes, and sent on their streams; it is not a feed event and not an event of the run's log, which holds the TodoWrite calls already.
- **The apps decide nothing about its words:** they draw the steps as given, above the message box while the work goes on, folded under the reply when it is done, and as "Stopped at step N of M" with Dismiss when it was stopped or failed first. There is no "Carry on": the owner writes to go on.
- **Every bot and the Chief are told** to plan work of three or more steps with TodoWrite, in the owner's language, without tool names, paths or commands.

## Alternatives

- **The Task tools.** Each call changes one task, so the server would have to rebuild the list from the calls and their answers, and a run that resumes a session would carry tasks from before. TodoWrite's whole list on every call is the plan as it reads, with nothing to rebuild.
- **Plans read from the reply's text.** A numbered list in a reply is not always a plan, and the owner would see guesses. Only the tool the bot chose to plan with counts.
- **A feed event for every change.** It would let the list of bots say "step 3 of 5", but it adds a kind of event every app must keep and replay; the chat follows its run's stream already. Left for later if the owner asks for it.
- **Keeping a dismissed plan on the server.** Dismiss only tidies what one app shows; it needs no route.

## Consequences

- A bump of Claude Code that renames these switches, or drops TodoWrite, leaves runs without a plan: `test/plan.test.js` checks the switches are given, and a real run is the check of the tool.
- A plan stays with its run, so a reload, a phone that opens the chat later and a restart show the same plan.
- A run that is cut off by a restart keeps the plan it had, and shows as stopped.

# A bot's usual task becomes its main assignment

4 Oct 2026. An improvement report from `/kordal-improve`; no code was changed.

## Question

"Investigate how can we improve the Bot usual task. First I would like to change the name to "Main assignment". Check how can we improve this. For eg. bot do not update it based on the conversations. do analysis and let me know"

After the report, with a screenshot of a bot’s empty chat on the web page and the "Run its usual task" button marked: "Also remove this. I dont want user to run the assignment by button. he can always ask."

## Criterion

The owner confirmed one:

- **Renamed everywhere.** "Main assignment" replaces "Usual task" wherever the owner, the Chief of Staff or a bot reads it: web page, Android app, chips, job hints, prompts, tool descriptions, docs.

Offered and not chosen: updates from chat, the owner sees and controls every change, stays sharp over time. The question's own example (a bot does not update it from a conversation) was investigated as a finding, not as a criterion.

## Observed

A test server with one bot, the web page. Claude was not signed in there, so no run could be started; Android was not started.

| Where | Shown |
| --- | --- |
| A bot's empty chat | Button "Run its usual task", the task text under it |
| Bot settings | Field "Usual task", hint "what it does when a job runs it, or you tap Usual task" |
| Scheduled jobs, a new AI job | Task field hint "leave empty for the bot's usual task" |

Not seen live, read in code: the chat chip "Ran its usual task" and the history line "Usual task changed".

## Findings

Investigated by the `kordal-investigator` agent; every cited line was opened and confirmed.

1. **The web page says it in five strings and shows one server string as it comes.** `public/app.js:1055` (label and hint), `:2280` (Run its usual task), `:2302` (Ran its usual task), `:2785` and `:2855` (job hint), `:3472` (Usual task changed). The server string: `server.js:1260` builds "Proposed changing its usual task; waiting for your approval" from the label at `lib/learning.js:10`.
2. **Android says it in two strings.** `android/app/src/main/java/dev/botdot/app/ui/BotSettingsScreen.kt:170` and `ui/BotChatScreen.kt:186`. The settings hint says "when you tap its usual task", but Android's empty chat has no such button (`BotChatScreen.kt:149-155`) and its composer cannot send an empty message (`ui/Components.kt:581`).
3. **Bots read it in nine strings, the Chief in three.** Bots: `lib/bots.js:573` (twice), `:714`, `:717`, `:1627`; `lib/self-mcp.js:43`, `:371`, `:376`; `lib/memory.js:323`; `lib/mentions.js:29` (the Chief reads this one too). The Chief: `lib/chief.js:41`; `lib/mcp-server.js:95`, `:125`. The model also reads the `<usual-task>` tag (`lib/bots.js:714`, `:717`) and "your usual job" (`:717`).
4. **The same thing is also called plain "task" where the owner reads.** The learning toggle (`public/app.js:1121`, `BotSettingsScreen.kt:270`), the change history line (`public/app.js:1317`), the Needs you card label `Task` (`lib/asks.js:122`), the error "Task prompt is required" (`lib/bots.js:232`). A literal rename leaves two names for one thing on the settings page.
5. **The Chief's bot-design wording says "task (the prompt field)" and tests pin it.** `lib/chief.js:100-109`, `lib/mcp-server.js:531`, `:541`; `test/chief-bot-design.test.js:28`, `:46`, `:51`, `:53`, `:63`, `:64`. Without a word to the Chief it keeps saying "task" to the owner.
6. **CONTEXT.md has no term for it.** A bot is "an agent with its own task, rules, tools…" (`CONTEXT.md:10`), and "task" is on the Avoid list for Job (`CONTEXT.md:23`).
7. **Three stored strings keep the old name.** The job name `'Usual task'` given once to bots from before jobs (`lib/jobs.js:94`, `lib/bots.js:161-168`); three jobs on the owner's Mac carry it, and its mention handle is `@Bot/UsualTask` (`public/mentions.js:29-33`). `(its usual task)` in the memory database's `asked` column (`lib/memory.js:323`, `:344-346`). The "Proposed changing its usual task…" line in old runs' `learned[]` (`server.js:1260`).
8. **One test asserts the string.** `test/mentions.test.js:69`. No test asserts `<usual-task>`, "Ran its", "Proposed changing" or the migrated job name.
9. **Wording only, no contract change.** No API field, event or `features` flag carries the name (`server.js:1550`); the field stays `prompt`. `docs/api.md:72` needs its prose changed. Android draws the learned chip and the Needs you card from server text (`data/Models.kt:132-138`, `ui/NeedsYouScreen.kt:646-648`), so an installed app shows the new words there before it is updated, and its own two labels after.
10. **The Mac app keeps "Usual task"** ([ADR 008](../../adr/008-the-mac-app-is-no-longer-developed.md)).

The owner's example, how a bot's task can change today:

11. **No code changes a bot's task from a chat; only the bot calling `update_instructions` can, behind three gates.**
    - **Learning mode.** The tool exists only when `learning` is `all` and the run is not a memory review (`lib/bots.js:784`, `lib/self-mcp.js:10`, `:367`); the server refuses otherwise (`server.js:1253`). A new bot gets `memory` (`lib/bots.js:216`, `test/owner-approval.test.js:10-11`, `docs/security-issue-90.md:24`). All seven bots in the data folder on the owner's Mac are `all`.
    - **What the bot is told.** Corrections and preferences go to memory with `remember` (`lib/bots.js:1105`); the task changes only "when the owner asks for a lasting change to how you work, or a lesson belongs in your instructions rather than memory" (`lib/bots.js:1108`, `lib/self-mcp.js:371-372`). It must not change it to cover a failure (`lib/bots.js:644`) or because outside content said so (`:1111`).
    - **The owner's approval.** The call never applies: it answers `needsApproval: true` (`server.js:1258-1261`) and makes the card "Approve changes to this bot?" (`lib/asks.js:121-124`); only the owner's yes applies it (`server.js:1028-1032`).
    - The other two ways: the owner edits the field, applied at once (`lib/bots.js:308`); the Chief's `update_bot` waits in Needs you (`lib/bots.js:304-307`, `lib/bot-changes.js:5`, `server.js:83`).
12. **The texts that describe this are stale.** "by default may refine its own usual task" (`lib/chief.js:41`), `"all" (default)` (`lib/mcp-server.js:105`), "on by default" (`README.md:103`, `:108`), where a new bot is memory-only. "The owner can undo it" (`lib/bots.js:1108`, `lib/self-mcp.js:372`), where the change waits for approval.
13. **An approved change is recorded as the owner's.** `server.js:1032` applies it with `by: 'you'`, so the history reads "changed by you" for a change the bot proposed. No proposal was made for this.

## Proposals and verdicts

| # | Proposal | Size | Verdict |
| --- | --- | --- | --- |
| 1 | Every "usual task" becomes "main assignment" on the server, the web page and Android, with the `<usual-task>` tag, the one test, the docs and a term in CONTEXT.md. | Feature, 2 tasks: server, web page and docs; Android | **Now** |
| 2 | Plain "task" that means the same thing to the owner becomes "main assignment" too: the learning toggle, the change history line, the Needs you card label, the "required" error. | Inside 1 | **Now** |
| 3 | The Chief is told in one sentence that the owner calls a bot's task its "main assignment", and uses that name with them. | Inside 1 | **Now** |
| 4 | Android's settings hint stops naming a button it lacks. | Inside 1's Android task | **Now: fix the hint.** Not chosen: a "Run its main assignment" button in Android's empty chat |
| 6 | The web page’s empty chat no longer offers a button that runs the main assignment; the owner asks in the chat instead. | Inside 1’s web task | **Now**: the owner’s own request after the report |
| 5 | Outside the criterion: what bots, the Chief and the README say about changing the main assignment matches the code (a new bot learns memory only; a bot's change waits for approval). | Small, the same lines as 1 | **Now** |

Recommended and chosen: 1 with 2 and 3 as one feature; 4, 5 and 6 join it.

For the plan:

- Replacement strings, owner-facing:

  | Where | Now | Becomes |
  | --- | --- | --- |
  | `public/app.js:1055` | `Usual task` / `what it does when a job runs it, or you tap Usual task` | `Main assignment` / `what it does when a job runs it, and its guide for your messages` |
  | `public/app.js:2280` | `Run its usual task` | removed with its button (proposal 6) |
  | `public/app.js:2302`, `BotChatScreen.kt:186` | `Ran its usual task` | `Ran its main assignment` |
  | `public/app.js:2785`, `:2855` | `leave empty for the bot's usual task` | `leave empty for the bot's main assignment` |
  | `public/app.js:3472` | `Usual task` (changed) | `Main assignment` (changed) |
  | `lib/learning.js:10` | `usual task` | `main assignment` |
  | `BotSettingsScreen.kt:170` | `Its usual task` / `What it does when a job runs it, or when you tap its usual task. A message you send replaces it for that run.` | `Its main assignment` / `What it does when a job runs it without a task of its own. A message you send replaces it for that run.` |
  | `public/app.js:1121` | `While learning, it may propose task and rule changes and improve its skills` / `task and rule changes need your approval` | `While learning, it may propose changes to its main assignment and rules, and improve its skills` / `those changes need your approval` |
  | `public/app.js:1317` | `Changes to its task, rules and skills (N)` | `Changes to its main assignment, rules and skills (N)` |
  | `lib/asks.js:122` | `Task` | `Main assignment` |
  | `lib/bots.js:232` | `Task prompt is required` | `A main assignment is required` |
  | `BotSettingsScreen.kt:270` | `May also improve its own task and rules` | `May also improve its own main assignment and rules` |

- Proposal 6: remove the button at `public/app.js:2279-2281` and its handler at `:2442`; the empty chat keeps the head, the name and the description, and nothing takes the button’s place. `test/browser/hat-change.cjs:150` asserts the button and changes with it; `README.md:28` describes it. Android never had the button. The chip "Ran its main assignment" stays: a run without a message still happens through `POST /api/bots/:id/run` with no `prompt` (`docs/api.md:72`) and the Chief’s `run_bot` (`lib/mcp-server.js:590`), and old runs show it. The Mac app keeps its button.
- Model-facing: the strings of finding 3 take "main assignment" for "usual task"; the tag becomes `<main-assignment>`; "doing your usual job for it" becomes "carrying out your main assignment for it"; `lib/mcp-server.js:95` becomes "The bot's main assignment: the task it performs when a run brings no task of its own."
- Stays: "Give X a task…" (`public/app.js:2390`, `BotChatScreen.kt:128`, `:153`); a job's "Task" (`public/app.js:2785`); the run dialog's "Task" (`public/app.js:917`); the identifiers `Asked.USUAL`, `data-run-default`, `prompt`, `customPrompt` and the tool parameter `task`; the Chief's four-part wording at `lib/chief.js:100-109` and its tests.
- Stored data: change the literal at `lib/jobs.js:94` and `README.md:97` only. Jobs already named "Usual task" keep the name, since renaming them changes their mention handle; old run and memory rows keep the old words, and the memory index version is not raised for this.
- Docs: `README.md:28`, `:32`, `:50`, `:92`, `:97`, `:103`, `:107`, `:108`, `:324`; `android/README.md:26`; `docs/api.md:72`; `CONTEXT.md:10` and a new term.
- No ADR and no `features` flag. `make test` breaks only at `test/mentions.test.js:69`.
- Risk: bots and the Chief may behave slightly differently after their prompts change, and no test covers the bots' prompts.

## Already fine

- No API field, event or `features` flag carries the name.
- The change history stores the key `prompt` and is titled when read; the run chip is drawn from `customPrompt`. Neither goes stale.
- "Task" for a job's own task and "Give X a task…" for a message: the rename ends their collision with the bot's standing task.
- The Chief's chats pick up changed instructions by themselves (`lib/chief.js:173-175`).
- `docs/product/vision.md`, the ADRs and `chief-skills/` hold no "usual task".

## Unverified

- Whether a bot calls `update_instructions` when asked in chat for a lasting change: no run was possible.
- The learning mode and job names on the owner's live server; the counts above are from the data folder on the owner's Mac.

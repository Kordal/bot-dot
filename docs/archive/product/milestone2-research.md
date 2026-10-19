# Milestone 2 research: a team that feels like a messenger

Planning status: stage 6 closed on 2026-10-02; next: delivery, starting with MSG-001, MSG-005 or MSG-008.

Date: 2026-10-02. Revision inspected: `main` at `670b633` (Milestone 1 merged through pull request 131, then the scaffold update). The integration branch `milestone1` is merged into main and no task is claimed. No product tests were rerun. This note is research evidence, not an implementation plan.

## Why this milestone

The owner asked for a comparison with another product, Grok Bot (Mac app, version 0.66.0), saying what matters is "how easy it feels" and "how bots feel alive". The comparison was made by using that app in the owner's own account on 2026-10-02: reading its screens and asking four of the owner's bots about their setup. From the findings the owner picked three candidates for this milestone:

1. Unread state in the bot list and in a chat.
2. A sharper bot description, written by the Chief of Staff.
3. A short "what I'm about to do" line from a bot before longer work.

## What the product delivers today

Verified by reading the code at the revision above:

- **The bot list has no unread state.** Nothing on the botdot server, the web page, the Android app or the Mac app records what the owner has read (no match for unread, last read or last seen in `server.js`, `lib/`, `public/app.js`, `android/` or `macos/`). A bot's row shows its head, name, the time of its last run and a preview of that run's result (`drawContacts()` in `public/app.js`).
- **The order of the list is the owner's.** Pinned bots first in the owner's order, then groups A to Z, then bots without a group; inside a group the owner's order, changed by dragging or by asking the Chief (`byPlace` in `public/app.js`, `Sidebar.swift`, the `pinned`, `group` and `order` fields).
- **"Needs you"** already gathers everything waiting for the owner's OK. It is about approvals, not about replies the owner has not read.
- **The Chief creates bots** with `create_bot` (`lib/mcp-server.js`); only `name` and `prompt` are required. Its guidance on the task prompt is one line: "Design bots carefully: a specific task prompt, a one-line description, and only the tools the job needs" (`SYSTEM_PROMPT` in `lib/chief.js`). It asks "at most one or two quick questions". Nothing says what a task prompt contains, and nothing tells the Chief to read the bot back after creating it.
- **Staying quiet already exists for scheduled jobs.** A scheduled AI job reaches the owner only when the bot calls `notify_owner`; "nothing new" replies never do; quiet hours hold non-urgent reports (`lib/chief.js`, `lib/jobs.js`).
- **A bot's own words during a run are dropped.** botdot reads Claude Code's event stream and keeps only tool calls as steps ("Searching the web for …", `describeStep` in `lib/bots.js`, line 903 onward) and the final result. Text a bot writes between tool calls is not shown anywhere.
- **Bots are told not to narrate.** The shared style added to every bot says "Don't narrate your process, tools, commands, file permissions or what you couldn't access" (`FRIENDLY_STYLE` in `lib/bots.js`). A "what I'm about to do" line has to be reconciled with this rule.
- **A working bot already shows it.** Its head has a working state, its row says "Working…", and a live run lists its steps in plain words.

## Evidence boundaries

- The Grok Bot findings are first-hand observation of one account on one day, on the Mac app only. Its phone app was not seen.
- What Grok Bot's bots said about their own setup is their report. Their role texts were quoted from their profiles; the platform's hidden system prompt was refused and not pursued.
- No user other than the owner has given feedback. "Feels easy" and "feels alive" are the owner's words and are judged by the owner.
- The code findings above were read, not exercised: no test was run for this note.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| Grok Bot marks a bot with a blue dot when it has new messages, draws a "NEW" line in the chat where the owner left off, and offers a "More unreads" pill that jumps to the next one (observed). botdot has none of these (verified). | Unread state: a mark on the bot, a line in the chat, kept on the botdot server so web, Android and Mac agree. |
| Grok Bot sorts each group by latest message (observed). botdot's order is the owner's, set by dragging (verified). | Leave the order alone: sorting by latest message would undo the owner's own order. An owner decision at stage 3. |
| A Grok bot is a name and one description; the owner's bot-design skill there writes it as one job, anti-jobs, voice, wake, and for non-coding bots the concrete how; it then reads the live profile back (the bots' report, quoted). The Chief's guidance is one line (verified). | Give the Chief that structure for every task prompt it writes, and have it read the bot back with `get_bot` after `create_bot` or `update_bot`. |
| The same skill tells the designer to ask only what an experiment cannot settle and not to ask "should I create it?" once the job is clear (the bots' report). The Chief already asks at most two questions (verified). | Small wording change only; the behaviour is already close. |
| Before a web search a Grok bot sent "Sprawdzam pogodę w Brukseli.", then showed "Searching the web", then the answer (observed). botdot shows the step but drops the bot's own sentence (verified). | Show a bot's short opening line in its chat while it works, and change the shared style so one such line is allowed. |
| Grok Bot's main bot wrote first: "I'm taking a look around to see if there's anything I can pick up for you" (observed). | Not picked for this milestone. Candidate for later. |
| One Grok bot runs weekday and Monday checks of chats and routines and proposes fixes as a numbered list (the bots' report). botdot has `lib/learning.js` and `lib/problems.js`, not compared in depth. | Not picked. Needs its own look before any proposal. |
| Voice input, reactions and reply, group chats, a plugin marketplace (observed). | Not picked: each adds controls, against the owner's minimal-UI rule. |

## Carried forward from Milestone 1

From the review notes in [milestone1-test.md](../../product/milestone1-test.md), left for the owner to know and still open: Android notifications show a bot as a plain coloured circle; at most eight marks in Android's "Needs you" row and the Mac's menu bar; browser tests are in no gate because the repository does not carry Playwright. The last one limits how this milestone's web behaviour can be tested automatically.

No task is unfinished and nothing is blocked from outside.

## Proposed boundary for the discussion

In: unread state on web, Android and Mac; the Chief's way of writing a bot's task; one opening line from a working bot. The Linux app stays out (Linux uses the web page). Out: reordering the list by latest message, bots writing first, healthcheck routines, voice, reactions, group chats.

## Existing solutions

Points: (1) unread state, (2) how a bot is defined and read back, (3) interim status while working.
Pages were opened on 2026-10-02. Most were read through a fetch tool that summarises the page, so quoted wording may differ slightly from the page. Telegram and Matrix text was read from the raw HTML.

### Grok Bot (xAI)
https://docs.x.ai/grok-bot
Named, persistent bots ("AI teammates with names, jobs, and context") that you message like teammates. Closest product to botdot: bots as sidebar contacts, bot-to-bot messages, routines.
- (1) The sidebar separates three states: "Needs attention" (question, approval, handoff), "Unread activity" (new result), and working/typing. Opening a conversation marks it read. Notifications are suppressed while the app is in focus, but the sidebar and dock badge still show unread. https://docs.x.ai/grok-bot/settings-and-notifications. Shortcuts exist for previous/next bot (`Alt+↑/↓`); a next-unread shortcut is not documented. https://docs.x.ai/grok-bot/chat-and-collaboration
- (2) A bot gets a short name, "one primary job", and a description of how it works; the examples end with a "Never ..." line. https://docs.x.ai/grok-bot/get-started. The description holds durable rules; task instructions go in the chat. https://docs.x.ai/grok-bot/bots. Routines confirm owning bot, schedule and time zone, input, expected result, approval boundary. https://docs.x.ai/grok-bot/skills-routines-and-automations. Read-back after creation: not documented.
- (3) The transcript shows tool activity, questions and approvals next to messages. A short "about to do" message: not documented. https://docs.x.ai/grok-bot/chat-and-collaboration

### OpenClaw
https://docs.openclaw.ai/concepts/agent-workspace
Open-source, self-hosted agent gateway that talks through messaging apps. Overlaps on self-hosting, personas, and wake/quiet rules.
- (1) Not documented (it relies on the host messenger).
- (2) The persona is split into files: `AGENTS.md` (operating instructions), `SOUL.md` (persona, tone, boundaries), `IDENTITY.md` (name, vibe, emoji). Same page. The SOUL template has sections Core Truths, Boundaries, Vibe, Continuity. https://docs.openclaw.ai/reference/templates/SOUL
- Wake/quiet: heartbeat runs every 30 minutes by default; the agent answers `HEARTBEAT_OK` / `NO_REPLY` when nothing needs attention and the system suppresses it; `activeHours` limits the window. https://docs.openclaw.ai/gateway/heartbeat
- (3) Typing modes `never`, `instant`, `thinking`, `message`, refreshed every 6 seconds by default. https://docs.openclaw.ai/concepts/typing-indicators

### Slack (agent platform and client)
https://docs.slack.dev/ai/developing-ai-apps
Guidelines and API for agents inside Slack. Overlaps on status lines and unread navigation.
- (1) "Jump to next unread channel or DM" is `Option/Alt+Shift+↓`; `Esc` marks the conversation read; `Option/Alt+Click` marks a message unread. https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts. An Unreads view lists all unread conversations. https://slack.com/help/articles/226410907-View-all-your-unread-messages. The "new messages" line itself: unverified (no page opened).
- (2) Not documented for personas.
- (3) `assistant.threads.setStatus` sets a status such as "is thinking..."; it takes up to 10 rotating `loading_messages`, clears when the app replies, and times out after two minutes. https://docs.slack.dev/reference/methods/assistant.threads.setStatus. A newer `agents.sessions.setStatus` has lifecycle states `processing`, `active`, `suspended` (waiting for the user), `closed`. https://docs.slack.dev/reference/methods/agents.sessions.setStatus. Task cards and plan blocks show steps as `in_progress`, `completed`, `error`. https://docs.slack.dev/ai/ai-apps-best-practices

### Matrix
https://spec.matrix.org/latest/client-server-api/#read-and-unread-markers
Open chat protocol. Overlaps on the unread data model only.
- (1) Two positions per room. The "fully read marker" (`m.fully_read`) ends the part the user has read. The read receipt ends the part the user "might have read". Receipts clear notification counts. A separate boolean `m.marked_unread` lets the user flag a room for later; clients should not move `m.fully_read` when setting it, and should reset it when the room is opened. Same URL.
- (2), (3) Not applicable.

### Telegram Bot API
https://core.telegram.org/bots/api#sendchataction
Bot API for a messenger. Overlaps on the live status line.
- (3) `sendChatAction` shows "typing" for "5 seconds or less" and clears when the bot's message arrives. Telegram recommends it over a "please wait" text, and only when the reply "will take a noticeable amount of time". `sendMessageDraft` streams an ephemeral draft; empty text shows a "Thinking…" placeholder. https://core.telegram.org/bots/api#sendmessagedraft
- (1), (2) Not documented for bots.

### Claude Code subagents and Claude Cowork
https://code.claude.com/docs/en/sub-agents
Agent definitions as Markdown files with frontmatter. Overlaps with how the Chief picks a bot.
- (2) `name` and `description` are required. The description is "when Claude should delegate to this subagent"; keep it short and move detail into the body, which loads only when the agent runs. "use proactively" in the description encourages delegation. `tools` is an allowlist.
- (3) Cowork: "Progress indicators show what Claude is doing at each step". https://support.claude.com/en/articles/13345190-get-started-with-cowork
- (1) Not documented.

### Letta
https://docs.letta.com/guides/agents/memory-blocks
Framework for stateful agents. Overlaps on persona storage and read-back.
- (2) The persona is a memory block with `label`, `description`, `value`, `limit`. The description is "the main information used by the agent to determine how to read and write to that block". Read-back: `client.agents.blocks.list(agent.id)` or retrieve by label; `GET /v1/agents/{agent_id}` returns system prompt, blocks and tools. https://docs.letta.com/api-reference/agents/retrieve
- (1), (3) Not documented on the pages opened.

### Cursor cloud agents
https://cursor.com/docs/cloud-agent
Coding agents that run remotely. Small overlap.
- (1) A webhook fires only on `FINISHED` or `ERROR`, with an optional `summary`. https://cursor.com/docs/cloud-agent/api/webhooks. Sidebar "Needs Attention" grouping: unverified (search result only).
- (2), (3) Not documented on the pages opened.

### Dropped
ChatGPT agent and Tasks (help.openai.com and openai.com returned 403). Lindy (the docs opened describe only Slack setup). Poke (docs cover recipes: onboarding context plus integrations, https://poke.com/docs/creating-recipes; nothing on the three points).

## Ideas worth adopting
- Three sidebar states, not one: needs your answer, new result, working. Grok Bot: https://docs.x.ai/grok-bot/settings-and-notifications. This fits botdot's coloured dots.
- Keep the "NEW" divider position separate from the unread mark, so "mark unread" does not move the divider. Matrix: https://spec.matrix.org/latest/client-server-api/#read-and-unread-markers
- One "next unread chat" shortcut, and opening a chat marks it read. Slack: https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts
- Bot definition = name, one primary job, how it works, and a closing "Never ..." line. Grok Bot: https://docs.x.ai/grok-bot/get-started
- Keep a short "when to use this bot" line apart from the long instructions. Claude Code: https://code.claude.com/docs/en/sub-agents
- Give wake and quiet rules their own slot, with an explicit "nothing to report" answer the system hides. OpenClaw: https://docs.openclaw.ai/gateway/heartbeat
- Read the saved bot back by API after creation. Letta: https://docs.letta.com/api-reference/agents/retrieve
- Status line that clears itself when the answer arrives and times out if none comes. Slack: https://docs.slack.dev/reference/methods/assistant.threads.setStatus; Telegram: https://core.telegram.org/bots/api#sendchataction
- Prefer an ephemeral status over a saved "please wait" message. Telegram, same URL.

## Solutions that make part of botdot unnecessary
None found. Grok Bot covers the same ground (bots as contacts, unread states, routines, bot-to-bot messages) but is a hosted xAI product, not self-hosted, and has no Chief of Staff. OpenClaw is self-hosted but has no dashboard of its own for unread state.

## Uncertainties resolved at stage 4

Checked on 2026-10-02 on a throwaway copy of the server (branch `prototype/milestone2-unread`, scratch data).

| Uncertainty | How it was checked | Result |
| --- | --- | --- |
| Will a bot write an opening line before its first tool call when told it may? | The shared style was given one exception ("first write one short line saying what you are about to do … under ten words, no tool names"), and three bots were each asked something that needs a tool, one of them in Polish. | Three of three did: "Checking my scheduled jobs.", "Checking my past runs.", "Sprawdzam notatki o dysku." Each line came as text before the first tool call in the event stream, in the owner's language, and was not part of the final reply. Three runs are a small sample; the delivering task repeats the check in its tests with a recorded stream, and the acceptance test with real runs. |
| Which apps already report the chat on screen? | Read the code. | The web page and the Mac app do (`POST /api/presence`); the Android app does not and has to start. |
| Can Android draw a bot's head with its hat in a notification? | Read `BotFigure.kt` and `Notifier.kt`. | The head is drawn by a `DrawScope` function and notifications take a bitmap. Drawing the same function into a bitmap is a standard Compose facility; left to the task as a routine choice. |
| Where does unread state live? | Design question. | Proposed in [ADR 005](../../adr/005-read-positions-on-the-server.md), owned by the first task. |

No finding changes the agreed outcome or scope. Nothing is blocked from outside.

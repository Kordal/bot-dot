# Milestone 10 research: one chat with several bots

Planning status: stage 6 closed on 2026-10-08; next: delivery, starting with GRP-001.

Date: 2026-10-08. Revision inspected: `main` at `5b2cf30` (Milestone 9 merged through pull request 292, then the features image cleanup, "a long reply is scannable" and "every bot learns"). `node scripts/agent-local.mjs phase` prints `between`: every task is done and `main` holds all of `feature/image-cleanup`. Tests rerun: `test/bots.test.js`, `messages.test.js`, `mentions.test.js`, `unread.test.js`, `awaits.test.js` and `message-waits.test.js` (97 pass). No botdot server was started and no message was sent. This note is research evidence, not an implementation plan.

## Why this milestone

On 2026-10-08 the owner asked: "I would like to have a functionality to create a group chats with bots. For eg. I would like to create a "Dev group" which will consist of bots related to programming", and showed a group chat of Grok Bot as the example ([Grok Bot](#grok-bot-xai) below). Group chats were seen there for the [Milestone 2 note](milestone2-research.md) and left out of [Milestone 2](../../product/milestone2.md) ("Voice input, reactions and replies to a message, group chats, a plugin marketplace"), because each adds controls.

## What the product delivers today

Every chat is one bot, or one chat of the Chief of Staff. To ask three bots the same thing the owner writes three messages in three chats, or asks the Chief, whose answer is the Chief's own words.

Read at `5b2cf30` on 2026-10-08 by one reader of the server, the web page and the Android app. "(C)" marks a line opened a second time for this note; the rest was read once and not exercised.

### A group today

| Area | Read at `5b2cf30` |
| --- | --- |
| What it is | A text on each bot, `group: ''` in `BOT_DEFAULTS` (`lib/bots.js:139`) (C), cut to 40 characters (`:219`). No record, no id, no list of members: a group exists while one bot carries its name |
| In the list | Pinned bots, then groups A to Z, then "Other"; a group folds (`public/app.js:723-780`, `870-877`; Android `ui/HomeScreen.kt:131-156`) |
| Making and changing one | Web: "+ New group" in a bot's settings, dragging a bot onto a heading, and a "⋯" menu that renames or removes (`public/app.js:884-1051`). Android: a "Category" text field in a bot's settings and dragging; no rename or remove. The Chief: `update_bot` with `group`, one bot at a time |
| The rename route | `POST /api/groups/rename` (`server.js:1164`) (C). It is not in `docs/api.md` (C) and the Chief may not call it |
| The word | "Group" is also a kind of tile on the Board (`CONTEXT.md`, Tile) |

### A chat is one bot

| Area | Read at `5b2cf30` |
| --- | --- |
| A bot's chat | Not stored: it is every run with that `botId` (`lib/bots.js:409-417`, `527`, `547`). One run is one message in and one reply out |
| The Chief's chats | Several, each a file of messages with a role; a bot's result comes back there as a report (`lib/chief.js:246-257`, `1153-1171`) |
| The key of a chat | `bot:<id>` or `chief:<id>`, nothing else: `/^(bot|chief):…$/` (`lib/read.js:18`) (C), and the same two in the presence check, the message keys, the web page's address and Android's routes `bot/{id}` and `chief/{id}` |
| Who wrote a reply | Implied by the chat on both apps: a reply in a bot's chat is that bot's (`public/app.js:179`, `2581-2592`; Android `ui/BotChatScreen.kt:217`) |
| One message to three bots | Three calls, three runs with nothing that joins them, each in its own chat, each with its own Stop and its own message key (`server.js:2141-2157`) |
| Running at once | No cap on the number of runs across bots (`lib/bots.js:405`). Per bot: one run, ten of the owner's messages waiting (`QUEUE_MAX`, `OWNER_MAX`, `lib/bots.js:1604-1605`) (C), [ADR 011](../../adr/011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md) |
| Stop | Ends one run and says who ended it; a Stop in a Chief chat ends the runs that reply started ([ADR 012](../../adr/012-a-run-keeps-who-ended-it-and-a-stop-ends-what-its-turn-started.md)). Nothing else stops the runs of several bots together |

### Bots and each other

| Area | Read at `5b2cf30` |
| --- | --- |
| A bot writes to a bot | `message_bot`, to those it may message and to whoever wrote to it (`lib/self-mcp.js:261-320`, `lib/bots.js:1919-1973`). It starts or queues a run of the other bot, or waits in its inbox |
| What stops a chain | Twenty hops (`MAX_HOPS`, `lib/messages.js:12`) (C); a wait for answers ends after 10 quiet minutes or 60 in all (`lib/awaits.js:11-12`). No limit per minute |
| How the owner sees it | Folded to "Message from X" and "Messaged X" in each bot's own chat. Such a run is never a new reply (`lib/read.js:26-31`; rerun: "a run the Chief or another bot started is not new") |
| What a bot reads | Its own chat and its own past runs. Recall and the lookup never reach another bot's runs (`server.js:1666`, `lib/bots.js:1347-1349`; Milestone 9's D26) |
| A mention | `@Bot` in the owner's message sends nothing: it adds a line to that run's prompt saying who the bot is, "nothing was sent to them" (`lib/mentions.js:15-41`) (C). `CONTEXT.md` defines a mention so |

### What follows a chat

| Area | Read at `5b2cf30` |
| --- | --- |
| New reply, read position | Counted per bot from its runs or per Chief chat; `POST /api/read` accepts the two kinds of key only ([ADR 005](../../adr/005-read-positions-on-the-server.md), `lib/read.js:76-105`, `server.js:947-960`) |
| Opening line, waiting messages, a question | Each kept per bot or per run and sent on the feed with one `botId` (`lib/events.js:60-84`) |
| A card | Drawn in Needs you and at the end of the chat it was asked in |
| Memory of a past run | One `bot_id` per run in the index (`lib/memory.js:189-193`); "left out" is per run |
| An app asks first | `features` in `/api/version` and the feed's `hello` (`server.js:2273`) (C) |
| Size of the chat code | Web: one file, `public/app.js`, 5,984 lines, about 750 of them the two chat views. Android: `ui/BotChatScreen.kt` (350), `ui/ChiefScreen.kt` (390), `ui/ChatModels.kt` (692), `ui/Components.kt` (791) |
| Tests | `npm test` runs the server's and the web page's tests against a stand-in for Claude. Android's unit tests run only in the resilience gate (`Makefile:14-17`) (C). Browser walks are run by hand and are in no gate |

## Evidence boundaries

- The code was read, by one reader, and six test files were rerun. Nothing new was tried: no run of two bots on one message was started.
- What Grok Bot does comes from its documentation, opened on 2026-10-08, and from one screenshot of the owner's account. Its limits on bots answering bots, and what a bot there reads of the group, are documented nowhere that was opened.
- Every test in the gates uses a stand-in for Claude. Whether real bots in one chat repeat each other, agree with each other or go on without end is model behaviour, seen by nobody yet in botdot.
- How many runs at once the owner's Claude sign-in carries before it slows or refuses is not known. botdot has no cap of its own.
- No user other than the owner has asked for this or tried it.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| The owner writes the same thing in several chats, or goes through the Chief (verified). Grok Bot, OpenClaw, Poe and Open WebUI have one chat for it (their documentation). | A chat with members: a record of its own, a third kind of chat key beside `bot:` and `chief:`, on the server, the web page and Android. An architecture decision. |
| Who answers is the one thing the products disagree on: every member (OpenClaw without a mention), nobody without a mention (Poe, Open WebUI), the bots decide (Grok Bot), a chooser picks one (AutoGen, LobeHub). In the owner's screenshot both bots answered both times. | An owner decision at stage 3, on a prototype: a mention picks the bots that answer; without one, either every member answers and may pass, or the bots decide. |
| A mention sends nothing today, by definition (verified). | In a group chat a mention would address a bot. `CONTEXT.md` and the note a mention adds to a prompt change with it, or the group gets another way to address one bot. |
| A bot reads only its own runs (verified). In a shared chat the second bot would not know what the first said. | Hand each member the chat as the owner saw it, as "A bot remembers its chat" does for one bot. Each bot keeps its own notes and past runs (OpenClaw, Poe, Claude Code). |
| Bots may answer bots for twenty hops, and such runs are folded and never new replies (verified). Grok Bot's makers report "duplicate work and noisy updates"; OpenClaw counts turns per message of the person, one round by default. | A bound per owner message, stated in the scope: each member speaks once, and again only when a member named it. A reply in the group is a new reply, whoever it answers. |
| Three bots on one message are three runs with three Stops (verified). | One Stop under the group chat ends what the owner's message started, as a Stop in a Chief chat does ([ADR 012](../../adr/012-a-run-keeps-who-ended-it-and-a-stop-ends-what-its-turn-started.md)). |
| New reply, read position, opening line and waiting messages are per bot (verified). | The same four for the group chat: one read position, several bots working at once shown under it. |
| A bot that is in a group chat is also working in its own chat (verified: one run per bot, the owner's message waits). | A message to the group waits for a busy member, shown as waiting, as [ADR 011](../../adr/011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md) has it. Whether the others answer meanwhile is a stage 3 question. |
| A card is drawn at the end of the chat it was asked in (verified). Grok Bot keeps approvals and logins out of a group; Claude Code: a teammate cannot give consent. | Decide where a card asked in a group chat is drawn. Another bot's message is never an OK. |
| Grok Bot makes a group with a control and edits members in a panel (observed). botdot's rule 5: no new control for what the Chief can do by chat. The Chief already places bots in groups (verified). | The Chief makes the group chat and changes its members by chat. The least the apps need is the row in the list and the chat. An owner decision at stage 3. |
| "Group" already means the folder in the list and a kind of tile (verified). The owner's example, "Dev group", and Grok Bot's screenshot both put the chat inside the folder of its bots. | Decide the word, and whether the group chat is the folder's own chat (its members are the folder's bots) or a thing apart with members of its choosing. |
| No cap on runs at once (verified). Claude Code reports about seven times the tokens for a team; Grok Bot, Claude Code and LobeHub all advise small groups. | A limit on members, two to six. What the owner's sign-in carries at once is a stage 4 question. |

## Carried forward from Milestone 9

No task is unfinished and nothing is blocked from outside. From [milestone9-test.md](../../product/milestone9-test.md), open and not part of this request: real use on the owner's own botdot server and phone (D30); the `CLAUDE.md` and auto-memory files bots left before Milestone 9; the low findings under "Follow-up". One of them meets this milestone: "Whether a bot may hand its private notes to a teammate is decided nowhere."

From the improvement reports: the interaction audit's groups "One voice" and "The Chief as helper" were named for Milestone 8 and not chosen; the Board's label is marked "Later". Neither is part of this request.

## Proposed boundary for the discussion

In: one chat in which the owner writes to several bots, on the web page and in the Android app; who its members are and how the owner sets them; who answers a message and how one bot is addressed; every reply showing its sender; each member reading what the others said; a bound on bots answering bots; one Stop; new replies and the read position of the chat.

Out: people other than the owner in a chat; a group that writes first; bots meeting without a message from the owner; voice, reactions and replies to one message; a chooser model that picks the speaker; anything that shows costs; the Mac app ([ADR 008](../../adr/008-the-mac-app-is-no-longer-developed.md)).

## Stage 4: what was tried and read

2026-10-08, after the owner agreed the scope of [milestone10.md](../../product/milestone10.md).

### Do real bots take turns?

The assumption the outcome stands on: told the group's rules in its prompt, a bot passes when it has nothing to add, hands the work on by naming a member, and ends the work by naming nobody.

Tried on real Claude (`claude -p`, Claude Code 2.1.293, the model alias `sonnet`, no tools, no settings, an empty folder). A script played the botdot server: it gave the turns, read the one word `PASS` and `@Name`, and would have stopped at 12 replies. Three bots (Issue Writer, Coder, Reviewer), each with a main assignment of one sentence and the five rules. Seven exchanges, 17 turns. The script and its output were scratch files and are not kept in the repository.

| Exchange | Runs | What happened |
| --- | --- | --- |
| "We will work on dark mode together. All clear?" | 2 | Once as wanted: Issue Writer and Coder answered, Reviewer passed. Once not: Issue Writer took it as an order and handed on, and the three did the work in five replies |
| "@Coder which branch are you on?" | 2 | Coder answered, nobody else had a turn, both times |
| "The settings page needs a dark mode switch." | 2 | Issue Writer, then Coder, then Reviewer, each naming the next; Reviewer named nobody and it ended. Three replies, both times |
| "Coder and Reviewer: keep reviewing and fixing pull request 310 until neither has anything left." | 1 | Issue Writer passed, Coder handed on, Reviewer had no finding and named nobody. Two replies |

- **Holds:** the pass (2 of 2 where one was due, as the single word), the mention, the hand-on, and ending by naming nobody (7 of 7 exchanges ended by themselves; no reply thanked or confirmed).
- **Does not hold yet:** a question can start the work. The prompt of the spike told the bots to "state your part as done", which pushed that way; the bots' instructions must say that a question is answered and not acted on, and G25 looks for it ("nobody twice").
- **Not shown:** the limit. Without tools the two bots had nothing to correct. It is the server's own count and is tested on the stand-in (G22).
- **Time:** a turn took 2.5 to 6 seconds, a pass 2.5 to 3. A bot's real run also starts its tools and reads its notes; how long a round of six feels is seen in the live walk.

### What the code says about a turn

Read at `5b2cf30` by one reader; nothing was run.

| Question | Read |
| --- | --- |
| How does a run know its chat? | Every run is a fresh `claude -p`; the last exchanges are printed into its prompt (`lib/chat-history.js:1-2`, `lib/bots.js:911`). `build(runs, …)` takes run records, not a bot; its words are for one bot ("You replied:") |
| Can a handed-on turn be a teammate's message? | No. `fromBot` makes the run internal, never a new reply, without a chat block, and it replies to its asker in the asker's own chat (`lib/bots.js:894`, `:1034`, `:1169`) |
| Is there a way to say nothing? | Only for a scheduled run (`quietRun`, `lib/problems.js:59`). An empty reply of a run the owner started is a drawn, counted reply |
| Would an older app show a group's turn? | Yes, unless the server leaves it out: both apps build a bot's chat from its `botId` alone, and Android notifies for a finished run that is `new` (`public/app.js:2636`, `data/Api.kt:107`, `feed/Notifier.kt:762`) |
| What links runs for one Stop? | Nothing stored. The Chief's Stop goes by a set kept in memory per turn (`lib/chief.js:1408-1427`) |
| How is a bot named in a mention? | `@IssueWriter`, the name without spaces, any case; of two bots with the same short name the first in the list wins (`public/mentions.js:23-46`). `findMentions` is pure and can read a reply on the server |
| Where does an owner's file go? | Into one bot's workspace (`POST /api/uploads?to=`). `uploads.copyIn` copies a file into another workspace and is what `message_bot` uses (`lib/uploads.js:212-227`) |
| Which chat does a card belong to? | None is stored: a card has its `botId` and its run, and the web page draws it at the end of that bot's chat (`public/app.js:4740-4763`) |
| How is "only in the owner's turns" kept for the Chief? | Twice: the tool is not offered (`BOT_DOT_TURN`, `lib/mcp-server.js:12`) and the route refuses (`server.js:725`) |
| What else goes by `botId`? | `lastStatuses`, `unreadByBot`, `asksByBot`, `announceFinished`, `recentConversation`, `answeredRun`, `earlierInChain`, `carryFacts`, the search hits (`lib/bots.js:537-744`, `:2040`, `server.js:2181`) |

### Decisions and what stays open

Three Proposed ADRs, each resolved and accepted by its owning task before the behaviour that depends on it:

- [ADR 018](../../adr/018-a-group-is-a-chat-of-its-own-and-a-turn-is-a-run-of-its-member.md): a group is a chat of its own, and a turn in it is a run of its member. GRP-001.
- [ADR 019](../../adr/019-the-botdot-server-gives-the-turns-in-a-group.md): the botdot server gives the turns. GRP-002.
- [ADR 020](../../adr/020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md): a member reads the group's chat and keeps its own memory. GRP-003.

| Uncertainty | State | Who resolves it | Blocks |
| --- | --- | --- | --- |
| Real bots take turns as told | Held in the spike, but for a question that started work | GRP-004 (the wording), GRP-008 (the live walk, G25) | Nothing: the scope's evidence limit says it |
| An older app sees nothing of a group | Needs the server to keep a group's runs and events apart (ADR 018) | GRP-001 | GRP-002 and every later task |
| A pass and a handed-on turn have no form today | Decided in ADR 019; the pass word is left to its task | GRP-002 | GRP-004 |
| A member's note after it read other members' replies | Decided in ADR 020, with its cost | GRP-003 | Nothing |
| How long a round of several members takes with real bots | Not known; 2.5 to 6 seconds a turn without tools | GRP-008 (the live walk) | Nothing |
| An Android app from Milestone 9 against this server (G19) | Milestone 9 could not run its own such scenario | GRP-006 (tests on what the server sends an app without `groups`), GRP-008 | Nothing |

No finding changes the agreed outcome or scope.

## Existing solutions

Date: 2026-10-08. A delta on the Milestone 2, 8 and 9 notes. Questions: (1) who answers, (2) bots answering bots and what stops them, (3) how a group is made, (4) what each bot sees and remembers, (5) what works badly. Every page was read raw with curl today (Markdown twins, stripped HTML, the help-centre API of Poe and Character.AI, raw GitHub files). One web search, for ChatGPT, found no page that opens. "Not documented": the pages opened do not say.

### Reused
- Grok Bot has group chats: Milestone 2 note, 2026-10-02, seen in the Mac app and not picked ("each adds controls"). How they work was not recorded.
- OpenClaw, https://docs.openclaw.ai/concepts/multi-agent: a workspace, voice and session store per agent; "The chief of staff remains the human's point of contact" (Milestone 8 note, 2026-10-06); "each agent searches only its own configured memory" (Milestone 9 note, 2026-10-06). Both still on the page.
- help.openai.com returns 403: Milestone 2 and 9 notes. Confirmed today.

### Refreshed or added
All 2026-10-08.
- Grok Bot: its group chat is documented; the earlier note had only the sighting.
- OpenClaw: broadcast groups, mention gating and bot loop protection, on pages no earlier note opened.
- Telegram: the Milestone 2 note covered its status line only.
- Questions 1 to 5 and every other product: new.

### Grok Bot (xAI)
https://docs.x.ai/grok-bot/chat-and-collaboration, https://docs.x.ai/grok-bot/faq
The closest product: one person, named bots as contacts, groups of bots.
- (1) Bots decide: "Write normally to let the participating Bots decide who should respond." "Type `@` and select a Bot when one teammate owns the request." "Use `@everyone` sparingly".
- (2) Yes: "Bots can post into the group and pass work among themselves." A limit: not documented.
- (3) A control: "In **New chat**, select two to six Bots"; the name is generated; "Group membership can be edited later." A bot in several groups: not documented.
- (4) Not documented, beyond: its "conversation and learned role are separate from other Bots".
- (5) "Too many parallel handoffs can create duplicate work and noisy updates."
- Different: "Approval requests, secret and login requests, and email or Slack drafts do not appear in a group."
- **Observed on 2026-10-08**, in one screenshot of the owner's own account (the Mac app, a group "bot-dot dev" of Issue Writer and Claude Coder):
  - The group is a row in the list, inside the category "Programming" beside its two bots, with a stacked picture of the owner's initial and the members' heads, and its last message as the preview.
  - A side panel has the tabs Details, Library and Members; Members lists the two bots and "Add Member".
  - "We will work on coding together" and "All clear ?" each got one reply from each bot, one after the other.
  - A bot answered a bot without a message from the owner: Claude Coder corrected Issue Writer with its name and small head in the text, and Issue Writer replied "Thanks, noted."
  - Every reply has its sender's name above the bubble, in the bot's colour, and its head beside it. The composer reads "Message bot-dot dev".
  - Not shown: who else answered "Can someone create a process flow ?" (the image ends at Issue Writer's reply), any limit on bots answering bots, and a message to one bot only.

### OpenClaw broadcast groups
https://docs.openclaw.ai/channels/broadcast-groups (experimental), https://docs.openclaw.ai/channels/bot-loop-protection
Self-hosted like botdot; several agents answer in one room. Its own example is "a dev group".
- (1) "Select explicitly mentioned participants; if none match, select all." In parallel by default.
- (2) Bounded per message: `maxRounds` defaults to 1 (at most 4), `maxTurns` to the number of agents. A further round is for those that replied "or were addressed by name in a sibling's final reply", told "to reply only when adding something new and otherwise return `NO_REPLY`". "All participants passing ends the thread." Where bots read bots on a channel, a pair is also cut off after 20 events in 60 seconds, for 60 seconds.
- (3) A configuration file, one entry per room, "at most 16 participants".
- (4) "Each agent has its own session key and isolated context." "sibling replies are shared only through bounded follow-up digests". Sessions are per agent and per group.
- (5) "parallel responses may arrive in any order"; live drafts are off "so concurrent participants do not overwrite each other's drafts"; "keep broadcast groups to a handful of agents".

### Claude Code agent teams
https://code.claude.com/docs/en/agent-teams (experimental), https://code.claude.com/docs/en/costs
botdot's own engine.
- (1) The lead answers; "You can also talk to any teammate directly without going through the lead."
- (2) Yes: "any teammate can message any other by that name". No broadcast: "To reach everyone, send one message per recipient." A limit: not documented.
- (3) By chat; "One team per session".
- (4) "Each teammate has its own context window." "The lead's conversation history does not carry over."
- (5) "approximately 7x more tokens than standard sessions when teammates run in plan mode"; "Start with 3-5 teammates".
- Better: "A teammate can't approve a permission prompt or supply consent on your behalf".

### SillyTavern group chats
https://docs.sillytavern.app/usage/core-concepts/groupchats/
Open source; one person and several characters.
- (1) Manual. Natural: members named in the last message, then each by its "Talkativeness", else one at random. List order. Pooled: "one random character who hasn't spoken yet since the last user message".
- (2) Only in auto-mode, "after a 5-second delay"; it stops "When the user starts typing".
- (3) Controls: add, remove, reorder, mute, "Force Talk".
- (4) "the group chat history is always shared between all the members."
- (5) One joined prompt: "characters being confused about themselves, having merged personalities".

### Poe group chats
https://help.poe.com/hc/en-us/articles/19944206309524-Poe-FAQs
People and AI models in one chat.
- (1) "By default, bots don't automatically respond to every message in group chats. You need to mention the bot directly"; a setting, "Automatic Replies", changes it.
- (4) Memory "does not activate in group chats".
- (3) A "New group chat" button. (2), (5): not documented.

### Open WebUI
https://docs.openwebui.com/features/channels, https://docs.openwebui.com/features/chat-conversations/chat-features/multi-model-chats
Self-hosted; channels of people and models.
- (1) "Channels are passive by default." "When you need input from a model, just tag it". The reply goes "in a thread under your message".
- (4) "Three models, one shared context, one timeline."
- Different: in a multi-model chat every chosen model answers, and "Merge Responses" adds one "Merged Response".
- (2), (5): not documented.

### LobeHub agent groups
https://github.com/lobehub/lobehub/blob/main/docs/usage/agent/agent-team.mdx
Open source; added today.
- (1) "Every Agent Group includes a built-in Orchestrator", "assigning tasks to the right Agents". (3) A control.
- (5) "Larger teams can slow the workflow without improving results."

### TypingMind and LibreChat
https://docs.typingmind.com/ai-agents/build-multi-agent-workflow, https://www.librechat.ai/docs/features/agents
- TypingMind (1): the person names one agent per part of a message, `@[AI_Agent_name]`, and the parts run in that order.
- LibreChat: no group. A fixed chain ("maximum of agents that can be chained is 10") or a handoff; a run ends at 25 steps by default.

### Telegram and Slack
https://core.telegram.org/bots/faq, https://core.telegram.org/bots/features, https://docs.slack.dev/reference/events/app_mention, https://docs.slack.dev/concepts/security
Messengers that host other makers' bots.
- Telegram (2): "bots will not be able to see messages from other bots regardless of mode"; an opt-in, "Bot-to-Bot Communication Mode", lifts it. Then "you must implement safeguards": "Deduplicate repeated messages", "Apply rate limits", "Enforce maximum interaction depth or timeouts".
- Telegram (4): privacy mode is the default; a bot gets only commands and messages meant for it.
- Slack (1): `app_mention`, "only the message events that mention your app or bot". (2): on "a bot messaging another bot", "the app should not process or respond to the message".

### AutoGen and Microsoft Agent Framework
https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html, https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat
Libraries; the group works on a task.
- (1) "A generative model (e.g., an LLM) selects the next speaker"; never the same one twice running by default. Agent Framework: a manager, round-robin or prompt-based.
- (2) "MaxMessageTermination to limit the conversation to 25 messages to avoid infinite loop"; `MaximumIterationCount = 5`.
- (4) "All agents see the full conversation history".

### Handoff frameworks
https://openai.github.io/openai-agents-python/handoffs/, https://github.com/langchain-ai/langgraph-swarm-py, https://docs.crewai.com/en/concepts/processes
- One agent holds the conversation. OpenAI Agents SDK: "the new agent takes over the conversation, and gets to see the entire previous conversation history"; past `max_turns` it raises `MaxTurnsExceeded`. LangGraph swarm "remembers which agent was last active". CrewAI has no group chat: tasks in sequence, or a manager.

### Character.AI
https://support.character.ai/hc/en-us/articles/41760067000475-Community-Update-September-2025
- (1), (2) "You don't have to script who talks next"; characters "send messages to each other to keep the story moving". Limits: not documented.

### Not reached
- ChatGPT group chats and @-mentioning GPTs: help.openai.com and openai.com return 403. A search result says ChatGPT replies by itself or on a mention: **unverified**.
- Poe multi-bot chat: its blog returns 403.
- Character.AI: its help-centre search has no page on group chats or Rooms.
- Discord's own documentation and Grok outside Grok Bot: not read.

### Ideas worth adopting
1. A mention picks who answers. Grok Bot, OpenClaw, Poe, Open WebUI.
2. A bot may pass, and a pass shows nothing. OpenClaw.
3. Turns are counted per owner message; one round by default. OpenClaw.
4. A second round only for a bot that replied or was named, fed a short digest. OpenClaw.
5. Each bot keeps its own session and memory; the group shares a transcript only. OpenClaw, Poe, Claude Code.
6. Another bot's message is never the owner's and never an OK. Claude Code.
7. Approvals and logins stay out of the group. Grok Bot.
8. Small groups: two to six. Grok Bot, Claude Code, LobeHub.
9. No live drafts from several bots at once. OpenClaw.

### Approaches that are better than a naive "send to everyone"
- **Mention, with a fallback.** Predictable; only the fallback differs: all (OpenClaw), none (Poe, Open WebUI), bots decide (Grok Bot).
- **Everyone reads, each may pass.** Removes "me too" answers; every bot still runs. OpenClaw.
- **A chooser picks one speaker.** One answer at a time, for one more model call. AutoGen, LobeHub.
- **Each speaks at most once per owner message.** Ends loops by construction. SillyTavern pooled order, OpenClaw `maxTurns`.
- **One bot holds the floor until it hands off.** No duplicates. OpenAI Agents SDK, LangGraph swarm.
- **Fan out, then merge into one answer.** Open WebUI.

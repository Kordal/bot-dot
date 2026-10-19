# How the bots interact with the user: an audit

5 Oct 2026. An audit and redesign recommendation the owner asked for; no code was changed. Revision read: `main` at `debefff`, before the feature "Board" was merged: every `file:line` below is of that revision, and the Dashboard it names is now the Board. Its section 8, the quick wins, is the starting point of [Milestone 5](../../archive/product/milestone5-research.md).

**Method.** 64 agents: 21 readers (16 areas, then 5 gaps a completeness critic found), each finding re-checked against the code by a separate verifier told to refute it. 168 findings: 86 confirmed as stated, 82 corrected in detail, 0 refuted. Where a verifier corrected a claim, this report uses the corrected version.

**Scope.** The brief describes "Ultracode" with planning, coding and reviewer agents and an issue → PR → merge workflow. This repository is bot·dot: a Chief of Staff and the bots it creates. I audited that product and mapped the journeys to it ("Add a button" → one small request to a bot or to the Chief). bot·dot has no reviewer agent; journey G says what exists instead. The `kordal-*` developer workflow is not covered.

**Confirmed vs inferred.** Code facts below were opened and quoted by a reader and re-opened by a verifier. What a bot *says* is model behaviour: claims about it rest on what the prompts instruct and what the code forces, and are marked *inferred*.

**Not covered.** First run and pairing (setup checklist, `lib/setup.js`, `ConnectScreen.kt`), updates and backup/restore, a few Android settings screens, the figure and outfits, `lib/audit.js`.

---

## 1. Executive summary

**1. An approval ends the work instead of pausing it.**
- Problem: after the owner's OK on a permission, bot change, skill or job, the server only changes a setting. No run restarts and the Chief is not told. The ask does not even store which run or chat needed it (`server.js:98`, `1033-1058`, `1132`, `1416-1422`). Only a tool install carries on (`lib/tools.js:335-371`).
- Impact: the owner types the request twice; "create a bot that browses the web" stops at a card and never runs. Nine readers hit this independently.
- Recommendation: every ask records what it interrupted (run id or Chief chat id); on yes the server continues it, exactly as `tools.complete()` does.
- Priority: **Critical**

**2. "Allow once" on a connected-app action cannot work in practice.**
- Problem: `connector_run` throws at once (`lib/connector-approvals.js:22-27`), so the run ends before the owner sees the card. The card's main button then fails with "That run has ended" (`:37`) and the card stays. Each retry adds another card. The card body is policy text plus raw JSON (`lib/asks.js:126`).
- Impact: the safe answer is unusable; the owner is pushed to "Always allow". Sending the first email takes several attempts.
- Recommendation: make `connector_run` wait for the answer the way `request_login` and `type_card` do; remove the ask when its run ends; word the card from the action's own fields.
- Priority: **Critical** (the one-run binding is a recorded security decision; keep it, fix the wait)

**3. A message that fails to send is thrown away.**
- Problem: web and Android empty the box and the attachments before the request (`public/app.js:1996-1999`, `Components.kt:587-589`). Failure is a 3-second toast or a snackbar. The web also toasts the browser's raw fetch error every 8 seconds while the server is away (`app.js:26-35`, `383-385`).
- Impact: retyping, on the most frequent action in the product.
- Recommendation: clear only after a 2xx, or put text and files back; one plain "Can't reach botdot" line on the web, as Android's home screen has.
- Priority: **Critical**

**4. "Busy" has three rules, and the Chief's chat locks for minutes.**
- Problem: the Chief refuses a message while it replies (`lib/chief.js:408`), and it is told to wait for the bot inside the turn: 240 s by default, 540 s at most, 14 minutes for a login (`lib/mcp-server.js:622`, `215`). On the web a message to a busy bot starts a second parallel run in the same workspace that cannot see the first (`server.js:1479-1483`, `lib/bots.js:569`). Android blocks it. Jobs and teammates queue, invisibly (`bots.js:1275`). Stop in the Chief chat does not stop the bot it started (`chief.js:948-954`).
- Impact: a correction never reaches the work it corrects.
- Recommendation: one rule on the server: accept and queue the owner's message (`waitingTurns` and `startOrQueue` already exist) and show it as waiting.
- Priority: **High**

**5. A bot does not remember its own chat.**
- Problem: every message is a fresh `claude -p`, no resume. Context is the last three runs of any kind in three days, each reply cut at 1,500 characters, all labelled "Owner:" even when a teammate or the Chief wrote them (`lib/bots.js:565-578`). A tap on "Yes" sends only the word "Yes" (`bots.js:993`, `app.js:2404`); the question may be gone.
- Impact: "draft, then Send it" hands the bot a clipped draft. "Why did you do that?" is answered from a reconstruction.
- Recommendation: an answer carries its question; build the history from what the owner actually saw, with the real sender, the last reply in full, and run ids for `read_run`.
- Priority: **High** (no session resume is deliberate; the thin history is not)

**6. One grant is asked two or three times, and the chat says "Updated" before anything happened.**
- Problem: the Chief is told to ask for a yes in chat (`lib/chief.js:110`, `113`), then the server holds the change for a card. A refused tool makes a permission card *and* the Chief's `update_bot` makes a bot-change card for the same grant; approving one makes the other fail with 409 (`server.js:1036`). The chip says "Created"/"Updated" while the change waits (`chief.js:376`; `mcp-server.js:33-42` drops `pendingChange`). The card is not in the Chief chat where the owner asked (`app.js:4455-4458`) and shows field names and two full texts with no diff (`asks.js:121-125`).
- Impact: the owner hunts for a card worded in internals, to confirm their own sentence.
- Recommendation: one control point per decision: the card. Drop the chat yes where a card follows; show the card under the Chief's reply in plain words; the chip says what waits.
- Priority: **High** (keep the gate itself: `docs/archive/security-issue-90.md`)

**7. The phone can approve what it does not show.**
- Problem: for a bot change or a connected-app action the notification reads "Asks to " and nothing else, with Allow (`server.js:95`, `Notifier.kt:519-527`). A script job is approvable from a notification that shows only its name (`Notifier.kt:254-255`, `server.js:1593`). Android's tile card leaves out scripts in named reads and actions (`Models.kt:479-484`).
- Impact: a rewritten main assignment, a shell script or an email send approved blind.
- Recommendation: the server sends a one-line `text` and `yesOn: 'card'` for these kinds; Android already honours `yesOn`.
- Priority: **High**

**8. Results the owner asked for can vanish.**
- Problem: every job defaults to `report-only`. A scheduled reply without `notify_owner` is marked quiet and blanked from the chat, notifications, recall and history (`lib/reporting.js:20-29`, `bots.js:842`). One-time jobs and attached files too. A hand-off between bots comes back only if the teammate chooses to message back; otherwise the wait settles in silence (`bots.js:1377-1378`, `awaits.js:44-49`).
- Impact: "send me the weather at 8" may never arrive, with "nothing to report" as the only trace. "Asked Researcher…" may be the last the owner hears.
- Recommendation: a requested report gets `notify: "always"`; one-time jobs always deliver; the server hands a teammate's final reply (or its failure) back to the asker and always starts the follow-up.
- Priority: **High** (silence for watch jobs is deliberate; keep it)

**9. Failures are hidden or misattributed.**
- Problem: a failed Chief turn is drawn as a normal reply whenever any text exists, an empty one as "Done.", and the feed calls it success (`lib/chief.js:562-603`, `app.js:2073-2079`, `2297`). "You stopped this run" is shown when the Chief or a sign-out stopped it (`lib/problems.js:7-8`). Thrown exceptions reach the apps raw as HTTP 400 (`server.js:1796-1800`). A failing job notifies on every run, in quiet hours too (`reporting.js:21`).
- Impact: the owner cannot tell done from failed.
- Recommendation: a status on every reply, written once on the server; never synthesise "Done."; hold and de-duplicate repeated failures.
- Priority: **High**

**10. No shared voice.**
- Problem: three style blocks written separately that disagree (`chief.js:97-98`, `bots.js:48-54`, `look.js:71`). The Chief's prompt (about 3,600 words) carries sixteen separate "say it in one line" duties, so replies repeat the chips. Progress words are a table per app: the web falls back to "Working on it", Android to the raw tool name ("Ask install tool") (`app.js:1814-1834`, `ChiefScreen.kt:319-331`). Chips say "Deleted <8-character id>". Cost reaches the Chief (`costUsd`, `mcp-server.js:45`; "free", `chief.js:116`) against the no-costs rule.
- Impact: the product reads as several bots, not one.
- Recommendation: one `VOICE` block appended to all three prompts; one server table for activity text and chips.
- Priority: **Medium**

---

## 2. Current interaction architecture

```text
Owner
 ├─ Chief chat ─► Chief turn (claude -p, one resumed session per chat) ─ 44 tools ─► botdot server API
 │                 ├─ acts at once : name, hat, AI job, skills, shared memory, run_bot, delete_bot
 │                 ├─ held as card : main assignment, rules, web, commands, computer, apps, script job, script tile
 │                 ├─ ask only     : install tool, install skill, login pop-up (tool waits ≤14 min)
 │                 └─ run_bot + wait_for_run (chat refuses messages, 240–540 s)
 │                        └─► Bot run ─► Chief's summary │ late: raw "Message from <bot>", no Chief turn
 │
 ├─ Bot chat ───► Bot run (fresh claude -p per message; last 3 runs, clipped, as context)
 │                 ├─ opening line ─► one status line + Stop ─► reply (+ answer buttons / question card)
 │                 ├─ ask_permission, ask_skill, add_job, update_instructions, suggest_tile
 │                 │        ─► card ─► owner OK ─► setting changes; NOTHING resumes
 │                 ├─ request_login, type_card ─► pop-up; the run waits ─► the same run goes on
 │                 ├─ connector_run (write) ─► error to the bot + card ─► "Allow once" fails once the run is over
 │                 ├─ message_bot ─► teammate run (folded, never "new")
 │                 │        ─► asker restarts ONLY if the teammate messages back
 │                 └─ send_to_chief ─► new Chief chat, waits for Approve
 │                    ask_chief_for_tool ─► Chief turn ─► Install card ─► install ─► Chief re-runs the bot  ◄ the one closed loop
 │
 ├─ Needs you ◄── asks (permission, skill, tool, bot-change, connector-action), jobs, tiles,
 │                shared-memory changes, logins, payments          (only the owner answers: server.js:1019)
 │
 └─ Unasked ◄──── look (read-only Chief session, ≤3 messages a day) · job reports (notify_owner)
                  reminders · server notices drawn as Chief bubbles · Android notifications
```

- **With the user.** Two front doors: the Chief (anything about the team) and each bot's own chat (routine work in its role). Progress is one ephemeral opening line (`lib/opening-line.js`). Replies are not streamed; only the final result is saved (`chief.js:562-570`).
- **With each other.** The Chief runs bots with `run_bot`. Bots hand work over with `message_bot`; the server enforces a may-message list and a 20-hop limit (`bots.js:1315-1320`). Bots never command the Chief: a plan waits for the owner's Approve (`chief.js:705-716`).
- **With the backend.** Every tool is an HTTP call to the same API the apps use. The actor comes from the socket or key, never the request body (`server.js:375`, `1670-1686`). Text the server injects into a turn is labelled by source.
- **State.** The Chief: one Claude session per chat; across chats only shared memory and `recall`. Bots: no session; memory notes plus the clipped history. Asks are durable; login and payment requests live in memory and expire.

---

## 3. Bot responsibility matrix

| Bot / actor | Current responsibility | User-facing? | Overlaps with | Main UX problem | Recommendation |
|---|---|---|---|---|---|
| Chief of Staff (chat) | Creates, changes, runs and deletes bots; jobs, skills, tools, tiles, memory, reminders | Yes | A bot's own chat (same task either way); the settings panels | Locks while it waits; not told when its own requests are approved; retells what the bot already said | Keep as front door. Server queues messages and tells it about approvals |
| Bot (own chat) | Does the work in its role, one fresh run per message | Yes | The Chief's `run_bot` | Forgets its chat; an approval restarts nothing; parallel runs on the web | Keep visible. Fix context and resume-after-OK |
| Look | Read-only Chief session; may write one unasked message | Yes | Scheduled reports; the chat Chief | Any next message counts as "the owner answered" (`chief.js:432-434`); does not see what broke | Keep. Record the next message neutrally (needs an ADR 006 update) |
| botdot itself | Notices, reminders, end-state sentences, late reports | Yes, drawn as the Chief or as the bot | The Chief's voice | Indistinguishable from the Chief; English only; "You stopped" when you did not | Server sends a `kind` with each line; one owner for end-state wording |
| Needs you | Everything waiting for the owner's OK | Yes | The Chief's chat confirmations | Dead ends; five names for one place; two cards for one grant | One card per decision, where the owner asked, that resumes the work |
| Teammate hand-off | `message_bot`, awaits, follow-up run | Folded lines only | The Chief's `run_bot` | Dead-ends when the teammate does not message back | The server returns the teammate's reply or failure itself |
| Scheduled job (AI / script) | Runs a bot or a script on a schedule | Reports only | Its own script → AI follow-up (two notifications) | Reply discarded without `notify_owner`; failures ring every run | Requested reports deliver; fold the script run under the AI's report |
| Memory review, dresser | Weekly tidy of notes; picks hats | No | — | Review is silent when it changes things or fails | Keep internal |
| Settings panels (bot, jobs, memory) | Edit every field by hand | Yes | The Chief's tools, field by field | Duplicate the Chief; show internals and API prices; `bypassPermissions` saves with no question (`app.js:1110`, `1155`) | Trim to what chat cannot do; remove prices |

---

## 4. Interaction problems

### Critical friction
1. **Approvals are dead ends** (finding 1). The table the critic asked for: *resumes work* = tool install, login, payment, a bot's plan for the Chief. *Does not* = permission, bot change, skill, job, connected-app action.
2. **"Allow once" fails after the run ended** (finding 2).
3. **A failed send loses the message**, on both apps (finding 3).
4. **A tapped answer reaches the bot without its question.** The buttons stay on screen while the question has left the bot's history (`bots.js:565-578`, `717`, `993`).
5. **The Chief chat is locked while it waits for a bot** (finding 4).

### Repeated friction
1. Asking twice: the chat yes, then the card (`chief.js:110`, `113`).
2. Retyping a request after Allow, after a failure ("Run again" opens the main assignment, not the failed request: `app.js:1675`, `1736-1741`), and after a late login.
3. The Chief retells a bot's answer: two extra model turns and a second-hand reply (deliberate "delegator" design, still slow).
4. A change to an approved job stops it, the card calls it "added", and Decline deletes the whole job (`lib/jobs.js:76-78`, `server.js:1419`). Tiles behave the same.
5. The password warning fires on ordinary sentences and blocks sending with a browser dialog (`app.js:1995`, `3967-3970`).

### Consistency problems
1. Busy: Chief refuses, web bot forks, Android blocks, jobs queue.
2. Wording per app: progress labels, end states ("Couldn't finish" vs "Stopped", "Done. (No written reply.)" vs "Done."), Needs-you cards, the place itself has five names.
3. Rules keyed on who was asked, not on risk: the same AI job needs a card when the bot adds it and none through the Chief (`jobs.js:42`). Deliberate; worth one owner decision.
4. Markdown: the web breaks loose and nested numbered lists, quotes and rules that Android draws (`app.js:268-300` vs `Markdown.kt`); no prompt says what the chat can draw.
5. Web vs Android: the web bot chat knows only the team's newest 200 runs and draws 40, with no scroll-back (`app.js:364`, `2330-2336`); Android pages. Android lacks safety prompts the web has; Decline on a job deletes it without a word.

### Missing feedback
1. Queued work is invisible; "Run now" on Android says "Started" when it queued.
2. A dashboard tile that asks a bot says "Asked X" for 2.5 seconds, then nothing: no working, done or failed (`server.js:74`, `app.js:5005-5014`). A switch whose action failed stays drawn in the new state (`lib/dashboard.js:428-430`).
3. An open question looks like a finished reply everywhere outside the open chat; a questions-only reply is stored empty and shown as "Done." (`lib/choices.js:12`, `36-46`).
4. A screenshot sent mid-run does not reach an owner who is not already in that chat (`bots.js:1156-1163`). The bot is never told the owner took the mouse; its prompt says the desktop is one "that only you use" (`bots.js:67`).
5. A job that was skipped, dropped or missed leaves no reason the owner can read; Android chats give no sign that botdot is unreachable.

### Unnecessary complexity
1. Tool names, ids and raw JSON on cards, chips and progress lines.
2. Field-by-field settings that duplicate the Chief, against the Minimal UI rule.
3. Cost: `costUsd` handed to the Chief, "free" in its job talk, API prices in settings.
4. The Chief narrates script-or-AI for a schedule request and hands over a bash script to approve.
5. A bot with learning off never reads its pinned notes, while both apps say it does (`bots.js:1076-1078`, `app.js:3232`). A plain bug.

### Confirmations, classified (about 45 found)

| Class | Which |
|---|---|
| Necessary | Delete a bot; reset its computer; script job; script tile; tool or skill from a link; connected-app write; payment; a login used on another site; shared-memory change after outside content; sign out of Claude; delete a Vault login; "Always approve" / "Always allow" |
| Useful | Permission card; registry tool card; a bot's tile suggestion; a bot's plan for the Chief; reading back a reminder's time |
| Unnecessary | The chat yes before a card; "Remove this job?" after "Decline and remove" (`app.js:2952`); Approve confirm in the jobs panel (`2887`); remove a group (`895`); Undo confirm (`1324`); delete a restorable note (`3284`); download after pressing Download (`3365`); take control in the preview (`2538`); re-approval when only a script job's time changed |
| Actively annoying | The password warning; the bot-change card for a dictated sentence, on another page, in raw fields (keep the gate, fix place and wording); backup passphrase in a clear-text browser prompt (`3756`) |
| **Missing** | `bypassPermissions` in bot settings; "Approve all" on Needs you (approves script jobs behind three-line cards, `4427-4431`); Android's Decline on a job; `delete_bot` guarded only by a boolean the model sets, also in turns botdot starts (`mcp-server.js:580-584`) |

### Clarifying questions
Well bounded for a new bot: at most two questions, defaults first, "create the bot right away" (`chief.js:99`). The gaps: no rule for an existing bot ("improve this bot" gets an open question or a blind rewrite); bots have no rule at all; "this bot" has no referent unless mentioned, though the server knows which chat was open (`server.js:476-501`); a bot run by the Chief still makes buttons for the owner, which the Chief never sees (`bots.js:709-727`).

---

## 5. Workflow analysis

**Create a bot that uses the web**
```text
CURRENT   message → (≤2 questions) → create_bot → chip "Created" → card on another page:
          Review → Approve → Back → nothing happens → message again "run it"
PROBLEM   the grant is the normal case, the card is elsewhere in tool names, the OK restarts nothing
PROPOSED  message → (≤2 questions) → create_bot → card under the Chief's reply
          "Let News Watcher browse the web?" → Approve → the Chief is told → one line + first run
```
1 message + 3 taps + 1 message → **1 message + 1 tap**.

**A permission in the middle of a task**
```text
CURRENT   message → the bot is refused, replies it could not → card → Allow → "Allowed" → message again
PROPOSED  message → card → "Allow and try again" → the same request restarts
```
2 messages + 1 tap → **1 message + 1 tap**; the first half of the work is not done twice.

**Hand work to a bot through the Chief**
```text
CURRENT   message → run_bot → wait_for_run (chat locked up to 9 min) → summary
          late: raw bot text appears, the Chief says nothing; Stop does not stop the bot
PROPOSED  message → run_bot → short wait → "Web Surfer is on it" → the owner's next message queues
          → the result arrives as one short Chief turn; Stop during a wait stops that run too
```
Same turns; the chat stays usable. Stop from the Chief chat: 3 taps → **1**.

**First write through a connected app**
```text
CURRENT   message → the Chief points to Settings → Connectors (about 6 taps + sign-in) → message "done"
          → bot-change card → the first send is refused → the run ends → "Allow once" fails → ask again
PROPOSED  message → card "Connect Gmail for Mail Assistant" → sign-in → the run waits on
          "Send this email?" → Allow once → sent
```
About 3 messages + 8 taps → **1 message + 2 taps + the sign-in**.

**One bot hands work to another**
```text
CURRENT   A: "Asked B…" → B answers in its own chat → A restarts only if B also messages back
PROPOSED  the same, but the server hands B's final reply (or its failure) to A and always restarts A
```
No owner turn changes; the dead end goes, and B stops writing its answer twice.

**A scheduled report**
```text
CURRENT   message → AI job, report-only → at 8:00 the reply is discarded unless the bot calls notify_owner
PROPOSED  message → the Chief sets notify "always" for a report the owner asked for → it arrives
```
Same turns; the result is no longer left to chance.

**Large request ("a team of bots for my inbox")**: about 5 messages + N + 8 taps with three trips out of the chat → **about 2 messages + 3 taps + the sign-in**, with every grant still the owner's.

**Already right, leave alone:** a missing login (pop-up, the same run goes on: the product's best flow), shared memory, deleting a bot, adding a tile, turning unasked messages down.

### The journeys

| Journey | What the code does today | Gap |
|---|---|---|
| A. Simple request | Bot: 1 message, one status line, one reply. Good | Lost on a failed send; no retry after Allow |
| B. "This bot doesn't work" | The Chief can read the job's last error through `get_bot` | `runSummary` strips job name and problem (`mcp-server.js:43-50`); it cannot see what waits in Needs you; a missed job leaves no record |
| C. "Improve this bot" | No rule: an open question or a blind rewrite | Should read recent runs and offer up to three concrete changes as buttons |
| D. Large request | Designed in one turn, then stops four times | The owner carries each approval back by hand |
| E. "Why this way?" | Answered from 1,500 clipped characters | No pointer to the run record |
| F. Failed work | One plain sentence, Details kept | No retry of the same request; a hung run looks like a working one (no time limit on an AI run) |
| G. A check finds a problem | **No review step exists.** `startReview` is the weekly memory tidy-up; the Chief relays, it does not check | A problem inside a failed hand-off is lost |
| H. Change of mind | Web forks a second run; the Chief refuses; Stop misses the bot | A card can only be taken back as a "no", which then blocks the same ask for a week (`asks.js:20`) |

---

## 6. Recommended interaction model

**Do not collapse to one chat with a hidden router.** The two front doors are deliberate (`docs/product/vision.md:7`: "giving it work is sending a message") and they work: a message to a bot skips the Chief, and runs the Chief or another bot started are folded and never count as new. The friction is not too many visible bots. It is that the seams between them (approval, hand-off, late result, busy) are left to the model or to the owner. Close them on the server.

- **Visible:** the Chief (front door for the team), bots (contacts for routine work), Needs you.
- **Internal:** the look, the dresser, the memory review, the scheduler, the MCP servers. Lines botdot writes itself carry a `kind`, so apps can caption them.
- **Routing:** none between bots. Add one fact to the Chief's per-turn note: which bot's chat the owner had open last, so "this bot" resolves.
- **Confirmations:** one control point per decision, and it is the card. It appears where the owner asked, says in plain words what changes, and resumes what it interrupted. A notification offers yes only when it shows everything. No chat yes where a card follows.
- **Progress:** the opening line, then one server-worded activity text. Queued is a visible state. Do not add step-by-step narration: one line was the owner's decision on 2026-10-02 (MSG-013).
- **Completion:** outcome first, at most three short sentences. Chips name the object and say when something waits.
- **Errors:** one `problem` sentence and a status on every reply, written on the server: what happened, what to do next. Raw text stays in Details.
- **Context:** an answer carries its question; a bot's history is what the owner saw, with the real sender.

**Autonomy boundary.** Too passive today: asks in chat for what a card covers, waits after every OK, cannot connect an app. Too autonomous today: `delete_bot` and `permissionMode` rest on the model's word; notifications approve unseen scripts; "Approve all". Rule: act at once on what the owner asked and can undo; one card for what adds power, runs unattended, spends, or is seen outside; after the card, keep going.

---

## 7. Messaging guidelines

One block, appended to the Chief's, the bots' and the look's prompts:

```text
Reply in the language the user wrote in. Lead with the outcome.
No greeting, no sign-off, no emoji, no account of your own process.
Plain sentences; a short list only for three or more parallel items.
At most three short sentences unless the user asked for detail.
Say what happened, then the one thing the user must do next, if any. Never report as done what waits or failed.
```

| Situation | Example |
|---|---|
| Starting work (opening line) | `Checking the weather in Brussels` |
| Progress (status line, never a message) | `Waiting for Web Surfer` · `Queued: starts when it's free` |
| Need user input | `Which mailbox: work or private?` `[Work] [Private]` |
| Completed | `Done. WeatherBot sends you the Brussels weather every day at 8:00.` |
| Completed partially | `Created Mail Sorter and Mail Writer. Mail Writer can't send until you allow Gmail: the card is below.` |
| Tests failed (work a bot ran) | `3 of 42 tests fail, all in login. Nothing was pushed. Fix them?` `[Fix] [Leave]` |
| Bot or tool failed | `I couldn't finish: Claude is signed out on the botdot server. Sign in under Settings, then send it again.` |
| A check found a problem | `Last night's backup is missing: the disk was full. Free space and run it now?` `[Run it] [Later]` |
| Nothing to change | `Nothing to change: WeatherBot already reports at 8:00.` |

Vocabulary from `CONTEXT.md`, everywhere: bot, main assignment, job, Needs you. Pick one of "the user" / "the owner" (the Chief's prompt and the bots' prompt differ today).

---

## 8. Quick wins

**Remove user turns**

| # | Change | Impact | Effort |
|---|---|---|---|
| 1 | Put text and files back when a send fails (`app.js:1996-1999`, `Components.kt:587-589`) | High | Small |
| 2 | Drop the chat yes where a card follows; tell the Chief the card already waits (`chief.js:110`, `113`) | High | Small |
| 3 | Hand-off: start the follow-up with zero answers too, carrying the teammate's reply or failure (`bots.js:1373-1387`, `awaits.js:44-49`; a test pins today's behaviour) | High | Small |
| 4 | Requested reports get `notify: "always"`; one-time jobs always deliver; `attach_file` answers truthfully in a report-only run (`chief.js:67-68`, `jobs.js:20-25`, `reporting.js:20-29`, `self-mcp.js:403`) | High | Small |
| 5 | Remove the seven needless `confirm()`s and fix the password detector (`app.js:895`, `1324`, `2538`, `2887`, `2952`, `3284`, `3365`, `3967-3970`) | Medium | Small |

**Remove confusion and risk**

| # | Change | Impact | Effort |
|---|---|---|---|
| 6 | Notifications: `text` + `yesOn: 'card'` for bot changes, connected-app actions, script jobs, tile scripts (`server.js:88-96`, `1593`, `Notifier.kt:519-527`) | High | Small |
| 7 | Chips and tool results say what waits and name the object (`mcp-server.js:33-42`, `chief.js:370-391`) | High | Small |
| 8 | Chief replies carry a status; never "Done." for an empty reply (`chief.js:562-603`, `app.js:2073-2079`, `2297`) | High | Small–Medium |
| 9 | Pinned notes reach a bot with learning off (`bots.js:1076-1078`) | High | Small |
| 10 | One "Can't reach botdot" on the web; stop the 8-second toast (`app.js:26-35`, `383-385`) | Medium | Small |

Also small: the shared `VOICE` block; drop `costUsd` and "free"; one server table for activity text (both apps already prefer the server's `text`); `COMPUTER_PROMPT` says the owner may take over; a confirm before `bypassPermissions`.

---

## 9. Structural improvements

1. **Asks that resume.** Store the run id or Chief chat id on every ask; on yes, restart the request or call `chief.tell`. Worth it: removes the most repeated extra turn in the product, and the pattern exists (`lib/tools.js:335-371`).
2. **One busy rule.** Queue the owner's message for a busy bot or Chief on the server and show it as waiting; a shorter `wait_for_run`; a late result becomes a short Chief turn; Stop during a wait stops the run. Worth it: corrections reach the work. Needs an owner decision on where Stop lives once Send stays available (the verifiers flagged this against the accepted MSG-013 design), plus `docs/api.md` and a `features` flag.
3. **`connector_run` waits.** Long-poll in slices (a call is capped at 120 s, `connectors-mcp.js:16`); withdraw the ask at run end. Worth it: makes the safe choice the easy one.
4. **Bot conversation context.** Answers carry their question; history built from owner-visible exchanges with real senders and run ids. Worth it: fixes "Send it", "Yes" and "why".
5. **The bot-change card.** Under the Chief's reply, permission wording, a diff for text, merged with a permission card for the same grant. Worth it: the gate stays and stops costing a search.
6. **Staged job and tile changes.** The approved version keeps running; Decline restores it; the card says "changed" and shows what. Worth it: a declined edit no longer destroys a working job.
7. **One wording layer on the server** for end states, card text, notification text and activity, plus a shared Markdown fixture for `md()` and `Markdown.kt`. Worth it: this is the stated architecture ("decided once, drawn twice") and most consistency findings are violations of it.
8. **Failure hygiene.** Hold failures in quiet hours, de-duplicate repeats, raise "Claude is signed out" once as one thing to fix, record why a job did not run.
9. **Web bot chat loads the bot's own runs**, with paging, as Android does.

---

## 10. Recommended implementation order

**Phase 1 – interaction cleanup** (small, independent): quick wins 1, 2, 5, 6, 7, 8, 9, 10; the `bypassPermissions` confirm.

**Phase 2 – shared UX conventions:** the `VOICE` block; server tables for activity text, chips and end-state sentences; card and notification text from the server; vocabulary pass; Markdown fixture; remove cost wording.

**Phase 3 – orchestration:** asks that resume (structural 1); hand-off return path; requested reports deliver; `connector_run` waits; the Chief gets job names, problems and a read-only view of what waits, for bug reports.

**Phase 4 – deeper changes:** one busy rule with a queue; bot conversation context; staged job and tile changes; the bot-change card in the Chief chat; web history paging; control of the live screen as a server fact.

API changes need `docs/api.md` and `features`; changing what "answered" means for looks needs an ADR 006 update.

---

## Top 5 changes to make first

**1. Every approval resumes what it interrupted.**
- Why: the most repeated extra turn; makes "create a bot" finish.
- Affected: `server.js` (asks route `1019-1058`, `98`, `1132`, job approval `1416-1422`), `lib/asks.js`, `lib/self-mcp.js:118-151`, `lib/mcp-server.js` (`CHIEF_CHAT_ID`), `lib/chief.js` (`tell`), card labels in `public/app.js:4508` and `NeedsYouScreen.kt`.
- Improvement: a permission mid-task goes from 2 messages + 1 tap to 1 + 1; a new bot from two messages and three taps to one and one.
- Complexity: **Medium**

**2. Never lose a message; say plainly when botdot is unreachable.**
- Why: the most frequent action must not fail silently.
- Affected: `public/app.js:1989-1999`, `2192-2214`, `2435-2443`, `26-35`, `383-385`; `Components.kt:584-599`, `ChatModels.kt:161-165`, `353-360`.
- Improvement: no retyping; one standing line instead of repeating raw toasts.
- Complexity: **Small**

**3. One confirmation per decision, in plain words, that the phone cannot approve blind.**
- Why: removes the double ask and closes a real control gap.
- Affected: `lib/chief.js:110`, `113`, `376`; `lib/mcp-server.js:33-42`; `server.js:88-96`, `1593`; `lib/asks.js:121-126`; `Notifier.kt:254-255`, `519-527`; `Models.kt:479-484`.
- Improvement: one fewer turn per grant; chips that tell the truth; no "Asks to " notification with Allow.
- Complexity: **Small** (prompt and feed), **Medium** with the card moved into the Chief chat

**4. One rule for "busy": queue the owner's message, keep the Chief chat usable.**
- Why: corrections reach the work; the web stops forking parallel runs.
- Affected: `lib/chief.js:405-446`, `635-672`, `948-954`; `server.js:1479-1483`, `74`; `lib/bots.js:1212-1275`; `lib/mcp-server.js:620-634`; both composers; `docs/api.md`.
- Improvement: no locked chat for up to nine minutes; Stop does what it says.
- Complexity: **Large**

**5. Results always come back: scheduled reports and hand-offs.**
- Why: silence after "Asked X…" or after "send me this at 8" reads as broken.
- Affected: `lib/reporting.js:20-29`, `lib/jobs.js:20-25`, `42-51`, `lib/chief.js:67-68`, `lib/bots.js:1373-1387`, `758`, `842`, `lib/awaits.js:42-49`, `lib/self-mcp.js:403`, `test/awaits.test.js:78`.
- Improvement: a requested report arrives every time; a failed hand-off is said, not dropped.
- Complexity: **Small** to **Medium**

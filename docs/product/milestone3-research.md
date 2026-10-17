# Milestone 3 research: the Chief of Staff writes first

Planning status: stage 6 closed on 2026-10-03; next: delivery, starting with CHF-001.

Date: 2026-10-03. Revision inspected: `main` at `5b26b9e` (Milestone 2 merged through pull request 146, the feature "a working bot is one line" through pull request 149, then the scaffold stamp). The integration branch `feature/working-bot-one-line` is merged into main and no task is claimed. No product tests were rerun. This note is research evidence, not an implementation plan.

## Why this milestone

The owner asked for it on 2026-10-03 in these words: the Chief of Staff proactively sends a message when it is useful (a quick tip, a joke, a fresh insight, something tailored to the owner); it is "always in your inbox, never in your face"; it remembers who the owner is, what they care about and what they like, so a message refers to what the owner actually asked about; "zero noise, maximum relevance".

Milestone 2 excluded exactly this ("Bots or the Chief writing to the owner first without being asked") and its research listed it as a candidate for later.

## What the product delivers today

Verified by reading the code at the revision above:

- **The Chief never starts a turn by itself.** A Chief turn starts only from the owner's message, an approved suggestion from a bot, or a bot's result coming back (`lib/chief.js`). The only messages that land in a Chief chat without one are reminders the owner asked for (`remind_me`, `remindersDue()` every 15 seconds) and bots' reports.
- **The Chief cannot look anything up.** Its tools are botdot's own plus `Read`, `Grep`, `Glob` and `Skill` (`TOOL_ALLOW` in `lib/chief.js`). It has no web search; web research belongs to bots that have `WebSearch` and `WebFetch`.
- **What botdot knows about the owner.** Shared memory: pinned notes about the owner that every bot and the Chief read on every run, at most 30 notes or 5000 characters, saved with `remember_shared` (`lib/chief.js`, `lib/memory.js`). Past runs and Chief replies are indexed and searchable with `recall` (full-text, optional meaning-based search). A weekly memory review exists per bot.
- **Nothing records what the owner liked.** There is no reaction, rating or "more like this" anywhere; Milestone 2 excluded reactions. The only signal botdot has is the read position per chat ([ADR 005](../adr/005-read-positions-on-the-server.md)) and whether the owner answered.
- **"In your inbox" exists.** Since Milestone 2 a new reply marks its chat with dots in the list and a "New" line in the chat, on the web page, Android and the Mac, and a notification follows unread state (`lib/read.js`). A Chief message counts as new (`messageCounts`).
- **"Never in your face" exists in part.** Quiet hours (22:00 to 07:00 unless changed) hold non-urgent scheduled reports until morning (`lib/reporting.js`, `deliverHeldReports` in `lib/bots.js`). Every new reply notifies; there is no kind of reply that shows as new without a notification.
- **Staying quiet exists for bots.** A scheduled AI job reaches the owner only when the bot calls `notify_owner`; "nothing new" replies are suppressed in many languages (`noNews` in `lib/reporting.js`). Nothing like it exists for the Chief.
- **Schedules are per bot.** Jobs belong to bots (`lib/jobs.js`, 5-field cron in local time). The Chief has no jobs.

## Evidence boundaries

- The request is the owner's own wording; no other user has been asked. "Useful", "funny" and "zero noise" are judged by the owner.
- The code findings were read, not exercised.
- Whether a model picks a message the owner finds worth reading, from shared memory and past chats, is not known. It is the main uncertainty and is assigned to stage 4.
- Other products' behaviour below comes from their documentation or from reviews, not from use.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| The Chief never starts a turn by itself (verified). The owner asks for messages it sends first. | A Chief turn that botdot starts: it looks at what it knows about the owner and decides whether there is something worth saying. |
| Every existing product in the survey lets the model answer "nothing to say" and hides that answer (OpenClaw, botdot's own scheduled jobs). | Silence is the default result of such a turn; a message is the exception. |
| The Chief cannot search the web (verified). "The hack that just dropped" needs fresh information. | Either give the proactive turn web search, or have it hand the research to a bot. An architecture choice for stage 4. |
| Nothing records what the owner liked (verified). Pulse and Daily Brief both learn from a thumbs up or down (reported). The owner's rule is a minimal UI. | Learn from what botdot already has: whether the owner read the message, answered it, or told the Chief "less of this". A visible rating control is an owner decision at stage 3. |
| Every new reply notifies (verified). "Never in your face." | A proactive message marks the chat as new but sends no notification, or only inside chosen hours. An owner decision at stage 3. |
| Reviews of Poke say its weak point is judging what is worth telling (reported, not verified). | A hard limit on how often the Chief writes first, and no repeat of a topic it already raised. A loop guard, not a spending cap. |
| Quiet hours already hold scheduled reports (verified). | Proactive messages respect quiet hours with the same rule. |
| Low findings left open by Milestone 2's review ([milestone2-test.md](milestone2-test.md)). | Not part of this outcome; listed under "Carried forward". |

## Carried forward

From Milestone 2's review, open and for the owner to decide: the medium defect on the Mac (a Chief chat that holds a bot's failed report does not load), and the low findings in the "Follow-up" list of [milestone2-test.md](milestone2-test.md). The Mac defect touches the Chief chat, where this milestone's messages land, so it is a candidate to fix here.

Browser tests are still in no gate (the repository does not carry Playwright).

No task is unfinished and nothing is blocked from outside.

## Proposed boundary for the discussion

In: the Chief of Staff writing first in its own chat, on the web page, Android and the Mac; choosing from what botdot already knows about the owner; staying silent when there is nothing; quiet delivery; the owner turning it down or off by chat. The Linux app stays out.

Out: other bots writing first; a feed of cards; reading the owner's mail or calendar for this purpose beyond what connected bots already do; ratings shown as numbers.

## Existing solutions

Pages were opened on 2026-10-03 through a fetch tool that summarises the page, so quoted wording may differ slightly.

### OpenClaw heartbeat
https://docs.openclaw.ai/gateway/heartbeat
Open-source, self-hosted agent gateway. The closest mechanism to what is asked.
- Heartbeat "runs periodic agent turns in the main session", every 30 minutes by default.
- The agent answers `HEARTBEAT_OK` when nothing needs attention; the reply is dropped when what remains is at most 300 characters.
- `activeHours` skips heartbeats outside a time window.
- A heartbeat is skipped when its instruction file is empty, so no model call is made.
- Event wakes are limited to one per 30 seconds, with a flood guard after five starts in 60 seconds.
- Better than botdot today: a system-owned turn with a built-in silent answer. Different: it is aimed at things that need attention, not at tips or jokes.

### Gemini Daily Brief
https://support.google.com/gemini/answer/17077455
A daily personal overview in the Gemini app.
- Built from connected apps (Gmail, Calendar) and Gemini chats.
- The user can mark an item done, dismiss it, chat about it, or say whether it was helpful; "this guides Gemini in personalizing your daily brief".
- Lives on its own page in the sidebar, not in a chat.
- Better: explicit feedback per item. Different: a page of items once a day, not a message.

### ChatGPT Pulse
https://help.openai.com/en/articles/12293630-chatgpt-pulse (returned 403; the points below come from search results and are unverified)
- Overnight research from chat history, memory and feedback, delivered each morning as cards; thumbs up or down refines it; memory must be on.
- A search result says OpenAI is retiring Pulse in favour of scheduled tasks. Unverified, and worth noting: a daily feed of cards may not have kept its users.

### Grok Bot
https://docs.x.ai/grok-bot/skills-routines-and-automations
- Bots write first only through routines. The page does not describe a bot messaging the user outside a routine.
- Its advice on noise: "Avoid broad listeners such as 'every new message.' They create noise."
- Observed by the owner's account on 2026-10-02 (Milestone 2 research): the main bot wrote first, "I'm taking a look around to see if there's anything I can pick up for you".

### Poke
https://poke.com (not opened; from search results of reviews, unverified)
- A texting assistant that writes first with briefings and alerts from connected apps, with layered memory.
- Reviews call its filtering judgment inconsistent: weak at knowing what is worth telling.

## Ideas worth adopting

- A system-owned turn with a silent answer that botdot hides, skipped entirely when there is nothing to look at. OpenClaw.
- Active hours for the turn itself, not only for delivery. OpenClaw.
- A floor between two proactive messages. OpenClaw's rate limits, and Poke's reported weakness.
- Feedback that the model reads next time. Gemini Daily Brief; in botdot it can be a sentence to the Chief instead of a button.
- A message in the chat, not a feed page: the possible retirement of Pulse and botdot's minimal-UI rule point the same way.

## Solutions that make part of botdot unnecessary

None found. An owner can already ask the Chief for a bot with a daily job that sends tips; that covers "scheduled content" but not "the Chief decides when something is worth saying, from what it knows about me".

## Uncertainties resolved at stage 4

Checked on 2026-10-03. The look was tried with a throwaway script: one `claude -p` call with a look prompt, the owner's seven bots and six Chief chats from the local data folder (23 and 24 September), web search allowed, nothing written.

| Uncertainty | How it was checked | Result |
| --- | --- | --- |
| Does a look pick something tied to the owner? | Full history, nothing raised yet. | Yes: "Your duplicate-ingredient check on recipes.example.com never finished … Want me to start it again?" It named the owner's own unfinished request. |
| Does it avoid repeating itself and respect ratings? | The same, with two topics listed as raised, one rated down with a reason. | Yes: it picked a third topic (Homelab Manager and the Proxmox token). |
| Does it stay silent? | Two messages of history, the one obvious topic listed as raised. | Yes: `NOTHING`. Without the raised topic it wrote a marginal message about an old answer. The Chief leans towards writing; the owner's priority ("feeling alive", silence trimmed first) accepts that, and the daily limit bounds it. |
| Can it joke? | Follow-ups listed as used up. | Yes, a joke about the owner's own bots staying quiet. |
| Can it bring a fresh find from the web? | Asked for a verified recent find only. | It searched (five turns) and answered `NOTHING`: it found nothing it could verify. The path works; a real find was not seen. The delivering task tests it with a recorded turn, and acceptance scenario A14 with real use. |
| How does the Chief know what it wrote when the owner answers? | Read the code. | Reminders and bots' reports already reach the chat's session on the owner's next turn (`unseen` in `lib/chief.js`). An unasked message uses the same path. |
| How does a look search the web without the Chief's changing tools? | Design. | [ADR 006](../adr/006-a-look-is-its-own-read-only-chief-session.md), Proposed, owned by CHF-001. |

Four of five trial runs took one model turn and under 11 seconds. The sample is five runs on eleven-day-old data: it shows the mechanism, not how the owner will judge a week of messages.

Nothing is blocked from outside.

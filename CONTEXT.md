# botdot

A messenger-style app for a team of AI bots, run by a Chief of Staff. Each person has an account on a machine that holds one or more; their account's botdot server holds their bots and data, and the web page and the Android and Mac apps are windows onto it. On Linux, the owner uses the web page; the botdot server and the account's computer still run on Linux.

## Language

### The team

**Bot**:
A headless Claude Code agent with its own main assignment, rules, tools, permissions, workspace and jobs, shown as a head in its colour whose face shows its state, with an outfit (a hat); beside its name in text, as a small head with its hat.
_Avoid_: agent, assistant

**Main assignment**:
A bot's standing task, the `prompt` field: what it does when a run brings no task of its own, and its guide for the messages the user sends it.
_Avoid_: usual task, task, prompt

**Chief of Staff**:
The one special chat that creates, changes and runs the other bots for the user. It counts as a bot when bots message each other. The user may give it a name of its own (asked once in the first-run setup, changed later by asking it); the apps then show that name where they name it, and "Chief of Staff" stays the name of its role.
_Avoid_: Chief bot, manager, admin

**Account's computer**:
The one Linux computer of an account, a container that stays on, which every bot with a computer works on at the same time, as the same user (`box`) with sudo. Its memory and CPUs are the account's share. Each bot has a screen of its own there; `/home/box` and `/workspace` are shared. Every bot there can see and change what the others do and read the secrets used there: the screens are separate work surfaces, not walls ([ADR 035](docs/adr/035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md)).
_Avoid_: VM, sandbox, container, a bot's own computer, computers (there is one per account)

**boat.dev computer**:
A bot's computer when its owner chose boat.dev for it: a Linux machine of its own at boat.dev, a paid cloud service, in place of the account's computer. It has the bot's commands and files, and a screen of its own with the bot's Camoufox browser ([ADR 094](docs/adr/094-a-bots-machine-on-boat-dev-has-a-screen-and-a-browser.md)), starts on the bot's first command and stops after 30 minutes unused ([ADR 088](docs/adr/088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md)). "This machine" is the account's computer, which is free.
_Avoid_: sandbox (boat.dev's own word), VM, cloud computer

**Bot's computer**:
The account's computer as one bot works on it: its own screen (a desktop with its own browser), which the user can watch live or take control of, and its own folder, `/workspace/<bot id>`. "Uses the computer" in a bot's settings gives a bot one; a bot without it has no screen and cannot reach the computer. A bot's old computer of its own, from before the account's computer, is kept stopped until the owner copies its files and erases it.
_Avoid_: VM, sandbox, desktop

**Group**:
One chat with two to six bots, its members. The user writes once and every member reads it; each answers under its own name or passes. A bot can be in several groups, and its own chat with the user stays apart from all of them. A member can also write there on its own (a post, `post_to_group`): only the members it names answer it. In the API a group is a "group chat" (`/api/group-chats`), because the name `group` was taken by the category.
_Avoid_: team, room, channel, group chat (in text for the user)

**Shared room**:
A chat on one machine where people of several accounts and their bots talk, kept by the front door and turned on by the admin. A bot there answers only when mentioned by someone its owner allows, and only talks: no tools, no notes ([ADR 060](docs/adr/060-a-shared-room-lets-bots-of-several-accounts-talk-through-the-front-door.md)). Unlike a group, it is not one owner's.
_Avoid_: room (alone, it reads as a group), channel, federation

**Category**:
A folder of bots and groups in the list, such as "Home" or "Work", under its heading. Until groups it was called a group, and it keeps that name in the data and the API: `group` on a bot, `POST /api/groups/rename`.
_Avoid_: group, folder, section

**Turn**:
One member's chance to answer in a group: a run of that bot which belongs to the group and to the message of the user's that led to it, and is no part of the bot's own chat.
_Avoid_: reply (a turn can end without one), round, step

**Pass**:
A turn that ends with nothing to say. It shows nothing and is no new reply.
_Avoid_: skip (a paused or deleted member is skipped: it gets no turn), silent reply

**Hand on**:
What a member does when it names another member in its reply: that member gets the next turn.
_Avoid_: hand off (a bot hands off work with `message_bot`, outside a group), delegate, forward

**Job**:
A run of a bot (AI or script) on a schedule, repeating or run once, or when called.
_Avoid_: cron, task, schedule

**Call**:
A request from a device or service with the job's key, that runs a job now: from wherever the front door can be reached, the internet included on a public install. A run it starts has the trigger `call`. "Webhook" appears only in `docs/api.md`.
_Avoid_: webhook, trigger, ping

**Call address**:
Where a job is called: one address per job, at the front door, naming the account (`/call/<account>/<bot>/<job>`).
_Avoid_: webhook URL, endpoint

**Needs you**:
Everything waiting for the user's OK (jobs, permissions, skills, installed tools, shared-memory changes, logins, payments), shown as one small head per item, in its bot's colour and hat.
_Avoid_: inbox, approvals, pending

**Card**:
One thing waiting in Needs you, with its buttons: drawn in Needs you and at the end of the chat it was asked in. The server's own word for most of them is an ask.
_Avoid_: request, prompt, approval

**Carry on**:
What follows the user's OK on a card: the bot or the Chief of Staff goes on with the work that waited for it, without a new message from the user.
_Avoid_: resume (a Claude session is resumed), retry, rerun

**Board**:
The owner's one page of tiles for the things they use most, under short headings. The Chief of Staff builds it by chat, and any bot may suggest a tile for it. The list shows it as one strip above the Chief of Staff: its tiles' names and values, or "Nothing on it yet"; the keypad as one line of the same above its pages. Its API paths, feed event and data file keep its earlier name, `dashboard`.
_Avoid_: dashboard, home, panel

**Tile**:
One thing on the Board: a switch, a button, a value, a list, a note, a group of tiles, a bot's page, or one built from blocks. A tile with a source belongs to a bot, whose saved logins and workspace it uses.
_Avoid_: card (a card waits in Needs you), widget

**Keypad**:
The home of a wide window ([ADR 029](docs/adr/029-a-wide-window-opens-on-the-keypad-with-one-chat-on-the-right.md)): the team as pages of keys, with the Board's values and Needs you above them and one chat on the right, the Chief of Staff's until the user opens a key. A narrower window shows the list instead.
_Avoid_: grid, dashboard, launcher, home screen

**Page**:
One part of the keypad (for what a bot writes, see A bot's page): the pinned bots and groups, one category, or Other, in the list's order. A page with no bot or group is left out, except Pinned on the web page, which always stands first with the Chief of Staff's key. Every app shows every page at once, one under the other under its heading.
_Avoid_: tab, screen, folder

**Key**:
One bot or group on a page of the keypad, with its head (a group's: up to three of its members' heads), its name and its line. A bot can have its own digit (its hotkey, set in its settings or by the Chief), shown on its key wherever it stands; the digits no bot holds number the other keys 1 to 9, counted across the pages. Opening a key opens that chat.
_Avoid_: tile (a tile is the Board's), button, card (a card waits in Needs you), shortcut

**Helper**:
A short-lived Claude Code agent a bot starts inside its own run (Claude Code's `Agent` tool) to do one part of the task in parallel, with the bot's tools, permissions and saved logins; it ends with the run, keeps no notes, and the bot gives the one reply. A bot uses helpers only with the permission "use helpers". It is not a bot and not a copy of one: it has no chat, head or jobs.
_Avoid_: subagent, copy, clone, worker

**A bot's files**:
What the user (or a teammate) gave a bot, kept in its folder until the user deletes them. Every task of the bot names them. Not the files a bot attaches to its reply, which are kept with that reply.
_Avoid_: uploads, attachments (in what the user reads)

**A bot's page**:
A lasting page a bot writes for the user in Markdown (a report, a memo, an overview), kept in its folder, opened in the app and listed under Pages in its settings. "Keep up to date" gives it a job that rewrites it ([ADR 065](docs/adr/065-a-page-is-a-bots-markdown-kept-up-to-date-by-the-owners-tap.md)). Never HTML, except an interactive page. Not a page of the keypad, and not the Board.
_Avoid_: artifact, document, report (for the page itself)

**Interactive page**:
A bot's page that is a small site it built on its computer (views, filters, a kanban), shown in a sandbox on an address of its own that can't see the account or reach the internet, with its versions ([ADR 072](docs/adr/072-an-interactive-page-is-a-bots-static-site-sandboxed-on-an-address-of-its-own.md)). The one kind of page that is HTML.
_Avoid_: app, artifact, website (in what the user reads)

**Kept in mind**:
Of a bot's file: its text, or the bot's summary of it, comes with every task of the bot. The API calls it `pinned`; the user reads "Keep in mind", so it is never mixed up with a pinned bot or a pinned note.
_Avoid_: pinned file, remembered

**Installed tool**:
A command-line program (`gh`, `make`, `ffmpeg`) put on the botdot server for one bot after the user's OK on a card in Needs you, taken from botdot's registry (conda-forge) or from a link. Only that bot can run it, it cannot change it, and it stays across botdot updates. The Chief of Staff asks for it; a bot asks the Chief. "Tool" alone stays what a bot may use (`Read`, `Bash`, the web).
_Avoid_: package, dependency, plugin, app

**Vault**:
Where the user keeps the secrets their bots may use without ever seeing them: botdot's own encrypted store or, once connected, the **bot-dot** folder of the user's Bitwarden. A saved item has one of three types: a **login** (a username or email, and a password), an **API token** (a token, with its token ID where the service has one) or **other** (any other secret, alone). The type is a label and the fields its form asks for; it limits nothing, and every type is typed in a browser and used in an API call alike. Bitwarden's payment cards and identities are in the Vault too and have no type.
_Avoid_: password manager, keychain, secrets store, credentials

**Mention**:
`@` plus the name of a bot, a bot's job, a bot's page, a tile of the Board or a skill in a message (`@FleetDoctor`, `@FleetDoctor/MorningCheck`, `@IssueList`, `@weekly-report`), saying the message is about it; it doesn't send anything to it or grant anything. A page or a tile mentioned comes to the run that answers with what it holds now ([ADR 078](docs/adr/078-a-mentioned-page-or-tile-is-handed-to-the-run.md)). In a group a mention of a member does one thing more: it gives that member the turn. The user's mention picks who answers, and a member's mention hands on. A mention of a bot that is no member gives nobody a turn. `@all` at the start of a message in a group is no mention: it gives every member its turn at once, and their replies hand on to nobody.
_Avoid_: tag, ping

**New reply**:
A reply in a bot's chat or a Chief chat that is meant for the user and that they have not read: a bot's answer to them, a scheduled report that reached them, a run that couldn't finish, or a Chief reply. A run another bot or the Chief started, and a quiet run, are never one. The botdot server decides it, the same for every app.
_Avoid_: unread message, notification, badge

**Working line**:
The one line under a working bot's chat and in its row in the list, with Stop beside it. The botdot server decides its text and changes it as the run goes on ("Reading nytimes.com", "Starting its computer"); it starts with the opening line when the bot wrote one. The server keeps it only while that run is going on, and it is gone when the answer arrives. A member's turn in a group has one too, under its name, and the Chief of Staff's line while it replies reads the same way: its opening line first, then the server's words for what it is doing. A script job has none: it has no run while its script runs. It is never a new reply and never part of the chat.
_Avoid_: status message, progress message, narration

**Opening line**:
The one short line a bot or the Chief of Staff may write before work that uses tools, saying what it is about to do ("Checking the weather in Brussels"). It is the working line's first text: the apps show it under the chat and as the bot's preview in the list until the botdot server has later words for the run. It is never a new reply and never part of the chat.
_Avoid_: status message, progress message, narration

**Reply draft**:
A bot's, the Chief of Staff's or a group member's reply as it is being written, shown in the place of that reply and growing there while the run works, in the chat that is open. Only the reply: never the opening line, text before a tool call, its answer buttons or a pass. The reply takes its place when the run ends. It is never a new reply and is kept nowhere.
_Avoid_: streaming message, typing indicator, partial reply

**Plan**:
The steps a bot or the Chief of Staff writes down for work of several steps, each done, at work or to do. The owner sees it above the message box while the work goes on, folded under the reply once it is done, and as "Stopped at step N of M" when the work was stopped or failed before its steps were done, until the owner dismisses it. Only what the bot wrote with its plan tool is a plan, never steps it lists in a reply. It is never a new reply. Not the Chief's proposal to build a bot, which waits for Approve.
_Avoid_: todo list, task list, checklist, progress

**Look**:
A Chief of Staff turn the botdot server starts by itself, a few times a day outside quiet hours, in which the Chief only reads (what it knows about the user, and the web) and decides whether there is one thing worth telling them. It ends with one unasked message or with nothing, and nothing leaves no trace.
_Avoid_: heartbeat, check-in, proactive turn

**Unasked message**:
A message the Chief of Staff wrote to the user after a look, without being asked: a follow-up, a tip, a fresh find or a joke tied to what the user asked about, at most three a day. It is a Chief reply like any other, so it counts as a new reply, and it is the only kind of message the user can rate with 👍 or 👎.
_Avoid_: proactive message, nudge, push, tip of the day

**Checkup**:
A Chief of Staff turn the botdot server starts by itself on the days and at the time the user set (weekday mornings unless they say otherwise), in which the Chief only reads how the bots did since the last checkup: the chats the user started, the jobs, the messages between bots and the Board. It asks no bot, and it searches the web only if the user switched that on. It ends with at most three proposals, each with its evidence, or with nothing. It is not a look: its message is not an unasked message, is not rated and does not count toward the three a day.
_Avoid_: fleet checkup, healthcheck, fleet report, audit

**Proposal**:
One change the Chief of Staff suggests after a checkup: a rule, a skill, a bot, a job or a tile, with the day and the words that show why. Nothing changes until the user picks it; their pick is the yes.
_Avoid_: recommendation, suggestion, finding

**Read position**:
The time up to which the user has read a chat, kept by the botdot server. A chat is read while an app shows it and is in front.
_Avoid_: last seen, read receipt

**Steer**:
The owner's press on a waiting message of a working bot or of the Chief of Staff: the run or reply that is going reads it at its next tool call, in place of starting it as a run or turn of its own later. Until then it shows "Steering…" and can still be taken back (ADR 040).
_Avoid_: interrupt (Stop ends the run), inject, push

### Memory

**Note**:
One thing a bot, the Chief of Staff or the user chose to keep: a short sentence that names its subject. Nothing is kept that nobody saved.
_Avoid_: memory (that is all of a bot's notes and past runs together), fact, memory item

**Shared note**:
A note about the user as a person that every bot reads ("Lives in Brussels").
_Avoid_: global memory, user memory, shared memory entry

**Chief's note**:
A note the Chief of Staff keeps for itself, about how the user wants the team run ("Ask before creating a bot"). No bot reads it.
_Avoid_: system note, admin note

**File a note**:
What the Chief of Staff does with something the user tells it: save it where it belongs, for all bots, with the bots it is about, or for itself.
_Avoid_: route, assign, distribute

**Pinned**:
Of a note: in every prompt of its bot. A note that is not pinned is searchable: the lookup and recall find it.
_Avoid_: active, core, always-on

**Source**:
Who said a note: the user (shown as "you said"), the bot itself, or the bot after it read outside content. The botdot server sets it; a bot never does.
_Avoid_: author (who last wrote the note), confidence, trust level

**Outside content**:
Anything a run read that neither the user nor the bot wrote: a web page, a connected app, a command's output, a file or message from someone else.
_Avoid_: untrusted input, external data

**Passing state**:
Something true about the user for a time ("in Berlin this week"), kept as a note with the day it ends.
_Avoid_: temporary memory, expiry, TTL

**Remove**:
To take a note out of every bot's reading because it is no longer true, replaced or ended; it can be brought back for 30 days.
_Avoid_: delete, archive, soft delete

**Forget**:
To erase a note for good, with its history, and leave the runs that held it out of everything a bot or the Chief of Staff reads.
_Avoid_: delete, remove

**Left out**:
Of a past run: read by no bot and no Chief of Staff tool, though still in the user's own chat history.
_Avoid_: excluded, hidden, "Don't recall"

**Lookup**:
The few notes and past runs the botdot server adds to a prompt by itself because they match the request.
_Avoid_: retrieval, RAG, search

**Recall**:
A bot's own search of its notes and past runs, when it asks for it.
_Avoid_: lookup, search (the user's search over all chats)

### Where botdot runs

**botdot server**:
The program that holds one account's bots, their data and the web page. Every account has its own, behind the front door of the machine it runs on; every app is signed in to exactly one account at a time.
_Avoid_: Server, backend, host, instance

**Account**:
One person's own botdot: their Chief of Staff, bots, groups, memory, Vault, Board, Needs you and settings, signed in to Claude with their own login. A machine botdot runs on holds one or more, and nothing in one account can be seen or reached from another.
_Avoid_: tenant, profile, workspace, user (in text for the user)

**Front door**:
The one program on a machine that people reach: it signs them in, takes sign-up links, serves the admin page and passes each signed-in person to their account's botdot server.
_Avoid_: proxy, gateway, router

**Admin**:
The person who runs the machine botdot is on: they create accounts with sign-up links and set how much of the machine each may use. The admin has an account of their own like anyone else, and sees nothing inside other accounts.
_Avoid_: operator, owner (a person owns their account), host

**Admin page**:
Where the admin creates and revokes sign-up links, suspends or deletes accounts, sets their share of the machine, sees its load, updates botdot for every account at once and reads the Feedback owners send. It never shows what is inside an account, but for that Feedback: what an owner wrote to the admin, and the screenshots they added, on purpose.
_Avoid_: dashboard (the Board's old name), admin panel, console

**Feedback**:
A bug report or a feature request an owner sends the admin of their machine with the icon beside Settings, on the web page or in the Android app. It holds only what they typed and up to three screenshots they added on purpose, and the admin reads it on the admin page and sees each screenshot whole.
_Avoid_: ticket, issue, support request, bug report (for both kinds)

**What's new**:
A short note per release, written by hand, that the web page and the Android app show once after an update: a title and 2 to 4 points in plain words. Closed once, it is gone in every app of the account.
_Avoid_: changelog, release notes, patch notes

**Share**:
How much of the machine one account may use: CPUs, RAM and disk. Its CPUs and RAM are also the limits of the account's one computer. The admin sets the default share and may give one account its own. Nothing in the account shows it: its work slows down, and a full disk fails a run with "No space left on the server".
_Avoid_: quota, plan, limits, tier

**Sign-up link**:
A link the admin makes on the admin page and hands to one person; opening it creates one new account and its passkey. It works once and ends after 7 days or when the admin revokes it. A fresh install prints the first one, which makes the admin's own account.
_Avoid_: invite, invitation, registration link

**Sign-in link**:
A link the admin makes on the admin page for an account that exists, for its owner who lost every device: opening it makes a new passkey for the same account. It works once and ends after a day.
_Avoid_: recovery link, reset link, magic link

**Suspended**:
An account the admin paused: its botdot server and the account's computer are stopped, its data is kept, and its owner sees only "Your account is paused by the admin" until the admin resumes it.
_Avoid_: disabled, frozen, locked, banned

**Local botdot server**:
A botdot server that the Mac app set up and looks after on the same Mac, in Docker. A botdot server on a VM is just a botdot server, even if the user runs it themselves.
_Avoid_: self-hosted botdot (every botdot is self-hosted), embedded server

**Self-built botdot server**:
A botdot server whose images were built from the source on its own machine instead of downloaded as botdot's signed images. It is updated by pulling the source and building again; on a machine of several accounts the admin page's Update then moves every account to what was built.
_Avoid_: local build (a local botdot server is the Mac app's), dev build, unofficial build

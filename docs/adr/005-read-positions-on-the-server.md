# ADR-005: Read positions live on the botdot server

- **Status:** Accepted
- **Owning task:** MSG-001; amended by BOARD-003 (a scheduled script's run whose output went to the AI is quiet)

## Context

[Milestone 2](../product/milestone2.md) shows which bots have new replies (dots in the list, a "New" line in the chat) on the web page and in the Android and Mac apps, and makes notifications follow the same state. Today nothing records what the owner has read. The only related signal is transient: the web page and the Mac app tell the server which chat is on screen (`POST /api/presence`), and the server announces `chat_seen` on the live feed so the phone drops that chat's notification. The Android app does not report it. An app that was offline learns nothing afterwards.

The three apps must agree, an app that reconnects must show the right state, and the state must survive a restart, a backup and a restore.

## Decision

The botdot server owns unread state. The apps report and display; none keeps its own.

- **One read position per chat.** A chat is a bot's chat (`bot:<id>`) or one of the Chief's chats (`chief:<chatId>`). The position is the time up to which the owner has read. It is stored in one file with botdot's data, so backup and restore carry it.
- **The server decides what is new.** It counts the replies after the read position that are meant for the owner: a bot's answer to the owner, a scheduled report that reaches the owner, a failed run, the Chief's replies. Folded bot-to-bot exchanges and quiet runs are never counted. The apps get, per chat, the count and the first unread reply; they do not recompute either.
- **Reading is reported, not inferred.** An app says which chat is on screen while it is in front; the server moves that chat's position to now and announces it on the live feed. All three apps report. A reply that arrives for a chat an app is reporting is read at once.
- **Notifications follow the same event.** An app shows a notification for a reply the server counts as new and removes it when the server says the chat is read.
- **Migration.** On the first start with this change every chat's position is now.

### What MSG-001 decided

**The store.** `read-positions.json` in the data folder, written through `lib/jsonfile.js`: `{ version: 1, since, chats: { "bot:<id>": time, "chief:<chatId>": time } }`. `since` is the moment the file was first made; a chat with no entry of its own is read up to `since`. That is the migration, and it also covers a bot or a chat created later: all its replies are after `since`. The file is made after the start has marked the runs a previous process left running, so those are read too on the first start. A position only moves forward. Deleting a bot or a Chief chat deletes its entry. `lib/read.js` holds the store and the rule; nothing else writes the file.

**The rule,** one function per kind of chat, used for the count, for the first new reply and for the feed:

- A run counts when it has ended (`status` is not `running`), is not a memory review (`trigger: "review"`), is not quiet (the API's `quiet`: `quietRun` in `lib/problems.js`, which covers a scheduled run with nothing to say and a report that was suppressed or is still held), and addresses the owner: its `notificationAudience` is `owner`, the field the feed already carried. A run another bot's message started, a run the Chief started and a follow-up on either are `internal` and never count, failed or not. A failed run is one with `status` `error`, `stopped` or `interrupted`, the three the API gives a `problem`. A script job's run exists only when the script found something or handed its output to the AI, and counts, except (amended on 2026-10-04 by BOARD-003, the owner's decision) a scheduled one that ended well and handed its output to the AI: it is quiet (`handedOver` on the run) and never counts, because the AI's report is what reaches the owner.
- A run's time is `deliveredAt`, else `endedAt`: a report held overnight becomes new when it is delivered.
- The first new reply is the topmost new one as the chat shows them: for a bot the new run that started earliest, for a Chief chat the new message with the lowest index. Every other new reply is below it, so the "New" line has none above it.
- A message of a Chief chat counts when its `role` is `chief` (a reply, a reminder going off) and it is not `pending`, or `report` (a bot's reply posted in that chat). The owner's messages and a bot's `suggestion` do not; a suggestion waits in "Needs you". Its time is `endedAt`, else `at`; a message that waited for the Chief to finish its reply (a bot's reply, a reminder) gets as `at` the moment it reached the chat.
- A reply is new when it counts and its time is after the chat's read position.

**The fields.** A bot, in `GET /api/bots` and `GET /api/bots/:id`: `unread`, the number of new replies, never capped (the apps cap what they draw), and `firstUnread`, the `id` of the run that is the first of them in the chat, or `null`. A Chief chat, in the `chats` of `GET /api/chief` and in `GET /api/chief/chats/:chatId`: `unread`, and `firstUnread`, the index of the first new message in the chat's whole `messages` (as `index` in search, and as `offset` counts), or `null`. `GET /api/chief` also returns `unread`, the sum over its chats, for the Chief's one row. `features` has `unread`.

**The report** is a call of its own, `POST /api/read` with `{ "app": "<id>", "chat": "bot:<id>" | "chief:<chatId>" | null }`. It says what that app shows now, in front: one chat, or none. `app` is an id the app makes up for itself (letters, digits, `.`, `_`, `-`, up to 80), so that the server can tell two apps showing the same chat apart; it means nothing else and is not stored. Each report takes the place of that app's last one. With a chat it answers `{ ok: true, chat, readAt, repeatMs }`, with `null` `{ ok: true, chat: null, repeatMs }`. A chat that does not exist, anything that is not a chat, or a report without `app` is refused with `400` and changes nothing. `POST /api/presence` does not carry the report: that call also says "the web page is in use", which silences the phone, and the phone itself must be able to report.

**How long a report counts.** Until that app's next report, and at most 15 seconds. An app reports a chat when it comes on screen with the app in front, repeats it every `repeatMs` (10 seconds) while that stays so, and reports `null` the moment it does not: the chat is closed, the page is hidden, the app goes to the background, the window is no longer key. So a reply is read at once while a chat is being watched and is new from the moment the app says it left. The 15 seconds are for an app that could not say so (it was killed, it lost its connection): its report runs out by itself. A chat is on screen while any app's report names it. Reports are kept in memory only; after a restart the apps' next repeat brings them back.

**The feed.**

- `unread`, `{ chat, unread, firstUnread, readAt }`: where that chat stands now. It is sent whenever a chat's count changes: after a reply that is new (once for the messages that reach a Chief chat together), and when a report reads a chat that had new replies (`unread: 0`). It replaces `chat_seen`. An app sets the chat's dots from it and removes the chat's notification when `unread` is 0.
- `run_finished` and `chief_reply` carry `new: true` when that reply counts as new. It is left out when the reply does not count or was read at once because its chat is on screen. An app that follows unread state notifies exactly for events with `new: true`.
- A report that leaves the count at 0 sends nothing: nothing changed for any app.

**What stays for apps from before.** `chat_seen` is still sent, by `POST /api/presence` as before and by `POST /api/read` when a chat comes on screen that no app was showing, so a phone app from before this change still drops that chat's notification. `webActive` and `POST /api/presence` stay as they are. Neither is part of unread state: an app that has `unread` in `features` follows `unread` and `new` and ignores `chat_seen` and `webActive`. MSG-009 and MSG-010 make that switch; when no supported app needs them, `chat_seen`, `webActive` and the presence call can go, in a task of their own.

## Alternatives

- **Each app keeps its own read state.** No server change, but the apps disagree and a reinstalled app shows everything as new. Rejected by the outcome: "all three agree".
- **A read flag per reply.** Allows marking single replies, which the milestone excludes, and costs a write per reply.
- **Keep `chat_seen` transient and let apps remember.** An app that was offline misses it; nothing survives a restart.
- **The presence call carries the report.** No new call, and today's web page and Mac app would report without a change. Rejected: presence also means "the web page is in use", so a phone reporting through it would silence its own notifications, and the Mac app sends it while its window is not in front, which would read chats nobody looks at.
- **Reports that only run out,** with no id per app and no way to say "I left". Simpler, and what this task built first. The review found the cost: a bot's answer that lands within 15 seconds of the owner leaving its chat is read at once and never shows a dot or a notification, which is the common case of asking a bot and switching away. Shortening the time only shrinks the hole and multiplies the calls.
- **Taking a report back by chat, without an id per app.** Two apps on one chat: when one leaves, the chat counts as off screen until the other repeats, and a reply in that gap rings the phone for a chat the owner is looking at.
- **The first new reply by arrival time.** A held report delivered in the morning arrived last but sits above later runs in the chat; the "New" line would be drawn below it.
- **One position per existing chat written at migration.** The same result as `since`, but it needs every chat listed at the first start and a rule for chats made later.
- **A separate "read" event and "new reply" event.** Two events for one fact, the chat's count; one `unread` event with the count serves both directions and a reconnecting app replays it the same way.
- **Counting only what today notifies, memory reviews included.** A review is housekeeping, not something the owner asked for or was sent; it stays in the chat and makes no dot.

## Consequences

- The bots and the Chief's chats gain unread fields in the API, documented in `docs/api.md`.
- The Android app must start reporting the chat on screen.
- The web page and the Mac app must report through `POST /api/read`, only while in front, every `repeatMs`, and `null` when they stop; their presence call says nothing about reading.
- An app must say when it stops showing a chat. One that cannot (killed, connection lost) leaves its report counting for up to 15 seconds; a reply in that time is read and shows no dot. A watched chat never shows a dot.
- The first new reply of a bot can have read runs below it in the chat (a held report delivered after later runs were read); the count says how many are new, the line only where they begin.
- Unread counts are derived from the runs and the chats on every request, from fields kept in memory (the run index, the chat summaries); only the positions are stored. Nothing can drift between the count and the chat, and a run whose fields change (a held report delivered) is counted by the same rule.
- A run the restart cut off counts as a failed run after that restart, except on the first start with this change.
- Restoring a backup restores its positions: replies in the backup after them are new again.
- An app older than the server ignores the new fields and shows no dots; an app newer than the server gets none and shows none.
- "Mark as unread" would later need a second flag beside the position, as Matrix does with `m.marked_unread`; it is out of scope.

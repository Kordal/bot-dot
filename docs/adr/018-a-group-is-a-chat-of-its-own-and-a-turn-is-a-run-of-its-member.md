# ADR-018: A group is a chat of its own, and a turn in it is a run of its member

- **Status:** Accepted
- **Owning task:** GRP-001

## Context

[Milestone 10](../product/milestone10.md). The owner wants one chat with several bots. Today there are two kinds of chat and the server, the web page and the Android app each know exactly those two ([research note](../archive/product/milestone10-research.md), "A chat is one bot"):

- A bot's chat is not stored: it is every run with that `botId`. The readers that build it all go by `botId`: `GET /api/runs`, the list's preview, `unreadByBot`, `asksByBot`, `recentConversation`, `announceFinished`, the search hits (`lib/bots.js:527-661`, `server.js:2181`).
- A Chief chat is a file of messages with a role.
- The key of a chat is `bot:<id>` or `chief:<id>`, in the read positions, the presence check, the message keys, the web page's address and Android's routes.

A run carries what a group's reply needs: Stop and who ended it, the files a bot attached, the opening line, the card asked in it and the carry-on after a yes, the note chips, and its place in the bot's memory. A message in a Chief chat carries none of that.

An app from before this milestone lists a bot's chat by `botId` alone (`public/app.js:2636`, `data/Api.kt:107`) and notifies for a finished run that is `new` (`feed/Notifier.kt:762`). So a run that only gained a field `group` would show up in its bot's own chat and ring the phone under that bot.

"Group" is also what a folder of bots is called today: a text on each bot (`group`), with the route `POST /api/groups/rename`.

## Decision

- **A group is a record of its own:** an id, a name, two to six members (bot ids, in the group's order) and its place in the list, as a bot has it (category, order, pinned). A bot can be in several groups.
- **A group is a third kind of chat,** with the key `group:<id>` wherever a chat has a key: read position, presence, message key, the address on the web page, the route on Android.
- **The owner's message in a group is the group's, kept once.** It starts turns; it is not the `prompt` of several runs.
- **A turn is a run of its member:** a run record with its `botId`, and the group and the owner's message it belongs to. Stop, files, the opening line, cards, the carry-on and the chips work on it as on any run. The link is kept wherever a run is rebuilt: the run index, a run that waits, one that never started, a carry-on.
- **A turn is no part of its bot's own chat.** Every reader that goes by `botId` to build a bot's chat, its preview, its new replies and its open question leaves a group's runs out. `GET /api/runs` hands them out only when asked for a group.
- **A group has its own answers on the feed and in the API:** its chat, its new replies, its working members. Nothing of a group is sent as an event an older app acts on, so that app shows no group and rings for none.
- **A turn is one of its bot's past runs** in the memory index, so the bot recalls in its own chat what it did in a group ([ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md)).
- **`features` has `groups`.** An app asks before it offers one.
- **The folder keeps its name in the data and the API** (`group` on a bot, `/api/groups/rename`) and is a "category" on screen and in the documents, as the Board kept `dashboard`.

Resolved by GRP-001 (2026-10-08):

- **The routes are `/api/group-chats`:** `GET` and `POST /api/group-chats`, `GET`, `PUT` and `DELETE /api/group-chats/:id`. `/api/groups/rename` stays the category's. The records are one file, `groups.json`, in the data folder (`lib/groups.js`).
- **On a run the link is `groupId` and `groupMessageId`,** not `group`: `group` is the category on a bot, and one name for both would be read wrong. `GET /api/runs` takes the group as `?group=<id>`. The key of the chat is `group:<id>`.
- **A reader says which runs it means** (`runSummaries` in `lib/bots.js`): the bots' own chats, which is what it gets by default and never holds a turn; one group's turns (`groupId`); or every run (`all`), for the memory index and for a restart that marks what was cut.
- **A run of a group is announced under names of its own:** `group_run_started`, `group_run_finished`, `group_opening_line` and `group_run_waits`, each with `groupId` and `chat: "group:<id>"` (`emitRun` in `lib/events.js`). It sends no `unread`, no `asks` and no `queued` of its bot. A change to a group is the event `groups`. With a turn's start and its end the server also sends `bots`, the event for "read the bots again": the member's own row shows that it works, in an app from before groups too.
- **The owner's messages in a group are kept in one file per group,** `group-messages/<id>.json` in the data folder, written by the task that takes them (GRP-002) and removed with the group. Not in `groups.json`, which every message would rewrite, and not as the `prompt` of a run, which several turns share.
- **A pass leaves a run record.** The member ran: Stop and who ended it need the record, a restart must know that the member had its turn, and the run is in the member's past runs. The readers of the group's chat leave it out, by the mark GRP-002 gives it.
- **A group's place is counted among the groups.** `category`, `pinned` and `order` mean what `group`, `pinned` and `order` mean on a bot, numbered among the groups only; in the list a category's groups stand after its bots, and the pinned groups after the pinned bots. A bot's numbers do not change when a group is made or moved. Since [ADR 058](058-pinned-bots-and-groups-share-one-order.md) `pinned` is one order for the pinned bots and groups: a group can stand before a bot there, and pinning or moving a group can renumber the pinned bots.
- **A search hit in a group is handed out only on request:** `GET /api/search?groups=1` adds the turns of the groups that exist, each with `group`. Without it a turn is no hit.
- **A group with one member left, or none, stays** until the owner deletes it. The owner cannot take a member out of a group of two; a deleted bot can leave it so.
- **A group's routes are the owner's.** The Chief's tools had none until GRP-007. Since then they list the groups, make one, rename one and change its members through these routes, in a turn the owner started and in no other, as [ADR 017](017-the-chief-files-a-note-with-a-bot-in-the-owners-turns.md) holds it for notes; deleting a group and every route of its chat stay the owner's (`docs/api.md`, "The Chief and groups"). A turn is a run, and the Chief's tools read it as they read any run, by its id or with `?group=`, without the text of one that is left out ([ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md)).
- **`chat_seen` is never sent for a group,** and `POST /api/presence` takes no group's chat: both serve apps from before read positions, which know no group.

Amended by [ADR 077](077-a-member-posts-in-its-group-on-its-own.md) (2026-10-23): a member may also write in its group on its own (`post_to_group`). Its post is a run of that member with `posted: true`, and the message kept for its line is marked `from` and holds no word of the owner's.

## Alternatives

- **A group as a file of messages, like a Chief chat.** One place for the chat, and no reader to change. Rejected for now: a reply would lose Stop, files, cards, the carry-on and memory, or each would be built a second time.
- **A group's turn as a message from a teammate** (`message_bot`, `trigger: 'bot'`). It exists today. Such a run is folded in each bot's own chat, never a new reply, gets no chat to read and replies to its asker in the asker's own chat (`lib/bots.js:894`, `:1034`, `:1169`): a group would be spread over its members' chats.
- **The category's own chat** (prototype B). No record and no members to keep. Not chosen by the owner on 2026-10-08: a bot would be in one group only, and a category of seven bots a chat of seven.
- **Renaming the `group` field to `category`.** Every app from before would lose the folders.
- **A group's routes under `/api/groups`** (`/api/groups/:id` beside `/api/groups/rename`). Rejected: `POST /api/groups/rename` renames a category and `PUT /api/groups/:id` would rename a group, under one name.
- **One order for the bots and the groups of a category,** so that a group can stand between two bots. Rejected: a bot's `order` would no longer be its place among the bots. The Android app of Milestone 9 compares the place it computed among the bots with `order` before it saves a drag (`ui/HomeScreen.kt`), and the web page sends a place among the bots; with groups in the count a drag would save nothing or land one row off.
- **Leaving a turn's events under the old names with a `groupId` field.** Rejected: an app from before reads `botId` alone, draws the turn in the bot's chat and rings for it.
- **No record for a pass.** Rejected: after a restart nothing would say that the member already had its turn on that message.

## Consequences

- Every by-`botId` reader is touched once, and a new one must ask whether it means the bot's own chat or all its runs.
- A bot's state, its one-thing-at-a-time and its queue stay per bot: a member at work in a group is working in its own row too.
- An app from before this milestone cannot see a group at all, also when a card of a member waits there: the card itself is in Needs you as before.
- Deleting a group removes a chat; its members' runs stay their own past runs. They keep their `groupId`, so they never turn up in a bot's own chat afterwards.
- A group cannot be dragged between two bots: it is ordered among the groups of its category.
- An app from before groups does not hear that a turn started or ended, only that the bots changed (`bots`); it reads them again and shows the member at work.
- The rule that two members cannot share a mention name is checked when a group is made or its members change. A bot renamed afterwards can break it; the next change to that group's members is refused until one is renamed.
- A message of the owner's in a group counts, for the carry-on rules of [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md), as a message to that bot: a card of the bot's own chat that waited is not carried on after it. GRP-003 decides what carries on in a group.

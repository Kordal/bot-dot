# ADR-011: A bot does one thing at a time, and the owner's message waits on the botdot server

- **Status:** Accepted
- **Owning task:** BUSY-001

## Context

[Milestone 7](../product/milestone7.md). "Busy" has three rules today. A replying Chief refuses the owner's message (`lib/chief.js`, "The Chief is still replying"). A bot with a run going starts a second run beside it, which cannot see the first (`server.js`, the route `POST /api/bots/:id/run`; `docs/api.md` records "a bot can have two runs going"). The Android app blocks sending while a bot works. Everything else that wants a busy bot already waits: a teammate's message, a job, a follow-up, work that carries on after an OK ([ADR 009](009-the-botdot-server-carries-on-after-an-ok.md)) sit in `data/queue.json`, ten per bot, first in, first out. Turns botdot starts for the Chief wait in `data/chief-waiting-turns.json`. Neither holds an owner's message, and no route or feed event shows what waits.

On 2026-10-06 the owner chose the priority "the message gets through": never refused for being busy, never a second run beside the first, kept and started when the bot or the Chief is free, shown as waiting, and to be taken back.

A Chief turn is one `claude -p` process with one prompt on its input, closed at once. A message cannot reach a turn that is going.

## Decision

- **A bot has one run at a time.** Every way to start a bot goes through its queue: the owner's message, the Chief's `run_bot`, a Board tile. `docs/api.md` loses "a bot can have two runs going".
- **The owner's message is work that waits, on the server.** It is a queue item with its text, its files, its message key and who sent it, written to disk before the request is answered. The apps keep nothing of their own for it.
- **A waiting message already has the id of its run.** The id is made when the message is taken, and the run gets it when it starts. The answer of `POST /api/bots/:id/run`, the message key, the Chief's `wait_for_run` and a tile's `runId` keep working on that id.
- **The owner's messages start first.** Before anything else that waits for that bot, in the order they were sent, each as its own run. They have their own limit of ten per bot, apart from the ten of the other work, so a full queue of jobs never refuses the owner.
- **The same for a Chief chat.** An owner's message to a chat whose reply is going waits in that chat's list and starts when the reply ends, before the turns botdot starts.
- **What waits is data the server hands out.** Each bot and each Chief chat lists the owner's waiting messages; a feed event says when a list changes; a route takes one back and answers with its text and files.
- **A message waits for the next run or turn.** It is not handed to one that is going.
- **The Chief stops waiting when the owner writes.** A Chief turn that only waits for a bot's run (`wait_for_run`) is told at once that the owner wrote, and ends; the run goes on.

Resolved by BUSY-001, for a bot. A Chief chat gets the same names from BUSY-002, under its own heading here.

- **The names.** What waits is called `queued`, as "Run now" and a bot's message already say it; `waiting` is taken by the feed's event for notes, by a Chief chat's plan and by both apps' models. A bot has `queued`, a list of `{ id, text, attachments, at }`, oldest first. The feed's event is `queued`, with the whole list. `DELETE /api/bots/:id/queued/:queuedId` takes one back and answers `{ text, attachments }`. The answer of `POST /api/bots/:id/run` while its run waits is `{ id, botId, status: "queued", prompt, attachments, queuedAt }`, and `GET /api/runs/:id` and its `/wait` answer the same for that id. `docs/api.md`, "A message that waits", is the contract.
- **Two kinds of work, in the bot's one file.** The owner's message, and a Board tile's request, is the kind `owner`; a run the Chief asks for is the kind `chief`. Both carry the id their run will have (`runId`) and sit in `data/queue.json` with the rest, so that a restart needs no second store. An `owner` item also keeps the text as the owner wrote it and the message's key. In `drainQueue` the oldest `owner` item starts before anything else; the rest stays first in, first out, the `chief` kind among it.
- **Two limits.** Ten `owner` items per bot, and ten of everything else, counted apart. The eleventh message is refused with `429` and a sentence; nothing is kept and its key is not taken.
- **Order holds also in the moment between two runs.** A message that arrives while the bot is free but another of the owner's messages still waits is put behind it, and the oldest starts. Other work that comes up in that moment (a "Run now", a teammate's message, work that carries on) waits too, so that the owner's oldest message is what starts.
- **It counts as sent from when it was sent.** For the rules of [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) a waiting message is "the owner sent the bot a message" from the moment it was taken, not from when its run starts: that is when the owner asked. So a card that is older than the message starts nothing for an earlier request, also while the message still waits. The run keeps that moment as `sentAt`, and the rule reads it before `startedAt`. A message sent before a run asked, which starts after it, does not count against that run: it was not the owner taking up what stopped.
- **A file that is gone.** The files are checked when the message is taken, as for a run. One that is gone from the workspace when its turn comes is left out and the message starts without it, as work that carries on does ([ADR 009](009-the-botdot-server-carries-on-after-an-ok.md)). The message is never dropped for it.
- **A message that cannot start is a failed run.** When its turn comes and no run can be made, botdot writes a run with that id, the status `error` and the reason in a sentence, and announces it as any run that ended. `drainQueue` drops other work that throws with a console line; not the owner's message, and not a run the Chief asked for.
- **Take back removes the key.** The message's key is kept in the step that takes the message, with the id of its run. A take back forgets it, so the same message may be sent again with the same key.
- **A deleted bot takes its waiting work with it.** Everything that waits for it leaves the file with the bot.
- **The Chief's list** (the fourth open point) is not the chat's file: a turn that is going saves the chat from its own copy and would write over it. A Chief chat's waiting messages are kept beside the turns botdot starts, in `data/chief-waiting-turns.json`, and the chat's answer lists them. BUSY-002 builds it and records its shape here.

Resolved by BUSY-002, for a Chief chat.

- **The names are a bot's.** A chat has `queued`, a list of `{ id, text, attachments, at }`, oldest first; the feed's `queued` event carries `chat: "chief:<chatId>"`, `chatId` and the whole list; `DELETE /api/chief/chats/:id/queued/:queuedId` takes one back and answers `{ text, attachments }`. The answer of `POST /api/chief/chats/:id/messages` is the chat with `busy` and `queued`. `docs/api.md`, "The Chief takes a message while it replies", is the contract.
- **One file, two kinds of item.** `data/chief-waiting-turns.json` keeps, per chat, what waits for the reply to end. A turn botdot starts is `{ prompt, message, otherwise, title, at }` as before; an owner's message is `{ owner: true, id, text, attachments, key, at }`. When a reply ends, one item starts: the owner's oldest, else botdot's oldest. The rest stays in the file until that turn has ended, so a restart finds it. Before, every waiting turn left the file at once and the later ones were written back.
- **The message has an id of its own, not a turn's.** A Chief turn has no id. The id is made when the message is kept; when its turn starts, the `user` message in the chat carries it as `queuedId`. A take back that comes too late finds it there and answers `409`.
- **The turn is built when it starts.** The plan that waits in the chat, the lines the Chief has not seen and the look's record are read then, by the same code as for a message sent at that moment. So an "Approve" that waited answers the plan when its turn comes, and not if the reply before it built the plan meanwhile.
- **Order holds also in the moment between two turns.** A message that arrives while no reply is going but another of the owner's still waits is put behind it. A turn botdot starts in that moment waits behind everything that waits there.
- **It counts as written from when it was sent.** For the rules of [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md), "the owner wrote in that chat since" reads a waiting message's time too.
- **Ten, and no age limit.** The eleventh message is refused with `429`; nothing is kept and its key is not taken. A turn of botdot's that waited more than 24 hours for botdot to come back is not started; an owner's message is started however long it waited.
- **A file that is gone, and a turn that cannot be made.** As for a bot: a file gone from the Chief's workspace when the turn comes is left out. When no turn can be made, the message is written into the chat with a failed reply that says why.
- **A deleted chat takes the owner's waiting messages with it.** What botdot had to tell the Chief there still goes to the chat the owner last used, as before.
- **The Chief stops waiting through the wait route.** `GET /api/runs/:id/wait?seen=chief` is answered at once when an owner's message is kept in the chat of the turn that waits, and at its start while one waits there: the run as it is, with `ownerWrote: true`. The chat is the one the Chief's tools name with the call (`X-Chief-Chat`), else the chat whose reply started the run. `wait_for_run` turns the flag into a note that tells the Chief to end its reply in one line. Nothing is sent into the turn, and a turn that does not wait is not touched. The run is not marked as seen (`chiefSaw`), so its result still comes as a turn.
- **A bot's result after the Chief's reply is a turn of the Chief.** Both ways such a result arrives, a run that ended after the Chief stopped waiting and the final reply of a bot that waited for its teammates, start a turn through the same path as every turn botdot starts, in the chat that started the run. The prompt says nobody typed it, which bot, how the run ended, and quotes the reply as the bot's text. The reply's `actions` begin with `{ kind: "from", text, botId, runId }` and it carries the run's files. An action `from` does not make that chat "the chat that started the run": only the action of `run_bot` does.
- **Bounded by `chiefSaw`, checked when the turn starts.** A turn that waits behind a reply keeps the run's id (`unlessSeen`); when its time comes and the Chief has read how that run ended meanwhile, it is dropped. So a run a Chief turn itself waited for and saw brings no further turn, and the turns are bounded by the runs that ended unseen.
- **When the turn brings no reply,** botdot writes the bot's own `report` message with its text and files into the chat, as it did before a turn was given: after a failed turn, after a turn that could not start, and for a turn cut off by a restart.
- **A chat that is gone.** The turn goes to the chat the owner last used, then to a new one. A chat names a run through the `run_bot` action of its reply. In the moment before that action is recorded, the run is known by the chat the Chief's tools named when they asked for it, kept in memory: a run that ends at once waits behind the reply that asked for it, and is not taken for one whose chat is gone. botdot keeps nothing more of where a run was started, so a run the Chief started that no chat names is treated as one whose chat is gone.

Resolved by BUSY-004 and BUSY-009: the hold while Claude is signed out.

- **What waits is held while Claude is signed out.** A turn that starts then only fails as not signed in. For a bot, nothing that waits for it starts: the owner's messages and the other work stay in `data/queue.json`, and work that comes up for a bot with something waiting waits behind it. For a Chief chat, the owner's waiting messages stay in `data/chief-waiting-turns.json`, and what botdot has to tell the Chief behind them waits with them. A turn of botdot's with no message of the owner before it starts as before, and botdot writes its line itself when the turn fails. With the sign-in everything that was held starts, in its order. The scheduler starts no job meanwhile (`docs/api.md`, "A job's line").
- **A message to a bot or a chat that is free starts and fails as not signed in**, as before this decision: only what already waits is held.
- **Only a check that could tell changes the hold.** A check of the sign-in that failed, took too long or answered something unreadable, and a botdot without Claude Code, change nothing: what ran goes on running, what was held stays held. The state is kept in `data/scheduler.json`, so a start knows it before Claude has been asked.
- **Work that cannot be written does not wait.** When the queue file cannot be written, the item is in memory neither for a bot nor for a Chief chat: the request fails, and the message sent again runs once.

## Alternatives

- **Hand the message to the turn that is going** (`claude -p --input-format stream-json`, as Claude Code and Codex steer a turn). It needs a Claude process that stays open per chat, and does nothing for a bot, whose run is fresh per message. Not chosen for this milestone; the queue is needed either way.
- **Keep the waiting message in the app** and send it when the bot is free. It is lost when the app is closed, is not seen on the other device, and each app would decide "busy" for itself, against "one botdot server holds the truth".
- **Refuse while busy, everywhere.** One rule, and the opposite of the owner's priority.
- **One queue, first in, first out.** The owner would wait behind jobs and reviews, and be refused when ten of them wait.
- **A second store for the owner's messages.** Two files that a restart reads in some order, and two places to look for a run's id. Not chosen: the queue file already survives a restart and already leaves an item as its run starts.
- **A run's record written when the message is taken, with the status `queued`.** Every reader of runs (the chat's list, the new replies, the history a bot is given, memory, the rules of ADR 009) would have to learn a run that has not run. Not chosen: the waiting run is answered from the queue, and a record exists from the moment it starts.
- **Count a waiting message from when its run starts.** A yes given while the message waits would start the earlier request again, behind the owner's back and after they wrote what they want now. Not chosen.
- **Refuse a message whose file is gone, when its turn comes.** The owner is not there to attach it again, and the text would be lost with it. Not chosen.

## Consequences

- A second message to a working bot no longer runs at once. The owner who wants it now presses Stop.
- A run that waits for the owner's OK on a connected-app action ([ADR 010](010-a-connected-app-action-waits-in-its-run.md)) holds the bot, and what waits behind it, for up to ten minutes.
- The Chief's `run_bot` on a busy bot answers with a run that has not started; its instructions say so.
- Tests that pin two runs of one bot at once, and the refusal "The Chief is still replying", change.
- A run the Chief started that ends asking for the owner's OK (ADR 009, ADR 010) now also gives the Chief a turn, in which it can say that a card waits; the turn after the owner's yes follows as before.
- A run's id is made when its message is taken, so it can be older than the run's `startedAt`. Nothing reads a time out of an id.
- A bot with messages waiting cannot be deleted in one step: Stop starts the next message. The owner takes the messages back first, or stops each run.
- A Stop on a run that still waits to start takes it away ([ADR 012](012-a-run-keeps-who-ended-it-and-a-stop-ends-what-its-turn-started.md)).
- While Claude is signed out a bot's queue and a chat's waiting messages do not move: the owner sees them waiting, with the line that says Claude is signed out, and can take them back.
- An Android app from before this decision keeps working: it never sent to a busy bot or a replying Chief from its message box, and a waiting answer has the fields of a run, its `id` first of all, for a reply from a notification. The server announces `message-waits` in `features`; an app that does not find it keeps its old message box.

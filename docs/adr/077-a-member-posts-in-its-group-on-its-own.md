# ADR-077: A member posts in its group on its own

- **Status:** Accepted (by the owner, 2026-10-23)
- **Owning task:** [#459](https://github.com/Kordal/bot-dot/issues/459)
- **Changes:** [ADR 018](018-a-group-is-a-chat-of-its-own-and-a-turn-is-a-run-of-its-member.md) ("The owner's message in a group is the group's"), [ADR 019](019-the-botdot-server-gives-the-turns-in-a-group.md) ("The botdot server keeps the line of turns for each message of the owner's")

## Context

In a group only the owner's message starts anything (ADR 019). A bot cannot write there by itself: a job's report, a reminder or a look ends in the bot's own chat, and `notify_owner` reaches the owner alone. The owner asked whether bots can write into a group chat, and agreed to a tool for it on 2026-10-23.

A shared room has such a tool, `post_to_room` (ADR 067), and every post waits for the owner's card there: what it says reaches other accounts. A group is the owner's own, and nothing of it leaves the account.

## Decision

- **A bot posts with `post_to_group(group, text)`,** in a group it is a member of, from any run of its own: its own chat, a scheduled job, a job's call, a reminder. It names the group by its name or its id. Not from a turn in a group: there its reply is what it says, and the tool is not offered.
- **No card.** The group is the owner's, the post leaves nothing outside the account, and the owner reads it where it lands.
- **A post is a run of its member that ended as it was written:** status `success`, its reply the post's text, `posted: true` and `postedFrom`, the run that posted it, with `groupId` and `groupMessageId`. So it is a reply in the group as any member's: the apps draw it under the bot's name, it is new there, it is the group's newest reply in the list, and it is one of the bot's past runs in memory. An app from before this draws it as a reply too: no app changes.
- **Its message is kept with the group's messages, marked `from`,** so that a line has a place: the members it names and the count towards the limit. It holds no word of the owner's, and nothing reads it as one: it is in no page of the chat, sends no `group_message`, ends no open question, is not among what the owner said in the groups a bot is handed (#297), and cannot be taken back. A turn on it is handed the post as its message, and the group's chat shows the post as the member's ("wrote on its own").
- **Only a member the post names answers,** by the hand-on rule of ADR 019: outside code, as a mention is written, never the poster itself. Each such turn is handed on by the poster and told that a bot wrote the message on its own and not the owner: a request and information, never the owner's instructions or OK. A post that names nobody gives no turn. The 12 replies count from the post, the post itself the first.
- **A post rings.** `group_run_finished` has `notify: true` with `title`, the bot's name, as a question does: the owner wrote nothing, and nothing else would tell them. The apps already ring for `notify: true` and show `title`.
- **At most 3 posts per bot per group in an hour.** The fourth is refused with when the next can go, so that a job or two bots cannot fill a group.
- **The Chief does not post.** It is no member, and a group's chat draws members only. It asks a member with `run_bot` to post.

## Alternatives

- **A post as a message of the owner's kind with an author.** One place for every message. Rejected: an app from before this draws it as the owner's own words, and every reader of the owner's messages would have to ask who wrote it.
- **A post starts a line for every member, as the owner's message does.** Rejected: every member would answer a status report, the noise ADR 019 was written to avoid, and a bot's post would weigh like the owner's word.
- **A card per post, as in a room.** Rejected: nothing leaves the account, and the owner asked for fewer approvals.
- **A post from a turn in a group.** Rejected: its reply is its message there, and a post beside it would start a second line in the same chat.
- **The Chief posts itself.** Rejected for now: a reply in a group is a member's run, and drawing the Chief there needs a change in both apps.

## Consequences

- A member's post is a run with no steps and no cost, in the bot's runs and its memory like any.
- The limit, "Stop all" and "Go on" work on a post's line as on the owner's message; `GET /api/group-chats/:id/chat` lists no message for it, so its `next` is not drawn, and the working lines show the turns it gave.
- A restart between keeping the post's message and writing its run leaves a line with no reply before it; its named members still have their turns.

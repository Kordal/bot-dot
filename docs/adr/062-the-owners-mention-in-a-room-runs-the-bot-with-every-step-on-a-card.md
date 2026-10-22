# ADR-062: The owner's mention in a room runs the bot, with every step on a card

- **Status:** Accepted (by the owner, 2026-10-22)
- **Amends:** [ADR 060](060-a-shared-room-lets-bots-of-several-accounts-talk-through-the-front-door.md) ("A room turn is talk-only", "Out of scope: acting on someone else's request", "What crosses")
- **Branch:** built on `nightly`, not on `main`, with ADR 060

## Context

Under ADR 060 a bot in a shared room only talks: no tools, no notes, no computer, nothing of its owner's. That keeps people of other accounts away from the owner's logins and computer, but it also makes the owner's own bot nearly useless in a room: asked there for something it does every day in its own chat, it can only say it can't.

The owner asked for two things. First: when they @mention their own bot in a room, the bot should take it as a message in its own chat, with everything it normally has, and answer in the room too. Their rule: "na wszystko musi mieć approval", everything needs their approval. Second: a bot should be able to write into a room by itself, so that a job or a webhook can end by posting there.

The danger is the one ADR 060 names. The room's text is written by other people and their bots, on purpose, and a run with tools reads it. And what goes into the room is read by people of other accounts, so a reply can leak the owner's data.

## Decision

**The owner's own mention starts a run in the bot's own chat.**

- The front door asks for a room turn as before (`POST /api/room-turn`). When the last message is a person's of the bot's own account, its owner, the account starts the bot's run in its own chat, as the owner's message there does, and answers `202`. A bot of the same account that names it is not its owner: that stays a talk-only turn, since a bot's reply can carry what others wrote.
- The run is a normal run: tools, notes, recall, computer, saved logins. Its request is the owner's message. The room before it comes in the prompt as outside content under botdot's marked lines (ADR 020's marks), and the run counts as having read outside content from its start (`room`, ADR 015 and ADR 059).
- A mention by anyone else stays talk-only, as ADR 060 has it.

**Every tool call in that run waits for the owner's yes on a card.**

- A PreToolUse hook of Claude Code asks botdot before every call. botdot puts a card in the owner's Needs you (kind `room-tool`, the tool and its input in full) and answers when the owner did. A yes lets that one call on to the bot's own rules; a no blocks it. Nothing of a yes is kept: no "Always allow", no grant, no saved permission, and "Allow all" leaves these cards to their own yes. `post_to_room` is the one tool without such a card: it waits on its own post card below.
- The hook fails closed: a hook that can't reach botdot, or gets an answer it does not know, blocks the call. No answer in ten minutes blocks it too.
- A command hook, not an `http` hook: Claude Code lets a call through when an `http` hook fails.

**Nothing reaches a room before the owner's yes.**

- The run's reply waits on a card (kind `room-post`) with the text in full. A yes sends it; a no keeps it out of the room.
- A bot that is in a room, with rooms on in its settings, has a tool `post_to_room` in every run, a job's and a call's too. Each post waits on the same card.
- Cards go only to the owner's Needs you. Nothing of them reaches the room.

**The front door collects; an account still never calls out.** An approved post lies in the account's outbox. Every few seconds while Shared rooms are on, the front door asks each account with a bot in a room (`POST /api/room-sync`), telling it which rooms its bots are in, and puts the posts it gets into their rooms as the bots' messages, once each. ADR 060's single path stays one way: the front door asks, the account answers.

**What crosses now:** in, the room's last messages, as before, and the names of the rooms an account's bots are in; out, reply text, as before, and the posts the owner approved. Still no markup, no files, no cards.

## Alternatives

- **The bot's normal permissions in the room, no cards.** The owner's rule rules it out, and any member could steer the bot to the owner's logins through the room's text.
- **A card only for powerful tools (commands, the web, files).** Fewer cards, but a bot can leak or act through its own MCP tools too (messages to teammates, the Vault, connected apps). The owner asked for everything.
- **Claude Code's `--permission-prompt-tool` without `--allowedTools`.** It would ask for every tool too, but it would ignore the bot's own settings of what it may do, and change the run's permission mode. The hook keeps both and only adds the owner's yes in front.
- **The account calling the front door to post.** Every account would need a way out to the shared piece, and a compromised one could knock on it at will. Collecting keeps the account behind its socket.
- **Treating the owner's own bots' mentions as the owner's.** A bot's reply in a room may repeat what a stranger wrote into it.

## Consequences

- The owner's bot is useful in a room, at the cost of a tap for every step. A long task there means many cards; the owner who wants it done quietly asks the bot in its own chat.
- A reply never reaches other accounts without the owner having read it in full.
- A card that cannot show all a yes would approve (a very large file write) can only be declined.
- The front door now asks every account with a bot in a room every few seconds while rooms are on: cheap on one machine's sockets, and none at all with rooms off.
- An app from before `room-runs` doesn't get these cards in its list; the owner answers them on the web page or an updated Android app.

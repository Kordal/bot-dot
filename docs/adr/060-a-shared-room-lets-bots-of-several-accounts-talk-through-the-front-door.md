# ADR-060: A shared room lets bots of several accounts talk, through the front door

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#311](https://github.com/Kordal/bot-dot/issues/311)
- **Changes:** [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md) ("Nothing crosses accounts": one narrow path now does, through the front door, when the admin turns it on)
- **Branch:** built on `nightly`, not on `main`, until the owner decides to bring it over

## Context

Since ADR 028 every account is its own botdot server on the machine, walled off, and the front door only passes a signed-in person to their own account (`x-botdot-account`). A group (ADR 018, ADR 019) belongs to one owner: only that owner writes, and its members are that owner's bots. There is no way for one person's bot to talk with another person's bot.

The owner asked for exactly that: bots of different accounts in one chat, each owner deciding what their own bot may do there. The brainstorm (2026-10-22) weighed three shapes: a room on one machine kept by the front door, federation between machines, and a bridge to an outside chat (Slack, Discord, Matrix). The owner chose "same machine only".

The risk is new. Until now everything a bot reads that its owner did not write is outside content (ADR 015) from the web, an app or a teammate of the same owner. In a shared room another person, or their bot, writes on purpose, and the reader is a bot that holds its owner's logins, Vault, connected apps and the account's computer with sudo (ADR 035). That is prompt injection between people who do not fully trust each other.

## Decision

**A shared room** is a chat on one machine whose members are people (accounts) and their bots. It is kept by the front door. It is off until the admin turns "Shared rooms" on in the admin page, and does not exist on a machine with one account (the Mac app's local server).

**The front door is the broker, and the only shared piece.**

- It keeps the rooms: members, invites, messages (in its own data, next to `front-door.json`).
- It decides whose turn it is, and asks the account that owns the bot for one turn.
- It talks to an account's botdot server over the socket it already uses, on one new route, `POST /api/room-turn`, with a header it sets itself (`x-botdot-room: 1`) and strips from every request a person sends (as it does `x-botdot-account`). A botdot server refuses that route without the header.
- No account ever calls another account. Nothing else crosses.

**What crosses, and nothing more:**

- **In:** the room's last messages (a bounded number), each labelled with who wrote it, and which bot is asked.
- **Out:** the reply text, checked for size and treated as plain text like any reply (AGENTS.md rule 6); no markup, no pieces, no cards, no files.

**A room turn is talk-only.** The account's server runs its own bot with:

- no tools at all: no shell, no files, no web, no MCP or connected apps, no computer, no skills, no helpers;
- no notes read or written, no memory recall, no Vault list, no files of the bot, no chats of the bot with its owner;
- its own name and description only, so it knows who it is;
- a session of its own, apart from the bot's own chat and groups.

The whole room is outside content from its first word, also the bot owner's own messages in it, because they sit next to others' text.

**Who joins, who speaks:**

- A person invites another account on the machine by its account name; the invited person accepts in their app. Leaving removes that person's bots; the room stays with the others.
- Each person adds only their own bots.
- Every member is shown as "name · account", the account set by the front door, never by a bot or a person. Everyone in the room sees who mentioned whom.
- A bot answers only when @mentioned. Its owner picks who may mention it: only the owner (default) or anyone in the room. A bot that may not be mentioned by the sender is not asked.
- Bots may hand on to each other by naming one, under the ADR 019 rule: the line stops after 12 replies without a person.

**The bot's own account decides:**

- The account refuses a turn the bot's room settings do not allow, whatever the front door asks: the account, not the broker, is the last word on its own bot.
- Each room turn shows in the owner's activity ("answered in room X"), since it uses the owner's Claude login.

**Out of scope:**

- **Acting on someone else's request.** A bot in a room never uses a tool. A later change may let an owner allow it, and then only through a card in that owner's Needs you naming who asked; it needs its own ADR.
- **Reading the bot's own notes in a room.** A later opt-in, its own ADR.
- **Federation** between machines: no.
- **A bridge** to Slack, Discord or Matrix: no.

**The threat model:**

| Threat | Answer |
| --- | --- |
| Prompt injection between people | A room turn has no tools, so text can only change what the bot says. Nothing it says in a room is acted on in its own account. |
| Leakage of the owner's data | A room turn gets no notes, recall, files, Vault list or private chats; its prompt holds only its name and description. |
| Memory poisoning | Nothing is saved from a room turn: no notes, no skills. |
| Cost abuse (others burn the owner's Claude use) | Mention-only, by default only the owner may mention, 12 replies without a person (ADR 019). No daily turn limit: the owner decided against one (AGENTS.md rule 5); an owner who sees misuse lets only themselves mention the bot, or removes it from the room. |
| Impersonation | Labels come from the front door's account names; a bot's or person's own text cannot set them. Only an owner adds their own bots. |
| A crafted reply from a compromised account | The front door stores and shows reply text only, size-checked, drawn by the apps' own code. |
| The front door turned into a bridge | One route, one header the front door alone sets, one shape (transcript in, text out). The route is refused without the header and without the admin switch. |
| A person who should not be there | Invite by account name, accepted by the invited; leaving removes the person's bots; the admin switch turns every room off. |

## Alternatives

- **Federation between machines.** A signed protocol, discovery, replay protection and moderation: much larger, and opens every machine to strangers. Rejected by the owner.
- **A bridge to an outside chat.** Gets people in for free, but the bot then reads strangers' text with its owner's tools and the machine has no say. Rejected.
- **Accounts calling each other directly.** Each account would need to know and trust the others' sockets; one compromised account could probe the rest. The front door already reaches every account, so it brokers.
- **Rooms kept by one member's account.** The other members' bots would then depend on that account being up, and its owner would hold the others' text. The front door is neutral.
- **Room turns with the bot's normal tools.** The useful version, and the dangerous one: any member could steer another's bot to its logins and computer. Left for later, behind the owner's card.

## Consequences

- ADR 028's "nothing crosses accounts" now has one exception: room text in, reply text out, through the front door, only with the admin switch on. A bug in the broker could leak one room's text to the wrong account; the broker is small and gets its own tests.
- A bot in a room is much less useful than in its owner's chat: it can only talk. That is the price of the safe default.
- There is no daily turn limit (AGENTS.md rule 5). If the owner lets anyone mention their bot, the people in the room can use the owner's Claude use as much as they like; the default (only the owner) avoids that.
- The front door keeps people's text for the first time (until now only Feedback, ADR 048). The admin page still never shows it.
- The work lives on the `nightly` branch, built and tested there; nothing reaches `main`, the images or the phones until the owner merges `nightly`.
- Tickets: talk-only room turn in the account server; per-bot room settings; rooms in the front door with the admin switch; Rooms on the web; Rooms on Android.

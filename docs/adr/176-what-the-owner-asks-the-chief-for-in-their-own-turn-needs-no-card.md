# ADR-176: What the owner asks the Chief for in their own turn needs no card

- **Status:** Accepted
- **Owning task:** the owner's request of 10 November 2026 ("when we create a bot it should get every permission it needs at once, don't ask the user"), and their OK on the approvals audit (https://claude.ai/artifact/EDDPL7ABQ5FVEbcq2NApJK)
- **Changes:** [ADR 033](033-the-chief-reads-the-web-and-what-it-changes-after-waits.md) (its consequence "a change of a bot's main assignment, rules or permissions then waits on its own card as well"), [ADR 007](007-installed-tools-are-pinned-lists-placed-by-a-tools-user.md) (every install waited for Install)

## Context

Every change the Chief made to a bot that gave it more (the web, commands, a computer, a connected app, a new main assignment or new rules) waited on a card, whoever asked for it. A bot the owner asked the Chief for was made without what it needed and stood still until a second tap. After the web the owner said yes once on the Chief's held request (ADR 033), and its replay then made a second card for the same change. A tool from the registry the owner named themselves ("Coder needs gh") also waited for Install.

These cards guard against what a page, an app or a bot's text could make the Chief do. In a turn the owner started, before it read anything from outside, the only author of the request is the owner.

## Decision

- **A new bot gets everything it is made with**, with no card: its task, rules, tools, computer and connected apps (`lib/bots.js` create). Only the Chief makes bots, and after the web its request already waits whole on one `chief-action` card. A duplicate is made the same way.
- **The Chief's change to a bot is saved at once in a clean turn of the owner's**: one the owner started (`standing().startedBy === 'owner'`) whose chat has not read the web or an app (`web`) and whose turn has read nothing that is not the owner's word (`read`, ADR 017). Anywhere else it waits on its card as before.
- **One yes, one card.** The owner's yes on a `chief-action` card replays the request with `approved`: nothing of it waits on a second card.
- **A registry tool the owner asked for is installed at once**: one the Chief asks for in such a clean turn, that no bot asked the Chief for. A tool from a link, and one a bot asked for, still wait for Install. `POST /api/asks` answers with `installing: true`.
- The Chief's instructions and its `create_bot`, `update_bot` and `ask_install_tool` answers say which of the two happened.

## Alternatives

- Keep the cards and add "Always allow" to them: rejected, the owner would still tap once per new bot.
- No card for the Chief's changes in any turn: rejected, a page or an app the Chief read could then give a bot commands or a mailbox.
- A clean turn defined by the web flag alone: rejected, a bot's reply or note is not the owner's word either (ADR 017).

## Consequences

- Asking the Chief for a bot, a permission for a bot or a tool takes no tap.
- The owner's guard against a mistaken change is what they see: the Chief's line under its reply, the bot's settings and its history with Undo.
- What the Chief read in a turn decides it: a turn that read a bot's notes or a checkup's records, or a chat that read the web, still waits on cards.

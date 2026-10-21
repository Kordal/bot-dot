# ADR-050: A bot saves a skill it wrote without an OK

- **Status:** Accepted (by the owner, 2026-10-21)
- **Owning task:** [#254](https://github.com/Kordal/bot-dot/issues/254)
- **Supersedes:** the skill part of [ADR 015](015-the-server-records-who-said-a-note.md) ("Only content from others makes a new skill wait for the owner")
- **Widens:** [ADR 025](025-what-a-run-did-is-no-row-under-a-reply.md) (a skill the bot saved is a row under the reply)

## Context

Since ADR 015 a skill a bot wrote or changed (`create_skill`, `update_skill`) after its run read content from others (the web, a connected app, its computer, a teammate's message) waited for the owner on a card in Needs you: "Wants to keep a skill it wrote: …", with the chip "Asked to add the skill … (waiting for your OK)". Coding bots read the web and their computer in almost every run, so nearly every skill they learned became a card. The owner decided that a bot does not have to ask to keep a skill it learned.

## Decision

- **A bot's own skill is saved at once, in every run.** No card, no Needs-you item, no waiting state, whatever the run has read.
- **It stays visible.** The skill is in the bot's skills in its settings, where the owner sees, edits and deletes it, and undoes it from the bot's history. The run has a row under its reply, `Saved the skill <name>` or `Changed the skill <name>`, which opens the bot's settings: `skill` and `skill-updated` are now sent to the apps as `memory-pending` and `skill-pending` are. Both apps already draw these kinds.
- **The checks stay.** The skill is given to the bot that wrote it only. Its name and text are validated, a bot writes at most 20 skills and changes only its own, while it still has them and the Chief has not been given them. A new skill cannot take the name of a skill of the Claude account or of a skill built into Claude Code: a library skill of that name would hide that one from every bot.
- **Cards asked before stay answerable.** A yes still saves the skill and a Decline drops it; no new one is made.
- **Unchanged:** a skill from a link (`ask_install_skill`) and the Chief's weekly review proposals (which also remove notes) still wait on a card, as do every other card (Vault, calls, features).

## Alternatives

- **An off switch per bot.** Not needed: the owner deletes a skill they don't want, and "Skills" off for a bot (`useSkills: false`) stops it writing any.
- **Keep the card only after a teammate's message.** Still a card for a skill the bot wrote itself; the owner asked for none.

## Consequences

- A sentence on a web page can now shape a skill the bot keeps and loads in later runs, without anyone reading it first. The row under the reply and the settings list are where the owner sees it; deleting or undoing it is the remedy.
- Notes keep their source and their cards as ADR 015 decided: only skills changed.

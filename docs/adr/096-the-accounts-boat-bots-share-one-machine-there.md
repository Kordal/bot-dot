# ADR-096: The account's boat.dev bots share one machine there

- **Status:** Accepted (2026-10-26, the owner's decision)
- **Owning task:** [#568](https://github.com/Kordal/bot-dot/issues/568)
- **Amends:** [ADR 095](095-a-bots-browser-logins-move-with-its-files.md), [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md), [ADR 091](091-a-bots-files-are-copied-when-its-computer-moves.md), [ADR 094](094-a-bots-machine-on-boat-dev-has-a-screen-and-a-browser.md)

## Context

ADR 088 gave each bot whose computer is boat.dev a machine of its own. Every one of those machines is paid for while it runs, starts on its own, and needs the screen kit put on it (ADR 094). On this machine the account has one computer that all its bots share (ADR 035). The owner chose the same model for boat.dev: one machine per account by default, and a machine of its own only for a bot that needs to be kept apart.

## Decision

- **One machine per account on boat.dev**, named `botdot-<account>` (or `botdot` without an account). It is kept in `boat-machines.json` under `@account`, beside the bots' own machines. The first computer tool of any boat bot on it makes or starts it, at the account's size. It stops once it has been unused by every bot for 30 minutes.
- **A folder per bot** there, `/home/user/workspace/<bot id>`. Its commands, files, Vault commands and screen programs start in it, which botdot makes again if it is gone. As on the account's computer, this is a convention and not a wall: every bot on the machine has sudo there.
- **A machine of its own**, by the bot's `boatOwnMachine` (default false). With it set, nothing changes from ADR 088. The Chief sets it with `update_bot`, and the change does not wait for a card, because the bot is on boat.dev already. There is no control for it in the apps (AGENTS.md rule 5). The Chief's change of a bot's computer to boat.dev still waits, and its card names which machine.
- **One screen and one browser** on the shared machine. Its desktop (`:0`) is the one that boat.dev streams, so the owner's view of any bot there shows it. botdot's bridge serves one Camoufox profile, `account`, which every bot on the machine shares. A bot's screen tools say that the screen is shared, and the Vault tools say that the other bots there can read what botdot types or hands to a command, as on the account's computer.
- **No browser profile to or from the account's machine.** A copy there or from there moves the bot's folder only (ADR 095 moves a bot's own profile between its own computers).
- **Files on a switch** (ADR 091): a copy now runs between this machine (`linux`), the account's machine on boat.dev (`boat`) and a bot's own machine there (`boat-own`). The apps see both boat.dev kinds as `boat`. A switch from its own machine to the account's with "Start empty" lets its own machine go. With "Copy files", its own machine goes only after the copy succeeded.
- **Migration without loss.** A bot whose own machine was made before this, and which does not want one, keeps working on that machine until its files are moved. Once a boat.dev key is set, botdot copies its home into its folder on the account's machine within a minute, in the background. Its own machine goes only after that copy succeeds. A failed copy keeps the bot on its own machine and shows "Try again". A copy that botdot's restart cut short is tried again by itself. Copies kept from before, whose `boat` meant the bot's own machine, are read as `boat-own`.

## Alternatives

- **A machine per bot, as before.** Rejected by the owner: it costs one running machine per bot and one kit install per machine.
- **A display per bot on the shared machine.** Rejected: boat.dev streams only `:0`, so the owner could not watch the other displays.
- **Moving existing bots to the account's machine without their files.** Rejected: their work would seem lost.

## Consequences

- **No isolation between the bots on the shared machine.** They can read and change each other's files, use each other's browser logins, and see what botdot types there. Two bots on the screen at once get in each other's way. A bot that must be kept apart gets `boatOwnMachine`.
- One machine runs while any boat bot works, so it is on for longer, but there is one machine instead of several.
- A bot's browser logins (ADR 095) do not move to or from the account's machine: its one browser profile is its bots', and a bot's own profile replacing it would erase the others' logins. They stay on the old side.

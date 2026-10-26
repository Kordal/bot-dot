# ADR-091: A bot's files are copied when its computer moves

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#556](https://github.com/Kordal/bot-dot/issues/556)
- **Amends:** [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md)
- **Amended by:** [ADR 095](095-a-bots-browser-logins-move-with-its-files.md)

## Context

A bot's computer may be the account's computer or a machine of its own on boat.dev (ADR 088). Switching left its work behind: a bot moved to boat.dev started on an empty machine, and one moved back lost what it had there once boat.dev dropped the disk. Neither machine may reach the other: the account's computer takes no incoming connections (`lib/computers.js`), and a boat.dev machine is reached only through boat.dev's API with the admin's key, which never goes to a computer.

## Decision

- **The owner chooses at the switch.** Between this machine and boat.dev, the apps ask "Copy files" or "Start empty". None is never asked. The Chief's `update_bot` takes `moveFiles` with such a change; its card says "with its files", and the copy starts on the owner's yes.
- **The bot's folder, copied.** `/workspace/<bot>` on the account's computer and `/home/user` on boat.dev, the folders its commands start in. The old side keeps its files; on the new side a file of the same name is replaced. Caches and the shell's dotfiles of boat.dev's home are left out.
- **Through botdot, in pieces.** The old side packs the folder into one gzipped tar in its `/tmp`; botdot reads it in pieces and writes them to the new side in order, which checks each one's place, then unpacks and drops it (`lib/computer-move.js`). On this machine through the Docker helper (`moveFiles`: botdot's fixed steps on the bot's own folder, a piece within the helper's 1 MB), on boat.dev through its command and file API. At most 2 GB packed.
- **In the background, said in the bot's settings.** While it runs the bot's computer tools answer that its files are being copied, and its computer can't change; a copy that failed stays with its reason and "Try again" until the computer changes again. A copy botdot's restart cut short is failed.
- **A boat.dev machine waits for its copy.** Switching off boat.dev lets the machine go only once a copy from it succeeded or the owner left it.

## Not copied

- **Browser logins:** a boat.dev machine has no browser. They stay in the bot's browser on the account's computer. (Amended by [ADR 095](095-a-bots-browser-logins-move-with-its-files.md): they are copied too.)
- **Tailscale:** the account's computer is one tailnet device that every bot on it uses, and botdot runs none on boat.dev.
- **`/home/box`:** every bot on the account's computer shares it, so it is no one bot's to take along.
- **Installed programs:** installed again when needed.

## Alternatives

- **One machine reaching the other** (rsync over SSH, a tailnet between them). Rejected: the account's computer takes no connections, and a boat.dev machine would need a key or the admin's key on a computer.
- **Moving instead of copying.** Rejected: a copy that fails half way must not lose anything, and the old side's disk ends by itself (boat.dev after 14 days) or is wanted when the bot comes back.
- **Copying by default.** Rejected: a bot sent to boat.dev for a clean machine would get a full one; the owner says which.

## Consequences

- A large folder takes a while: every byte passes botdot twice, in pieces of 3 MB out and 0.6 MB into the account's computer.
- Files outside the bot's folder stay where they are.

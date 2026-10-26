# ADR-094: A bot's machine on boat.dev has a screen and a browser

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#563](https://github.com/Kordal/bot-dot/issues/563)
- **Amends:** [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md), [ADR 092](092-a-bots-machine-on-boat-dev-takes-a-vault-secret-for-one-command.md)

## Context

ADR 088 gave a boat bot commands and files only, on the belief that a boat.dev machine has no screen; ADR 093 lets the owner watch that desktop, but the bot still had no tool for it. It has one: every machine runs an X11 desktop (Xorg `:0`, 1920x1080) with `xdotool`, Python 3.12 and passwordless sudo. boat.dev documents no screenshot, input or CDP API of its own, and its in-machine computer tools serve its own agent only. Its command API takes a command, a timeout and `detached`, but no input and no environment.

## Decision

- **Same stack as the account's computer, not boat.dev's Chrome.** On the bot's first screen tool after its machine started, botdot puts its screen kit on the machine when it hasn't this version of it (`deploy/desktop/botdot-boat-kit`, run once with sudo, detached): cua's computer-server and Camoufox in their own venvs at the paths and versions the desktop image pins, botdot's bridge (`camoufox-browser`) and the `browser` user it runs as. It stays on the machine's disk; its version is a hash of the script, so a changed kit goes there again, and a changed bridge alone replaces the machine's bridge. The tool waits while it installs (up to 20 minutes; an install still running is waited for, never started twice) and says which step failed.
- **The machine's own display.** botdot starts computer-server (on the machine's loopback) and the bridge (on `:0`, with the bot's profile in `/home/browser/profiles/<bot>`) as detached commands, and reaches them through the command API: a request's body goes as base64 in an argument, as `requestOn` hands it to `docker exec` on the account's computer.
- **Every screen and browser tool works there**, `place_secret_file` alone stays refused. The machine's rest (30 minutes unused) counts them as use; what they started ends when it stops. `keep_computer_on` changes nothing there.
- **A typed secret** goes through the file API to a file of its own in `/tmp`; the command botdot sends opens it, removes it, and only then hands it to the bridge as the browser user, so it is in no file while it is typed and never on a command line (as ADR 092).
- **Never the account's computer.** When boat.dev can't start the machine, its screen tools say why; they never fall back, as its commands and files do.

## Alternatives

- **boat.dev's own Chrome and computer tools.** Rejected: no API reaches them from botdot, and a second browser engine would keep a bot's logins from moving between its computers.
- **A desktop image of our own on boat.dev.** Not offered by boat.dev: every machine starts from its own image.
- **Installing the kit when the machine is made.** Rejected: most boat bots code and never use a screen; the minutes and the disk go only to those that do.

## Consequences

- The bot has sudo on its own machine, so a command it writes could reach the bridge and a secret typed there, as on the account's computer (ADR 035): the file and the browser user guard against leaks by accident, not against the bot.
- The first screen tool on a new machine takes minutes; later starts of that machine only start computer-server and the bridge.
- Camoufox and computer-server on the machine follow the image's pins: a bump in `deploy/desktop/Dockerfile` must be made in the kit too (`test/boat-screen.test.js` checks they agree).
- It is the desktop the owner watches and takes over through boat.dev's stream (ADR 093, #564). A browser's logins do not move with the bot's files yet (#565).

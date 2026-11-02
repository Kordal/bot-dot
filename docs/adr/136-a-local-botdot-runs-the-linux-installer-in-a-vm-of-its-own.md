# ADR-136: A local botdot runs the Linux installer in a VM of its own

- **Status:** Accepted
- **Owning task:** [#882](https://github.com/Kordal/bot-dot/issues/882) (parent [#878](https://github.com/Kordal/bot-dot/issues/878))
- **Amends:** [ADR 0002](0002-mac-hosting-in-docker.md), [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)

## Context

The desktop app for Windows and Mac (#878) is a window onto a front door. Besides a botdot server somewhere else, it can run botdot on the owner's own computer. ADR 0002 ran that local server in Docker Desktop on a Mac, with a compose file of its own (`compose.mac.yaml`). Since ADR 028 an account's botdot server runs in its own rootless Docker under gVisor, behind a front door, and only `install.sh` sets that up; Docker Desktop gives neither, and a second install path is what ADR 028 and the 2026-10-18 line in DECISIONS.md removed. ADR 028 knows two ways to reach botdot, a public domain and a tailnet, both for a server.

## Decision

- **The same installer, in a Linux VM of its own.** The desktop app sets up a Linux VM that belongs to botdot alone and runs the real `install.sh` in it: on Windows a WSL2 distribution named `botdot`, on macOS a Lima VM. Every check the installer makes of the machine (Docker, rootless Docker, gVisor) stays as it is. Plan B without gVisor is a follow-up, if a spike asks for it. The spikes ([#879](https://github.com/Kordal/bot-dot/issues/879) for WSL2, [#880](https://github.com/Kordal/bot-dot/issues/880) for Lima) add their results here.
- **A third way to reach botdot: `local`.** It is chosen only by the answer `BOT_DOT_REACH=local`, which the desktop app gives. The installer's question still offers only a public domain and a tailnet: a person installing on a server shouldn't pick it.
- **One account.** The front door runs with `FRONT_DOOR_ONE_ACCOUNT` (the account `BOT_DOT_ADMIN`, `owner` by default): no sign-up link is printed or opens, and there is no admin page, no feedback to an admin and no shared rooms. The installer makes the account's Linux user, rootless Docker and botdot server as it makes the admin's on a server.
- **The passkey is made with a setup key.** The installer makes the key once (64 hex characters, which the front door's 32 to 100 base64url characters include) and keeps it in the front door's `.env`, which only root reads. It opens the one account's sign-up page until that account exists, and nothing after.
- **On localhost.** The front door listens on the VM's 127.0.0.1 with the origin `http://localhost:<port>` (`BOT_DOT_PORT`, 4700 by default): a passkey can belong to `localhost`, never to 127.0.0.1. Bots' interactive pages are on the next port, `http://localhost:<port + 1>`, an origin of its own as the server's port 8443 is (ADR 072). There is no Caddy and no Tailscale. The VM passes those ports to the computer's own localhost (WSL2's localhost forwarding, Lima's port forwarding).
- **One line for the app.** The install's last line is `BOTDOT_LOCAL {"origin":"http://localhost:4700","signUp":"http://localhost:4700/sign-up/<setup key>"}`, JSON after the word, and without `signUp` once the account exists. The key is printed nowhere else.
- **The rest of the lifecycle is a server's.** A rerun keeps how botdot is reached, the port, the key, the account and its passkey. `install.sh --update` updates it in its phases (ADR 045), and `--uninstall` removes it. With no admin page, the desktop app runs them.

## Alternatives

- **Docker Desktop, as ADR 0002.** Rejected: no rootless Docker per account and no gVisor, so bots would run as on no other botdot, and a second compose file and install path to keep working.
- **The server natively, with Node on the computer.** Rejected: nothing would keep the bots from the owner's home folder.
- **Offering `local` in the installer's question.** Rejected: on a server it makes a botdot nobody can reach.
- **Printing the setup key for the person to type.** Rejected: the app reads it from the line and opens the sign-up page itself.

## Consequences

- Root in the VM reaches the account, as root on a server does; the VM is the owner's own.
- The bots stop while the computer sleeps or the VM is stopped.
- A phone can't reach a local botdot: it answers on localhost only.
- The key stays in `.env` after the account is made, where it opens nothing.
- A front door from before this change doesn't know one account, so the installer refuses `local` with its image rather than make an admin's sign-up link on a computer.

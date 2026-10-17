# ADR-027: botdot trusts one owner, on a server of its own, reached through Tailscale

- **Status:** Superseded by [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md) (2026-10-16); proposed 2026-10-14
- **Owning task:** the spec [#426](https://github.com/Kordal/bot-dot/issues/426)

## Context

botdot is going to be released as open source, and strangers will install it on their own Linux servers. Until now it ran only on the owner's machines, and its checks assume that:

- The web page has no login. A connection from this machine is identified by its Linux user (`/proc/net/tcp`), and **every user that is not botdot's own counts as the owner** (`lib/identity.js`). Every container on the host network counts as the owner too.
- From another device the only way in is Tailscale Serve: botdot listens on `127.0.0.1:4747`, Serve sends the Tailscale login, and `BOT_DOT_ALLOWED_USERS` names the owner's. A call (ADR 026) is let in only from a tailnet address.
- The bots hold the owner's logins (the Vault, Bitwarden, connected apps) and can act with them.

A stranger may install it on a shared server, on a VPS with a public address, or without Tailscale. The audit of 2026-10-14 found nothing that stops or warns them.

## Proposed decision

- **One owner.** A botdot server belongs to one person. There are no accounts and no login on the web page (Minimal UI).
- **A server or VM of its own.** botdot is supported only on a machine where no other person has a login and no other container runs on the host network. The README says so before the install, and `install.sh` warns when it finds other login users.
- **Tailscale is required to reach botdot from another device.** botdot stays on loopback. Before Tailscale is set up, the setup page is opened through an SSH tunnel (`ssh -L 4747:localhost:4747`), which the README describes.
- **Docker Compose is the only supported install on Linux.** The native systemd service is no longer described.

## Alternatives

- **A login on the web page** (a password or a token). Rejected for now: a new screen and a new secret to look after for one person, and a public botdot would need much more than a login (rate limits, TLS, protection from the internet for every route). A separate project, if ever.
- **A public domain behind a reverse proxy.** Rejected: it puts agents that hold the owner's logins on the internet.
- **LAN only, without Tailscale.** Rejected: anyone on the LAN would be the owner, and calls (ADR 026) rely on a tailnet address.
- **Telling local users apart** (only one named host user is the owner). Possible later; the dedicated server makes it unnecessary today.

## Consequences

- A stranger who installs botdot on a shared server gives every user of that server full control of their bots. The warning in `install.sh` and the README is the only protection, so it must stay.
- Without Tailscale, botdot is usable only from its own machine or through an SSH tunnel.
- The Android and Mac apps keep reaching botdot through its tailnet name only.
- The Mac-hosted botdot (ADR 0002) is unchanged: it already serves one person on their own Mac.

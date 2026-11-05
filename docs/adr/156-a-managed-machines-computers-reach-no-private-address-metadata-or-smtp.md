# ADR-156: A managed machine's computers reach no private address, no metadata address and no SMTP

- **Status:** Accepted (2026-11-05)
- **Owning task:** [#984](https://github.com/Kordal/bot-dot/issues/984), part of [#977](https://github.com/Kordal/bot-dot/issues/977)
- **Amends:** [ADR 034](034-a-bots-computer-reaches-the-local-network-and-its-own-loopback.md) on a managed machine ([ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md)): there, a computer doesn't reach the local network. Follows [ADR 136](136-a-local-botdot-runs-the-linux-installer-in-a-vm-of-its-own.md)'s host-level chain.

## Context

Under gVisor the computer's own firewall lets every outgoing connection through, and ADR 034 lets a computer reach the local network. On a customer's VPS with a public address that opens three risks: a bot sends spam on ports 25 and 465 and the provider blocks the address; a bot reads the cloud's metadata at `169.254.169.254`, cloud-init's user-data included; a bot reaches other VPSs over the provider's private network.

## Decision

- **A host-level guard, for the accounts' Linux users alone.** An account's computers and containers leave the machine as that account's slirp4netns does: as the account's Linux user, through the machine's `OUTPUT`. On a managed machine root's firewall sends each account user's packets (`-m owner --uid-owner`) from `OUTPUT` through `BOTDOT-EGRESS` to `BOTDOT-GUARD`, which refuses new connections to private ranges (`0/8`, `10/8`, `100.64/10`, `172.16/12`, `192.168/16`, `198.18/15`, `fc00::/7`, `::ffff:0:0/96`), link-local (`169.254/16`, `fe80::/10`) and TCP 25 and 465 anywhere, over IPv4 and IPv6. Answers (`! --ctstate NEW`), loopback (the machine itself: the front door, Caddy) and DNS to the machine's resolvers stay open.
- **The front door's and Caddy's traffic is untouched**: they run as other users, in the machine's own Docker.
- **Rebuilt at once, from the accounts there.** `BIN/egress.sh` builds both chains with `iptables-restore --noflush`, so there is no moment without them, from each folder in `ACCOUNTS` whose `botdot-<name>` user exists, and the resolvers in the machine's `resolv.conf` files as they are then, beside those the install saw. `botdot-egress.service` runs it at boot before Docker, and every account's unit requires it and starts after it. The installer runs it again whenever it makes or starts an account, never by restarting the unit, which would restart every account.
- A machine that isn't managed is unchanged, and the uninstaller removes the unit and both chains once no account runs.

## Alternatives

- **The rules in each computer's own firewall.** A bot has sudo there, and under gVisor that firewall doesn't hold the outgoing traffic.
- **One chain for all of `OUTPUT`, as `BOTDOT-LOCAL` does.** It would hold back the front door, Caddy and the machine's own updates too, which the issue keeps open.
- **A group for the accounts' users, matched with `--gid-owner --suppl-groups`.** Depends on how each account's Docker is started getting the supplementary group; the user's own UID needs nothing more.
- **Block port 587 too.** Authenticated submission is how a bot sends a mail through a mailbox it was given; 25 and 465 are what the spam risk needs.

## Consequences

- A bot on a managed machine can't reach a printer, a NAS or another VPS of the provider's private network, nor a resolver other than the machine's on a private address.
- An account made while the machine runs is guarded before its Docker starts, and an erased account's UID leaves the rules with it.

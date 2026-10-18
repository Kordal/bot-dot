# ADR-032: A bot installs programs in its home, and joins the tailnet in userspace

- **Status:** Accepted (2026-10-18, the owner's decision)
- **Owning task:** [#11](https://github.com/Kordal/bot-dot/issues/11)

## Context

The owner wants each bot to install whatever the owner asks for on its own computer, and Tailscale first, so that the computer joins the owner's tailnet as a device of its own. [ADR 021](021-a-bot-works-on-its-computer-as-a-normal-user.md) took root away from the bot on its computer, so that it cannot replace Camoufox's launcher or the bridge that types secrets. The computer also runs with `--cap-drop ALL` and botdot's firewall. Kernel Tailscale needs root, a TUN device and the right to change the network, and with that right it could also rewrite the firewall. Until now the computer reached tailnet services only through the machine's own Tailscale (#523), and `lib/computers.js` said the bot never runs Tailscale itself.

## Decision

The desktop image carries `botdot-install` and `botdot-tailscale`. `botdot-install` installs what the owner asks for, as the bot, into `~/.local/env`: packages from conda-forge with micromamba (pinned as in botdot's own image, [ADR 007](007-installed-tools-are-pinned-lists-placed-by-a-tools-user.md)), Python packages with pip and Node.js commands with npm, and puts that folder's `bin` on the PATH of new shells. `botdot-tailscale`, also as the bot, installs Tailscale's static build into `~/.local/tailscale` after checking the published SHA-256. It runs `tailscaled --tun=userspace-networking` with a SOCKS5 and HTTP proxy on `localhost:1055`, then runs `tailscale up --shields-up` and prints the login link for the owner. There is no auth key: the owner approves the device in their own admin console, so no secret passes through the bot. The computer keeps no root, no capabilities and botdot's firewall.

## Alternatives

- **Root `apt-get install` after the owner's OK on a card.** Refused: package scripts would run as root in the computer and could change what types secrets, against ADR 021.
- **Kernel Tailscale (NET_ADMIN and `/dev/net/tun`).** Refused: the same right lets the computer rewrite its firewall.
- **Only the machine's own Tailscale (#523).** Refused: no bot becomes a device of its own that the owner can tag and cut off.

## Consequences

- What needs root stays out of reach: apt packages and system services. Most command-line programs are on conda-forge. The bot installs without asking, as it already could with pip or a downloaded program, since all of it lands in its own computer's home.
- Programs reach the tailnet only through the proxy (`ALL_PROXY=socks5h://localhost:1055`); a program that ignores proxies doesn't reach it.
- With shields up, no tailnet device connects to the computer. Without them, userspace Tailscale would pass a peer's connection on to the computer's loopback, where cua's control API and screen listen. The bot could turn shields off itself, so the owner limits each bot's device with a tag in the tailnet's access rules.
- Tailscale stops when the computer turns off. botdot starts it again as the computer starts (`botdot-tailscale resume`, as the bot), still signed in, from the state in the bot's home, and only when that state holds a login; resetting the computer signs it out. Under gVisor the home outlives a stop only with runsc's `--overlay2=none` (2026-10-18, [#68](https://github.com/Kordal/bot-dot/issues/68)).
- The device can reach whatever the tailnet's rules let it reach, which the owner decides in the admin console ([what bots can reach](../what-bots-can-reach.md)).

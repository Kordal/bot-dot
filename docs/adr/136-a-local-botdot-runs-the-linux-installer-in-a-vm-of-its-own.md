# ADR-136: A local botdot runs the Linux installer in a VM of its own

- **Status:** Accepted
- **Owning task:** [#882](https://github.com/Kordal/bot-dot/issues/882) (parent [#878](https://github.com/Kordal/bot-dot/issues/878))
- **Amends:** [ADR 0002](0002-mac-hosting-in-docker.md), [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)
- **Amended by:** [ADR 170](170-the-desktop-app-on-linux-runs-botdot-on-the-computer-itself.md) (on Linux, the installer runs on the computer itself, with the accounts' users guarded and no VM)

## Context

The desktop app for Windows and Mac (#878) is a window onto a front door. Besides a botdot server somewhere else, it can run botdot on the owner's own computer. ADR 0002 ran that local server in Docker Desktop on a Mac, with a compose file of its own (`compose.mac.yaml`). Since ADR 028 an account's botdot server runs in its own rootless Docker under gVisor, behind a front door, and only `install.sh` sets that up; Docker Desktop gives neither, and a second install path is what ADR 028 and the 2026-10-18 line in DECISIONS.md removed. ADR 028 knows two ways to reach botdot, a public domain and a tailnet, both for a server.

## Decision

- **The same installer, in a Linux VM of its own.** The desktop app sets up a Linux VM that belongs to botdot alone and runs the real `install.sh` in it: on Windows a WSL2 distribution named `botdot`, on macOS a Lima VM. Every check the installer makes of the machine (Docker, rootless Docker, gVisor) stays as it is. Plan B without gVisor is a follow-up, if a spike asks for it. The spikes ([#879](https://github.com/Kordal/bot-dot/issues/879) for WSL2, [#880](https://github.com/Kordal/bot-dot/issues/880) for Lima) add their results here.
- **A third way to reach botdot: `local`.** It is chosen only by the answer `BOT_DOT_REACH=local`, which the desktop app gives. The installer's question still offers only a public domain and a tailnet: a person installing on a server shouldn't pick it.
- **One account.** The front door runs with `FRONT_DOOR_ONE_ACCOUNT` (the account `BOT_DOT_ADMIN`, `owner` by default): no sign-up link is printed or opens, and there is no admin page, no feedback to an admin and no shared rooms. The installer makes the account's Linux user, rootless Docker and botdot server as it makes the admin's on a server.
- **The passkey is made with a setup key.** The installer makes the key once (64 hex characters, which the front door's 32 to 100 base64url characters include) and keeps it in the front door's `.env`, which only root reads. It opens the one account's sign-up page until that account exists, and nothing after.
- **On localhost.** The front door listens on the VM's 127.0.0.1 with the origin `http://localhost:<port>` (`BOT_DOT_PORT`, 4700 by default): a passkey can belong to `localhost`, never to 127.0.0.1. Bots' interactive pages are on the next port, `http://localhost:<port + 1>`, an origin of its own as the server's port 8443 is (ADR 072). There is no Caddy and no Tailscale. The VM passes those ports to the computer's own localhost (WSL2's localhost forwarding, Lima's port forwarding).
- **One line for the app.** The install's last line is `BOTDOT_LOCAL {"origin":"http://localhost:4700","signUp":"http://localhost:4700/sign-up/<setup key>"}`, JSON after the word, and without `signUp` once the account exists. The key is printed nowhere else.
- **The rest of the lifecycle is a server's.** A rerun keeps how botdot is reached, the port, the key, the account and its passkey. `install.sh --update` updates it in its phases (ADR 045), and `--uninstall` removes it. With no admin page, the desktop app runs them: its menu asks root's step for the update with the `UPDATE` file, as the admin page does.
- **The VM can't reach the computer or its network.** In mode `local` the installer writes a chain, `BOTDOT-LOCAL`, on the VM's OUTPUT, from a unit that runs before Docker and its network (`botdot-local-firewall`). New connections to private ranges are refused, the VM's gateway among them; only DNS to the VM's own resolvers stays open, as Lima's resolver is on the gateway. What the VM answers stays open, so the port forward and `limactl shell` work.

## On macOS: the spike's result (#880)

- **gVisor works, and there is no plan B.** On macOS 27 with an Apple M5, Lima 2.2.1 (`vz`), Ubuntu 24.04 and kernel 6.8: the real `install.sh` ran unchanged, with systemd's units, rootless Docker, `runsc` and `runsc-uds` under systrap, the account's share, a computer with its firewall and its screen. A passkey was made in Safari at `http://localhost:4700`, and a restarted VM answered in 11 s.
- **The gateway is the Mac's localhost.** Lima's `192.168.5.2` maps to the Mac's `127.0.0.1`: from a bot's computer a server bound there and the home router both answered, which the computer's own firewall doesn't stop. The rule above is why.
- **Lima comes with the app.** `desktop/lima.sh` puts the release's `limactl`, with its virtualization entitlement, its guest agent and its templates in the Mac's bundle at build time, checked by SHA-256, so the owner needs no Homebrew. Its Lima home is `~/.botdot`: short, as Lima keeps sockets there, and away from other Lima instances.
- **The VM's share of the Mac.** Half the CPUs (2 to 8), a third of the memory (8 to 16 GiB) and half the free disk (60 to 200 GiB, sparse). A Mac with under 12 GB of memory or 40 GB free is refused: the account alone takes 5 GiB. Plan on the whole VM's memory as the Mac's cost, since its page cache isn't given back. Only the front door's two ports are forwarded.
- **A launch agent starts the VM at login,** `dev.botdot.vm`, with `RunAtLoad` and `limactl start`, which returns once the VM is ready and leaves it running. The app writes it again when it moved.

## On Windows: the spike's result (#879)

- **gVisor works, and there is no plan B.** On Windows 11 25H2 with WSL 3.0.3, kernel 6.18 and NAT networking: the real `install.sh` ran unchanged in a distribution made with `wsl --install Ubuntu-24.04 --name botdot --no-launch`, whose image has systemd on. systemd's units, rootless Docker, `runsc` and `runsc-uds` under systrap, the account's share, a computer with its screen, and a passkey at `http://localhost:4700` all worked. WSL forwards the distribution's `127.0.0.1` ports to Windows by itself.
- **The distribution keeps away from Windows.** By default the image mounts every Windows drive and runs Windows programs, so the account's Linux user read the owner's files and ran `cmd.exe` as them. The app writes the distribution's own `/etc/wsl.conf` with `automount` and `interop` off before the installer runs, and restarts the distribution to read it. Nothing else of Windows changes: not the owner's other distributions, and not `.wslconfig`, so the VM's size is WSL's (half the memory unless the owner says otherwise) and the account's share follows it.
- **A start at sign-in keeps it running.** A distribution with no `wsl.exe` left stops in about 15 s. `wsl.exe -d botdot --exec dbus-launch true` returns at once and leaves a process that keeps it running with no Windows process (15 minutes checked). The app puts that command in the user's `Run` key, under `conhost.exe --headless` so no window shows, and removes it with the distribution.
- **WSL itself comes from Windows.** A PC without it gets `wsl.exe --install --no-distribution`, with Windows' own administrator prompt, then a restart; the app starts at sign-in and carries on where the setup stopped. A PC with less than 16 GB of memory or 40 GB free is refused.
- **Not checked by the spike:** WSL's mirrored networking, where the distribution's loopback is Windows' own and `BOTDOT-LOCAL` lets loopback through.

## Alternatives

- **Docker Desktop, as ADR 0002.** Rejected: no rootless Docker per account and no gVisor, so bots would run as on no other botdot, and a second compose file and install path to keep working.
- **The server natively, with Node on the computer.** Rejected: nothing would keep the bots from the owner's home folder.
- **Offering `local` in the installer's question.** Rejected: on a server it makes a botdot nobody can reach.
- **Printing the setup key for the person to type.** Rejected: the app reads it from the line and opens the sign-up page itself.

## Consequences

- The compose file of the old Mac app's local server (`compose.mac.yaml`) is not used and not changed.
- Root in the VM reaches the account, as root on a server does; the VM is the owner's own.
- The bots stop while the computer sleeps or the VM is stopped, and on Windows while the owner is signed out.
- A phone can't reach a local botdot: it answers on localhost only.
- The key stays in `.env` after the account is made, where it opens nothing.
- A front door from before this change doesn't know one account, so the installer refuses `local` with its image rather than make an admin's sign-up link on a computer.

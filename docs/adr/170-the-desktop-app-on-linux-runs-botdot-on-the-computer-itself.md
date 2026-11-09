# ADR-170: The desktop app on Linux runs botdot on the computer itself, with no VM

- **Status:** Accepted (2026-11-09)
- **Owning task:** the desktop app for Linux
- **Amends:** [ADR 136](136-a-local-botdot-runs-the-linux-installer-in-a-vm-of-its-own.md) (on Linux, no VM), [ADR 137](137-the-desktop-app-is-a-tauri-window-onto-the-front-door.md) (a third desktop system)

## Context

The desktop app is a Tauri window onto the front door's page on Windows and the Mac (ADR 137). Tauri builds the same app for Linux, where the window is WebKitGTK. On Windows and the Mac a botdot on the computer runs the real `install.sh` in a Linux VM of the app's own (ADR 136), since only Linux runs the installer. On Linux the computer already is that Linux, and the installer already installs on Debian, Ubuntu and the Fedora and RHEL family (#1202). ADR 136's VM had one more job: its chain `BOTDOT-LOCAL` keeps all of the VM from the computer and the home network. Written on the computer itself, that chain would cut the owner's own programs off the home network.

## Decision

- **The same app, for Linux.** `desktop.yml` builds it for x64 and arm64 on Ubuntu 22.04, whose older glibc the builds run on and after, as an AppImage, a `.deb` and an `.rpm`. The release signs all three and `latest.json` names each as `linux-<arch>-<kind>`, the key the updater asks for by the kind installed: an AppImage replaces itself, a `.deb` or an `.rpm` installs through polkit's password prompt. Tauri's packages name WebKitGTK and the tray's library, `libayatana-appindicator`, as what they depend on.
- **botdot on the computer itself.** "Run botdot on this computer" runs the real installer as root through `pkexec`, polkit's own password window, with `BOT_DOT_REACH=local` and a new answer, `BOT_DOT_LOCAL_HOST=1`. It installs git and curl first with apt or dnf when they are missing. The button shows only where `pkexec` and systemd are. The installer's systemd units start botdot with the computer, so the app keeps nothing running itself. Update and Remove in the menu ask root through `pkexec` too: the `UPDATE` request, and the installer's own `--uninstall`, answered yes.
- **`BOT_DOT_LOCAL_HOST=1` guards the accounts' users, not the computer.** Chosen with `local` at the first install and kept in `.env`. The installer writes no `BOTDOT-LOCAL`. It writes a managed machine's guard instead (ADR 156): the accounts' Linux users alone, through `BOTDOT-EGRESS`, are refused new connections to private ranges, link-local and SMTP, before their Docker starts. The owner's own traffic is untouched.
- **Notifications from the desktop's notification server** (`org.freedesktop.Notifications`) over the session bus, as ADR 138 has them on the other systems: a tag's newer notification replaces the older one by its id, and a click opens its target.
- **The rest as on the other systems.** One account at `http://localhost:4700`, the sign-in in the browser, the tray and "Open at login" (a file in `~/.config/autostart`). An AppImage registers `botdot://` links itself, as no package does it for it. WebKitGTK's DMA-BUF renderer is off with NVIDIA's own driver, where it draws a blank window.

## What it keeps from the computer, and what it can't

- **Kept:** the bots' computers run under gVisor in their account's rootless Docker, as on a server: they see neither the owner's files nor the computer's own processes. The account's Linux user is not the owner's. Its traffic reaches no private address (the home network, the router, a NAS) and no SMTP. Rootless Docker doesn't let a container reach the computer's own localhost.
- **Not kept as a VM keeps it:** the installer puts Docker, gVisor, systemd units, two Linux users and firewall rules on the owner's computer itself, as root. A flaw in gVisor and in rootless Docker together would reach the computer as the account's Linux user, not a VM, and that user can read whatever the owner's home lets others read (`750` on Ubuntu, `700` on Fedora, but `755` on Debian 12). The front door runs in the computer's own Docker. Root, who installs it, reaches everything, as on a server.

## Alternatives

- **A VM on Linux too, as on the Mac (Lima with QEMU, or libvirt).** It would keep ADR 136's wall, but needs QEMU and KVM from the owner's system, which neither package can bring, takes a fixed share of the memory, and puts a second Linux on a Linux computer. Kept as a follow-up should the guard above not be enough.
- **`BOTDOT-LOCAL` on the computer.** Rejected: it refuses the home network to every program of the owner's.
- **Flatpak.** Rejected: its sandbox stops the `pkexec` the local botdot needs and the updater, and botdot's earlier Linux GUI was retired.

## Consequences

- A Linux computer with less than 12 GB of memory or 40 GB free is refused.
- The owner sees polkit's password window at the setup, each update of a `.deb` or an `.rpm`, and Update and Remove botdot.
- On GNOME without its AppIndicator extension (Fedora's own GNOME) there is no tray icon: closing the window hides it, and starting the app again brings it back.
- A computer with `podman-docker`, or a distribution's Docker without rootless Docker, is refused by the installer, as a server is (#1202).

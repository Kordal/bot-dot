# Install the desktop app

The desktop app for Windows, Mac and Linux shows a botdot in a window of its own, with a tray icon, notifications and "Open at login" ([ADR 137](adr/137-the-desktop-app-is-a-tauri-window-onto-the-front-door.md)). It can open a botdot that runs somewhere else, or run one on the computer itself ([ADR 136](adr/136-a-local-botdot-runs-the-linux-installer-in-a-vm-of-its-own.md), [ADR 170](adr/170-the-desktop-app-on-linux-runs-botdot-on-the-computer-itself.md)).

## Download

| | |
| --- | --- |
| Windows | [Intel/AMD](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-windows-x64-setup.exe) · [ARM](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-windows-arm64-setup.exe) |
| Mac | [Apple silicon](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-mac-apple-silicon.dmg) · [Intel](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-mac-intel.dmg) |
| Linux x64 | [AppImage](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-linux-x64.AppImage) · [.deb](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-linux-x64.deb) (Debian, Ubuntu) · [.rpm](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-linux-x64.rpm) (Fedora, RHEL) |
| Linux ARM | [AppImage](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-linux-arm64.AppImage) · [.deb](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-linux-arm64.deb) · [.rpm](https://github.com/ladrok/bot-dot/releases/download/desktop-latest/botdot-linux-arm64.rpm) |

The app is built from `main` every night and updates itself.

## Open an app that is not signed yet

Windows code signing and Mac notarization are not done yet ([#1365](https://github.com/ladrok/bot-dot/issues/1365)), so both systems warn once, the first time you open it:

- **Windows:** SmartScreen says it protected your PC. Choose **More info → Run anyway**.
- **Mac:** open the app once; the Mac refuses it. Then **System Settings → Privacy & Security**, scroll to the message about botdot and choose **Open Anyway**.
- **Linux:** nothing to allow. Install the package (`sudo apt install ./botdot-linux-x64.deb` or `sudo dnf install ./botdot-linux-x64.rpm`), or make the AppImage executable (`chmod +x botdot-linux-x64.AppImage`) and open it. An AppImage updates itself; a package asks for your password to update. Built on Ubuntu 22.04: it runs on that and newer, with WebKitGTK 4.1. On GNOME without the AppIndicator extension (Fedora's own GNOME) there is no tray icon: closing the window hides it, and opening the app again brings it back. The passkey is made and used in your browser: Linux has no passkey store of its own, so use Chrome's (Google Password Manager), your phone (Chrome shows a QR code), a security key or a password manager's extension.

## Connect to a botdot that runs somewhere else

For a botdot on a server or a VPS, type its address (for example `https://botdot.example.com`) and choose **Continue**. You sign in with your passkey in the browser, and the app opens your botdot. The address must be `https`, or `http` on this computer itself. This needs no VM and no more than a normal computer. You can add several botdots from the app's menu.

No botdot yet? [Install one on a Linux server](install-linux.md), or run one on this computer, below.

## Run botdot on this computer (preview)

On a computer with no server, choose **Run botdot on this Mac**, **Run botdot on this PC** or, on Linux, **Run botdot on this computer**. On the Mac and Windows the app sets up a Linux VM that belongs to botdot alone and runs the same installer a server runs in it. On Linux it runs that installer on the computer itself, after your password. Then it opens the sign-up page in your browser to make your passkey.

### Requirements

| | Mac | Windows | Linux |
| --- | --- | --- | --- |
| **Systems** | An Apple silicon or an Intel Mac, with macOS 13 or newer (the VM uses Apple's Virtualization framework) | Windows 11, on Intel/AMD (ARM is built but not tested), with virtualization turned on in the firmware, which WSL2 needs. The app does not check the Windows version: Windows 10 22H2 is not tested | Debian, Ubuntu, Fedora and the RHEL family, with systemd and polkit, as [a server's install](install-linux.md) |
| **Memory and disk** | At least 12 GB of memory and 40 GB of free disk | At least 16 GB of memory and 40 GB of free disk | At least 12 GB of memory and 40 GB free under `/var/lib` |
| **What it takes** | Half the CPUs (2 to 8), a third of the memory (8 to 16 GB) and half the free disk (60 to 200 GB, used as it fills) for the VM | What WSL gives the VM: half the memory, unless your `.wslconfig` says otherwise | No VM: Docker, gVisor, two Linux users and systemd units on the computer itself |
| **Tested on** | macOS 27 on Apple silicon; Intel Macs are not tested | Windows 11 25H2 with WSL's default NAT networking | Not yet on a real desktop: the installer's part is tested as on a server |

A computer below the memory or the disk is refused with a message, and nothing is installed. The install itself takes about 18 GB of disk. What each system gets:

- **Mac:** Lima comes with the app. Nothing else to install.
- **Windows:** a PC without WSL gets it through Windows' own administrator prompt and a restart, and the app carries on after it. The VM is a WSL2 distribution named `botdot` (Ubuntu 24.04), which leaves your other distributions and your `.wslconfig` alone.
- **Linux:** the installer adds Docker when it isn't there, gVisor, two Linux users and its systemd units, as root through polkit's password window, and installs git and curl first when they are missing. A computer with `podman-docker`, or a distribution's Docker without rootless Docker, is refused, as a server is.

### What differs from a server

- **A local botdot sleeps with the computer.** Its bots run only while the computer is on and awake: they stop while it sleeps, and on Windows while you are signed out. For bots that run around the clock, use a server.
- **One account,** at `http://localhost:4700`, with no admin page, no sign-up links and no shared rooms.
- **This computer only.** A phone can't reach it: it answers on localhost.
- **The VM can't reach your computer or your home network.** It has its own firewall, which refuses connections to private addresses, and on Windows it doesn't mount your drives or run Windows programs.
- **On Linux there is no VM.** The bots' computers run under gVisor, as their account's Linux user, which is not yours, and that user's connections to private addresses (your home network) and to SMTP are refused. Your own programs' traffic is untouched. What a VM adds and Linux doesn't have: a flaw in gVisor and rootless Docker together would land on your computer as that user, which reads what your home folder lets others read (`ls -ld ~`: `drwxr-x---` or `drwx------` keeps it out). [ADR 170](adr/170-the-desktop-app-on-linux-runs-botdot-on-the-computer-itself.md) has the details.
- **Updates by itself** at night: at 04:00 in your time zone, when a newer version is out, botdot on this computer updates itself, and your bots carry on after it ([ADR 183](adr/183-a-machine-of-one-account-updates-itself-at-night.md)). The app updates itself too.
- **Update and remove** from the app's menu: **Update botdot on this Mac** (or PC, or computer) and **Remove botdot on this Mac…**, which deletes its bots, chats, memory, Vault and logins for good. Download a backup first in **Settings → Backups** if you want to keep them.

The app installs botdot from `main`, so it gets the newest version of the day, which is less tested than a server's update.

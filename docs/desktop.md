# The desktop app

The desktop app for Windows and Mac shows a botdot in a window of its own, with a tray icon, notifications and "Open at login" ([ADR 137](adr/137-the-desktop-app-is-a-tauri-window-onto-the-front-door.md)). It can open a botdot on a server, or run one on the computer itself ([ADR 136](adr/136-a-local-botdot-runs-the-linux-installer-in-a-vm-of-its-own.md)).

## Download

| | |
| --- | --- |
| Windows | [Intel/AMD](https://github.com/Kordal/bot-dot/releases/download/desktop-latest/botdot-windows-x64-setup.exe) · [ARM](https://github.com/Kordal/bot-dot/releases/download/desktop-latest/botdot-windows-arm64-setup.exe) |
| Mac | [Apple silicon](https://github.com/Kordal/bot-dot/releases/download/desktop-latest/botdot-mac-apple-silicon.dmg) · [Intel](https://github.com/Kordal/bot-dot/releases/download/desktop-latest/botdot-mac-intel.dmg) |

The app is built from `main` every night and updates itself. It is not signed yet:

- **Windows:** SmartScreen says it protected your PC. Choose **More info → Run anyway**.
- **Mac:** open it once, then **System Settings → Privacy & Security → Open Anyway**.

## A botdot on a server

Type your botdot's address (for example `https://botdot.example.com`) and choose **Continue**. You sign in with your passkey in the browser, and the app opens your botdot.

## botdot on this computer (preview)

On a computer with no server, choose **Run botdot on this Mac** or **Run botdot on this PC**. The app sets up a Linux VM that belongs to botdot alone and runs the same installer a server runs in it, then opens the sign-up page in your browser to make your passkey.

| | Mac | Windows |
| --- | --- | --- |
| **The VM** | Lima, which comes with the app | A WSL2 distribution named `botdot`. A PC without WSL gets it with Windows' own administrator prompt and a restart, and the app carries on after it |
| **Memory and disk** | At least 12 GB of memory and 40 GB of free disk. The VM takes half the CPUs (2 to 8), a third of the memory (8 to 16 GB) and half the free disk (60 to 200 GB, used as it fills) | At least 16 GB of memory and 40 GB of free disk. The VM takes what WSL gives it: half the memory, unless your `.wslconfig` says otherwise |
| **Tested on** | macOS 27 on Apple silicon. Lima needs macOS 13 or newer; Intel Macs are not tested | Windows 11 25H2 with WSL's default NAT networking |

What differs from a server:

- **One account,** at `http://localhost:4700`, with no admin page, no sign-up links and no shared rooms.
- **Bots run only while the computer does.** They stop while it sleeps, and on Windows while you are signed out.
- **This computer only.** A phone can't reach it: it answers on localhost.
- **The VM can't reach your computer or your home network.** It has its own firewall, which refuses connections to private addresses, and on Windows it doesn't mount your drives or run Windows programs.
- **Update and remove** from the app's menu: **Update botdot on this Mac** (or PC) and **Remove botdot on this Mac…**, which deletes its bots, chats, memory, Vault and logins for good. Download a backup first in **Settings → Backups** if you want to keep them.

The app installs botdot from `main`, so it gets the newest version of the day, which is less tested than a server's update.

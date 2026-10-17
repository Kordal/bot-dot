# ADR-021: A bot works on its computer as a normal user, and its browser as another

- **Status:** Accepted (2026-10-09, [#311](https://github.com/Kordal/bot-dot/issues/311))
- **Owning task:** #311

## Context

botdot types a saved password, a two-step code, a card detail or an identity detail into a bot's browser so that the bot never sees it. Until now everything on the bot's computer ran as root: the desktop, cua's computer-server behind `run_shell`, `read_file` and `write_file`, every program `start_program` started, Camoufox, and the helper botdot ran to hand a secret to Camoufox (`/usr/local/bin/botdot-type-secret`, a POST to `127.0.0.1:47111`). The bot could rewrite that helper, or close Camoufox and listen on 47111 itself, and receive the secret in plain text; it could also answer `{"op": "where"}`, on which card approval and the choice of host rely.

The container already runs with `--cap-drop ALL` and `no-new-privileges`, so a root there has no right to signal another user's programs, to read another user's files or to change users: only Docker's own `docker exec -u` and `docker run --user` choose who a program runs as.

On 2026-10-08 the owner decided that the bot does not keep root, that a computer made before this is kept but stopped, and that the way the secret reaches only the real browser is the implementer's.

## Decision

- **The container runs as the user `bot`** (`docker run --user bot`, home `/home/bot`), so supervisord and everything it starts (the XFCE desktop on TigerVNC, the computer-server, cua-driver and noVNC) is `bot`, and so is every `docker exec` that names no other user, `start_program` among them. Our own `supervisord.conf` and `botdot-desktop` replace the base image's, which keep the desktop in `/root`.
- **Camoufox and botdot's bridge into it run as the user `browser`**: `camoufox-browser --serve`, which botdot starts with `docker exec -u browser` when the computer starts. It opens Camoufox when a page is asked for, and takes secrets and `where` only on `/run/botdot-browser/bridge.sock`, in a folder only `browser` can open. `127.0.0.1:47111` stays, for `{"op": "open"}` alone, which is how `open_browser`, the dock's icon and `xdg-open` open a page; it answers nothing else.
- **botdot sends its own copy of the helper with every secret** and runs it as `browser`, from `/`, in Python's isolated mode (`/usr/bin/python3 -I -c`). No file of the computer stands between botdot and the bridge, so there is nothing for the bot to replace and nothing to check or race between a check and the send. The helper also sends nothing unless the program at the other end of the socket is `browser`'s (`SO_PEERCRED`).
- **`bot` cannot reach any of it:** the launcher, the Python it runs on, Camoufox's browser (fetched into `/opt/camoufox-cache`, which the bridge hands the launcher as `XDG_CACHE_HOME`) and their folders are root's, so not even `browser` can change them; `browser`'s home and socket folder are closed to `bot`, and `bot` cannot signal `browser`'s programs. `browser` is in the group `bot` and saves downloads into `/home/bot/Downloads`, so the bot still reads what it downloaded. The display is `bot`'s; `bot` lets `browser` onto it by name (`xhost +SI:localuser:browser`).
- **Root is used only by botdot, named:** `docker exec -u root` for the time zone and for making the copied launcher executable, as before. A changed time zone ends the browser and the bridge as `browser`, and the bridge starts again with the new zone.
- **A computer made before this has no label `botdot.user-version=1`.** It is stopped when it starts or when botdot starts, with "Export its files and reset it", as one without `botdot.network-version=1` is, and botdot types no secret into it.

## Alternatives

- **The bot keeps root, and only the bridge moves to another user.** A capability-less root could not signal that user either, but it owns `/usr/local/bin`, the Python botdot runs and the image's libraries, and could change what the bridge user runs when it next starts. The owner chose that the bot loses root.
- **Copy the helper back in and compare it before each secret.** Two `docker exec` calls leave a moment between the check and the send, and the helper's interpreter and libraries would still be the bot's to change.
- **Keep the TCP port and check who listens on it.** A listener can change between the check and the connection, and the browser's process would still be the bot's own.
- **Type from outside the container,** through the screen. The typing would go through the computer-server and the X server, both the bot's.

## Consequences

- `apt install` and anything else needing root no longer works for a bot. Its prompt says it works as `bot`, without root.
- An existing computer is stopped until the owner exports what they want and resets it. A desktop image made before has no `bot` user: botdot builds it again, or pulls the configured one again, when its label `botdot.user-version` is not `1`.
- A copied launcher reaches a running bridge only when the computer next starts; computers turn off when the bot replies.
- The browser's profile is in `/home/browser`, closed to the bot; the bot keeps its downloads, its files and its uploads through the browser's file dialog.
- What the bot can still do through the browser's own window is outside this decision: what the page shows (a "show password" toggle, the page's developer tools), and what the browser itself saves where the bot points its file dialog, which can be the browser's own profile (a `user.js` that changes its settings, say). Closing that needs the browser's own settings locked (Firefox's enterprise policies), its own issue.

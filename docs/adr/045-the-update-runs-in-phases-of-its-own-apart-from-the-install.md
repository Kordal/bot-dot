# ADR-045: The update runs in phases of its own, apart from the install

- **Status:** Accepted (2026-10-20, the owner's plan in [#189](https://github.com/Kordal/bot-dot/issues/189)). Keeps [ADR 036](036-the-admin-pages-update-runs-the-installer-of-the-version-it-installs.md)'s hand-over and [ADR 044](044-an-account-whose-new-server-doesnt-start-goes-back-and-the-others-carry-on.md)'s per-account switch. Supersedes the part of the line of 2026-10-16 in [DECISIONS.md](../DECISIONS.md) that the installer's output stays in `update.log`, root's alone.
- **Owning task:** [#195](https://github.com/Kordal/bot-dot/issues/195)

## Context

The admin page's Update was the installer run again without a terminal (`install.sh --update` was the install with `UNATTENDED=1`). Every install-only step ran in it or was skipped by a flag: the questions, Tailscale, Caddy, the admin's sign-up link. Any change to the installer could break the update, and only `make install-real` caught it. While it ran, the admin page showed a spinner. When it stopped, the page showed one line of the installer's at most, often "see update.log on the machine", a file only root can read over SSH.

## Decision

- `install.sh --update` is a mode of its own (`MODE=update`). It runs in named phases, in this order: `check` (the new release's signature), `clean` (room in the machine's Docker), for each running account `clean` and `preflight` (room made, and its disk checked against what it downloads, #192), `download` (into the machine's Docker), then the hand-over of ADR 036, then `preflight` (the image's compose file against this installer's runtimes) and `download` for each account. Nothing has restarted up to here. Then `switch` for each account (the admin's first; its Docker gets the runtimes the new compose names, and is checked for them, here), `front-door` (its compose file and the images `.env` pins are written only now, then it restarts), `clean` for each account and for the machine, and `done`.
- Each phase is written to `update.json` as it starts (`phase`, and `account` for one account's phase), by an update root's step started for the admin page. A failed update keeps the phase it stopped in, and `log`: the last 40 lines of `update.log` that say something, without colours, printable ASCII only, at most 300 characters each. The front door passes each field on only after checking it.
- The update reads how botdot is reached and the admin's name from `.env`. It never asks a question, never installs Docker, rootless Docker, gVisor or Tailscale, never runs `tailscale serve` or waits for Caddy's certificate, and prints no sign-up link. What it needs and `.env` lacks stops it, with "Run the installer yourself". The non-interactive setup it shares with the install (the front door's folders and settings, the systemd units, root's step) runs as before.

## Alternatives

- A separate updater script or a Node program in the image: the hand-over of ADR 036 replaces root's `install.sh`, so a second file would need its own hand-over, and the account and front-door steps would be written twice. The update stays a mode of the same file, with phases of its own.
- The front door reading `update.log`: it would need root's file, which holds more than the admin page needs. Root writes the cleaned tail into `update.json`, which the front door already reads.

## Consequences

- The admin page says what the update is doing ("Downloading for kordal…") and, after a failure, where it stopped and its last log lines; the admin needs SSH only to fix the cause.
- The order differs from the issue's list in one place: the machine's Docker downloads the new image before the last `preflight`, because the hand-over and the compose file that preflight reads come from that image. Nothing has restarted by then. The accounts' room is checked before it.
- The front door moves after the accounts, so for the length of an update it is one version behind them. A sign-up link used meanwhile waits for the update (one installer at a time, ADR 036) and is made on the new version.
- The first update from a root's step that predates this (ADR 036's hand-over) runs the phases but writes none: that older step started it without `BOT_DOT_UPDATE_AT`.

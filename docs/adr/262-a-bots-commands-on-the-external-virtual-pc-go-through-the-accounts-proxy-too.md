# ADR-262: A bot's commands on the External Virtual PC go through the account's proxy too

- **Status:** Accepted (2026-11-23, the owner's request, [#1612](https://github.com/ladrok/bot-dot/issues/1612))
- **Owning task:** [#1612](https://github.com/ladrok/bot-dot/issues/1612)
- **Amends:** [ADR 171](171-a-bots-browser-goes-out-through-the-accounts-proxy.md) (its line on the External Virtual PC: "the account's proxy is used, browser only")
- **Builds on:** [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md), [ADR 094](094-a-bots-machine-on-boat-dev-has-a-screen-and-a-browser.md) (the screen kit and the bridge on the machine), [ADR 096](096-the-accounts-boat-bots-share-one-machine-there.md) (one machine and one bridge for the account), [ADR 134](134-a-bots-commands-on-the-external-virtual-pc-end-with-its-run-and-have-its-limits.md) (how a command runs there), [ADR 261](261-a-bot-may-have-a-place-for-its-computer-of-its-own-under-advanced.md) (a bot's `computer` is where it works, and so decides that it is on boat.dev)

## Context

ADR 171 sends a bot's browser through the account's proxy, and on the account's computer its commands too: they get `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` to the bridge's forwarder, which speaks SOCKS5 and HTTP. On the External Virtual PC it left the commands out: they went out from boat.dev's own data-centre address, and only the browser used the proxy. The owner wants a boat.dev bot's commands (curl, wget, pip, npm, git, scripts) to use the proxy too, whenever the account has one, which is the point of a proxy the hosted plan includes.

## Decision

- **A boat bot's command takes the proxy variables.** When the account has a proxy, `run_shell` of a bot whose `computer` is `boat` (the one resolution of ADR 261, not a second copy) runs with `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and their lower-case twins to `http://127.0.0.1:47300`, the bridge's forwarder on that machine (`47300 + n` for screen `n`, and the machine's desktop is `:0`), as on the account's computer, with `NO_PROXY` for the machine itself. The address holds no login: the bridge signs in to the proxy.
- **On boat.dev the account's proxy is used,** as ADR 171 has it: one bridge and one forwarder for the account's machine, shared by its boat bots. A bot's own proxy choice applies on the account's computer only, unchanged.
- **The forwarder is started for commands, without the screen.** botdot hands the proxy to the machine's bridge as each command starts, as it hands it to a bridge on the account's computer: the bridge alone is started for it (the kit first, as the screen's first tool waits for it), never computer-server or the desktop, and the bridge keeps the proxy for its next start and runs the forwarder. A bot that only runs commands never opens the screen.
- **As each command starts, not once a run.** A changed or removed proxy applies from the next command. When the machine already has the proxy, the command only asks that the forwarder answers (one call); a machine that started again, or a forwarder that is gone, is handed it again. Removing the proxy tells the bridge, or takes its kept file away when the bridge is not running, so a later start does not use it.
- **Never out directly.** When the proxy can't be handed over or the forwarder does not answer, the command does not run, and the bot gets the words of ADR 171's browser: which proxy, why, and "Tell the owner: they can test it in Settings → Proxy". A machine that boat.dev can't start gives the same: a proxied command is never run on the account's computer standing in for it, where it would go out directly.
- **Without a proxy nothing changes:** no variables, nothing asked of the machine.
- **Best effort, as on the account's computer.** A tool that ignores the proxy variables goes out directly. Forcing all of the machine's traffic through the proxy (a firewall rule on the machine) stays out of scope. Only `run_shell` is proxied, as on the account's computer; a command that carries a Vault secret (`run_with_login`, `run_with_ssh_key`, `run_with_file`) is not, and neither is botdot's own traffic (Claude, connectors, the feed).
- **No new screen or API.** The proxy is set where it was (Settings → Proxy); `docs/api.md` says what goes through it.

## Alternatives

- **Leave commands out on boat.dev (ADR 171 as it was).** Rejected: the owner's proxy would hide the bot's browser and not its curl, git or pip from the same sites.
- **A firewall or transparent proxy on the machine.** Rejected, as in ADR 171: every bot on the machine shares it, so botdot's own use of the machine (its kit, boat.dev's agent) would go through it too.
- **Start the whole screen for commands.** Rejected: the screen's start waits on the desktop and computer-server and holds memory for a bot that only runs commands; the forwarder lives in the bridge, which starts alone.
- **Hand the proxy over once a run, as on the account's computer.** Rejected: the owner asked that a changed or removed proxy apply from the next command, and a forwarder checked at each command is how "never out directly" is known to hold.

## Consequences

- The first command of a proxied boat bot on a machine without the screen kit waits for it (minutes, as the screen's first tool does); later ones cost one extra call to the machine.
- A bot whose proxy is down can't run a command on boat.dev until the owner fixes or changes it; it says so in its run.
- The bridge process runs on a machine whose bots only run commands, with no browser open.
- Commands through the proxy are not guaranteed: tools that ignore the variables go out directly.

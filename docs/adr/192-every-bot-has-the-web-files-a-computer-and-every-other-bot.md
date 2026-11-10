# ADR-192: Every bot has the web, files, a computer and every other bot

- **Status:** Accepted (2026-11-10, the owner asked for it)
- **Owning task:** the owner's request: every bot may ask any other without the owner, has the internet and Files, may use the computer and its browser, uses a login after the owner's yes with no list of bots on the card, and token usage only under Advanced
- **Supersedes:** "May message" and "Other bots may ask it" (#136, #137), the switches "Can browse the web", "Can change files" and "Uses the computer" of a bot, and `ask_permission`'s `web`, `files`, `message` and `computer`
- **Builds on:** [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md) (one computer, every bot on it with sudo), [ADR 176](176-what-the-owner-asks-the-chief-for-in-their-own-turn-needs-no-card.md), [ADR 177](177-every-saved-login-accepts-a-self-signed-certificate-and-is-usable-in-its-computer.md)

## Context

Nearly every bot the owner made was given the web, files and a computer, and kept every other bot to message. Each one missing was a switch to find or a card to answer, and a bot that met one off stopped and asked. The owner asked to drop all of them.

## Decision

- **Every bot has them, always.** `normalizeBot` and reading `bots.json` give every bot `WebSearch`, `WebFetch`, `Edit` and `Write`, `acceptEdits` where its mode was unset or `dontAsk`, a computer at the account's place (`"none"` is gone), `mayMessageAll: true`, `mayMessage: []` and `othersMayAsk: true`. Nothing sent can take them away. `Bash` and helpers stay the owner's to give, and a mode of `default` or `bypassPermissions` stays as set.
- **No switch, no ask.** The web page and the Android app draw neither the switches nor the "May message" row nor "Other bots may ask it" (an app on an older server still does, gated by the `everything-allowed` feature). `ask_permission` offers only `commands` and `helpers`; the Chief's `update_bot` has no messaging fields and no `"none"` computer. A Chief change that only adds these makes no card, as the bot already has them.
- **Logins after the owner's yes.** A login's line in the Vault no longer warns that no bot may use it: a bot gets it when the owner answers its `request_login`. Cards, identities, SSH keys and files keep their list of bots.
- **Usage under Advanced.** Settings has an "Advanced" switch (`settings.advanced`, off); the Usage section shows only while it is on.

## Trade-off

- **Every bot reaches the web and the account's computer.** A bot that reads a hostile page, mail or message (prompt injection) can now act on the web and on the computer, where every bot has sudo (ADR 035) and can read what other bots leave there, on the owner's home network. Before, only bots the owner chose had that reach.
- **Every bot can ask every other.** A bot that is talked into something can pass it on to a bot that has mail or logins; the asked bot's own rules and cards are what is left between them.
- **A job's call card always names the web, files and the computer** in its warning, as every bot has them.
- Logins, connected apps, `Bash` and helpers still need the owner's yes, per bot.

## Alternatives

- **On by default, switches kept:** what was there; the owner asked to remove them.
- **Web and files for all, the computer only on request:** smaller reach, rejected by the owner's request.

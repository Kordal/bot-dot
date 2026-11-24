# ADR-268: Every bot runs commands and uses helpers

- **Status:** Accepted (2026-11-24, the owner asked for it)
- **Owning task:** [#1672](https://github.com/ladrok/bot-dot/issues/1672)
- **Supersedes:** the part of [ADR 192](192-every-bot-has-the-web-files-a-computer-and-every-other-bot.md) that says "`Bash` and helpers stay the owner's to give", the switches "Can run commands" and "Can use helpers" and the block "Exact tools and permission mode" of a bot's settings, and `ask_permission`'s `commands` and `helpers`
- **Builds on:** [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md) (one computer, every bot on it with sudo), [ADR 054](054-a-permission-card-comes-only-from-the-bots-ask.md), [ADR 178](178-cards-that-guarded-nothing-are-gone.md), [ADR 192](192-every-bot-has-the-web-files-a-computer-and-every-other-bot.md)

## Context

ADR 192 gave every bot the web, files, a computer and every other bot, and kept `Bash` and helpers for the owner to give: a switch in the bot's settings under "What it may do" and a card when a bot asked. The owner asked to drop these too. A bot that needs a command stops and asks, a bot made by the Chief gets them on a card, and the section with its two switches and its exact tools and permission mode is a place almost nobody changes.

## Decision

- **Every bot has `Bash`, `Agent` and `Task`, always.** They join `WebSearch`, `WebFetch`, `Edit` and `Write` in the tools every bot has (`ALWAYS_TOOLS`, applied by `withEverything`): reading `bots.json` adds them, and every save keeps them. No setting, Chief change or request takes them away. The saved permission mode stays as it is.
- **No "What it may do".** A bot's settings on the web page have neither switch, nor "Allowed tools", nor "Permission mode", and a save from the page no longer sends `allowedTools` or `permissionMode`. The Android app never drew them.
- **No asking for them.** `ask_permission` is gone: with `commands` and `helpers` there is nothing left in it. `POST /api/self/session/ask` with `kind: "permission"` answers an error. A Chief `update_bot` that adds `Bash` (or any tool) is saved at once, and holds nothing: `WebFetch` and `WebSearch` were held only for a bot that could lack them, and none can now.
- **Old cards.** A waiting `permission` ask for `commands` or `helpers`, and a waiting change of a bot that only adds tools every bot has, are answered yes at the first start after this update, since the bot has what they asked for: what the card held carries on once (the run that waited, and the Chief's turn in the chat that asked, as the owner's yes would have started them), and then the card is removed. A card older than a week (`CARRY_HOURS`) is removed and carries nothing on, as an old yes would not have either.
- **Prompts.** The note about the bot's installed tools and the guidance on helpers now go to every bot, as both are gated on the bot having `Bash` and `Agent`. A job's call card names "run commands" and "use helpers" in its warning for every bot, as it names the web and files.

## Trade-off

- **Every bot can run any command on the account's computer.** Every bot works there with sudo (ADR 035), so a bot that reads a hostile page, mail or message (prompt injection) and is talked into it can now run anything: change or read what other bots leave on the computer, reach the owner's home network, install software. Before, only bots the owner chose had that reach. This is the widest of the reaches ADR 192 listed, and the owner chose it knowingly.
- **The owner's own check is gone.** A card for `Bash` was a moment to say no. What is left between a bot and the computer is its own rules, the saved logins and files it is given by hand (the Vault's lists of bots), the account's walls (ADR 028), and the cards of what leaves the account: a write in a connected app, a payment, a login.
- **Helpers share the bot's tools,** so they add no reach beyond it, only parallel runs.
- **A permission mode `bypassPermissions`, set earlier, stays,** and nothing in the apps can set or clear it now. The Chief never could.

## Alternatives

- **Switches kept, on by default:** what ADR 192 left; the owner asked to remove them.
- **Commands for every bot, the exact tools and mode kept under Advanced:** the owner asked for the whole section to go; a bot's tools beyond the ones every bot has are for the Chief to set.
- **A card only for the first command of a bot:** a question the owner would answer yes to every time, which ADR 178 removed for the web and files.

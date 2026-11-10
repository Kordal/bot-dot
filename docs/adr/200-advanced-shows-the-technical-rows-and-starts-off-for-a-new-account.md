# ADR-200: Advanced shows the technical rows, and starts off for a new account

- **Status:** Accepted (2026-11-10, the owner's "All ok" on the audit "Botdot bez żargonu")
- **Extends:** [ADR 192](192-every-bot-has-the-web-files-a-computer-and-every-other-bot.md), which made the switch and put the token usage under it
- **Keeps:** every setting, tool and route; the Chief and the bots change all of it by chat as before

## Context

The apps showed every person the rows a developer needs: the model and reasoning level, a bot's shell commands, helpers, exact tools and permission mode, a job's cron and bash script, a job's signed calls and notify address, a run's folder, steps and `claude --resume`, and token counts. botdot is a personal assistant for people outside IT, who read those rows as noise or as something they must get right.

## Decision

- **One switch.** `advanced` in `GET /api/settings`, `true` or `false`, changed with `PUT /api/settings` (`400` for anything else). The server announces `advanced` in `features`. Settings ends with an "Advanced" switch, web and Android.
- **Off for a new account, on for one from before.** A new account starts with it off. An account whose `settings.json` was written before the switch existed starts with it on, so nobody loses a row they use.
- **What it hides while off, never what it does.** Settings: the default model, the proxy and the bots with a model of their own. A bot: its model, "Can run commands", "Can use helpers" and the exact tools and permission mode (still in the form, so what is saved stays). The Chief: its model. A job: cron (a schedule of its own is one more choice in its own words), the kind of job, the script behind "Show code", the time limit, signed calls and the notify address. A run: its folder, model, steps and `claude --resume`. Usage: the token counts (a bot shows its share of the whole).
- **Plain words with it off too.** Passwords (the Vault): a login alone, with a Website and no Type, extra hosts or API note; SSH keys and files are added with Advanced on. Apps (Connectors): the marketplace leaves out apps that need a key or a developer app of the owner's. A bot: where its computer is and its proxy. Everyone, Advanced or not: an answer without botdot's sentence says what to do, never its status number; the chat's steps and the quick check's card say what happens in plain words.
- **An older server** (no `advanced` in `features`) and settings not read yet: everything shows.

## Alternatives

- **On for the admin only.** Rejected: an account's server does not know who the front door's admin is, and every account from before would lose rows on the update.
- **Hide each row in its own way.** Rejected: one switch is one thing to learn, and one test of what is technical.
- **Remove the rows.** Rejected: the owner uses them, and the Chief cannot show a person what a bot's exact tools are.

## Consequences

- A new account sees a short Settings and short bot settings; the Chief still sets models, scripts and schedules when asked.
- A new technical row is drawn only while `advanced()` (web) or `Advanced.on` (Android) is true.

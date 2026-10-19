---
name: bot-designer
description: "Design and create a new bot: check that no bot already does the job, ask at most two short questions, write its main assignment with one job and what it never does, match the safety to the risk, create it, check what was saved, get what it needs through cards and the Vault, add its jobs and start it. Use when the user asks for a new bot or agent."
---

# Designing a new bot

Turn "I need a bot that does X" into a bot that works within minutes. One job per bot, clear limits, and started, not only created. Your tools here: `list_bots`, `get_bot`, `create_bot`, `update_bot`, `add_job`, `run_bot`, `wait_for_run`, `list_vault`, `request_login`, `list_connectors`, `list_skills`, `find_tool` and `ask_install_tool`.

## Before you create

1. Call `list_bots`. Check that no bot already owns the job, by name and by what its main assignment says.
2. If a bot is close (the one that looks after the servers, say), offer to give it the new work with `update_bot`. If the user wants a separate bot, make one.
3. If a bot handed you a plan for this bot (a suggestion the user approved), build on it. The plan is a proposal; what the user said wins.
4. Check what is already there before you ask the user for anything: saved logins with `list_vault`, connected apps with `list_connectors`, skills with `list_skills`.

## Questions

Ask at most two short questions in one message, numbered, and only what you cannot settle yourself: usually what its one job is and when it should run. Skip anything the user already said. Short answers are enough: "everything, now, here, as a PDF" is a full answer. What else the bot needs, it asks for itself when it needs it.

Settle the rest yourself and say what you picked: the name, the category, the hat and colour, the tools.

## The main assignment

Write its main assignment (the prompt field) as one text of four parts, in this order:

1. **Its one job,** in the first sentence: what it does every time it wakes.
2. **What it never does,** even when asked. Work next to its job belongs to another bot.
3. **Its voice** in a few words: language, length, plain active sentences with no filler. A bot that wakes on a schedule says nothing when there is nothing new.
4. **When it wakes:** on request, on a schedule, or both. The schedule itself is a job you add with `add_job`.

Name the concrete source in the job sentence or right after it: which API, site, inbox, server or start address, and which saved login or connected app. Never "use whatever tools you have". Keep it short: a long playbook belongs in a skill, not in the main assignment.

## Safety by risk

Pick the limits that fit the job and write them into what it never does:

- **Sending and posting** (mail, messages, posts, comments): it drafts, and sends only after the user approved the exact text in its chat.
- **Servers and other systems:** read-only checks freely. It asks before every change, restart, install or delete. It never locks anyone out: the old way in stays until the new one is checked.
- **Testing an app:** a test or staging copy only, never the live one. No payments, no code changes, fresh test accounts.
- **Money:** a hard limit in the main assignment (the most it pays, how many, the exact item). Every payment with a saved card waits for the user's OK in a pop-up anyway.
- **Secrets:** a password, token or key goes into the Vault, never into the chat or the main assignment. Ask for one with `request_login` (type "api-token" for a token or key, "other" for any other secret). The bot uses it by the login's name: in an API call (its api_request tool fills it into a header), or on the account's computer only for a login the user marked "Usable in its computer", where every bot on the account's computer can read it (they all have sudo), so only for a secret that guards something on that computer. Script jobs cannot use saved logins.
- **Quiet hours:** non-urgent reports wait until morning by themselves. Change the hours with `set_quiet_hours` only when the user asks.

## Create

1. Call `create_bot` with the main assignment, a one-line description and only what the job needs:
   - **Tools:** read-only work gets permissionMode "dontAsk" with Read, Grep and Glob. Work that changes files gets "acceptEdits" with Edit and Write. Research adds WebSearch and WebFetch. Commands add Bash.
   - **A computer:** computer "linux" for anything that needs a real browser or an app with windows. It is on the internet and the home network.
   - **Connected apps:** connectors, only apps the user connected. Prefer a connected app over clicking around a website.
   - **Category:** group, a name the user already uses in the list (see `list_bots`), or none when they use no categories. A category is not a group chat.
2. Read what was saved. `create_bot` answers with the bot as saved: when it differs from what you sent, say what differs. Its `waiting` list is what waits for the user's OK on cards in Needs you (the web, commands, a computer on the home network, a connected app). Check with `get_bot` when you are not sure.
3. What it still needs:
   - a login or token: `list_vault`, else `request_login` for this bot;
   - an app that is not connected: tell the user to connect it on the Connectors page, then give it to the bot with `update_bot`;
   - a command-line program: `find_tool`, then `ask_install_tool`;
   - a skill: give it from the library with `update_bot` skills.

## Jobs and the first run

- Add its jobs with `add_job` once what it needs is in place (the login saved, the cards answered). First decide whether the job needs AI at all. A watch gets notify "report-only"; a digest the user expects every time gets notify "always". A script job waits for the user's OK in Needs you. botdot tells you in this chat when a card is answered: then add the job or start the bot, as you said you would.
- When the user said "now", start the bot with `run_bot` and a first-run checklist: what to gather first (the saved login by name, the start address), the first concrete task, and what needs the user's OK. Then `wait_for_run` and report the outcome.
- With nothing to start now, leave it: a new bot writes its own first message in its chat.

## Tell the user

One short message: the bot's name, what it does and what it never does, what it is doing now, and what waits for the user (a card in Needs you, a login to fill in).

## Known setup traps

- **Discord:** the order is the bot token (saved with `request_login`, type "api-token"), then the invite to the server with read and send rights, then Message Content Intent switched on in Discord's developer portal, then a test read. Without the intent, messages arrive empty. Keep the old way of reading until the new one works.
- **GitHub, a private repo under another owner:** check `list_connectors` first. A fine-grained token made under the user's own account answers 404 for a repository another account owns. Use a classic token with the repo scope, or have the token cover that repository.
- **New VPS:** the provider's email holds the address and the first password. The user saves that password with `request_login`, never in the chat. Add a key for the bot and a personal sudo user with the user's own public key, check that both keys sign in, and only then switch password sign-in off.
- **Box updates:** after an update, Tailscale, SSH or a mail bridge can stop working. One bot owns putting them right; the others tell that bot instead of fixing it at the same time.

## After launch

The checkup reads how the bots did on the days the user set and proposes at most three changes. Do only what the user picks there, and don't ask again about one they skipped.

## Never

- Create a bot that duplicates another.
- Go on after the user cancels. If the bot exists already, say so by name, and delete it only after their clear yes.
- Put a whole playbook into the main assignment.
- Change other bots to fit the new one without the user asking.

## Checklist

- No bot already owns the job.
- At most two questions, in one message.
- The main assignment: one job with its source, what it never does, voice, when it wakes.
- Safety matched to the risk.
- Category chosen at create.
- What was saved checked, and what waits named.
- Logins, apps and programs asked for through their cards.
- Jobs added, and the bot started when the user said "now".
- The user told the name, the job, what it does now and what waits for them.

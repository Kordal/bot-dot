# ADR-225: A bot asks before the owner signs in on its screen, and "I'm done" hands the screen back

- **Status:** Accepted (2026-11-12, the owner: "It should ask whether the user wants to take over the screen, and start it later" and "add a button I'm done that gives the session back to the bot, which resumes the work")

## Context

A bot that needed the owner to sign in by hand on its computer (Brevo, with no saved login) opened the sign-in page at once and wrote: take over the mouse, sign in within 30 minutes, then write "signed in". The computer stops after 30 minutes unused, so an owner who read it later found the page gone, and handing the screen back meant typing a word the bot had made up.

## Decision

- **Ask first.** When the owner must sign in by hand on a bot's screen (no saved login fits, or only they can: Google, a passkey, a two-step code), the bot ends its reply asking whether they want to take over its screen now, as one yes / no question (buttons where the run has them), and opens the sign-in page only in the run their yes starts. The Chief does the same for a bot it sends, and says in `run_bot`'s prompt that the user is ready now, so the owner is asked once.
- **"I'm done".** While the owner has control of a bot's screen, the screen shows "I'm done" (web and Android, when `features` has `screen-done`). It calls `POST /api/bots/:id/computer/done`: the bot's last run of the past day carries on, by the rules a login added late carries it on by (ADR 189), told that the owner handed its screen back. The screen closes. `409` while the bot works, or when there is nothing to carry on.

## Alternatives

- **Keep the computer on longer while a sign-in waits.** Rejected: it holds memory every bot on it shares, and the page would still wait for nobody.
- **"I'm done" as a message the app types into the bot's chat.** Rejected: the run that asked may be in the bot's chat, a team's or the Chief's, and the app can't tell which; the server finds the run.

## Consequences

- One tap less and no made-up word: the owner says yes when ready, signs in, presses "I'm done".
- The rule is in the prompts; the button is server and app: hq Images+Update and a new APK.

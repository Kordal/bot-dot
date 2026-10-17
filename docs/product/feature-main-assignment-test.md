# Feature test: a bot's main assignment

Test document of the feature "main assignment" ([its record](milestone4.md#added-features)), written by its last task, ASSIGN-002. The tasks: ASSIGN-001 (the server, the web page and the docs), ASSIGN-002 (Android and this acceptance). The source: the improvement report [A bot's usual task becomes its main assignment](improvements/2026-10-04-main-assignment.md).

## Review

The whole feature, the diff from main, was reviewed by the `kordal-reviewer` agent (Claude Opus 5.5), once per axis, on `5b91f7c`; ASSIGN-002's own diff by the `kordal-task-reviewer` agent on the same commit. Fixes in `012318f`; they were not reviewed again, all three gates cover them.

1. **Medium, fixed: Android's learning switch said the bot "may improve" its main assignment and rules**, the report's own wording, where the server only lets it propose (Standards and Spec). It reads "May also propose changes to its main assignment and rules", with "Those changes need your approval; it may also improve its skills." under it, as the web page says.
2. **Low, fixed: Android's hint said "A message you send replaces it for that run"**, also the report's wording; the server gives the main assignment as the guide for every message. It reads "What it does when a job runs it without a task of its own, and its guide for your messages."
3. **Low, fixed: the Chief still read "task prompt" and "its task/rules"** beside the sentence that tells it the name (`lib/chief.js`, the `get_bot` description). Both say "main assignment" now. The four-part wording for writing a bot stays, as planned.
4. **Low, fixed: a bot got its stored text in `<stored-task>` tags** beside `<main-assignment>`. The tag is `<stored-main-assignment>`.
5. **Low, fixed:** `android/README.md` and a comment in `BotSettingsScreen.kt` said "improve its own task".
6. **Low, kept:** "only send, post, change or delete things when you (or their task) ask for it" on the connectors page, and its twin in a bot's prompt: "task" there is also a job's task or a message. Code comments that say "task and rules". `BOT_DEFAULTS.learning` is `all`, which reaches only a stored bot without the field; a new bot gets `memory`.

### What cannot be relied on

- **No test covers how bots and the Chief behave with the changed prompts.** The test server has no Claude sign-in, so no bot answered and no proposal card was seen. The checklist's last block needs a server where Claude is signed in.
- **The browser check runs by hand**, and was not run: `test/browser/hat-change.cjs` asserts the empty chat has no button. The empty chat was looked at instead.
- **Android's strings have no unit test**; they were read on the emulator.

### What was walked before handing over

On `012318f`, the test server and the emulator at tablet size:

- The web page: the empty chat with no button (before the run below); the settings field "Main assignment" with its hint; under Advanced, "While learning, it may propose changes to its main assignment and rules, and improve its skills" with "those changes need your approval"; after a run started without a message, the chip "Ran its main assignment".
- The server: a bot saved without one answers "A main assignment is required".
- Android: the chip "▶ Ran its main assignment"; the section "Its main assignment"; under Advanced, the switch of finding 1.
- Not walked: a job's hint on the web page was seen at the first look only; the Needs you card and the history line need a run.

## How to start it

It is running on this Mac, from branch `task/assign-002`:

- **The botdot server:** the test server of `.claude/launch.json` (`bot-dot-test`), data in the ignored `.test-data/`: http://localhost:4801. One bot, News Scout, learning set to all, with one failed run without a message. Claude is not signed in there, so a bot does not answer.
- **Android:** the emulator (Medium_Phone, at tablet size) with the debug app built from this branch, connected to that server.

To start it again: `bot-dot-test` from `.claude/launch.json`; `~/Library/Android/sdk/emulator/emulator -avd Medium_Phone`, then `adb reverse tcp:4801 tcp:4801` and the address `http://localhost:4801` in the app.

## The owner's checklist

The web page, http://localhost:4801:

- [ ] News Scout's chat: the chip reads "Ran its main assignment".
- [ ] News Scout's settings: the field "Main assignment" with the hint "what it does when a job runs it, and its guide for your messages".
- [ ] Under Advanced: "While learning, it may propose changes to its main assignment and rules, and improve its skills", "those changes need your approval".
- [ ] Scheduled jobs, a new AI job: the hint "leave empty for the bot's main assignment".
- [ ] Empty the "Main assignment" field: it is refused with "A main assignment is required".

Android, on the emulator:

- [ ] News Scout's chat: the chip "▶ Ran its main assignment".
- [ ] Its settings: the section "Its main assignment" with "What it does when a job runs it without a task of its own, and its guide for your messages."
- [ ] Under Advanced: "May also propose changes to its main assignment and rules", "While learning. Those changes need your approval; it may also improve its skills. Never its tools, permissions or computer."

With Claude signed in (the test server's Setup page, or your own server after the merge):

- [ ] A new bot's empty chat on the web page: head, name, description, no button, until its first message comes (#511).
- [ ] Send a bot a short message ("any news?"): it answers in its role.
- [ ] Run a job without a task of its own: the chip, and the bot does its main assignment.
- [ ] Ask a bot whose learning is "all" for a lasting change ("from now on, always answer in two lines"): a card in Needs you with the field "Main assignment" or "Rules"; under the run, "Proposed changing its main assignment; waiting for your approval". Approve: the settings show the new text and the history reads "Main assignment changed". Decline on a second try: nothing changes.
- [ ] Ask the Chief "what is News Scout's job?": it says "main assignment", not "usual task".

Failure cases to try:

- [ ] A job already named "Usual task" on your own server keeps its name and its mention `@Bot/UsualTask`.
- [ ] An installed Android app from before this feature still works: the card from the server says "Main assignment", its own labels say "usual task" until it is updated.

## Acceptance

On `012318f`, on 2026-10-04:

- `task-check` passed in 1:30 (lint, the structure check, the server and web tests).
- `pr-check` passed in 0:07 (`tools-real`).
- `premerge-check` passed in 0:28 (`android-build`, `android-test`, `android-lint`).

The owner tested the feature on 2026-10-04, on `ae01632` (its runtime files are those of `012318f`), and said it passes, with the two Android strings as the review changed them.

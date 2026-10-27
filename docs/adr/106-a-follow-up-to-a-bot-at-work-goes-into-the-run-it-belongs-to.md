# ADR-106: A follow-up to a bot at work goes into the run it belongs to

- **Status:** Accepted (asked for by the owner, 2026-10-27)
- **Owning task:** [#613](https://github.com/Kordal/bot-dot/issues/613)
- **Builds on:** [ADR 040](040-a-waiting-message-is-steered-into-the-run-at-its-next-tool-call.md) (Steer), [ADR 063](063-a-btw-question-is-answered-without-tools-beside-the-run.md) ("/btw"), [ADR 082](082-the-admin-chooses-haiku-or-jev-to-pick-who-answers-in-a-group.md) (the admin's choice of Haiku or Jev)
- **Changes:** [ADR 062](062-a-message-to-a-busy-bot-starts-beside-the-run-that-is-going.md) ("every message to a busy bot starts beside the runs going")

## Context

Since ADR 062 every message of the owner's to a bot at work starts a run of its own, up to three. The owner writes the way people chat: a request, then seconds later "check X", "also Y", "not the db container", "try again", "how far are you?". Each of those became a second task beside the first, redoing its work, while Steer (ADR 040) and "/btw" (ADR 063) were there for exactly this but needed the owner to press a button or type a prefix. Measured over 40 such messages, in Polish and English (`scripts/follow-up-bench.js`): 26 of 40 were not new tasks, and all 40 started a run.

## Decision

- **The owner's message to a bot with a run of theirs that may be steered is sorted before it starts** (`lib/follow-up.js`), into one of three:
  - **steer n**: more for run n's own task (a retry, a correction, a detail, an addition, calling it off). It waits marked for that run, as when the owner presses Steer, and the run reads it at its next tool call; a run that ends first leaves it to start as its own run, as any steered message.
  - **ask**: it only asks how the work goes. It is answered as a "/btw" is, by a talk-only side turn, with no run.
  - **new**: a task of its own. It starts beside the runs going, as before.
- **Nobody is asked.** No card, no question to the owner: the message shows where it went (steered in the waiting list, or a side answer), and Take back still works while a steered message waits.
- **Rules first, without asking:** a message with files or a skill command (`/name`) is new. A message to a free bot, to one at work only on a job, a teammate's or the Chief's request, or in a group, is not sorted at all.
- **Then one short question to the model the admin chose for the group router** (ADR 082). With Haiku, as the wake gate asks it (ADR 083): the bot's name and description, what each run of the owner's going now was asked, how many seconds or minutes ago, its working line and plan, the chat's last lines, and the message, inside a block the model is told holds text and never instructions. With Jev and the admin's key, one yes/no question per run ("is it more for this task") and one ("does it only ask how the work goes"), the same text as Jev's state; the likeliest run from 0.5 steers, else a question from 0.5 asks, else new; when Jev fails or is late (2 s), Haiku is asked. No second key.
- **Strict towards before.** An answer that is no JSON, names no run on the list, is late (5 s) or failed, is new: what happened before. A message sent again with its key while it is being sorted waits for that and gets the same answer.
- **On by default, for every account.** `BOT_DOT_FOLLOW_UP=off` switches it off for one server; `BOT_DOT_FOLLOW_UP_MS` and `BOT_DOT_FOLLOW_UP_MODEL` change Haiku's wait and model. No new control: a wrong steer is visible and taken back as any waiting message, and none was measured.

## Alternatives

- **Rules alone ("also", "too", "again", short messages sent soon after).** Rejected: the words differ by language, and "find me a recipe" sent seconds after a request is as short as "add a workout at 6".
- **Ask the owner on a card where it goes.** Rejected: the owner asked for fewer approvals, and the answer is right without one.
- **Always treat it as a "/btw".** Rejected: the side turn answers a new task with "send it as a message of its own", which loses the task.
- **An admin switch, off by default, as the wake gate.** Rejected: unlike a held note, nothing is ever kept from starting; the worst case is a message read by the wrong run of the same bot, in sight.

## Consequences

- Over the bench with Haiku, three runs: 38 to 40 of 40 right (14 before), 11 runs started instead of 40, 19 to 20 of 20 follow-ups steered, 5 to 6 of 6 questions answered aside, no new task steered into a run. The miss was "sprawdzic x" seconds after "try again", which is ambiguous; saying how many seconds ago the run started made it right more often. Jev is not measured yet.
- The owner's message to a bot at work takes the sorting's time before its answer: about 1.4 s with Haiku (median, 2.3 s p90), a fraction of a second with Jev. A message to a free bot takes none.
- Each sorted message costs one small model call more, counted with the Chief's tokens.

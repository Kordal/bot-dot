# ADR-083: A small model decides whether a note or a call needs a run now

- **Status:** Accepted (asked for by the owner, 2026-10-23), off until the owner switches it on
- **Owning task:** [#515](https://github.com/Kordal/bot-dot/issues/515)
- **Builds on:** [ADR 082](082-the-admin-chooses-haiku-or-jev-to-pick-who-answers-in-a-group.md) (the admin's choice of Haiku or Jev)
- **Changes:** [ADR 049](049-a-note-to-a-bot-wakes-it-as-soon-as-it-is-free.md) ("every note wakes its bot"), [ADR 026](026-a-call-is-let-in-on-the-jobs-key-alone.md) ("a call runs its job now")

## Context

Every note one bot leaves another (`priority: false`, ADR 049) and every call of an AI job (ADR 026) wakes the bot with a full run of Claude Code, also for an acknowledgement, a thank-you, a repeat of a note already waiting, or a heartbeat saying all is well. Measured over 35 realistic notes and webhook calls (`scripts/wake-gate-bench.js`, 14 of them must wake the bot), on the staging machine with the real Claude sign-in: 35 runs, 21 of them needless.

## Decision

- **Before a note or an AI job's call wakes its bot, the wake gate decides "run" or "later"** (`lib/wake-gate.js`). "Run" is what happened before. "Later" starts nothing: the note stays in the bot's inbox, marked `later`, and its next run, whatever starts it, reads it. A held call becomes such a note, with the job's name and what the call carried.
- **Rules first, without asking:** a note that asks a question, carries an approval or a card, or names a time or a deadline always runs. So does anything from the owner or the Chief, a priority message, an answer a waiting bot collects, and a teammate's final reply, which never reach the gate. A date and time as data carries it (`2026-10-23T14:02:11Z`) is not a deadline.
- **Then one short question to the model the admin chose for the group router** (ADR 082). With Haiku, as the group router asks it (ADR 081: `askClaude` with a system prompt of its own, no tools, no settings): the bot's name, description and main assignment, the job's task for a call, the notes already waiting, and the note or the call's body, inside a block the model is told holds text and never instructions. With Jev and the admin's key, one yes/no question, "must it run now", the same text as Jev's state; "run" from a likelihood of 0.5; when Jev fails or is late (2 s), Haiku is asked. No second key and no second client: the group router's (`askJev`, `config`).
- **The model answers one of three, the gate keeps two.** It is asked for "run", "wait" (its next run is soon enough) or "save" (nothing to do), which it answers better than a plain "run or later": over the bench, three choices held 18 items back with 3 needless runs, two choices 15 with 6. But it told "wait" from "save" badly, so both are "later" and nothing is ever dropped.
- **Never a missed run by failure.** An answer that is no JSON, no known word, late (5 s), or a failed call is "run". An error while holding the note wakes the bot.
- **Seen in the bot's chat.** A held note carries a small "Later" chip, beside it and under the notes that wait; "Run now" starts the bot with every note, held ones too. The run that read it keeps `later` on its notes. A held call reads "⏰ <job>". No other text.
- **A held call is outside content.** The run that reads one has read content of the kind `call` from its start (`outside`), as a called run has, and the call's body reaches it marked inert, between `<call>` tags.
- **Bounded.** Of one job's held calls only the newest five wait, so that a service calling every minute fills no inbox. A call body longer than a note holds (4,000 characters) is never held. The inbox's own limits stay (20 notes, 7 days).
- **Off until the admin switches it on**, for the whole machine: one checkbox, "Wake bots only when needed", in the admin page's Group router section, kept in the front door's `group-router.json` and handed to every account with the router's choice. `BOT_DOT_WAKE_GATE=on` switches it on for one server (tests, a single-account machine); `BOT_DOT_WAKE_GATE_MS` and `BOT_DOT_WAKE_GATE_MODEL` change Haiku's wait and model.

## Alternatives

- **Three outcomes, "save" dropping the note.** Rejected: both models measured put real updates ("the release moved to next month") under "save" in 5 of 8 cases.
- **Rules alone (keywords).** Rejected: "Beszel shows CPU at 97% for 10 minutes" and a Stripe `invoice.payment_failed` carry no question or deadline; the stand-in of keywords in the bench missed one of 14.
- **Hold a call for its job's next scheduled run.** Rejected: a job taking calls often has no schedule, so the call would wait for nothing.
- **Gate the priority messages too.** Rejected: a priority message is a hand-off its sender waits on.

## Consequences

- Over the bench: 17 runs instead of 35 with Haiku, no item that must run held back, 3 needless runs left; the gate takes about 2 s (median), during which the note already waits. Jev on OpenRouter held back as many at 0.23 s.
- A held note waits for the bot's next run, which may be hours away for a bot with no schedule; the chip and "Run now" show it, and the inbox drops notes older than 7 days as before.
- Each note or AI call costs one small model call more, counted with the Chief's tokens; an item a rule decides costs none.

# ADR-099: Every bot run has an outcome in a ledger

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#589](https://github.com/Kordal/bot-dot/issues/589)

## Context

A team that improves itself has to know how its runs went: which jobs fail, which replies the owner corrects, which tools break. That knowledge sat spread over run files, their logs and the read positions of chats, and reading them all again for each question costs a pass over every log. Later steps (a replay of a run, an AI job turned into a script, the Chief's weekly review) need one cheap place to ask.

## Decision

- **One row per finished bot run** in an `outcomes` table of the account's `memory.db`, beside the run's entry in the past-run index (`lib/outcomes.js`). Every kind of bot run has one: a run of Claude, a script job's run, an aside, a run that did not start. The Chief's own replies have none.
- **The outcome:** `done`, `failed`, `stopped`, `needs_you` (its reply asks the owner) or `passed` (a group turn that passed); who ended it; an error kind in botdot's words (`signout`, `idle`, `limit`, `timeout`, `exit`, `disk`, `no_reply`, `no_start`, `restart`, `error`); how many tool calls failed and the names of up to five of those tools; retries; duration and turns.
- **The owner's signals outrank any model's judgement.** The owner writing to the same bot within 10 minutes of its reply marks that run re-asked, and corrected when the message starts like a correction ("no", "wrong", "nie", "popraw"…). Whether the reply was opened is read from the chat's read position when the ledger is asked, never stored.
- **No text of a run.** No request, reply, error message or note: inputs for a replay are ids (the notes and past runs the lookup handed it), a count of files and the model asked for. The request itself stays in the run's file. No cost, price or usage limit (AGENTS.md rule 5).
- **A row follows its run.** A forget that leaves a run out erases its row; a deleted bot's rows go; rows older than the past-run retention go. On start, the runs of the last 7 days without a row get one from their file, by how they ended, their tool errors unknown (`null`).
- **Read-only:** `GET /api/bots/:id/outcomes?days=7` answers the rows and the bot's five worst patterns (a task and a signal, with how many of that task's runs had it). No UI.

## Alternatives

- **Derive outcomes on demand from run files and logs.** Rejected: every question rereads every log, and the owner's signals (a re-ask) are not in any run file.
- **A model grades each run.** Rejected for now: it costs a call per run, and the owner's own signals are what the review should trust first. A judge can add a column later.
- **A JSON file per bot.** Rejected: the ledger is queried by bot and day, and `memory.db` already holds the past runs it sits beside, with forget and retention.

## Consequences

- Each finished run adds one insert to `memory.db`; the owner's message to a bot adds one lookup.
- The Chief's weekly review, a replay harness and the AI-to-script promotion can ask the ledger instead of reading logs.

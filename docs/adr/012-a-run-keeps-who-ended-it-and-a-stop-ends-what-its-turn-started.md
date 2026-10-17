# ADR-012: A run keeps who ended it, and a Stop ends what its turn started

- **Status:** Accepted
- **Owning task:** BUSY-003

## Context

[Milestone 7](../product/milestone7.md). A run that is stopped gets `status: "stopped"` and nothing else: the request to stop it is a flag that is deleted when the run ends (`lib/bots.js`). The owner, the Chief's `stop_run` and a sign-out of Claude all stop runs, and all read "You stopped this run before it finished." (`lib/problems.js`). Three rules read `stopped` as "the owner did that": such a run is not passed on to the Chief's chat that started it (`lib/bots.js`), it never carries on after an OK ([ADR 009](009-the-botdot-server-carries-on-after-an-ok.md), `lib/asks.js`), and its connected-app card goes ([ADR 010](010-a-connected-app-action-waits-in-its-run.md), `lib/connector-approvals.js`).

Stop in the Chief's chat ends the Chief's process only; the bot run that reply started goes on. The reply already keeps the runs it started, as its `actions` of kind `run`. A stopped run's end starts the next work that waits, and so does a stopped reply's.

A bot's run and a Chief's turn have no time limit. Since [ADR 011](011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md) a run that never ends would hold everything that waits behind it.

The owner decided on 2026-10-06: one Stop in the Chief's chat ends the reply and the run it started; after Stop the owner's waiting message starts at once; the run says who ended it; a run and a turn are ended after 60 minutes.

## Decision

- **A run that was ended keeps who ended it**: the owner, the Chief, a sign-out of Claude, or the time limit. The server words the run's sentence from it, and the apps draw that sentence.
- **Only the owner's and the Chief's Stop make a run `stopped`.** A run that a sign-out or the time limit ended did not finish: it is an `error` with its own sentence. The three rules above then hold for it as for any run that failed: the Chief hears of it, and its card stays.
- **Stop in a Chief chat ends the reply and every bot run that reply started** that has not finished, and takes away one that still waits to start. The reply says which runs were stopped too. It does not follow a hand-off to a teammate, and not a run an earlier reply started.
- **Stop empties nothing else.** What waits for that bot or chat starts as after any end, the owner's message first (ADR 011). After an end that a sign-out of Claude brought, what waits is held until the sign-in, for a bot and for a Chief chat (ADR 011, "the hold while Claude is signed out").
- **A bot's run and a Chief's turn end after 60 minutes**, one constant on the server that a test can set short.

## Resolved by BUSY-003

- **The field** is `endedBy` on the run: `"owner"`, `"chief"`, `"signout"` or `"limit"`. A run that ended by itself, and one a restart cut off, has none. It is written when the run ends, not when it is asked to end: a restart in between leaves a run that was cut off, with that sentence. Who asked first is kept: a limit that comes while the owner's Stop is ending the run changes nothing.
- **The status.** `stopped` for `owner` and `chief`, `error` for `signout` and `limit`. The server words the run's `problem` from `endedBy` (`lib/problems.js`), and an `error` of that kind has the same sentence as its `error` where the run brought none of its own.
- **A run the Chief stopped stays `stopped` for the three rules.** It is not passed on to the Chief's chat that started it, it never carries on after an OK, and its connected-app card goes: as for a run the owner stopped. The Chief ends a run with `stop_run` on purpose, in a turn of its own that says so, and it acts for the owner: a turn that tells the Chief what the Chief just did, or work that starts again after it was ended on purpose, would undo the Stop. Only the sentence differs: "The Chief stopped this run before it finished." So `lib/asks.js` and `lib/connector-approvals.js` did not change.
- **A run that a sign-out ended is passed on without a turn.** The Chief can take no turn while Claude is signed out: the bot's own `report` message stands in the chat that started the run, and the Chief is told of it with the owner's next message there, as of any `report` message. A run the limit ended brings a turn, as any run that failed.
- **The 60 minutes count everything from the run's start**, the time it waits for the owner too (a login, an OK on a connected-app action), and not the time it waited to start. The limit is there so that nothing holds what waits behind a run for ever (ADR 011), and a run that waits for the owner holds it as much as one that works. The wait for an OK on a connected-app action ends by itself after ten minutes. A run the limit ended while it waited for an OK is a run that failed: its card stays, and a late yes starts the bot again (ADR 009, ADR 010). For a Chief's turn likewise: from its start, the time it waits for a bot included. The limit ends the turn alone: the runs it started have their own 60 minutes.
- **The second signal.** A Chief's process that has not ended 5 seconds after the first signal (`SIGTERM`) is killed (`SIGKILL`), as a bot's is. One constant for both, which a test sets short with `BOT_DOT_KILL_AFTER_MS`, as `BOT_DOT_RUN_LIMIT_MS` sets the limit.
- **Which runs a Stop in a Chief chat ends.** Those of the reply's `actions` of the kind `run`, and those the turn asked for whose tool call has not answered yet: the run route tells the turn of each run it makes for it, so a Stop that comes before the chip does ends that run too. A run that is asked for after the Stop, by a tool call that was already on its way, is ended as it arrives while the reply is still ending; one that arrives after the reply has ended is a run like any other, and its result comes to the chat as a late result. A reply that was whole when the Stop came (its result read, its process not yet gone) stays a reply that succeeded, unless the Stop ended a run: then it says so.
- **A run that still waits to start is taken away, with no record**, as a take back: the reply names it among the runs that were stopped. `POST /api/runs/:id/stop` takes such a run away for the owner, whichever it is, and for the Chief only one the Chief asked for: the owner's waiting message is the owner's to take back.
- **A job's run that the turn's `run_job` left waiting** behind a busy bot is taken away too, when that call made its place in the queue: not when the owner's own "Run now" of that job waited there already. It has no run's id yet, so no chip names it and the reply does not either.
- **A sign-out or the limit that comes as a run ends by itself**, its reply whole, ended nothing: that run succeeded. A Stop makes a run `stopped` whatever it had written, as before this decision.

## Resolved by BUSY-009

- **Stop in a Chief chat follows a script job too.** `run_job` on a job without AI starts a script, not a run of Claude. The run route tells the turn of it, by the id the script's run will have, made as the script starts. A Stop ends the script with what its time limit uses: the kill of the script's whole process group. Its run is then written as `stopped` with `endedBy: "owner"`, also when it had printed nothing, and the reply names it with the other runs. The AI does not look at what it printed. This supersedes "Not followed: a script job" of BUSY-003.
- **A script that was done when Stop came.** What is left of it is the AI run it handed its output to. One that still waits behind a busy bot is taken away and named nowhere, as a job's waiting run is; the script's own run then shows in the bot's chat, as when the AI has no room for it. One that is going is ended and named, as any run the reply started.
- **Only through that reply.** A script the scheduler or the owner's "Run now" started is not ended by a Stop in a Chief chat, and a script whose reply had ended before the Stop goes on, with its hand-over. `POST /api/runs/:id/stop` does not end a script: it has no run while it goes.

## Alternatives

- **Keep `stopped` for every end and add only the field.** Each of the three rules would then ask the field too, and an app from before this decision would show "Stopped" for a run the limit ended.
- **Stop that follows every hand-off** (OpenClaw ends the whole tree). A teammate's run belongs to its own exchange, with a wait that already ends when the asker is gone; excluded from the milestone's scope.
- **A watchdog for silence instead of a total.** Claude Code already ends a run whose model or tool is silent; what is missing is an end for a run that keeps going.
- **A limit as a setting.** Against the rule of no new settings; the number was the owner's choice on the prototype.

## Consequences

- A run that needs more than 60 minutes is ended, also one that spent part of them waiting for the owner.
- Android stops writing its own "Stopped." and draws the server's sentence.
- A run that a sign-out ended used to count as stopped by the owner; it now reaches the Chief's chat that started it and keeps its card.
- The server announces the field in `features`; an app that does not know it shows the server's sentence all the same, since `problem` is already sent.

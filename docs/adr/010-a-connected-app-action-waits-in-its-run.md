# ADR-010: A connected-app action waits in its run, and a late one-use grant binds the run it starts

- **Status:** Accepted
- **Owning task:** OK-003

## Context

[Milestone 6](../product/milestone6.md). A write through a connected app needs the owner's OK. Before this decision `connector_run` answered the bot at once with an error and added a card; the run ended before the owner saw it, and "Allow once" then failed with "That run has ended", because a one-use grant was bound to the run that asked (`lib/connector-approvals.js`). The safe answer could not be given, which pushed the owner to "Always allow this action".

`docs/archive/security-issue-90.md` recorded the rule: "A one-use grant binds the current run, action and exact arguments." On 2026-10-05 the owner decided that a late "Allow once" starts the bot again, and that the grant then counts once for the run it starts.

A missing login already waits inside its run: the bot's tools server leaves the call unanswered and asks the server in slices of 25 seconds (`lib/vault-mcp.js`, `lib/login-requests.js`). Claude Code allows a bot's tool call 15 minutes.

## Decision

- **`connector_run` waits for the owner's answer inside the run**, in slices of a long poll, for ten minutes. A yes lets the same call go through; a no and the end of the wait are told to the bot in plain words.
- **The card stays when the wait ends**, marked as no longer waited for. It goes when the owner stopped that run, sends the bot a new message, or after 24 hours.
- **A late "Allow once" starts the bot again** by [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md). The new run is handed the ask's stored arguments word for word.
- **The late grant binds the run the OK starts, the action and the exact arguments.** It is kept with the queued work, bound to the run's id when the run starts, used once, and gone when that run ends, used or not. Other arguments make a new card and a new wait.
- `docs/archive/security-issue-90.md` is reworded to this rule in the owning task.

Resolved by OK-003:

- **The route of the wait is the run's own.** `POST /api/connectors/session/run` answers a write that has no grant with `needsApproval`, `waits` and the ask's id, as soon as the ask is made. The bot's tools server then asks `POST /api/connectors/session/wait` with that id in slices of 25 seconds, and calls `run` again with the same arguments when the answer is a yes: that second call is the one the grant lets through. Both routes take only the token of the run that asked; an ask of another run is "not found". The owner's answer stays `POST /api/asks/:id`, which the Chief's tools may not call.
- **The length is one constant on the server**, ten minutes (`BOT_DOT_CONNECTOR_WAIT_MS` sets it for a test). The clock starts when the ask is made and is the server's: the tools server only relays, and gives up by itself after 14 minutes, inside the 15 that Claude Code allows a tool call.
- **Where a held ask keeps its state.** On disk the ask has `stoppedAt` once nobody waits for it; an ask without it is held. In memory the server keeps who waits (the run, the timer of the ten minutes, and the answer for the tools server to fetch), which a restart loses: so when botdot starts, every connected-app ask without `stoppedAt` gets it. A run has `waitingFor: "ok"` while one of its asks is held, from the same memory.
- **The feed's event is `run_waits`**, shaped like `opening_line`: `{ chat: "bot:<id>", botId, runId, waitingFor: "ok" }` when a run begins to wait, and the same without `waitingFor` when its last wait ends.
- **The words handed to the bot are the server's**, sent with the wait's answer and relayed by the tools server: after a no, that the owner declined and not to try it another way; after ten minutes, that the owner has not answered, that the card stays and that botdot starts the bot again if they allow it later, and to say so in its reply. A second call of the same action with the same arguments in that run, after a no or a wait in vain, is answered at once with the words it was told then: it makes no card and does not hold the run again, also when the first card is gone.
- **A card that is not held stays only while its yes would start the bot again**, by the rules of ADR 009 asked for the one run that waited: not after the owner sent the bot a message, not after 24 hours, not for a bot that is gone, a job's run of a bot that is paused (the owner's own request to such a bot stays, since OK-010), a run the owner stopped or a run that already carried on. It is looked at when the wait ends, when a run of that bot starts or its own run ends, when botdot starts, when the asks are read for their cards (`GET /api/asks`), and once a minute: so a card that is drawn and not held says what its yes starts, and the feed's entry can be without `then` for up to a minute before it goes. "Allow once" on a card whose yes can start nothing any more (it went a moment before the tap) is refused with a sentence that says nothing was done, and the card goes; "Always allow this action" there saves the lasting grant and starts nothing.
- **A connected-app ask is not one of a run's several asks** in the sense of ADR 009: it does not keep `runs`, and its yes starts the bot at once, not after the last answer of that run. A grant would otherwise wait in `asks.json` on another card's entry. A run carries on once all the same: of two cards of one run, the yes that comes second finds a run that carried on already, and its card goes when that run starts.
- **The grant in the queue is `grants` on the `carry-on` item**: `[{ app, action, arguments, always }]`. It is bound to the new run's id in the step that makes that id, before the bot's process is started. A grant from "Always allow this action" is carried the same way, so that the run is handed the arguments; the lasting grant is what lets its call through.
- **botdot starts the bot itself also when the Chief started the run that waited.** This supersedes, for a late OK on a connected-app action only, the rule of ADR 009 that a run the Chief started is handed back to the Chief, who starts the bot with `run_bot`: a grant cannot be bound to a run the Chief will start. The run botdot starts has `startedBy: "chief"`, and its reply reaches the Chief chat that started the first run. As in ADR 009, nothing starts when that chat is gone.
- **A job's run that is repeated** gets the grant and, after its own task, botdot's note with the action and the stored arguments.

Resolved by OK-007, after the milestone review:

- **The card shows all it approves.** The ask's `rows` in `GET /api/asks` have a row for every argument and every value in full; before, a value was clipped at 500 characters and the list at 30 rows, and "Allow once" approved, and a late yes sent again, text the owner could not open. The feed's entry keeps the short form and marks each cut with `more`; an app that has only those rows shows `details` under them and offers no yes.
- **A card that is not held also goes when the Chief was told to start the bot again on its run** (`handedBackAt`, [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md)): its yes would start the bot from that run a second time.
- **What the owner writes in the Chief's chat does not take such a card away**, also where the Chief started its run. ADR 009's rule that a message in that chat counts as asking again is for work the Chief would be handed; a late yes here starts the bot itself, and the bot was told that its card stays. The rule function is asked with `startsBot` for this ask and for its queued work.
- **A yes on another card of that run, while its late grant waits behind a busy bot, joins that work** and gives the Chief no turn: the queued work is told what was allowed and keeps the grant. Handing the run back there would drop the grant the owner gave.

Resolved by OK-008, after the second pass of the milestone review:

- **A card is bounded, and "Allow once" needs a card that shows everything.** The ask's `rows` in `GET /api/asks` hold at most 200 rows and 100,000 characters of labels and values together. An action beyond either has the first rows that fit, each whole, and `more: true`; the server refuses a yes without `always` on it (`409`), while its run waits and after. Decline and "Always allow this action" are left: the lasting grant is for the action with any arguments, so it does not depend on what the card shows. Before, 120,000 small arguments made 120,000 rows on every read of the list, drawn by the phone in one layout.
- **A label keeps every letter and digit of the argument's name**, in any script, and is not clipped: the card that "Allow once" answers read "Imi" for `Imię` and "Value" for `日本語`, and ended a long name in "…". A character that draws nothing is left out of a label, so two names that differ only by it are numbered as two that are spelled the same. Look-alike letters of two scripts are not told apart: that needs Unicode's table of confusables, which botdot does not carry.
- **That yes joins the queued work also when the owner wrote in the Chief's chat since** ([ADR 009](009-the-botdot-server-carries-on-after-an-ok.md)).

Resolved by OK-009, after the third pass of the milestone review:

- **What the rows of the list hold, said once.** The ask's `rows` in `GET /api/asks` hold every argument and every value in full up to the two limits of OK-008, 200 rows and 100,000 characters of labels and values together, and beyond either the first rows that fit, each whole, with `more: true`. This is what stands where "every value in full" under OK-007 and the bound under OK-008, above, read differently.
- **The feed's entry bounds a label as it bounds a value.** In the short form a label is at most 60 characters, clipped with "…" and marked with `more: true` on its row; the labels of the list stay whole, as OK-008 has them. Before, a label was whole in both forms: one name of 900,000 letters made a feed entry of that size with no `more`, kept among the feed's last events and sent again on each change.

## Alternatives

- **Keep the rule and refuse a late OK.** The card goes when its run ends; the owner asks the bot again and must answer within ten minutes. Shown to the owner on 2026-10-05 and not chosen.
- **Bind a late grant to the bot, the action and the arguments, with no run.** Any later run of that bot could use it, also one a web page or an email started. Wider than what the owner sees on the card.
- **Wait without a limit.** A run that nobody answers would hold a Claude process and the bot's queue for as long as the card stands.
- **Hold the HTTP call of `run` itself until the owner answers.** One call of ten minutes, past the two minutes the tools server gives a call and past what a proxy in front of botdot keeps open. The slices are what a missing login uses.
- **Keep `held` on disk and trust it after a restart.** No run survives a restart, so a card would say that a bot waits which does not.
- **Let a connected-app ask keep `runs` and carry on after the run's last answer**, as a permission does. The grant of the first yes would be written into `asks.json`, on the card that still waits. The decision keeps a one-use grant in the queue file only.
- **Tell the Chief of a late yes on a run it started**, and let it start the bot. The run it starts is not known when the owner answers, so the grant would have to fit any next run of that bot.
- **Keep a card that is not held until it is 24 hours old, whatever its yes can do.** "Allow once" on it would then answer that nothing was done for most of a day.

## Consequences

- A held run keeps a Claude process and the bot's queue for up to ten minutes.
- A one-use grant is on disk for the first time, inside the queue file, for as long as its run waits to start. The ask's arguments are in `asks.json` while its card waits, as before.
- The owner approves a run that does not exist yet. What they approve is still exact: this action with these arguments, once.
- A bot that does not call the action again with the stored arguments leaves the grant unused; it goes with the run.
- The stored arguments are handed to the new run as text the bot itself wrote in the run that waited, also when a page or an email it read then shaped them. They are marked as data in what it is handed, and the owner saw them on the card.
- A run the Chief started and botdot carries on is not announced to the Chief before it ends: its reply arrives in that chat as a bot's report.
- The feed's `asks` entry of a connected-app action carries its `rows`, the arguments in the owner's words, for as long as it waits: in the short form, at most 60 characters of a label, 500 of a value and 30 rows. The line of its notification (`text`) still holds none.
- `GET /api/asks` is as large as the arguments of the actions that wait.
- A card's `then` says "It carries on when you allow it." also where a bot with ten tasks waiting cannot take the work: that yes is refused with the reason and the card stays.

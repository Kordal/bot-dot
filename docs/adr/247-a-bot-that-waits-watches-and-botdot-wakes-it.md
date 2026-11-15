# ADR-247: A bot that waits watches, and botdot wakes it

- **Status:** Accepted (2026-11-15, the owner asked for bots that set up their own monitoring while they wait)
- **Keeps:** [ADR 175](175-botdot-notices-between-the-looks-and-starts-one-when-it-cannot-wait.md) (a Chief's check starts a look; the look is the Chief's only unasked voice), [ADR 026](026-a-call-is-let-in-on-the-jobs-key-alone.md) and jobs as they are, [ADR 178](178-cards-that-guarded-nothing-are-gone.md) (no card for what reaches no one)

## Context

A bot that waits for something outside (a pull request to be merged, its checks to finish, a deploy, a reply by mail) had two ways to come back to it: promise it and forget, or set a job that wakes it on a clock. A job spends a whole run each time only to find nothing new, and a recurring script job waits for the owner's OK because its script runs on the machine. Nothing ended by itself when the thing happened.

## Decision

- **A watch** (`lib/watches.js`): a bot or the Chief sets one with `watch`, saying what to read, what it waits for, a deadline and `then`, what it will do. botdot reads it itself, without a model, every few minutes (5 by default), and wakes whoever set it once: when it is so, when the deadline passes, or after 6 failed reads in a row. Then the watch is gone.
- **Three fixed kinds**, so no script and no card: a GitHub pull request (merged or closed, every check of its newest commit finished, a new review or comment, any change), an address read with GET (a value of its JSON, a text there or gone, any change), and a mail in the owner's Gmail that came after it was set. What it reads is data: the woken run gets a few lines of it inside a block, beside its own `then`.
- **Safe reads.** Without a login only a public https address is read, its address checked and pinned against DNS rebinding as a login's is. A private repository or the owner's own server needs a saved login shared with the bot; its secret goes only to the login's own hosts (vault-http.js). The Chief's watches take no login.
- **The first read is at once.** A wrong address or a missing login is said to the bot in its tool's answer, and something already so is said instead of watched.
- **Waking.** A wake the bot's queue could not take keeps the watch, which tries again at the next read, reading nothing more. A bot is started with a run of `trigger: "watch"`, queued like a lead's project work when it is busy; its reply is in its chat. The Chief's end is a check (ADR 175, P3), so a look says what it found, within the day's rules.
- **Seen and stopped.** Each watch is a chip at the end of its bot's chat with its name, its deadline and a button that stops it. At most 10 per bot and 10 for the Chief, 14 days at most. Bots are told to watch instead of promising to look again.

## Alternatives

- **A job with a script and `aiWhen: "output"`.** It does the same reading, but its script waits for the owner's OK and it never ends by itself.
- **The jobs' scheduler reading them.** Its minute starts runs and scripts of the bots; a watch's read is a few seconds of network that must never hold a job's minute back, and many watches read at once. The reads have their own short timer; what they start goes through the bots' queue (`startOrQueue`) and the Chief's checks (ADR 175), the same ways a job or a promised check (#1229) reaches them.
- **GitHub webhooks.** A server at home (`BOT_DOT_REACH=local`) has no public address, and a webhook needs setting up per repository. Reading every few minutes works on every server; webhooks can come later for hosted machines.
- **Through the connected GitHub app (Composio).** Its action names and accounts differ by connection; GitHub's own API with a token or none is simpler. Later, if owners connect GitHub only there.

## Consequences

- Waiting costs no model call until something happens.
- A run a watch starts is outside the day's budget of unasked messages (ADR 175, P5), as a one-time job's is: the bot was waiting on it for the owner.
- With no login, GitHub allows 60 reads an hour from one address: about five pull requests watched at once at the default pace.

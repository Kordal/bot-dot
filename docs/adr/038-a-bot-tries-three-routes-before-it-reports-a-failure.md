# ADR-038: A bot tries three routes before it reports a failure

- **Status:** Accepted (2026-10-20, the owner's decision: a number of attempts, 3, not a time limit).
- **Owning task:** [#156](https://github.com/Kordal/bot-dot/issues/156) ("bots give up too early")

## Context

A bot that hit one failure (a missing command, an empty source, a page that would not open) often stopped and told the owner. Its instructions told it to say plainly what did not work (`honesty()` in `lib/bots.js`) and, since #136, to ask a teammate before it said something was not there, but nothing asked it to look for another way first. The owner saved a shared note asking for that; a note lives in one account's memory and a new install starts without it.

## Decision

- Every bot's instructions carry one rule beside `honesty()` (`TRY_OTHER_ROUTES` in `lib/bots.js`): before it reports a failure, it tries other reasonable routes (another tool, command, source or teammate, a smaller step, the same step after fixing its cause), up to 3 attempts in all, each on a different route. It reports sooner when the next route needs the owner (a permission, a login, a decision) or is not allowed.
- The rule names its limits: a declined card, a card that waits, a refused permission and "leave others out" are final for the run, and no secret is guessed. A missing command keeps the installed-tools note and the computer's note (install it where allowed, else `ask_chief_for_tool`); secrets keep `VAULT_PROMPT`; the bot's own rules stay out of reach as `honesty()` says.
- The rule ends with the report's shape: what failed, what the bot tried, what it needs from the owner. `REPLY_STYLE` no longer says "or what you couldn't access. Work with what you have.", which told a bot to settle.
- The rule is in every run a bot does for the owner, a job, a call, a teammate's message and a group turn. It is not in botdot's own memory review.

## Alternatives

- A time limit: rejected by the owner.
- A counter or a setting in code: the server cannot tell one route from another, and AGENTS.md rule 5 keeps limits out of the account. The 3 is prompt text.
- A second pass that sends a give-up back with "try another way": costs a run per failure; not now.
- A rule in the Chief's four-part bot template: the shared rule already reaches every bot, including bots written before it, so the template is unchanged.

## Consequences

- A fresh install has the rule with no notes and no shared memory.
- The bound test of a full prompt is 101,000 characters (DECISIONS.md, 2026-10-20).
- A bot spends up to three attempts on a failure, which makes a failing run longer; a job that fails still fails once per run, and Milestone 7's "said once and not at night" is unchanged.
- Whether a bot follows the rule is up to the model; the tests check the instructions it is given, not its behaviour.

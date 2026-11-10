# ADR-182: A job that fails for a passing reason runs again

- **Status:** Accepted (2026-11-10, the owner's go on "less heavy, less minding the bots": 3 tries, 5, 10 and 15 minutes after each failure)
- **Changes:** BUSY-004 ("a failing job is said once"): a passing failure is tried again before it is told
- **Keeps:** the row, said once and held at night (BUSY-004); the run's own carry-on after a failing API (#1093)

## Context

A scheduled job that failed because Claude's servers were busy, or because its run didn't start, waited for its next time: the next day for a daily job. The owner saw the failure and pressed "Run now" by hand. Owners felt they had to mind their bots.

## Decision

- **Which failures.** A repeating job's scheduled run whose error kind (`lib/outcomes.js` `errorKind`) is `rate_limit`, `api_error`, `no_start`, `idle` or `timeout`. A run already carries on once in its own session after a failing API (#1093); this comes after that, as a new run.
- **When.** 5 minutes after the run ended, then 10 after the next failed try, then 15: three tries. The scheduler starts a try in the minute its time has come, as `trigger: "schedule"`.
- **Quiet.** A failed run that is tried again is `quiet`, has `retryAt`, and is no part of the row: the job's line and the row's count stay as they were. When the last try fails, that run is told by the row's rules (the first of a row by day, held at night), with `retried: 3`.
- **Ends.** A try that ends well ends the tries. A job switched off or waiting for approval loses its try. The tries are kept with the queue (`queue.json`, `jobRetries`), so a restart does not lose them.
- **Not tried again.** Any other failure (the job's own error, a usage limit, a sign-out), "Run now", the owner's message and a one-time job (which has its own wait for a sign-in).

## Alternatives

- **Try at the next minute.** Rejected: a busy API is rarely over in a minute, and the run already waited one.
- **Ask the Chief to diagnose each failure.** Kept for the last failure only; a passing one needs no thought, only time.

## Consequences

- A job that hit a busy moment is done half an hour later at worst, without the owner.
- A job that fails for good is told up to 30 minutes later than before, and spends up to three more runs.

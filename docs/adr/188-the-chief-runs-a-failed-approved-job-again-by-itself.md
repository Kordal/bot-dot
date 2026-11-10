# ADR-188: The Chief runs a failed approved job again by itself

- **Status:** Accepted (2026-11-10, the owner's "Tak" on D in "less heavy, less minding the bots")
- **Changes:** ADR 006 (a look only reads, changes nothing and starts nothing) for one step; ADR 023 (a checkup only reads) keeps its rule, and its proposals still wait for a pick
- **Keeps:** ADR 182 (a job that fails for a passing reason runs again by itself); every card

## Context

A look saw that a job had failed and could only tell the owner, who then had to say "run it again". That is a step the owner already approved: the job and its run, as they are.

## Decision

- **One step a look may take:** `run_failed_job_again` (`POST /api/bots/:id/jobs/:jobId/run-again`) runs a job again once when its newest run failed.
- **The server checks it is that step:** the job is switched on, approved and has no change waiting; its newest ended run is neither a success nor stopped by the owner, ended within 24 hours, and was not itself a try. The failed run is marked (`ranAgain`), so a second try is the owner's. Anything else is `409` with why, and the look tells the owner instead.
- **Undo is Stop:** the look says in one line that it ran the job again and why; the run is in the bot's chat, where the owner stops it.
- The look keeps no other tool that changes anything; a web search can at most make it run again a job the owner approved.

## Alternatives

- **Every safe step at once** (switch off a job that keeps finding nothing, raise a timeout). Rejected for now: each changes what the owner approved, so each wants its own Undo. Running again changes nothing.

## Consequences

- A failed morning job gets a second try before the owner reads about it.
- A job that fails again is the owner's, as before.

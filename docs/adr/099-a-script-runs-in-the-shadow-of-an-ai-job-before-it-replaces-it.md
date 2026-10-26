# ADR-099: A script runs in the shadow of an AI job before it replaces it

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#588](https://github.com/Kordal/bot-dot/issues/588)

## Context

ADR 085 tells the Chief to turn an AI job that only counts or checks into a script job with logins. That saves a run of Claude every time, but the owner has to trust a script that has never answered the job's question. The owner also wants as few cards as possible. Proposing the swap blind adds a card that the owner can only judge by reading code. Proposing nothing leaves the AI doing mechanical work forever.

## Decision

- **A shadow.** The Chief writes the script, its logins, `aiWhen` and the follow-up prompt for an AI job (`shadow_job`, `POST /api/bots/:id/jobs/:jobId/shadow`). For a week, after each scheduled run of the AI job, botdot runs that script as the job's bot. It uses the same `botdot-request` key and ssh-agent a script job gets (ADR 085, 087), in a folder of its own (`.shadows/<job id>`).
- **Its output goes nowhere.** A shadow run is not a run: it is not in any chat, it notifies no one, the AI never reads it, and it takes no call and tells no address. botdot keeps only whether each run matched, and both sides of a run that did not.
- **What is compared is what the owner got.** The AI run's result after reporting (`''` for a run that stayed quiet) is compared with what the script printed. Rules answer first: both quiet is the same; a failed script, or one side quiet and the other not, differs. Otherwise a short Haiku call says whether both tell the same facts. A failed, late or unclear answer counts as "differs".
- **One run that differs ends it.** The AI job stays as it is, and no card comes. The Chief reads why with `shadow_status`. A change to what the AI job does, or its removal, also ends the shadow.
- **One card, at the end.** After 7 days with every compared run the same (3 at least), botdot proposes the swap as the Chief's change to the job (ADR 013): a script job with the shadow's script and logins, summary "Same answers N of N in 7 days". This is the only card. The owner reads the script and its logins there, as ADR 085 requires. A job the owner always approves, with no new logins, is swapped at once, as any change of it.
- **Versioned, and one step back.** When the owner says yes, botdot keeps the AI job's definition beside the job (`promoted`). `back_to_ai` (`POST …/back-to-ai`) restores it exactly and at once, as any AI job the Chief changes. After the yes, the Chief offers it as a one-tap choice.

## Why the shadow itself needs no card

The script runs as the bot's own user, with logins already shared with that bot. That is no more than the AI job it shadows can do with its own tools (`api_request`, Bash). The owner's approval is for what reaches them and what keeps running, and nothing of the shadow does either until they say yes on the swap card.

## Alternatives

- **Propose the swap at once.** Rejected: the owner judges a script without evidence, and a wrong swap goes unnoticed until it misses something.
- **A card before the shadow and another after.** Rejected: two cards for one decision, and the first one asks the owner to judge the code anyway.
- **Compare text exactly.** Rejected: an AI never writes the same sentence twice, and a script never writes a sentence at all.
- **Keep comparing after the swap.** Rejected: that is the AI run the swap saves.

## Consequences

- `shadows.json` in the account's data holds the shadows and the promotions. A deleted bot's are dropped with it.
- The tests shorten the week and its fewest runs (`BOT_DOT_SHADOW_MS`, `BOT_DOT_SHADOW_RUNS`). An owner's botdot never sets them.
- Choosing candidates is the Chief's judgement from a job's recent runs. An outcome record of runs can feed it later.

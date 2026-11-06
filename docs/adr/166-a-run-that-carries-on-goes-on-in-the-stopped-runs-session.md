# ADR-166: A run that carries on goes on in the stopped run's session

- **Status:** Accepted (2026-11-06, the owner's review package F, #1111). Changes [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md): its "a new run, not the old one" stands, and that new run now resumes the old one's session.
- **Owning task:** #1111

## Context

After the owner's yes on a card, botdot starts the bot again (ADR 009) as a fresh `claude -p`, handed the request, its earlier reply clipped at 4,000 characters, what was allowed and declined, and a pointer to `read_run`. Everything the stopped run read (files, pages, tool output) and reasoned is gone, so the bot looks it up again or guesses. Bots are told to stop early for an OK, so every stop throws their context away. ADR 009 left resuming the session to a later milestone: `defer` exits the process and needs the run's session resumed.

botdot already resumes a session once, after Claude refused a sign-in midway (#481, `resumedAfterRefusal`): the same bot, in the same workspace, as the same user.

## Decision

- **The new run resumes the stopped run's session.** A run that carries on (`carry-on`, ADR 009) is started with `--resume <the stopped run's sessionId>`, and handed only the owner's answer in botdot's words: that the owner answered on the card, what was allowed, what was declined, the grants of a connected app's actions (ADR 010), and to go on without repeating what is done. The request and the reply are already in the session.
- **It is still a new run.** Its own id, record, chat bubble and outcome, `continues` and `customPrompt: false` as before. Its record says `resumed: true` while it went on in that session, so the outcome ledger can compare retries and corrections of resumed and fresh carry-ons.
- **What changed since is the new run's.** The tools, the permission mode, the model and the appended system prompt are given to every `claude -p` anew, so a resumed run runs with what the owner allowed and with the bot as it is now.
- **A session Claude Code no longer has starts the run afresh, once.** When Claude Code answers that it has no such session (its file is gone, the workspace moved), the run starts again in a new session with the full carry-on prompt of ADR 009. No error is shown.
- **Not after a restart of botdot.** A run cut off by a restart (ADR 140) carries on afresh: its session ends in the middle of a step.
- **Only a session id as Claude Code writes it** (a UUID) goes on the command line.

## Alternatives

- **Keep starting afresh** (ADR 009 as it was). Simple and proven, but every stop for an OK loses the run's context, and the bot redoes lookups.
- **Hold the run open while the card waits** (a permission host, or Claude Code's `defer` hook). One process per waiting card, for hours, and a late answer needs a new run anyway.
- **Resume only when the bot's settings did not change.** Nearly every yes changes the bot's tools, which is the point of the yes: the check would turn resuming off where it matters. The settings are passed anew on every start.

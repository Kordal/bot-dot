# ADR-226: The Chief writes a new project's setup questions, each from the answers before it

- **Status:** Accepted (2026-11-12)
- **Supersedes in part:** [ADR 127](127-the-chief-picks-a-new-projects-setup-questions-and-the-server-sends-its-screens.md) (the Chief picks the questions from a catalogue)
- **Builds on:** [ADR 112](112-the-chief-helps-set-up-a-company-in-short-calls-and-botdot-reads-its-site.md), [ADR 081](081-a-short-model-call-picks-who-answers-a-group-message-without-a-mention.md)

## Context

The catalogue of ADR 127 has 14 questions in three shapes, picked all at once by the first read. For some projects none of them fit, and an answer could change only the chips of the questions after it, never the questions (#1298).

## Decision

- **The read writes the questions:** 2 to 5 of its own for the ask (keys `q1`…), each with a short label for the review and chips, and `first` on the one that asks what to do first. `setup` keeps `ai: true`, `labels` and `first`.
- **Only the first is final.** Each later one is a draft, written again by the fast model once the answers before it are in (`POST /api/company/suggest`, as the chips were): its words, label and chips. From the third on it may end the questions instead; the open ones from there go.
- **A failure keeps the draft**, now of the answers' basis, so nothing is asked again. A failed read, or fewer than two questions, falls back to the catalogue questions of its shape, as before.
- **A draft's screen says so** (`draft: true`): the apps hold its title as a skeleton while it is written again, so the words never change on screen.
- **The answer to the `first` question is plan item 1** at Create, as "What first?" was.

## Alternatives

- **Keep the catalogue and add questions to it:** the list grows, and still can't follow an answer.
- **Write all questions again after every answer:** more calls and more waiting for the same result; the next one is enough.
- **Wait for the next question with no draft:** a failed or slow call would stop the setup.

## Consequences

- One more call of the fast model per question after the first (at most four per project).
- Projects read before keep their catalogue questions; an app before this change shows a draft's words until they are written again.

New projects on apps with `project-conversation` use [ADR 239](239-new-projects-start-in-their-chiefs-conversation.md); existing setup and older apps retain this flow.

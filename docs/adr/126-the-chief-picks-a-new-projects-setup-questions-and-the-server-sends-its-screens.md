# ADR-126: The Chief picks a new project's setup questions, and the server sends its screens

- **Status:** Accepted (2026-10-30)
- **Builds on:** [ADR 112](112-the-chief-helps-set-up-a-company-in-short-calls-and-botdot-reads-its-site.md) (the Chief helps set up a project in short calls), [ADR 003](003-one-figure-definition-for-all-apps.md) (what must look the same everywhere is data the server hands out)

## Context

Every new idea was asked the same five venture questions (who it is for, what they do today, why you, the 90-day signal, the first test), then stories and a SWOT with competitors (#668). For "Manage my homelab" or "Plan the wedding" most of it made no sense, and the Team step always proposed three to five bots. The screens were also written three times, in the server, the web page and the Android app, each with the same hash of the answers (#787).

## Decision

- **A catalogue of questions on the server** (`lib/company-chief.js` `CATALOGUE`), in three shapes: venture (it serves people), ops (something to run and keep well), goal (a personal or one-off goal).
- **The Chief's first read of an idea picks them:** a shape, 3 to 5 keys of the catalogue in the order to ask them, and whether the setup has stories and a SWOT. They are kept on the project as `setup`. A bad or failed answer, or fewer than three known keys, falls back to its shape's own questions, and no shape to the venture five, so every project read before stays as it was.
- **The server sends the screens** (`screens` on the project in setup): each question with its words, its review line and the basis of its chips, then stories where they apply, the delivery date and the review (with the SWOT or not). The apps draw the list as it comes and translate the catalogue's words they know; an app on a server without `project-screens` keeps the venture five.
- **No SWOT, then "What first?"**: its answer is plan item 1 at Create, as the SWOT's first test is.
- **The team is one to five bots**, as few as the work needs.
- **A bench of ten asks** (`scripts/onboarding-bench.js`) checks the read and the team proposal against what fits each ask.

## Alternatives

- **A template gallery** (Homelab, Startup, Wedding tiles): one more choice for the owner, and the Chief reads the ask anyway.
- **The Chief writes its own questions:** nothing to translate or check, and no review line or fallback to rely on; a catalogue keeps the words known.
- **The screens stay in each app:** every new question means three changes and three hashes.

## Consequences

- An app before this change draws a new ops or goal project with the venture five, its answers stored under those keys.
- A site's read is unchanged: its review alone.

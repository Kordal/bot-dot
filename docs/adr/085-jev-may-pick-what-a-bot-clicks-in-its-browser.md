# ADR-085: Jev may pick what a bot clicks in its browser

- **Status:** Proposed (asked for by the owner, 2026-10-24), off until the admin switches it on
- **Owning task:** [#526](https://github.com/Kordal/bot-dot/issues/526)
- **Builds on:** [ADR 082](082-the-admin-chooses-haiku-or-jev-to-pick-who-answers-in-a-group.md) (the admin's choice of Haiku or Jev, and Jev's key)

## Context

A bot works its Camoufox with the browser tools (#170): each tool answers with the page's accessibility tree, up to 12,000 characters, and the bot's model reads it to choose the next ref. Jev (`typesafe/jev-1.14`) answers a choice among up to some hundred options in about 0.2 s, for well under a thousandth of a dollar, but writes no text: it can pick a control, never an address or what to type.

Measured with `scripts/browser-bench.js` on the staging machine: a real Camoufox, Claude Code with its default model as a bot runs it, 10 fixed tasks (8 on the bench's own site: a product's price, a product that does not exist, a search, a paged list, a page of 150 links, a form, settings three pages deep, a help article; 2 on public sites), 3 runs of each task in each variant, 30 runs per variant. Every run of every variant succeeded (30 of 30).

| Variant | Median time | Mean steps | Claude per task | Jev per task |
| --- | --- | --- | --- | --- |
| Today's tools (first bench) | 20.3 s | 3.8 | $0.0225 | none |
| Jev reads the page, actions answer with the title (`brief`) | 21.4 s | 6.7 | $0.0352 | $0.0001 |
| Today's tools (second bench, alongside) | 18.2 s | 3.7 | $0.0210 | none |
| `what` and `browser_navigate` | 17.5 s | 3.2 | $0.0246 | $0.00004 |

The bot used `browser_navigate` in 4 tasks of 10 (the price, settings, help, the public article): the price took 16 s and 1 step in place of 27 s and 4, help 16 s and 1 step in place of 17 s and 3. It never named a control by `what`. In the other 6 it worked by refs, as today.

## Decision

- **One admin switch, "Jev in the browser", in the admin page's Group router section, shown with Jev only and off until switched on**, kept in the front door's `group-router.json` and handed to every account with the router's choice and the key (ADR 082). It works only while the router is Jev with its key.
- **Switched on, a bot's run gets two things more** (`BROWSER_PICKER=on` for its computer tools, as the run starts): `browser_click` and `browser_fill` take `what` in place of a ref, and `browser_navigate` takes a goal. botdot reads the page, asks Jev one choice question (the controls of that kind, each with the heading above it, as the options), and works the control; `browser_navigate` does so up to 6 times, offering Jev "this page is it" beside the controls, and answers the tree it stopped on with the way it took. Every answer is the tree, as today.
- **A pick under 0.6 acts on nothing:** the bot is told the likeliest three with their refs. A failed or late Jev (3 s) clicks nothing and says so; refs work as before. `browser_navigate` never types or submits.
- **The page goes to Jev as state and its controls as options,** never as instructions, with `data_collection: deny`, as the group router's questions do.

## Alternatives

- **Jev drives the whole task.** Not possible: it writes no address, no search and no form's text.
- **Jev reads the page for the bot (`browser_find`) and actions answer with the title alone (`brief`).** Measured worse: 6.7 steps in place of 3.8, and 57% more Claude cost, as the bot asked for the whole tree anyway. Kept in the bench only.
- **`what` alone, without `browser_navigate`.** The bot never used `what` when it could; picking a ref is not what costs it.

## Consequences

- On a machine that switches it on, a task that clicks through a few pages to one takes a step instead of one per page; other tasks are as today. Over the bench, 4% faster at the median, with the same success and about the same cost.
- Each page `browser_navigate` or a `what` reads goes to OpenRouter and TypeSafe, as a group message does with Jev.
- A wrong pick by Jev is a click on another control of the same page; the bot sees where it landed in the tree it gets back.

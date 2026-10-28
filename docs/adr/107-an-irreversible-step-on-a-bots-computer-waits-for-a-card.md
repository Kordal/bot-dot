# ADR-107: An irreversible step on a bot's computer waits for a card

- **Status:** Accepted (the owner's decisions of 2026-10-28)
- **Owning task:** [#638](https://github.com/Kordal/bot-dot/issues/638)
- **Builds on:** [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) (carry on), [ADR 010](010-a-connected-app-action-waits-in-its-run.md) (a connected-app action waits in its run), [ADR 047](047-the-chief-uses-connected-apps-in-the-owners-turns-and-every-write-waits-for-an-ok.md)
- **Leaves as it is:** [ADR 014](014-botdots-memory-is-the-only-memory-a-bot-keeps.md) (a project's `AGENTS.md` / `CLAUDE.md` is that project's text)

## Context

In OpenBot's reported failure, the owner told an agent not to change an irreversible Stripe setting; it changed it anyway, in the web interface, by reading "a request naming the action counts as approval" in its instructions as a yes. botdot compared:

| | OpenBot | botdot before | botdot now |
| --- | --- | --- | --- |
| Approval rules in a project's `AGENTS.md` | bind the agent | project text only (ADR 014) | unchanged |
| Writes in a connected app | the agent's judgement | a card in code; a no is final for the run and its carry-on (ADR 010) | unchanged |
| An irreversible click in a web page | the agent's judgement | the agent's judgement: no card, no memory of a no; taking control of the screen recorded nothing | a card in code; a no, or taking control, is final for the run and its carry-on |
| "You asked for it in chat" | counts as approval | the Chief's soft rule, in its prompt | never stands in for the card |

## Decision

- **The gate is in botdot's browser route, not in the prompt.** The bot's `browser_click`, and `browser_press` of Enter or Space, are checked against the page snapshot botdot itself last returned to that run (`lib/irreversible-steps.js`). A step is irreversible when the control is a button or menu item that does not step back (not Cancel, Close, Keep…) and its own name, or the dialog or form it stands in, says "irreversible", "cannot be undone" or "cannot be reversed". A page that only mentions those words elsewhere opens no card.
- **It waits on a card in Needs you, inside the run, for ten minutes**, as a connected-app action does (ADR 010): kind `computer-step`, with the site, the control and the page's words. Its one yes is "Allow once": this step, once, in the run that waits. There is no "Always allow", and "Allow all" leaves it to its own yes.
- **A no is final for the run and its carry-on.** The same step (site, control) is refused at once with no new card, by Enter too, and so are the screen's own clicks and keys while it is on the page: while a step of the run is declined or waits, botdot reads the page afresh before each such click or key, so leaving the page and coming back by the screen is no way round. What was declined is kept by run, so the run that carries it on (ADR 009) inherits it, also across a restart.
- **Taking control of the screen is a no.** When the owner's app opens the bot's screen with mouse and keyboard, every such card of that bot is declined, and each such step on its page counts as declined for its run.
- **A chat ask is no yes.** "Change the Stripe setting" in chat does not let the step through: the card is still asked.
- **No double gate, and no way round.** A step on the site of an app the bot has connected (a host label that is the app's name, or Google's addresses) is first refused, with no card: the bot is told to do it with `connector_run`, whose card is the one it waits on. Only if it tries the step again, because that app has no action for it, does it wait on a card here. botdot cannot tell which actions are equivalent; either way the step needs the owner's yes.
- **A card whose run stopped waiting goes.** The page it was asked on is gone with that run, so a late yes would confirm something nobody sees.
- **ADR 014 stands.** A project's `AGENTS.md` / `CLAUDE.md` neither loosens nor tightens what a bot may do. Stricter rules belong in the bot's own rules, told to the Chief.

## Alternatives

- **Document it only.** Rejected by the owner: the OpenBot case is a prompt that was read as a yes.
- **Taking control as the only gate.** Rejected: it needs the owner to be watching at that moment.
- **A list of sensitive sites, or every form submit on them.** Rejected: a list is never complete, and it cards ordinary forms.
- **The bot announcing an irreversible step itself.** Rejected: a prompt can skip it.
- **Keep a card whose run stopped, for a late yes that starts the bot again.** Rejected: the page and its dialog are gone; the owner can ask again.

## Consequences

- The words are matched in English. A page in another language, or a step with no such words, is not gated: the bot's rules and the owner's watching are what is left there.
- Only the account's computer's viewer tells botdot that the owner took control. The viewer of a machine on boat.dev ([ADR 093](093-the-owner-watches-a-boat-dev-machines-desktop-through-boat-devs-stream.md)) is boat.dev's stream, which botdot does not see: taking control there is not yet a no.
- A step reached and confirmed by screenshots and screen clicks alone, before any browser tool asked about it, is not seen: a screen position names no control. Once a step was declined or waits, the screen's clicks are checked against the page.
- Taking control is seen when the viewer is opened with mouse and keyboard: an owner who already had control when the step came up is not counted.
- A site that only looks like a connected app's by name is sent to the connector path; if that app has no such action the bot says so and leaves it to the owner.

# ADR-260: A Chief message may carry a project the server checked

- **Status:** Accepted (2026-11-23, the owner: do both the label and the name in the text, [#1587](https://github.com/Kordal/bot-dot/issues/1587))
- **Builds on:** [ADR 223](223-a-chief-message-names-the-team-it-is-about.md) (the label above a Chief message), [ADR 006](006-a-look-is-its-own-read-only-chief-session.md) (the Chief's looks)
- **Changes:** ADR 223's rejected alternative "The model names the topic itself"

## Context

In the Chief's main chat the owner could not tell which project a message was about. The check-ins the Chief writes by itself (looks, brief, wrap, hand-off) go to the chat the owner used last and carried no label, and a bot's result the Chief tells came with none either. Only a message about one team had a label (ADR 223), and only after `team_chat`.

## Decision

- **`about` may have a project and no team:** `{ project: { id, name, color } }`. The apps draw it above the message as they draw a team's label, a square and the name in the project's colour, and a tap opens the project. A team's `project` carries `color` too.
- **A check-in's project is picked by the model and checked by the server.** The model may end its answer with one line `[[project: <name or id>]]`. botdot takes the line out of the text, as it does `[[choices: …]]`, and matches it, in any case, with the name or id of one of the owner's projects (an archived one is none). A name that matches none gives no label and no error. A check-in that covers several projects has no line and no label. ADR 223 refused a topic the model names because the server could not check it; a project can be checked against the owner's real projects, so the model's pick is only ever a choice among them.
- **A bot's result told to the Chief is labelled by the server alone:** when the bot is in exactly one project (its team's bots, or the project's own bots), the Chief's reply about it, and the bot's message that stands in for it, have that project. A bot in no project or in several has none. A turn that then writes to a team gets that team's label instead (ADR 223).
- **Never in the project's own Chief chat,** whose header names it already (the rule of ADR 223).
- **The text names the project too.** Each kind of check-in is told that a line about one project starts with its name ("Qwotz: Google Play closes tomorrow"), and a brief or wrap names the project on each line, so a message with no label (several projects) still says which it means. The model is given the names of the owner's projects.
- Announced in `features` as `about-project`.

## Alternatives

- **The server labels check-ins by the project of what the look read:** a look reads everything at once, so the server cannot tell which project its message is about.
- **A label from the project's name found in the text:** matches a name inside another sentence, or a project named like a common word.
- **Labels on the owner's own turns:** out of scope; no way yet to tell which project a free message is about.

## Consequences

- A project renamed or recoloured later keeps its old name on messages already written.
- A look that names a project wrongly but exactly as one of the owner's gets a wrong label; the text it comes with is the model's as before.
- Android draws the label with this change; iOS has it noted on its catch-up issue ([#1355](https://github.com/Kordal/bot-dot/issues/1355)).

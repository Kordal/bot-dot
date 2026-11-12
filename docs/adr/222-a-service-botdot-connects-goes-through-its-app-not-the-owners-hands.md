# ADR-223: A service botdot connects goes through its app, not the owner's hands

- **Status:** Accepted (2026-11-12, the owner: "We started setting up Brevo, and the bot didn't know we have a connector for it")
- **Amends:** [ADR 168](168-a-missing-app-is-one-connect-card-and-connecting-it-carries-the-work-on.md) (when the Chief and a bot ask for an app)

## Context

The Chief was told to check `list_connectors` and to offer a Connect card "when an app isn't connected", and a bot had `ask_chief_for_app` "for a connected app your work needs", with Google apps, Slack, GitHub and Notion as the examples. Both read as rules for apps a task already names as apps. Asked to set up a Brevo waitlist, a team wrote the owner fifteen minutes of steps in Brevo's own pages and asked them to paste back the form's code, and the Project Manager passed that on. Brevo is in Composio's catalogue: one Connect card would have let the bot do it. Nothing told either of them that any online service may be one botdot connects, so nobody looked.

## Decision

- **Look the service up before steps by hand.** Before the Chief gives the owner steps to do in an online service, or asks them to copy something out of it, it searches `list_connectors`. When botdot connects it, the work goes through the app: the Chief uses it or gives it to the bot doing the work when it is connected, else it calls `offer_connect_app` for that bot instead of writing the steps. This holds for a bot's or a team's answer the Chief passes on.
- **A bot asks for it.** Every bot's run, where apps are set up, says that botdot connects about 1,500 services and that it asks with `ask_chief_for_app` before giving the owner steps by hand in one. The tool says the same. An app Composio doesn't know answers "No app called …" and tells the bot to do the work another way.
- **Steps by hand stay** for what the app can't do and for a service botdot doesn't connect.

## Alternatives

- **List the catalogue in every prompt.** Rejected: about 1,500 names, most never used, in every run.
- **Spot service names in the owner's message on the server.** Rejected for now: many app names are plain words ("Close", "Box", "Linear"), so it would offer cards nobody asked for; the search the Chief already has is exact.

## Consequences

- The owner gets a Connect card where they got a list of steps, and the bot does the setup once it is connected.
- Prompt and tool-text change only: no API, no app change.

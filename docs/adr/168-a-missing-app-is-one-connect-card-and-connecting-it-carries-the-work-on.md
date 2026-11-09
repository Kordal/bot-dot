# ADR-168: A missing app is one Connect card, and connecting it carries the work on

- **Status:** Accepted (2026-11-07, the owner's decisions on the plan of #1182)
- **Owning task:** [#1182](https://github.com/Kordal/bot-dot/issues/1182)
- **Changes:** [ADR 047](047-the-chief-uses-connected-apps-in-the-owners-turns-and-every-write-waits-for-an-ok.md) ("No token, no tools": one more turn botdot starts is given connected apps, the Chief's turn after its Connect card in its chat is connected), and the rule of `lib/connected-apps.js` that only the Chief gives a bot an app (the owner's press on a card that names the bot gives it now)
- **Amends:** [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) (a connection that becomes ACTIVE is a yes: what waited for the card carries on by the same rules), [#431](https://github.com/Kordal/bot-dot/issues/431) (the Reconnect card under a job's reply stays for the apps from before; a Connect card of the same app takes its place in the new ones)
- **Keeps:** [ADR 054](054-a-permission-card-comes-only-from-the-bots-ask.md) (a permission card still comes only from the bot's ask; it leaves connected apps as they were), [ADR 166](166-a-run-that-carries-on-goes-on-in-the-stopped-runs-session.md) (the run that carries on resumes the stopped run's session, with the connected apps of the bot as it is now)

## Context

A bot or the Chief that needs a connected app that is not connected can only say so in a sentence. `ask_chief_for_app` starts a Chief turn that has no connected apps (ADR 047) and that tells the owner in one line to connect the app on the Connectors page. A bot whose app is signed out gets a Reconnect card only in a job's scheduled run, once a day (#431). Nothing comes back to the work: after the owner connected the app, the bot and the Chief are not told, and the owner starts the work again by hand.

The pieces are there: a card that waits in Needs you and carries the run on after a yes (ADR 009, ADR 166), Connect on the Connectors page (`POST /api/connectors/connect`, Composio's sign-in page), and the connection's status (`GET /api/connectors/connections/:id`).

## Decision

- **A missing app is one card, kind `connect-app`.** One per bot (or the Chief) and app: a run that needs it while it waits joins it (`runs`). It is no batch's: its yes is a sign-in, which "Allow all" never gives. Its title and buttons only: "Connect Gmail for Writer", "Connect Gmail" for the Chief, "Reconnect Gmail"; and, when there is nothing to sign in to yet, "Add your Composio key" or "Set up GitHub in Composio" with Composio's words.
- **The card's button says what it does by a verb, `act`** (`connect`, `open` a screen of the app), not by the kind's name, so the next card of this sort needs no new app.
- **Its yes is the sign-in on its card, never a bare yes.** Connect opens the app's sign-in page through `POST /api/asks/:id/connect`; the card keeps the connection Composio makes and until when, never the page's address, which expires. `POST /api/asks/:id` with a yes is refused for it. Only the owner connects: the Chief's key and a bot's run are refused.
- **ACTIVE settles it.** Once Composio says that connection is ACTIVE (asked by the app as the owner comes back, and by botdot itself), the card goes, the bot gets the app, and what waited for the card carries on as after any yes (ADR 009, ADR 166). The owner's press on a card that names the bot is the owner's yes to giving it the app: the bot's history keeps it as the owner's change.
- **Not now holds the next card for that bot and app for a day**, not a week as for a permission: the app is the owner's, and work that needs it comes back sooner.
- **An app that is connected already and that the bot lacks is a changed bot's card** (`bot-change` with `asked: 'app'`), as a setting the bot asks for with `ask_permission` is: every app draws it, also one from before this record.
- **One Chief turn botdot starts is given connected apps:** the turn that follows its own Connect card in its chat, once that app is connected, under the same checks as a late yes's turn (ADR 047: the owner did not write in that chat since). Every write in it still waits on its card (ADR 010).
- **botdot makes the card where it knows the cause**, never the bot by naming a card: a bot's `ask_chief_for_app` and its `connector_run` on an app that is signed out, and the Chief's offer in its chat. Not in a replay, a look, a shared room or a run that only remembers.

## Alternatives

- **Widen the Reconnect card under a reply** (#431). It has no Needs you and no notification, does not draw in the Chief's chat, and goes with a reload. The work does not come back.
- **A general "ask the owner" tool.** A bot would name its own cards; ADR 054 decided that a card comes from a cause botdot knows.
- **Wait for the connection inside the run.** A run would hold its Claude session for up to the sign-in's minutes. A new run that resumes the session (ADR 166) loses nothing, and waiting can come later for a reconnect.
- **A second card to give the app after it is connected.** Two presses for one decision the card already named.

## Consequences

- An app from before this record does not list the card (`GET /api/asks` lists it only with `connect-app=1`); its notification shows the server's line and Decline, which is Not now. The owner can still connect the app on Connectors.
- A server from before this record would take `POST /api/asks/:id/connect` for a no: the apps check `features` for `connect-cards` first.
- The rule "only the Chief gives a bot an app" no longer holds: the owner gives it on a card, without a Chief turn.
- A bot gets an app without the changed bot's card that a Chief's `update_bot` with that app waits for. It is the owner's own press, kept in the bot's history.

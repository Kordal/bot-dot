# ADR-241: A managed machine's owner asks for deletion in the app

- **Status:** Accepted (2026-11-13, the operator chose "B: console, your passkey")
- **Owning task:** [#1313](https://github.com/Kordal/bot-dot/issues/1313)
- **Amends:** #1312 (Settings opened botdot.app's page, and deletion was asked by email)

## Context

On a managed machine (ADR 154) the account is the machine, which the fleet console runs. Settings' "Delete account" opened a page of botdot.app that asked the owner to send an email. The app stores ask that deletion can be started in the app, and a paying owner stays billed until someone cancels the subscription by hand.

## Decision

- **Settings asks the console.** On a managed machine the session says `deleteAccount: true` and `deletionRequest: true` (and `deleteAccountPage: null`). The owner types the account's name, as with #1307, and `POST /front-door/delete-account` takes the request instead of deleting.
- **Through the Feedback outbox (ADR 164).** The request is a file of the outbox, `feedback-<id>.json` with `kind: "deletion"`, so a console's agent of any version brings it to `POST /agent/feedback`. The console handles that kind as a deletion request, not as a report.
- **The account is suspended at once.** It is marked `deleting`, every session ends, its server stops, and signing in shows "Your account is being deleted". Asking twice answers `409`. A resume by the console (`front-door.js resume --by console`) drops the request.
- **The console cancels the subscription and the operator erases the machine.** The console cancels the customer's Stripe subscription at once (ADR 0008 in botdot-hosting) and shows the request. Deleting the machine stays the operator's, behind a passkey.

## Alternatives

- **The front door erases the account itself.** Rejected: on a managed machine that leaves the VPS, its backups and the subscription with nobody who knows.
- **A new agent route for the request.** Rejected for now: every machine's agent would have to be updated before any request could arrive.
- **Keep the email.** Rejected: the stores ask for deletion in the app.

## Consequences

- An older app sees `deleteAccount: true` and shows its usual confirmation. Its toast says "deleted" while the account is being deleted.
- A console older than this request refuses the kind with `400`, and the agent sets the file aside. Update the console before the machines.

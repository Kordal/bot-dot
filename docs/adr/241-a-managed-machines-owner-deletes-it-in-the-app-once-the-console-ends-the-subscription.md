# ADR-241: A managed machine's owner deletes it in the app, once the fleet console has ended the subscription

- **Status:** Accepted (2026-11-13, the owner: "go" on [#1313](https://github.com/Kordal/bot-dot/issues/1313) with the subscription cancelled on deletion)
- **Builds on:** [ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md) (a managed machine, run by the fleet console), [ADR 164](164-a-managed-machines-feedback-goes-to-the-fleet-console-through-an-outbox.md) (the outbox the console's agent empties), [#1307](https://github.com/Kordal/bot-dot/issues/1307) (Settings → Delete account), botdot-hosting ADR 0008 (a customer with no machine left is no longer billed)
- **Replaces:** [#1312](https://github.com/Kordal/bot-dot/issues/1312) (a managed machine's "Delete account" opened a page of botdot.app)

## Context

Google Play's account deletion policy and Apple's guideline 5.1.1(v) ask that an account can be deleted from inside the app. #1307 built that for a self-hosted machine of several accounts; #1312 only sent a managed machine's owner to a page of botdot.app. On a managed machine the account is what the customer pays for, and only the fleet console holds the Stripe key: deleting the account while the subscription goes on billing would charge a customer for nothing, and ending the subscription is not something the machine can do itself. The console reaches a machine only through its agent, and the machine has no network API for it (ADR 154).

## Decision

- **Every account of a managed machine has "Delete account".** `deleteAccount` is `true` for each. Another account of a machine of several (one the payer invited) is deleted at once, as on a self-hosted machine (#1307): it pays for nothing.
- **The account that pays goes only once the subscription has ended.** That is the machine's one account, or the first of several (made with the setup key; `deleteEndsSubscription` in the session). After its name is typed, `POST /front-door/delete-account` erases nothing: it writes `delete-<account>.json` to the outbox (`{ account, accounts, requested }`, hidden name then renamed, mode 600) and answers `202 { ok, pending: true }`. The session says `deletion: "pending"`.
- **The agent asks the console, and writes the answer beside the request.** The agent sends the file to the console, which cancels the customer's subscription in Stripe at once (no refund, as ADR 0008) or finds none, and answers. The agent writes `delete-<account>.answer.json`, `{ "state": "canceled" | "none" | "failed" }`, then removes the request. While the console can't be reached the request waits, and the app keeps saying "Deleting…".
- **The front door acts on the answer, and on nothing else.** Every 3 seconds, and when a session asks, it reads the answers it finds, never through a link and only for the account that pays. `canceled` or `none`: the machine is marked deleted first (`machine-deleted.json` beside its data), then every account of it is erased through the same path as the admin's delete (`eraseAccount`: boat.dev, the front door forgets it, root's step erases it and forgets its off-site snapshots after 14 days); the audit entry says the subscription was cancelled or that there was none. `failed`: nothing is erased, the answer stays, and the session says `deletion: "failed"` until the owner asks again, which removes it first.
- **A deleted machine answers only that it is deleted.** Every page is the "Your account is deleted" page (`410`), every other request `401` with `signIn` and `deleted` (an ended session: the apps leave for their sign-in, which says so), sign-in and the setup key included; the front door's own `/api/version` still answers, for the installer. It stays so after a restart, until whoever runs the fleet removes the machine. Nothing here calls a hosting provider: the console shows the machine as awaiting teardown, and its operator deletes it.
- **Root's step erases the first account of a managed machine.** `FRONT_DOOR_ADMIN` names it there, though it is no admin; `erase_account` no longer refuses it on a managed machine.
- **The apps.** Settings shows "Delete account…" for every account of a managed machine. The confirmation adds "Your subscription is cancelled first." for the account that pays, and names the machine's other accounts that go with it. After Delete the form says "Deleting…" and asks the session every 3 seconds: an ended session opens the deleted page (web) or the sign-in screen (Android), and a failure says that the subscription couldn't be cancelled, so nothing was deleted, with Delete working again. `deleteAccountPage` is gone from the session.

## Alternatives

- **Erase first, cancel later from a tick** (as the console's Delete does). A Stripe outage would leave a customer billed for a machine that no longer holds their data, and the issue asks that a Stripe failure erases nothing.
- **The console runs the erase with a signed command.** The console's erase-like commands need the operator's passkey; here the owner's own confirmation is the authority, and the front door already has the erase path. The console only says whether billing ended.
- **A route on the console the front door calls.** The machine would need the console's address and a credential of its own: a second channel beside the agent. Rejected by ADR 154.
- **Deleting only the payer's account and keeping the others.** The subscription that pays for the machine ends with it, so the others would be left on a machine nobody pays for, then removed by the operator without their data ever being erased in order.

## Consequences

- The deletion needs a console and an agent that know the request (botdot-hosting ADR 0009). With an older agent the request waits, and the owner sees "Deleting…" until the agent is updated.
- Off-site snapshots are forgotten 14 days after the erase by the machine's own nightly run: the operator should keep the machine, or its off-site set, until then, or remove the set by hand when tearing it down.
- An owner who closes the app while it waits finds "Deleting…" in Settings, or the deleted page once it is done.

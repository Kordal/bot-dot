# ADR-164: A managed machine's Feedback goes to the fleet console through an outbox

- **Status:** Accepted (by the owner, 2026-11-05). Amends [ADR 048](048-the-admin-page-shows-the-feedback-an-owner-sends-the-admin.md) (Feedback goes to the admin page of the owner's machine) and [ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md) (what the console's agent reads).
- **Owning task:** [#1042](https://github.com/Kordal/bot-dot/issues/1042)

## Context

Feedback (ADR 048) goes to the admin page of the owner's machine. A managed machine has no admin page: the fleet console is its admin (ADR 154). So its front door says `feedback: false` and an owner there, a paying customer, has no way to report a bug or ask for a feature. The console reaches a machine only through its agent, which connects out and reads only files root's step and the front door write in fixed places.

## Decision

- **A managed machine has Feedback.** `GET /front-door/session` says `feedback` and `feedbackScreenshots` `true` there, with one account or several. The form, its limits and `POST /front-door/feedback` stay as ADR 048 has them.
- **Each report is also written to an outbox.** The front door keeps the report as on any machine and writes it whole to one file of its own, `outbox/feedback-<id>.json` beside its data (`FRONT_DOOR_DATA`), screenshots as base64: `{ id, account, created, kind, text, app, version, screenshots: [{ type, data }] }`. The file is written under a hidden name and renamed (folder 700, file 600). A report whose file can't be written isn't kept either, and the owner is told to try again: one the owner was told went is never missing from the console.
- **The agent sends it on.** The fleet console's agent reads only `feedback-<id>.json` files of that folder, sends each to the console, and removes it once the console has it; the same id sent twice is one report there. It reads nothing else of the front door's data. The console lists the reports of every machine for its operator.
- **A bound on waiting reports.** While 100 reports wait in the outbox (the console has been away a long time), a new one is refused with `503` and "Feedback can't be sent right now. Try again later.", so the disk never fills with them.
- No Chief, bot or botdot server sends, reads or changes a report, as in ADR 048.

## Alternatives

- **The agent reads the front door's data (`front-door.json`).** No new file. Rejected: that file holds passkeys, sessions and links; the agent should read only what is written for it.
- **A folder of its own, mounted into the front door's container.** Rejected for now: a change to the install and its compose file for one folder the front door can make itself inside its data.
- **Reports in the heartbeat.** Rejected: the heartbeat's files are at most 16 KB, and a report with screenshots is up to about 20 MB.
- **A reply to the owner from the console.** Left for later: it is a way back into the account and needs a decision of its own.

## Consequences

- Owners on a managed machine see Feedback beside Settings, as on any machine with an admin.
- The front door's data folder holds `outbox/` on a managed machine. A backup of the folder carries the reports that still wait; sent again after a restore, they are the same reports on the console.
- A report that waits when its account is erased is still sent; the console's operator deletes it there.
- A managed machine whose agent doesn't send the outbox yet keeps its reports waiting, up to 100.

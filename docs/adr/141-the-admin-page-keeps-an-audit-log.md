# ADR-141: The admin page keeps an audit log

- **Status:** Accepted (2026-11-03)
- **Owning task:** [#911](https://github.com/Kordal/bot-dot/issues/911), part of [#909](https://github.com/Kordal/bot-dot/issues/909)
- **Changes:** [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md) (what the front door keeps)

## Context

A machine open to many accounts needs an answer to "who did what, and when" on its admin page: which account was suspended or deleted and by whom, when a share or a key changed, when someone kept failing to sign in. Until now the front door wrote these as lines of its journal ("the admin suspended the account bob"), which Docker rotates, the admin page never shows, and which can't be filtered.

## Decision

- **The front door keeps an audit log** of every action the admin takes on the admin page (a sign-up link made or revoked, the update asked and its deadline, shared rooms on or off, the decision model, replays, the boat.dev key set or removed, the default share, an account's share, suspend, resume, delete, a sign-in link, Update now) and of its own security events: an account made from a sign-up link, a passkey added from the admin's sign-in link, and a client that starts to be slowed down after failed sign-ins, sign-up links or calls (`lib/front-door/limits.js`). Each is written where its journal line is, after the action succeeded: an action that fails writes nothing.
- **An entry is `{ at, actor, action, account?, detail? }`.** `actor` is the admin's account or `front-door`. `detail` is a few words the front door writes itself from what it knows (a share, a deadline, on or off, a client's address), never what a request sent: no key, session, link, link hash or passkey is ever in it. `at` is later than the entry before, by a millisecond if need be, so paging by `at` loses none.
- **Append-only, in `audit.jsonl`** beside `front-door.json`, mode 600, one line of JSON an entry. Entries are never changed; the front door drops those older than **13 months** on start and every six hours, the same time as the usage counts (ADR 105), long enough to compare a month with the same month a year before. A deleted account's entries stay: the log is how the admin knows it was deleted.
- **`GET /admin/audit`**, the admin's session alone, newest first, with `account`, `action` and `before` (an entry's `at`) for paging; it hands the actions it knows and the accounts its entries name, so the page and a script build their filters from it.
- **A group of its own on the admin page,** "Audit log": the entries in words, two selects (account, action) and Older.
- Not on a machine of one account, which has no admin page.

## Alternatives

- **Read the front door's journal.** Rejected: Docker rotates it, it mixes in every other line, and its lines carry a link's id prefix the log has no need for.
- **Keep it in `front-door.json`.** Rejected: that file is rewritten whole on every change and read again by other processes; an audit log grows and should only be appended to.
- **Log what the owners do inside their accounts.** Rejected: the admin page never shows what is inside an account (ADR 028); the log is the front door's own doing and the admin's.

## Consequences

- The admin sees who did what on the machine, filtered by account or action, for 13 months.
- A failed sign-in streak is one entry, when the client starts to wait, not one per try: a flood of guesses can't fill the log.
- The journal lines stay as they were; the log is beside them.

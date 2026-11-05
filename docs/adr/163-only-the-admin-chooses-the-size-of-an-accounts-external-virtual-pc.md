# ADR-163: Only the admin chooses the size of an account's External Virtual PC

- **Status:** Accepted (2026-11-05, the owner's decision: "for boat.dev only admin should have the ability to assign the size of the VM. remove this from user setting and put it to /admin")
- **Amends:** [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md) and the decision of 2026-10-24 ([the size is the account's](../decisions/2026-10-24-the-size-of-boat-dev-machines-is-the.md)), where the owner chose it in Settings
- **Builds on:** [ADR 146](146-only-the-admin-moves-an-accounts-computer.md) (only the admin moves an account's computer)

## Context

Since #539 the size of an account's boat.dev machines (small, default, large, xlarge) is the account's, and its owner chose it in Settings → Computer, on the web page and in the Android app. boat.dev runs on the admin's key and the admin pays for it, so a bigger machine is the admin's call, as where the computer is has been since ADR 146.

## Decision

The admin chooses the size, per account, on the admin page. While an account's computer is its External Virtual PC, its row says the size beside the place ("External Virtual PC Large"), and "Change size" opens a pick of the sizes boat.dev makes now, each with its CPUs and memory, never a price. `POST /admin/accounts/<name>/boat-size` `{ size }` asks the account's botdot server with the front door's own header (`x-botdot-room: 1`), and keeps an audit entry `boat-size`.

The account keeps the size, as before, and a machine takes a new one when it starts next. `PUT /api/settings/boat-size` is the front door's alone: the owner and the Chief get `403`, and `PUT /api/settings` still ignores `boatSize`. `GET` stays the owner's, and `features` says `boat-size-admin`, so the apps show no picker: Settings → Computer is one row, "External Virtual PC · Large", shown only while the computer is there.

`GET /admin/accounts` asks an account for its size only while its computer is the External Virtual PC, the second thing the list reads from inside an account, and the admin's choice too.

## Alternatives

- **The front door keeps each account's size.** Two copies of one setting, and the account would have to be handed it every minute as the boat.dev key is. The account already keeps it and makes machines at it.
- **The admin sets one size for every account.** One setting for the machine, but accounts differ: one renders video, another reads mail.
- **A size the admin may set while the computer is on this machine.** Nothing uses it there; the pick appears when the computer moves to the External Virtual PC.

## Consequences

- An owner who wants a bigger External Virtual PC asks the admin. The Chief cannot change it either; it can still read it.
- Sizes chosen before stay as they are: nothing moves, nothing is migrated.
- An older Android app still shows the picker; a change there gets the server's `403` with "the admin chooses the size of the account's External Virtual PC, on the admin page".

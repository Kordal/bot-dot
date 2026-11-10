# ADR-183: A machine of one account updates itself at night

- **Status:** Accepted (2026-11-10, the owner's go on "less heavy, less minding the bots")
- **Changes:** ADR 136 (botdot on the owner's computer): it no longer waits for the menu's "Update botdot on this Mac"
- **Keeps:** the admin page's Update and each account's "Update automatically" on a machine of several accounts (ADR 053); root's step does every update (#473)

## Context

botdot on the owner's own computer (a Lima VM, WSL2 or Linux) and a server of one owner have no admin page. Root's step finds the newest signed release once an hour (`status/latest.json`, #193), but only the desktop menu's "Update botdot on this Mac" asked for it. Owners ran old versions until they remembered, and felt they had to mind botdot.

## Decision

- **Who.** A front door of one account (`FRONT_DOOR_ONE_ACCOUNT`) with root's step (`FRONT_DOOR_REQUESTS`). Not a machine of several accounts: its admin chooses when, as before.
- **When.** At 04:00–04:59 in the owner's time zone (their quiet hours' `timeZone`, the machine's when the account does not answer), after the nightly backup.
- **What.** Only when root's step found a newer signed release than the one installed, and not for images built on the machine. The front door writes the same empty `UPDATE` request as the admin page's Update: root's step updates to the newest.
- **Once a night.** The front door keeps its last ask (`night-update.json` in its data) and asks at most once in 20 hours, so a failed update is tried again the next night, not every minute.
- The desktop menu's "Update botdot on this Mac" stays, for now.

## Alternatives

- **A setting to turn it off.** Not now: a machine of one account has no admin page to hold it. An owner who wants to pin a version builds images on the machine, which are never updated.
- **The desktop app asks.** Rejected: the app may be closed at night, and a server of one owner has no app.

## Consequences

- botdot on the owner's computer follows releases within a day, without them.
- The update restarts botdot at night; runs it cuts off carry on (ADR 140), and Bitwarden stays unlocked (ADR 181).
- A computer asleep at 04:00 updates the next night it is awake then, or by the menu.

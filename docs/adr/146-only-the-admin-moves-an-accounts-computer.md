# ADR-146: Only the admin moves an account's computer

- **Status:** Accepted (2026-11-04, the owner's decision: "Only Admin should be able to change from local to boat.dev for each user")
- **Amends:** [ADR 098](098-the-accounts-computer-is-in-one-place-for-all-its-bots.md), where the owner chose it in Settings

## Context

Since ADR 098 an account's computer is in one place for all its bots: this machine (`linux`) or its External Virtual PC on boat.dev (`boat`), and the owner switched it in Settings, on the web page and in the Android app. boat.dev runs on the admin's key and the admin pays for it, so which accounts work there is the admin's call, not each owner's.

## Decision

The admin moves an account's computer, per account, on the admin page: the account's row says where it is while boat.dev has a key, and "Move to External Virtual PC" or "Move to this machine" asks whether its bots' files go along ("Copy files", "Start empty"). `POST /admin/accounts/<name>/computer` `{ place, moveFiles? }` asks the account's botdot server with the front door's own header (`x-botdot-room: 1`, which it strips from every request a person sends), and keeps an audit entry `computer`.

The account keeps the place, as before. `PUT /api/settings/computer` is the front door's alone: the owner and the Chief get `403`. `GET` stays the owner's, and `features` says `computer-place-admin`, so the apps show no switch: Settings → Computer shows where it is, and opens only while it is the External Virtual PC, for its size.

`GET /admin/accounts` asks each running account where its computer is while boat.dev has a key. That is the one thing the list reads from inside an account: where the account's computer is, which the admin chooses, and nothing the owner made.

## Alternatives

- **The front door keeps the place and hands it to each account every minute,** as it does the boat.dev key. Two copies of one setting: an account that moved its bots before (ADR 098's upgrade, which settles the place by itself) would disagree with the front door until someone looked.
- **The owner keeps the switch and the admin only allows or forbids boat.dev per account.** Two settings for one choice, and the owner's still costs the admin.

## Consequences

- An owner who wants the External Virtual PC asks the admin. The Chief cannot move it either.
- An older Android app still shows the switch; a change there gets the server's `403` with "the admin chooses where the account's computer is, on the admin page".
- A one-account machine has no admin page and no boat.dev key (`FRONT_DOOR_ONE_ACCOUNT`), so its computer stays on this machine, as before.

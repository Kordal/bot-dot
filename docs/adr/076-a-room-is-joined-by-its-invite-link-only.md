# ADR-076: A room is joined by its invite link only

- **Status:** Accepted (by the owner, 2026-10-23)
- **Owning task:** [#437](https://github.com/Kordal/bot-dot/issues/437)
- **Changes:** [ADR 068](068-a-room-invites-with-a-link-its-maker-shares.md) ("Other members still invite by name"), and with it [ADR 060](060-a-shared-room-lets-bots-of-several-accounts-talk-through-the-front-door.md) ("Who joins")

## Context

ADR 068 added the invite link beside inviting an account by its name. The "New room" dialog still asked for an account name, and a room's settings still had the "Account name to invite" field. The owner, looking at that dialog, asked to remove the field: a room is joined by its link only. Two ways in made the dialog longer and asked the maker to know another account's name, which a link exists to avoid.

## Decision

- **The apps no longer invite by name.** The web page and the Android app drop the name field from "New room" and from a room's settings.
- **A new room comes with its link.** "New room" asks for the name only; the app makes the room, makes its invite link and opens the room's settings on it, to copy (web) or share (Android). A link that could not be made leaves "Make an invite link" there.
- **The link stays the maker's** (ADR 068): only the maker makes, sees, replaces and takes it back. A member who wants someone in asks the maker.
- **Invitations by name already made keep working.** They are still listed in the room's settings, and the invited account still accepts or declines them; joining by the link takes one, as before.
- **The front door keeps `POST /front-door/rooms/:id/invite`** for apps not updated yet, so an older Android app's Invite still works rather than failing. No app of this version calls it; it can go once no older app is in use.

## Alternatives

- **Every member shares the link.** It would give members a way to invite again, but ADR 068 kept one owner for taking a leaked link back; that reason stands.
- **The front door refuses invitations by name now.** Cleaner, but an older app's Invite would fail with an error for no gain to the person using it.

## Consequences

- A room has one way in that its maker controls; a member who is not the maker cannot bring anyone in.
- The "New room" dialog is one field.

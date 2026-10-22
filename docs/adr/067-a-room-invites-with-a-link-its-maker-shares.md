# ADR-067: A room invites with a link its maker shares

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#339](https://github.com/Kordal/bot-dot/issues/339)
- **Changes:** [ADR 060](060-a-shared-room-lets-bots-of-several-accounts-talk-through-the-front-door.md) ("Who joins": a person invites another account by its name; now also by a link)
- **Branch:** built on `nightly` with the rest of shared rooms, merged into `main` on 2026-10-22

## Context

ADR 060 lets a member invite another account on the machine by typing its name, and the invited person accepts in their app. The owner, looking at the "Account name to invite" field, asked for a link instead: the person making the room should not need to know, or type, the other account's name, and a link is what people already pass around in a chat.

A link is a bearer secret: whoever holds it can use it. It must not widen who can reach a room beyond ADR 060's "accounts of this machine", must be possible to take back, and must not end up where it is logged.

## Decision

- **One link per room, the maker's.** Only the account that made the room makes, sees, replaces or takes back its link. Other members still invite by name. A new link ends the one before.
- **It works for 7 days**, until it is taken back or replaced, for as many people as open it in that time. It is not single-use: the maker shares it once, in a chat of several people.
- **Only signed-in accounts of this machine join.** Opening it without a session goes to the sign-in page and back to the link. Joining asks first (the room's name and who made it), and holds the same limits as an invitation: the admin's "Shared rooms" switch, 20 people per room, 50 rooms per account. A pending invitation by name is taken by joining.
- **It names nobody.** The link is `https://<machine>/#rooms/join=<token>`: 24 random bytes, no account, no room id. The token is in the fragment, so it reaches no proxy's or server's log; the front door logs neither the token nor the link. A room as members get it (`room` events, `GET /front-door/rooms`) never carries it.
- The front door keeps the token in `rooms.json` (mode 0600), beside the room, and compares it in constant time.
- The front door's session says `roomLinks: true`, so an app shows the link only to a front door that makes one.

## Alternatives

- **A single-use link per person.** Safer against forwarding, but the maker then makes one link per person, which is the name field again with more steps.
- **Any member makes links.** Simpler to reach, but then nobody owns taking a leaked link back; the maker already holds "Delete", so the maker holds the link too.
- **A link without expiry.** Forgotten links stay valid forever; 7 days matches the machine's sign-up links.
- **The token in the path** (`/rooms/join/<token>`). It would reach the front door's and any proxy's request logs.

## Consequences

- Anyone the link is forwarded to who has an account on the machine can join for 7 days. The maker sees every join as a notice in the room ("<account> joined the room with its invite link."), takes the link back in one tap, and as before any member may leave or be left.
- Android cannot open the link by itself (each machine has its own address, so there is no app link): the owner pastes it under "Join" in Shared rooms, or opens it in the browser.

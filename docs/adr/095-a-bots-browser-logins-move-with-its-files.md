# ADR-095: A bot's browser logins move with its files

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#565](https://github.com/Kordal/bot-dot/issues/565)
- **Amends:** [ADR 091](091-a-bots-files-are-copied-when-its-computer-moves.md)

## Context

ADR 091 left a bot's browser logins on the account's computer when its computer moved, because a boat.dev machine had no browser. Since ADR 094 it has one: the same Camoufox and bridge, with the bot's profile in `/home/browser/profiles/<bot>`, as on the account's computer. A bot moved with "Copy files" still started signed out.

## Decision

- **The profile is the second part of the copy.** After its folder, `lib/computer-move.js` copies the bot's Camoufox profile the same way: packed on the old side, through botdot in pieces, unpacked on the new side (`part: 'profile'` on each side's `moveFiles`). Both parts are packed first, so the bytes shown only grow, and unpacked once both arrived, so a part that fails on the way leaves the new side as it was; they count together toward the 2 GB.
- **It replaces the new side's whole.** Two Firefox profiles can't be merged file by file: the one taken in is unpacked beside the old one and put in its place. A side without a profile hands out nothing, and the new side keeps its own.
- **The browser closed on both sides.** The bot's Camoufox is ended before the old side packs and before the new side unpacks; its bridge stays and opens it again on the next browser tool. The bot's computer tools already answer that a copy runs.
- **Without its caches.** `cache2`, `startupCache`, thumbnails, the shader cache, Safe Browsing lists, crash reports, telemetry, temporary storage and the locks of a browser that ran (`PROFILE_LEFT_OUT`).
- **On the account's computer as the browser user.** Its tar is in that user's home, which a bot's commands (box) can't reach, and what it unpacks is owned by it. A profile from boat.dev that holds a link or a device is refused: the bot is root on its machine and could have put one there to reach another bot's profile.
- **On boat.dev through sudo.** The browser user is made as the screen kit makes it when the kit isn't there yet, so a profile can arrive before the bot's first screen tool.

## Alternatives

- **Profile files merged like the folder.** Rejected: a newer `cookies.sqlite` beside an older `key4.db` or session store gives a profile Firefox may refuse or reset.
- **Only cookies.** Rejected: sites keep sign-ins in local storage and IndexedDB too.

## Consequences

- "Start empty" leaves both profiles where they are.
- A bot's large profile makes the copy longer; caches, its largest part, stay behind.
- Not yet checked on a real boat.dev machine.

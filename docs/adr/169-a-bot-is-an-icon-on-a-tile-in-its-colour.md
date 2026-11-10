# ADR-169: A bot is an icon on a tile in its colour

- **Status:** Accepted (2026-11-09, the owner picked direction B of six mockups)
- **Owning task:** the owner's request to make the bots' avatars look professional
- **Amends:** [ADR 003](003-one-figure-definition-for-all-apps.md) (what apps that know the tile draw; the head stays in the definition for apps from before), [ADR 004](004-pieces-as-restricted-shape-lists.md) (an outfit has an icon beside its hat; an icon is always a kit name), [Milestone 1](../product/milestone1.md) (a bot is no longer shown as a head with a hat, and its state is no longer its face)

## Context

Every bot is a head in its colour with two eyes and a hat, and its face shows its state (ADR 003, Milestone 1). The owner finds this not professional enough: next to the rest of the page it reads as a toy, and at 16 to 20 pixels the eyes and the hat merge into a blot. Six directions were drawn on the real page, wide and on a phone: a monogram, an icon on a solid tile, an icon on a tinted tile, an orb, a calmer head and a generated pattern. The owner picked the icon on a solid tile.

## Decision

- **A bot is a rounded square in its colour with a white line icon on it.** The icon says what the bot does (a newspaper, a server, a fork and knife). The colour is the bot's own, mixed a quarter of the way towards a warm dark grey, so the eight colours sit calmly on the page and a white icon reads on each of them at 3 to 1 or better (`test/figure.test.js` checks every colour).
- **The state is a sign beside the icon, not a face.** A working bot shows nothing more on its tile (2026-11-10: the turning ring drew the eye from every working bot at once, so `lib/figure.json` gives `working` no ring; a definition may still give a state `{ ring }`); one that needs the owner, that failed or that waits has a dot on the tile's corner, cut out of what is behind it; a paused one is faded (the state's own `opacity`). An idle bot shows nothing more. The line under a bot's name keeps saying the state in words.
- **The tile is data in the one definition, `tile` in `lib/figure.json`,** as the head is (ADR 003): the rounded square, how the colour is muted, where the icon sits, the ring, the dot, the colour of each state's sign and the small mark's view. The icons are a kit beside the hats, `kit.icon`: 81 drawings in a 24 by 24 box, each a list of ADR 004's shapes in one ink and one line width, with what it stands for. The web page and Android each draw the tile from it; a tile a renderer can't draw whole is refused with the definition, as a face is.
- **A change of state moves once, then the tile holds still.** The ring fades in (0.26 s) and out (0.2 s); a dot grows in with a slight settle and leaves quickly; a bot that needs the owner or failed sends one thin pulse from its dot (0.9 s); a paused tile fades to its opacity (0.2 s); when a run ends well (`working` to `idle`) the icon gives way to a check drawn once, under a second, and comes back. A pressed tile shrinks to 94%. Under reduced motion what comes or goes only fades (0.12 s), the check shows without being drawn and nothing pulses. Only changes the app saw move: the first draw of a page or a list is still, and a page drawn again mid-move carries on where it was. Times and easings are data, `tile.motion`, and the transition that draws the check is named there (`done.from`, `done.to`), so no renderer names a state.
- **The format's version stays 2.** An app from before the tile ignores `tile` and `kit.icon` and keeps drawing the head with its hat, which the definition still holds. An app that knows the tile draws it whenever the definition has one.
- **An outfit is `{ hat, icon }`.** The icon is the name of a kit icon, never a drawing: a drawn icon would look unlike the others, and the kit covers the jobs bots are made for. The Chief gives each new bot an icon (and still a hat, for apps from before); `compass` is the Chief's own and is not offered to bots. A bot without an icon shows the icon its hat stands for (`tile.byHat`), or `spark`.
- **The dresser gives icons.** Every bot without an icon (those from before this change, and any the Chief made without one) gets one from Claude in the background, as hats were given (ADR 004): nothing is asked of the owner and nothing is shown but the new icon. A bot's hat is never changed by it.

## Alternatives

- **Monogram** (initials on a tinted tile): no data to choose, but two letters can't be read at 16 pixels, two bots with the same initials look the same, and it collides with the owner's own initial in the rail.
- **Orb** (a soft sphere, no face): calm, but bots differ only by colour and there are eight colours.
- **A calmer head** (no hat, no whites of the eyes): the least change, but still a character from a cartoon.
- **A generated pattern**: unique without choosing, but it means nothing and is hard to remember.
- **An icon on a tinted tile**: quieter, but weaker at small sizes than a solid tile.
- **Changing the eight stored colours**: the muting is done when drawing, so stored colours, the colour picker and every test of them stay as they are.

## Consequences

- The web page and the Android app draw tiles; the desktop and iOS apps get them with the web page. A new Android build is needed for the app; until then it keeps drawing heads.
- The faces in `states` and the hats stay in the definition only for apps from before the tile. They can be removed once those apps are gone, with a new format version.
- `list_bots` gives the Chief each bot's `icon` beside its `hat`, so it can give a new bot one no other bot has.

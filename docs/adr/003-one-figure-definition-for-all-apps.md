# ADR-003: One figure definition for all apps

- **Status:** Accepted
- **Owning task:** FIG-002; amended by FIG-012 (the figure is a head with a face and a hat)

## Context

A bot's dot was animated three times by hand: CSS keyframes on the web page, a Compose canvas on Android, Core Animation on the Mac. The three were kept alike by eye. [MVP 1](../product/milestone1.md) replaces the dot with a mark that has more to keep alike: a shape, a look and a movement for each of six states, a still form for reduced motion, where a hat sits, hats that look the same everywhere, and hats the Chief draws that no app has seen before.

FIG-002 decided this for a stick figure: bones, joints and body poses. In the acceptance test the owner found the stick figures hard to see in the list on a phone and revised the scope ("Scope revision" in [MVP 1](../product/milestone1.md)): a bot is a **head** in its colour with two eyes and a hat, and its state shows in its **face**. The stick figure was never released. FIG-012 amends this ADR: what stays is that the mark is data, where the file lives and how apps get it; the bone tree and its keyframe model are replaced by the head and the layer model below.

## Decision

The mark is data. One definition file, `lib/figure.json`, describes the head, the face and movement of each state, where the hat sits, the kit of hats ([ADR 004](004-pieces-as-restricted-shape-lists.md)) and the small mark. Each app has a small native renderer that draws from it: SVG on the web page, a Compose canvas on Android, Core Animation on the Mac. No app holds face or kit data of its own, beyond one built-in bare head.

### Where the file lives

`lib/figure.json`, beside the server code that hands it out. `lib/` is already in the server's image (`.dockerignore` is an allowlist), so nothing about packaging changes. The Android and Mac builds read the same file from the repository, as they already read `test/fixtures/mentions.json`: Gradle copies it into the app's assets, and the Xcode project lists it as a resource by its path in the repository. Neither build keeps a second copy in Git.

### Fetched, with a bundled copy to start from

The botdot server hands the definition out at `GET /api/figure` and announces it as `figure` in `features`.

- The web page always fetches it: the page and the definition come from the same server, so they cannot disagree.
- The Android and Mac apps bundle the file at build time and draw from that copy at once. When the server's `features` has `figure`, they fetch the server's definition and use it instead, if its `version` is one they know. An app against an older server, or offline, keeps its bundled copy.
- A renderer that cannot load any definition it knows draws one **bare head** it has built in, so a bot is never left without a mark: the head's circle in the bot's colour with the two round eyes of the idle face, looking ahead. That fallback has no states, no movement and no hat. Its numbers are the definition's own at the time of FIG-012: head `cx 12, cy 16.5, r 7.5` in a box of 24 by 24; eyes white circles `r 2.2` at `(8.8, 17.1)` and `(15.2, 17.1)`; pupils ink circles `r 1.2` at the same points; white `#ffffff`, ink `#24231f`.

`version` is the version of the format, not of the content: it changes only when a renderer written for the old format would draw the new file wrongly. It is **2** from FIG-012 on (1 was the stick figure). A renderer ignores keys it does not know, so hats and new states can be added without a new version. A renderer refuses a definition whose version it does not know, or whose face it cannot draw whole (a shape kind it does not know in a state's face, or a `fill` or `stroke` that is not one of the four tones), and falls back as above.

Reason: the kit will grow, and the Chief draws from it on the server. Fetching lets a new hat or a tuned face reach apps without an app update; the bundled copy keeps an app working before it has reached a server.

### The head

Units are those of `box` (24 by 24), x to the right and y downward.

- `head` is `{ cx, cy, r }`: a circle filled with the bot's colour (`main`). Nothing is drawn behind it: the avatar has no circle of its own. The head is 15 of the box's 24 units wide, 62% of the avatar.
- A renderer does **not clip** the mark to `box`. The box is what is scaled to the avatar's size; a wide hat reaches up to a unit past its left and right edges, a bobbing head lifts its hat up to a unit and a half above it, and a tilted head leans its hat a few units past it. The rows of a list leave that room.
- `tones` is `{ white, ink }`, two colours as `#rrggbb`: the white of an eye and the ink of a pupil, of crosses and of closed eyes. They are the same on a light and a dark background, because they lie on the head, not on the page. `main` and `deep` are the bot's colour and its second tone, as in ADR 004.
- `attach.hat` is `{ at: [x, y], scale }`. The hat's box (`kit.hat.box`, ADR 004) is drawn `scale` times as large, with its `origin` on `at`: a point `q` of a hat lands at `at + scale × (q − origin)`, and its stroke widths are multiplied by `scale` too. `at` is the top of the head. With `scale` 2.6 the hat's box of 10 by 6 covers 26 by 15.6 units: a hat may be a little wider than the avatar and ends above the middle of the eyes.
- `pivot` is `{ head: [x, y], eyes: [x, y] }`: the points the head turns about (its middle) and the eyes close about (the middle between them).

### The face of a state

A state has:

- `eyes`: a list of shapes, everything of the face that does not look around (the whites, brows, crosses, closed lids).
- `pupils`: a list of shapes that look around; empty when the face has none.
- `pose`: where the layers are when the face is still. It is what reduced motion shows.
- `opacity`, when the state is faded. The whole mark, hat included, fades as one group.
- `move`, when the state moves.

The shapes are those of ADR 004 (`rect`, `circle`, `line`, `path` with `M L Q C Z`), with coordinates in the box's units and `fill` and `stroke` each one of `main`, `deep`, `white`, `ink`. They are part of the definition, not of anything a bot or the Chief writes, so ADR 004's limits (the box, the number of shapes) do not apply to them.

`default` names the state to draw for a state the renderer does not know.

The six faces, as FIG-012 fixed them after checking the list on a phone:

| State | Still face | Movement |
| --- | --- | --- |
| `idle` | round white eyes, pupils in the middle | blinks: the eyes close and open once every 5 s |
| `working` | eyes flat on top under two straight ink brows, pupils low | the pupils go from side to side, 1.4 s |
| `waiting` | the round eyes moved to one side of the head, pupils at their far edge, the head leaning a little the other way (the opposite of the failed tilt) | a glance down and back, every 6 s |
| `needs_you` | wide eyes, half as large again, with small pupils | the head bobs up, 0.9 s |
| `failed` | ink crosses for eyes, the head tilted | the tilt sways slowly, 4 s |
| `paused` | closed eyes (two ink curves), the whole mark faded to 40% | none |

Each differs from every other in what is drawn, not only in where a pupil is: `working` and `needs_you` differ in the shape and the size of the eyes.

### The layer model

Movement is three **layers**, one inside the other, and nothing else moves:

1. `head`: everything (the head's circle, the face, the hat).
2. `eyes`: the face (the state's `eyes` shapes, and the `pupils` layer).
3. `pupils`: the state's `pupils` shapes.

Draw order inside the `head` layer: the head's circle, the `eyes` layer (its shapes in list order, then the `pupils` layer), then the hat, which so lies over the face.

A pose places layers. It is an object with any of the keys `head`, `eyes`, `pupils`:

| Layer | May say | Pivot |
| --- | --- | --- |
| `head` | `move: [x, y]`, `turn: degrees` | `pivot.head` |
| `eyes` | `move: [x, y]`, `scale: [x, y]` | `pivot.eyes` |
| `pupils` | `move: [x, y]` | none |

What a pose leaves out is `move [0, 0]`, `turn 0`, `scale [1, 1]`. `turn` is clockwise on screen. A layer puts a point `p` of its content at

```
p′ = move + pivot + R(turn) · S(scale) · (p − pivot)
```

that is: scale about the pivot, turn about the pivot, then move. A point of a pupil goes through the `pupils` layer, then `eyes`, then `head`. No layer both turns and scales, so the three renderers need not agree on the order of a turn and an uneven scale.

`move` (of a state) is `seconds` for one loop, one `easing` (`linear` or `ease-in-out`, the cubic bezier 0.42, 0, 0.58, 1), and `keys`. A key has a time `at` from 0 to 1 and, for any layer, the values that differ from `pose`: a value a key gives (`move`, `turn` or `scale` of a layer) replaces the pose's value of that name, and the rest is the pose's. Between two neighbouring keys every number (move x, move y, turn, scale x, scale y of each layer) goes from its value at the first to its value at the second on its own, by the easing over that stretch: `v = a + (b − a) × ease((t − at₁) / (at₂ − at₁))`. The first key is at 0, the last at 1, and the two are equal, so the loop has no jump. Every movement loops for ever, and all marks take their place in the loop from one clock (`t = (clock mod seconds) / seconds`), so a mark drawn again carries on where it was. A hold is two equal keys.

With reduced motion nothing moves: every layer stays at `pose`.

Reason: a translation, a turn about a point and a scale about a point, each keyed in time with one timing function, are what all three can play natively and alike, and they are all a face this small needs: eyes that look around (the pupils move), a blink (the eyes scale to a tenth of their height), a bob (the head moves) and a tilt (the head turns).

- **Web:** three nested SVG groups (`l-head`, `l-eyes`, `l-pupils`). Each layer's transform is written as the same four steps, `translate(move + pivot) rotate(turn) scale(scale) translate(−pivot)`, as the group's `transform` for the still pose and as CSS keyframes for a layer that moves; a browser moves between two such lists number by number.
- **Mac:** three nested `CALayer`s with empty bounds, each positioned at its pivot (`position = pivot + move`) with its content laid out around that point. A moving layer gets a `CAKeyframeAnimation` per value that changes: `position`, `transform.rotation.z`, `transform.scale.x`, `transform.scale.y`, with the keys' times as `keyTimes`, the easing as `timingFunctions` for every stretch and `calculationMode` linear. Core Animation's `easeInEaseOut` is the same bezier as CSS `ease-in-out`.
- **Android:** the Compose canvas draws from a shared clock; it finds the two keys around the clock's time, eases each number between them, and draws the shapes through the three transforms.

### The small mark

Beside a bot's name in running text, and once per waiting thing in "Needs you", the mark is about as tall as a line of text. `small` is `{ view: [x, y, width, height] }`: the part of the box that fills the mark. The small mark is the head's circle and the bot's hat, placed as on the avatar, **without eyes**: no state, no layer, no fade, and it never moves. A renderer whose definition has no `small` shows the whole box, `[0, 0, box width, box height]`.

### The Chief of Staff

`chief.outfit` is `{ hat }`, the Chief's fixed hat by its kit name; apps draw it on a head in the Chief's coral.

## Alternatives

- **Three hand-written marks**, as with the dot. No shared file to design, but every face, hat and later change is made three times and checked by eye, and a drawn hat still needs a shared format.
- **[Rive](https://rive.app/docs/runtimes/getting-started)**: one authored animation file with a state machine, played by MIT-licensed runtimes on web, Android and Apple platforms. The states would be authored once, with better tools than keyframes in JSON. Rejected for now: it adds the first runtime dependency to the web page and one to each app, the mark would have to be authored in Rive's editor (which the agents delivering this cannot do from code), and hats drawn by the Chief at runtime would still need a path of their own.
- **Bundled only.** Simplest, and an app could never get a broken definition from a server. Rejected: every new hat would need an Android and a Mac release before the owner sees it.
- **Fetched only.** No copy in the apps. Rejected: an app would draw nothing until it reached a server, and a new app against an older server would have no mark at all.
- **The definition in `public/`.** The web page would get it as a static file with no API route. Rejected: it reads as the web page's own data, and the apps would fetch a file of the web page rather than ask the API.
- **A free easing per key or per value.** More lifelike movement. Rejected: three renderers have to agree on every curve; one easing per movement is enough for a mark this small.
- **Keeping the stick figure and making it larger** (the first decision of this ADR: a tree of bones, a pose as one angle per bone). Tried in mockups on the test server with the owner's bots: a figure of lines uses a third of its avatar however it is scaled, and its pieces stay a few pixels. The owner chose heads.
- **The bone tree kept for the head** (a single bone with the face hung on it). Rejected: angles about joints say nothing a face needs; a blink is a scale and a look is a translation, which the bone model lacked.
- **A face per state as a swap of whole pictures, with no layers.** Simplest to draw. Rejected: nothing could move without redrawing shapes per frame in every renderer, and CSS and Core Animation animate transforms, not shape lists.
- **Shapes that change over time** (an eye whose outline is keyed). Rejected: CSS cannot animate a path's points in every browser, and Core Animation would need a path animation per shape. A blink as a scale of the eyes' layer looks the same and is one number.
- **Fading by opacity inside the face** (a blink as the eyes fading out). Rejected: a closed eye should be a line, not a missing eye; and opacity is kept for one thing, the paused state.
- **Eyes that depend on the background** (dark eyes on a light page, light on a dark one). Rejected: the eyes lie on the head, whose colour is the same on both.

## Consequences

- The three renderers are small and alike, and are tested against the same definition.
- A face or hat change is one edit; the apps cannot drift.
- Movement is limited to what the layer model can say: three nested layers, each moved, the head turned and the eyes scaled, looping, with one easing. Anything richer (a movement that plays once, a shape that changes, a mouth with a layer of its own) needs a change to the model in all three renderers and a new `version`.
- The format changed with FIG-012: `version` is 2, and the Android and Mac renderers written for version 1 keep their bundled stick figure until FIG-013 and FIG-014 replace them. Nothing of version 1 was released.
- The API has one more route, and the server's image must keep carrying `lib/figure.json`.
- An app may draw from an older bundled copy for a moment before the server's arrives; the two differ only when the definition changed since the app was built.
- All marks of one state move in step, because they share the clock: nine idle bots blink together.

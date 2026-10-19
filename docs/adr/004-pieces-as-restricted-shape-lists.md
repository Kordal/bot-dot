# ADR-004: Pieces are restricted shape lists

- **Status:** Accepted
- **Owning task:** FIG-003; amended by FIG-012 (one slot, the hat)

## Context

In [MVP 1](../product/milestone1.md) a bot's outfit is a hat and a held object. Most come from a kit; when nothing fits, the Chief of Staff draws one. A drawn piece is written by Claude, stored on the server, sent to three apps and drawn there. It must look the same on all three, stay readable at sidebar size, and never be a way to get markup, scripts or links from a model's output into an app.

A prototype in the planning conversation (2026-10-02) drew ten pieces this way (a loaf, a watering can, a lantern, a shield, a newspaper, a suitcase, a magnifying glass, headphones, a chef's hat, a party hat) with 3 to 5 shapes each.

## Decision

Kit pieces and drawn pieces share one format: a short list of shapes inside a small fixed box, one box per slot. A shape is a rectangle, a circle, a line, or a path made only of move, line, quadratic, cubic and close commands. Each shape is filled, stroked or both, in one of two tones that the app derives from the bot's colour. The server checks every piece before it is stored and refuses anything else with the reason. Apps draw the shapes with their own drawing code; no app parses SVG or HTML from a piece.

The one check is `pieceProblem(slot, piece)` in `lib/pieces.js`. Every kit piece passes it in the tests, and FIG-006 uses the same function for drawn pieces.

### Amendment (FIG-012): one slot, the hat

The owner revised [MVP 1](../product/milestone1.md): a bot is a head with a hat, and held objects are dropped. The format of a piece, its check, the limits and the two tones stay as decided in FIG-003. The sections "The outfit", "The kit" and "The box" below were rewritten for one slot; what changed from the first decision:

- An outfit is `null` or `{ "hat": … }`. `holds` is no key any more: it is refused like any unknown key, with the reason. A bot stored with `holds` by the stick-figure build (never released) is read as `{ hat }`, and the object is gone when the bots are next saved; one that held something and wore no hat is read as `null`, never dressed, so that it is given a hat (FIG-015). "Dressed with nothing, on purpose" is `{ "hat": "" }`.
- The kit is `kit: { limits, hat: { box, origin, pieces } }` and the Chief's outfit `chief: { outfit: { hat } }`. `kit.holds`, `kit.hat.attach`, `attach.held` and `turns` are gone.
- The one box is the hat's, 10 wide and 6 high with `origin` `[5, 3.5]`, as before. It is placed by `attach.hat` of the definition ([ADR 003](003-one-figure-definition-for-all-apps.md)): drawn `scale` times as large with its `origin` on `at`, the top of the head; stroke widths grow with it. With the head 15 units wide and `scale` 2.6, the head is 5.8 of the hat's units wide below the origin, where the stick figure's was 4.4. The hat is drawn in the head's layer, after the face.
- A hat's tones are still only `main` and `deep`. The tones `white` and `ink` belong to the faces in the definition; a hat that names them is refused.
- Every kit hat was checked on a head in the list at phone width, light and dark (`docs/archive/evidence/FIG-012/`): the aerial and the propeller cap were redrawn with thicker parts, the halo was dropped because a ring that small reads as a mouth or an eye, and 20 hats remain.

### The outfit

A bot has `outfit`, which is `null` (it was never given one) or `{ "hat": … }`. `hat` is the one **slot**.

- Its value is `""` (no hat), the **name of a kit hat** (a string), or a **drawn hat carried inline** (an object: `{ "shapes": [...] }`). A string is always a kit name and an object is always a drawn hat, so the two cannot be confused.
- A kit name matches `^[a-z][a-z0-9-]{0,23}$`.
- `null` and `{ "hat": "" }` are different stored states: never dressed, and no hat on purpose. FIG-007 dresses only the first. An `outfit` sent without `hat`, or with `hat: null`, leaves a never-dressed bot never dressed.
- Any other key is refused with the reason, `holds` included.

### The kit, in the figure definition

The kit is the `kit` key of `lib/figure.json` ([ADR 003](003-one-figure-definition-for-all-apps.md)), so every app gets it with the head:

```json
"attach": { "hat": { "at": [12, 9], "scale": 2.6 } },
"kit": {
  "limits": { "shapes": 6, "commands": 16, "stroke": [0.8, 2] },
  "hat": { "box": [10, 6], "origin": [5, 3.5], "pieces": { "<name>": { "means": "…", "shapes": [] } } }
},
"chief": { "outfit": { "hat": "top-hat" } }
```

- `kit.hat.pieces` maps a name to a piece. A piece is an object with `shapes` and, in the kit, `means`; any other key is refused. `means` is one line, "What it is: what it stands for", read by the Chief when it picks.
- `chief.outfit` is the Chief of Staff's fixed outfit. It names a kit hat, and apps draw it on the Chief's head.
- A renderer draws a hat whole or not at all. A name its definition lacks, or a hat with a shape kind or a tone it does not know, is left out, and the head is drawn without it.

### The box

A hat's coordinates run from 0 to 10 across and from 0 to 6 down, in the hat's own units. Its `origin` is `[5, 3.5]`.

A renderer draws the box `attach.hat.scale` times as large with its `origin` on `attach.hat.at`, the top of the head: a point `q` lands at `at + scale × (q − origin)` in the units of the definition's box (24 by 24), and stroke widths grow with it. So a hat has 3.5 of its units above the top of the head and 2.5 below it, down to above the eyes (headphones reach the ears).

Draw order: the hat is drawn in the head's layer after the head and the face, so on top of them, and it moves and tilts with the head; its shapes are drawn in list order, later ones over earlier ones.

Scaled, the box is a little wider than the avatar (26 of 24 units), and renderers do not clip a mark at the edge of its box (ADR 003).

### A shape

A shape is an object with `shape` and only the fields listed for it. Any other field is refused.

| `shape` | Fields | Rule |
| --- | --- | --- |
| `rect` | `x`, `y`, `w`, `h`, optional `r` | `w` and `h` above 0; the whole rectangle inside the box; `r` (corner radius) from 0 to half the shorter side |
| `circle` | `cx`, `cy`, `r` | `r` above 0; the whole circle inside the box |
| `line` | `x1`, `y1`, `x2`, `y2` | both ends inside the box; a line has a `stroke` and no `fill` |
| `path` | `d` | a list of 2 to 16 commands, below |

A path's `d` is a list of commands, each a list that starts with a letter: `["M", x, y]`, `["L", x, y]`, `["Q", cx, cy, x, y]`, `["C", c1x, c1y, c2x, c2y, x, y]`, `["Z"]`. Coordinates are absolute. The first command is the only `M`. Every point, control points included, is inside the box. `d` is never a string: no app parses path text.

Paint, on every shape:

- `fill`: `"main"` or `"deep"`; left out means not filled.
- `stroke`: `"main"` or `"deep"`, with `width`; left out means no outline. `width` is from 0.8 to 2 and is given only with a `stroke`. Strokes have round caps and round joins. A stroke may reach half its width past the box.
- A shape has a `fill`, a `stroke` or both.

Every number is a finite JSON number, and `shape` and a command's letter are strings.

A renderer draws what it is given and checks no limit: the boxes and limits are enforced once, on the server, before a piece is stored.

### The limits

| Limit | Value | Why |
| --- | --- | --- |
| Shapes in a piece | 1 to 6 | the prototype and the kit need 5 at most |
| Commands in a path | 2 to 16 | the kit's longest (a crown) has 8; the star of the first kit, a held object, had 11 |
| Stroke width | 0.8 to 2 | 0.8 units is 1.1 px in a 34 px avatar and 1.4 px in the 42 px sidebar avatar; thinner lines vanished in the mockups |

The limits are data, `kit.limits`, so the three apps and the Chief's guidance read the same numbers.

### The two tones

Tones are not stored; a piece names them and each app works them out from the bot's colour as it draws. So a piece, kit or drawn, is kept as it is when the bot's colour changes.

- `main` is the bot's colour itself.
- `deep` is the bot's colour mixed with 45% of black on a light background and with 45% of white on a dark one, channel by channel in sRGB: `deep = colour × 0.55 + ink × 0.45`, where ink is `#000000` or `#ffffff`.

Reason: the bot's colour is a mid-tone that reads on both themes, and a tone mixed towards the text colour reads on both too. A fixed dark tone would be weak on the dark theme, and a fixed pale one on the light theme. A hat in `main` joins the head into one silhouette, and `deep` carries the outline or the detail.

### What the server does in FIG-003, and what FIG-006 adds

FIG-003 accepts only kit names in an outfit. A name the kit lacks is refused with the valid names, and the bot keeps its outfit. FIG-006 lets a slot carry a drawn piece and checks it with `pieceProblem`. The web renderer draws an inline piece from FIG-003 on.

## Alternatives

- **Raw SVG from the Chief**, sanitised. Most freedom, but sanitising SVG is a known source of holes, and Android and the Mac would each need an SVG renderer that agrees with the browser.
- **Kit only.** No validation problem at all. The owner chose drawn pieces as well, so that an unusual bot still gets something fitting.
- **A pixel grid** (for example 8 by 8, two tones). Trivial to validate and draw, but blocky at the large avatar size and unlike the kit's smooth pieces.
- **Path data as an SVG string** (`"M2 4Q2 1 5 1"`). Shorter to write. Rejected: every app would need a path parser, and a string is where markup hides; a list of numbers cannot carry any.
- **Relative commands, arcs and ellipses.** Rejected: more to check and to draw three times; quadratic curves draw every round shape the kit needed.
- **Two fixed tones** (a dark and a pale one, the same on both themes). Simpler to describe. Rejected: one of the two is always weak against the background, and which one flips with the theme.
- **Tones stored with the piece as colours.** Rejected: a piece would keep its old colours when the bot's colour changes, and a colour is one more thing to validate.
- **The kit in a file of its own, with a route of its own.** Rejected: an app would have two things to fetch and keep in step; ADR 003 already hands out one definition.
- **Worn on the body** (a third slot). Rejected in the MVP's scope: a body that is one line carries nothing.

## Consequences

- One renderer per app draws the kit and drawn pieces alike.
- Validation is a size and shape check, not a sanitiser.
- What a piece can show is limited to a few flat shapes; that is also what stays readable when small.
- The kit can grow without an app update: a new piece arrives with the definition. An app that has an older definition draws the figure without that piece.
- A change to a box, an origin or a limit changes how stored drawn pieces sit or whether they pass. After FIG-006, such a change needs a migration of stored pieces or a new `version` of the definition.
- An app must know which background it draws on to work out `deep`.

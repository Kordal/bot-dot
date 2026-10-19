# MVP 1 research: stick figures for bots

Planning status: stage 6 closed on 2026-10-02; next: delivery, starting with FIG-001.

Date: 2026-10-02. Revision inspected: `main` at `0c0e286` (the scaffold commit on top of `1e6f545`). No product tests were rerun; only the scaffold's own checks (`make agent-check`, `tests/integration/check-docs.sh`) ran, and both passed. This note is research evidence, not an implementation plan.

The local main was seven commits behind GitHub when it was inspected. Those commits were merged before the handoff; none of them touches how a bot is drawn (`BotDot.kt`, `BotDotView.swift`, the `.bd` styles) or the Chief's `create_bot`, so the findings below stand. The delivery branch `mvp1` starts from the merged main.

## Why this MVP

The owner reports that "dots" as the mark for bots is already used by another company, and wants a different mascot. After mockups of bits, blobs, spores and stick figures in the planning conversation, the owner chose stick figures with animations, dressed by Claude when a bot is created, from the bot's name or instructions. The claim about the other company is the owner's report; it was not verified here.

## What the product delivers today

Verified by reading the code at the revision above:

- **A bot's mark is a coloured, liquid dot.** The server gives each bot a `color` (one of eight, `COLORS` in `lib/bots.js`; a new bot gets the least used one) and a `state`.
- **Six states already exist**, decided in `botStates()` in `server.js`: `needs_you`, `working`, `waiting` (for teammates' answers), `failed`, `paused`, `idle`. Each has its own movement: idle sways, working circles with a tail, waiting breathes with a ring, needs_you bounces, failed melts, paused shrinks.
- **The dot is drawn three times, natively**: CSS in `public/style.css` (`.bd`) with `botDot()` in `public/app.js`; Compose canvas in `android/.../ui/BotDot.kt` (176 lines); Core Animation in `macos/BotDot/UI/BotDotView.swift` (212 lines). All three stand still when the system asks for reduced motion.
- **Smaller dots elsewhere**: a bot's name in running text carries a small plain dot (`.name-dot`); "Needs you" shows one hopping dot per waiting item in its bot's colour (`.needs-dots`); a folded group shows a busy dot; the logo is "bot" plus a coral dot that pulses while anything works. Dashboard tiles also use dots, for switches and values, not for bots.
- **The Chief of Staff creates bots** through `create_bot` in `lib/mcp-server.js`, whose fields include `name`, `color`, `description`, `prompt`. `update_bot` changes them. There is no field for how a bot looks beyond its colour (an older `emoji` field is still stored and used in text sent to bots).
- **The Chief itself** is always the coral dot (`#d85a30`), not one of the eight colours.

## Evidence boundaries

- Read from code, not run: the list above. The apps were not started in this session.
- From the planning conversation's mockups (HTML and SVG only, not checked on Android or Mac, and not viewed rendered by the agent): a stick figure with a hat and a held object reads at sidebar size (about 24px); at chat-line size (about 16px) the pieces shrink to two or three pixels; worn-on-body pieces (a stethoscope) read poorly because the body is a line.
- Assumption: a kit of hats and held objects is enough to tell bots apart. Not tested with real bot lists.
- Assumption: the Chief picks fitting pieces from a bot's name and task reliably. Not tested.
- Unknown: whether the product's name and logo also have to change. The owner has not said.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| The dot mark is reported as taken by another company | Replace the bot's dot with a stick figure in every place a bot is shown |
| Six states with distinct movement already exist on all three apps | Give the figure one pose or movement per existing state, so no state loses its signal |
| The dot is drawn natively three times, with no shared drawing data | Define the figure, its poses and its kit once as data the three apps draw from, so they cannot drift |
| `create_bot` has no look beyond `color` | Add a look (hat, held object) to the bot, chosen by the Chief at creation and changeable by chat |
| Existing bots have only a colour | Give every existing bot a look once, without the owner doing anything |
| Mockups: pieces vanish at chat-line size | Keep colour as the identifier in running text; show pieces only from sidebar size up |
| "Needs you" shows one dot per item; the logo is a dot | Decide whether those marks change in this MVP or stay |
| Owner preference (saved earlier): minimal UI, no new controls for what the Chief can do by chat | No picker in settings; the look is changed by asking the Chief |
| Owner preference (saved earlier): web, Android and Mac get every feature together; Linux uses the web page | Deliver the figure on all three in the same MVP |

## Existing solutions

Surveyed on 2026-10-02. Each claim below comes from the linked page, opened that day.

- **[DiceBear](https://www.dicebear.com/start/what-is-dicebear/)**: an avatar library where a seed string picks parts (hair, eyes, accessories) from a style's set, always the same for the same seed, as SVG; libraries for JavaScript, Dart, Python and others; code under MIT, styles under their artists' licences. Overlap: a parts kit assembled into a character. Different: the seed picks at random, so the result has nothing to do with what the bot does, and the output is a still image with no states. Worth adopting: the idea of a style as data (named slots, each with a set of parts) that any platform can assemble.
- **[Agent Avatars](https://notxf1le.github.io/agent-avatars/)**: a deterministic avatar generator aimed at AI agents and bots; name or ID plus a namespace decide the image; SVG and PNG; MIT. Overlap: the same job, a look for an agent with no one drawing it. Different: static, no status, and again unrelated to the agent's role.
- **[Open Peeps](https://www.openpeeps.com/)**: a hand-drawn library of people built from interchangeable vector parts (poses, clothes, expressions), CC0. Overlap: mix-and-match figures. Different: static illustrations for design tools, far too detailed for 24px.
- **[Rive](https://rive.app/docs/runtimes/getting-started)**: an animation tool with a state machine and open-source (MIT) runtimes for web, Android and Apple platforms including macOS; the app can drive states and swap bound properties and assets at runtime. Overlap: one animated character file with states, played natively on all three apps, which is exactly the "define once" improvement above. Better than today: the three hand-written animations would become one authored file. Cost: a new runtime dependency in each app (the web page and server have none today), and the figure has to be authored in Rive's editor, which an agent cannot do from code.

Ideas worth adopting: parts in named slots as data (DiceBear); one definition of the states for all platforms (Rive's model, if not its runtime). Nothing found chooses the parts from what the agent does, and nothing found combines a parts kit with status animation, so no existing solution makes this MVP unnecessary. Unverified: whether DiceBear's "Animated" section offers anything beyond still images.

## Proposed boundary for the discussion

In: the stick figure as each bot's mark on web, Android and Mac; a pose or movement for each of the six existing states; a kit of hats and held objects; the Chief choosing a look at creation and changing it by chat; a look for existing bots.

Open for the owner: whether the "Needs you" marks, the name marks in running text, and the product's name and logo change in this MVP.

Out, proposed: free-form drawing by Claude of whole figures; a picker in the UI; the Linux app; new states.

## Uncertainties and how each was settled (stage 4)

| Uncertainty | Outcome | Owner |
| --- | --- | --- |
| Can Claude draw a recognisable piece in a restricted shape format? | Prototype in the planning conversation, 2026-10-02: ten pieces of 3 to 5 shapes each, shown at 64px and 24px. The owner judged them good enough and kept drawn pieces in scope. The agent did not see the render. | Settled; quality in real use is FIG-006's criterion (four of five recognised) |
| How one figure is drawn alike by three native apps | [ADR 003](../../adr/003-one-figure-definition-for-all-apps.md), Proposed: one definition file, three small renderers; bundled or fetched and the keyframe model are open | FIG-002 resolves it before FIG-004 and FIG-005 start |
| What a piece is, so a model's drawing is safe and alike everywhere | [ADR 004](../../adr/004-pieces-as-restricted-shape-lists.md), Proposed: a short list of simple shapes, validated on the server, never markup; limits open | FIG-003 resolves it before FIG-006 |
| Whether six poses stay distinct at sidebar size | Not tested. The mockups showed idle, a raised arm and walking only | FIG-002: a criterion with a nine-bot screenshot at phone width; a pose that fails is simplified there |
| Whether the Chief reliably sets an outfit | Not tested | FIG-007 dresses any bot left without one, so a miss costs nothing |
| Whether a 16px figure carries enough colour beside a name | Doubtful from the mockups | FIG-008: if it can't be made to read, it returns to the owner with screenshots and one alternative |
| Whether the name and logo must change | Owner's decision: left for later, outside this MVP | Owner |

No external dependency blocks any task.

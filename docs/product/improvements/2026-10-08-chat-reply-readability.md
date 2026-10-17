# Reading a long reply in the chat

8 Oct 2026. An improvement report from `/kordal-improve`; no code was changed.

## Question

"The long text like this is not very user friendly to read. How could we improve the user experience when reading the chat?" The owner's screenshot showed a bot's reply on the web page: an opening sentence, a bold title "Host (pve)" with three bullets, a bold title "Worth fixing, in order", then four numbered items, each numbered "1.", each with two or three sub-bullets.

## Criterion

The owner confirmed one:

- **Scannable in seconds.** Headings, spacing and line width let the owner find the main point and each section of a long reply without reading every line.

Offered and not chosen as criteria of their own: list structure drawn correctly, long replies kept short on screen, the same on web and Android. They count here only where they serve scanning.

## Observed

A test server on this checkout, the web page at 1280x800. The reply's text (288 words, reconstructed from the screenshot) was drawn by the page's own `md()` into the chat's bubble markup; no bot wrote it. The Android app was not started.

| What | Seen |
| --- | --- |
| Numbered items | Four separate lists of one item each, every item numbered "1." |
| Sub-bullets | Not nested: their text starts at the same left edge as the numbered item above (417px for both) |
| Section titles | A bold line at 14.5px, the size of the body |
| Space above a title | 7px, the same as between two paragraphs |
| Space between a numbered item and its bullets, and before the next item | 5px each |
| Space between two bullets | 3px |
| Height | 768px in a 649px chat: 1.18 screens |
| Line length | About 80 characters in a 623px bubble |

The blocks the reply became: `P P UL(3) P OL(1) UL(3) OL(1) UL(3) OL(1) UL(2) OL(1) UL(2) P`.

Three more inputs, run in the page:

| Written | Drawn |
| --- | --- |
| `1. one`, blank line, `2. two`, blank line, `3. three` | Three lists, each "1." |
| `1. one`, an indented line under it, `2. two` | List, paragraph, list: both items "1." |
| `> quoted`, `---`, `##### deep` | Three paragraphs of literal text |

## Findings

Investigated by the `kordal-investigator` agent; every cited line of the repository was opened and confirmed. Android was read, not run. The external sources were not opened.

1. **The web page restarts every numbered list at 1.** `md()` keeps one flat `list` state: a bullet line, indented or not, closes the numbered list (`public/app.js:359`), and so do a blank line and any other line (`public/app.js:370-371`). The next number opens a new list. The order of the items is lost.
2. **The web page nests nothing.** The same flat state means a sub-bullet is a sibling of the numbered item, and `public/style.css:449` has no rule for a list inside an item. Four problems and their details read as one list of fourteen lines.
3. **A section title does not stand out.** Bots write titles as bold lines, which are drawn as body text. A real heading would hardly differ: `.md h1` to `h4` are 1.02em and `h1` 1.15em (`public/style.css:446-447`). Android draws `###` and deeper at 15sp, its body size (`Markdown.kt:88-89`, `Theme.kt:61`).
4. **Spacing groups nothing.** Web: paragraphs .5em, lists .35em, items .2em (`public/style.css:448-450`). Android: 6dp between every block (`Markdown.kt:84`).
5. **Android keeps the numbers but not the indent.** The number comes from the source, so it does not restart (`Markdown.kt:92`). The indent pads the marker inside a box 16dp wide, so a sub-bullet's text starts at 16dp against 24dp for its numbered parent, and at indent 2 the bullet has no room (`Markdown.kt:92-93`). **Unverified**: read from the code, not seen on a device.
6. **No bot is told what the chat draws.** The style note says "bullets or a few headings" and "as short as the task allows", not which Markdown to use for a title, nor a length (`lib/bots.js:54-60`). The Chief is told "plain language, short" (`lib/chief.js:103`). The note is left out for a bot with "Human-friendly replies" off (`lib/bots.js:950-951`), and no prompt reaches replies already written.
7. **The web page prints quotes, rules and deep headings as text**, and makes every source line its own paragraph (`public/app.js:358`, `:371`). Android draws quotes (`Markdown.kt:195`).
8. **The renderers are shared.** The Chief's replies, reports, suggestions, run details, skill previews and Board note tiles use the same `md()` (`public/app.js:1534`, `1873`, `2320`, `2329`, `2960`, `4873`) and the same `MarkdownText` (`ChiefScreen.kt:283`, `351`, `372`; `TileBlocks.kt:154`). A fix reaches all of them.
9. **Raised before, not rejected.** The interaction audit named the broken lists and "no prompt says what the chat can draw", and proposed a shared Markdown fixture (`docs/product/improvements/2026-10-05-bot-interaction-audit.md:151`, `:332`). Milestones 5 to 8 did not take that group up.

External, as reported by the investigator and not opened here: NN/g measured large usability gains from subheadings, bullets, the conclusion first and half the words; CommonMark 5.2 nests a sub-list by its parent's content indent and takes the start number from the first marker; Anthropic's prompting guide advises stating the wanted format positively.

## Tests a change must keep passing

- `test/chief-reply-web.test.js:30`, `:44`, `:61`, `test/chief-files-web.test.js` and `test/chief-line-web.test.js` pin the exact `<div class="md"><p>…</p></div>` output.
- Those files cut `md()` out of `public/app.js` between `function md(src)` and `// Link bare web addresses after rendering`: a helper of `md()` stays inside that span.
- `MarkdownTest.kt:7-19` pins the flat `Block.Item(text, number, indent)` shape.
- Nothing pins the web page's list output, the `.md` styles or the style note.

## Proposals

Ranked; the recommendation was 1 and 2 as one feature, then 3.

| # | Proposal | Fixes | Touches | Size | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Draw a bot's lists as written, on the web page and Android: numbers continue across sub-bullets, blank lines and continuation lines, and sub-bullets sit indented under their item. | 1, 2, 5 | `public/app.js`, `public/style.css`, `Markdown.kt`, one shared fixture | Feature, 2 tasks | Board note tiles and skill previews change too |
| 2 | Make section titles stand out in a reply: clear heading sizes, more space above a heading than below, and a line that is only bold drawn as a heading. | 3, 4 | `public/style.css`, `public/app.js`, `Markdown.kt` | Feature, 2 tasks | A bold-only warning would look like a title: limit it to a short line without a full stop |
| 3 | Tell every bot and the Chief what the chat draws: answer first, `##` for a section title, a length target. | 6 | `lib/bots.js`, `lib/chief.js`, a prompt test | Quick | Replies turn terse or over-formatted; judged on live replies |
| 4 | Draw quotes and rules on the web page as Android does. | 7 | `public/app.js`, `public/style.css` | Quick | Low. A single line break inside a paragraph should stay a line break, as on Android (`MarkdownTest.kt:13`), not be joined away |

## Already fine

- **Line width.** About 80 characters on the web page.
- **The final reply is not folded.** Deliberate (`public/app.js:2566`, `BotChatScreen.kt:223`); folding hides sections and would not serve scanning.
- **Rule 6.** `md()` escapes its input first (`public/app.js:340`); Android builds its own styled text.
- **Tables, code blocks and links** work in both apps.
- **The Mac app** has the same flat design (`MarkdownBlocks.swift`): nothing to copy, and it gets no change (ADR 008).

## Verdicts

| # | Verdict |
| --- | --- |
| 1 | Now |
| 2 | Now |
| 3 | Now |
| 4 | Now |

All four belong together: one renderer change per app, the styles beside it, and the note that tells the bots to write what the renderers now draw. They go into one `/kordal-plan-feature`.

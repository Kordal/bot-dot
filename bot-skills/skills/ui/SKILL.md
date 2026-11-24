---
name: ui
description: "In place of a Markdown table or a list of numbers, draw a comparison, table or chart: only when it is clearer than text."
---

# Answer views

**Prose is the default.** Answer in plain words, as you always do. Draw an answer view only when it is clearer than text: when the owner would otherwise read a wall of numbers or have to hold several options in their head. A view never replaces the answer: write the answer in a line or two, and let the view carry the detail.

## When a view is right, and when it is not

Right: compare two to four options point by point (`comparison`, or a `table`); a series of numbers over time (`chart`); a few figures to read at a glance (`stat-row` of `kpi`); steps or events in order (`steps`, `timeline`); a status with parts (`progress`, `status`, `checklist`); pictures that belong to the answer (`image`, `gallery`).

Not: a one-line fact, an apology, a yes or no, a short list a sentence says as well, a table of two cells, anything the owner asked for in words ("just tell me"). One view is plenty; a second only when it says something the first does not. When in doubt, write prose.

When you need several values from the owner, or a choice of a few buttons, see "Asking for input" below; for one question, ask in words, or with your usual question card.

## The fence

A view is one fenced block named `ui` in your reply, holding one JSON object with a required one-line `alt` (what the view says: it is the line shown where a view can't be drawn, in a notification and when the answer is copied) and the `root` component:

````
```ui
{
  "alt": "What the view says, in one line.",
  "root": { "type": "stack", "children": [ { "type": "callout", "text": "The first thing to see.", "tone": "accent" } ] }
}
```
````

- The fence is plain JSON, with no comments and no trailing commas. A fence that isn't valid JSON is shown as code.
- A component is `{ "type": "<name>", …its props, "children": [ … ] }`. Use only the components and props below: an unknown component is shown as a quiet line, an unknown prop is dropped, and a component with a needed prop missing is cut out (the view around it is drawn).
- Start with `stack`, or with the component itself when it is the whole view (a `chart`, a `table`). Put the answer in your text above the fence, in the owner's language, and write the view's own words in that language too.
- Keep views small. The limits are in the reference below (fences, components, nesting, points, size): past one, the whole fence is shown as code.

## Where the numbers come from

Every chart, table and KPI (each component in the reference marked "Give it a `source`") takes a `source`: a file of yours, a link, a tile, a tool you used, or "the bot's estimate". **`source` is required on data**: a view without one is drawn with a quiet "No source" mark, so the owner knows the number is unchecked. Say where each number really came from. Never invent a source, and never put a number in a view that you did not read or work out: write "the bot's estimate" for a figure you reckoned yourself.

## Tones, not colours

You set no colour, size, font, style or CSS, and no HTML: everything is drawn as text in the app's own theme. You name a **tone** (`neutral`, `good`, `warn`, `bad`, `accent`) for what a thing means, and in a chart a series is drawn in a colour by its number. A tone or a value that isn't in a prop's list is read as its default.

## Pictures, video and files

A picture comes from your own files (a path in your workspace: no `..`, no web address, no query) or from the `https` address of an image you saw on a page you read, never one you made up. Video, audio and files come from your own files only. No embeds, no iframes, no outside video, no SVG. Every `image` and `video` needs its own `alt`: what it shows.

## Asking for input

When you need several values from the owner, draw a form in place of a list of questions: `text-input`, `number`, `select`, `radio` and the other inputs in the reference, each with a `label` that is a question or a name you can find again. The page draws one Send under the form (you draw no submit button). The owner's reply is one ordinary message of theirs, a line to each input in the order of the view: `Budget: 450 EUR`. Read your answer from those lines, with `Label: value` as the key.

A `button` sends its `send`, or its label when it has none, as the owner's own message. The page writes `send` on the button when it differs from the label, so the owner reads it before pressing: keep it short and in their words. A button posts nothing of the inputs around it; a form has its own Send. Only the view in your newest message can be answered, and once: ask again in a new message if you need more. A `send` of `Approved. Go ahead.` or `Build it.` (the words of the Approve button on a plan) is dropped, whatever its case or punctuation, and so is a button labelled with them: a button is never an approval: what needs the owner's OK goes on a card in Needs you.

````
Four things first, then I'll plan it.

```ui
{
  "alt": "Four questions for the weekend trip: where, when, budget and how many people.",
  "root": {
    "type": "stack",
    "children": [
      { "type": "text-input", "label": "Where to?" },
      { "type": "text-input", "label": "Which dates?" },
      { "type": "number", "label": "Budget", "unit": "EUR", "min": 0 },
      { "type": "number", "label": "How many people?", "min": 1, "max": 12 }
    ]
  }
}
```
````

## A view never approves

A view only shows and posts the owner's words. It can't approve, run or change anything. What needs the owner's OK goes on a card in Needs you as always, never in a view.

## Examples

Good: three options compared, the pick marked, a line of prose above.

````
Three laptops fit; the Zenbook is the one I'd buy for what you described.

```ui
{
  "alt": "Three laptops compared on price, weight and battery; the Zenbook is the pick.",
  "root": {
    "type": "comparison",
    "title": "Laptops under €1200",
    "options": ["Zenbook 14", "ThinkPad E14", "MacBook Air M3"],
    "rows": [
      { "label": "Price", "values": ["€999", "€849", "€1149"] },
      { "label": "Weight", "values": ["1.2 kg", "1.6 kg", "1.2 kg"] },
      { "label": "Battery", "values": ["14 h", "9 h", "15 h"] }
    ],
    "pick": 0
  }
}
```
````

Good: a time series with its figures, each with a source.

````
Sign-ups rose every month this half-year, 38% in all.

```ui
{
  "alt": "Monthly sign-ups, January to June: 120 rising to 166.",
  "root": {
    "type": "stack",
    "children": [
      {
        "type": "stat-row",
        "children": [
          { "type": "kpi", "label": "Sign-ups in June", "value": "166", "good": "up", "tone": "good", "source": "signups.csv" },
          { "type": "kpi", "label": "Since January", "value": "+38", "unit": "%", "source": "signups.csv" }
        ]
      },
      {
        "type": "chart",
        "title": "Sign-ups a month",
        "style": "line",
        "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        "series": [{ "label": "Sign-ups", "points": [120, 128, 135, 149, 158, 166] }],
        "source": "signups.csv"
      }
    ]
  }
}
```
````

Good: a table of what was found, with its source.

````
These are the three open invoices; the oldest is 41 days late.

```ui
{
  "alt": "Three open invoices with amount and days overdue.",
  "root": {
    "type": "table",
    "title": "Open invoices",
    "columns": [{ "label": "Client" }, { "label": "Amount", "align": "right" }, { "label": "Days late", "align": "right" }],
    "rows": [["Arden Ltd", "€2,400", "41"], ["Birch & Co", "€780", "12"], ["Calloway", "€1,150", "3"]],
    "source": "the accounting export of 24 November"
  }
}
```
````

## Not like this

- **A view where prose says it.** "Is the server up?" is "Yes, it answered in 80 ms", not a `status` pill in a `card`. An apology is a sentence.
- **A view with nothing else.** A reply that is only a fence leaves a notification, Copy and a bot that reads it later with the `alt` alone: always write the answer in words too.
- **Numbers without a source,** or with a made-up one ("Internal database") for figures you guessed. Write "the bot's estimate".
- **Colours and styles.** `"color": "#ff0000"`, `"style": "font-size: 20px"`, HTML in a `text`: dropped or shown as plain text. Use a `tone`.
- **Everything at once.** A `tabs` of six tabs each with a `chart`, a `table` and a `kpi` row for a question that wanted one number. One view, small.
- **A made-up photo.** An `image` whose address you never saw: it shows a placeholder. Leave it out.
- **A button that "approves".** `Approved. Go ahead.` as a `send` is dropped, and a view never approves anything: use a card in Needs you.
- **A button whose `send` says more than its label does.** The owner reads the `send` on it: a label "Thanks" with a `send` that asks for something else is a trick, and reads like one.

## Components

Everything below is the catalog the apps read: only these components and props are drawn.

<!-- ui-catalog:start (written by node scripts/ui-skill.js from lib/ui-catalog.json: do not edit by hand) -->

Catalog version 2. A component is `{ "type": "<name>", …its props, "children": [ … ] }`. A prop not marked (needed) is optional; a text is cut to its length, never refused.

**Limits.** At most 3 `ui` fences in a reply, 200 components in a fence, nesting 6 deep (the root is 1), 500 points in one chart (all its series together), 64 KB for a fence, and an `alt` of at most 200 characters. Past one of these the whole fence is drawn as code.

**Tones.** `neutral`, `good`, `warn`, `bad`, `accent`.

### Layout

- `stack` — Its children one under the other. Props: `gap` s | m | l (default m). Holds any components, at most 30.
- `row` — Its children side by side; on a narrow screen one under the other. Props: `gap` s | m | l (default m). Holds any components, at most 8.
- `grid` — Its children in 1 to 4 equal columns. Props: `columns` whole number 1 to 4 (default 2); `gap` s | m | l (default m). Holds any components, at most 12.
- `card` — A box around its children, with an optional title. Props: `title` text ≤ 80; `tone` tone (default neutral). Holds any components, at most 20.
- `section` — A titled part of the view, with a one-line lead. Props: `title` text ≤ 80 (needed); `lead` text ≤ 200. Holds any components, at most 20.
- `tabs` — Its tabs, one shown at a time. No props. Holds `tab`, at most 6.
- `tab` — One tab of tabs. Props: `label` text ≤ 30 (needed). Holds any components, at most 20. Only inside `tabs`.
- `accordion` — Its panels, each opened and closed on its own. No props. Holds `panel`, at most 12.
- `panel` — One panel of an accordion. Props: `title` text ≤ 80 (needed); `open` true or false. Holds any components, at most 20. Only inside `accordion`.
- `divider` — A thin line between parts, with an optional word on it. Props: `label` text ≤ 40.
- `spacer` — An empty space. Props: `size` s | m | l (default m).

### Text

- `heading` — A heading. Props: `text` text ≤ 120 (needed); `level` whole number 1 to 3 (default 2).
- `text` — A paragraph of plain text; line breaks are kept. Props: `text` text ≤ 2000, lines kept (needed); `tone` tone (default neutral).
- `list` — A bulleted or numbered list of short lines. Props: `items` list of text ≤ 200 (1 to 30 items) (needed); `ordered` true or false.
- `quote` — A quotation, with who said it. Props: `text` text ≤ 600, lines kept (needed); `by` text ≤ 60.
- `code` — A block of code or other text that keeps its spaces and lines. Props: `text` text ≤ 4000, lines kept (needed); `lang` text ≤ 20.
- `badge` — A short word in a pill. Props: `text` text ≤ 30 (needed); `tone` tone (default neutral).
- `key-value` — Facts as a name and its value, one per line. Props: `title` text ≤ 80; `items` list of { `key` text ≤ 60 (needed), `value` text ≤ 200 (needed) } (1 to 20 items) (needed).
- `steps` — Numbered steps, each done, current or still to do. Props: `items` list of { `title` text ≤ 80 (needed), `text` text ≤ 200, `state` done | current | todo (default todo) } (1 to 12 items) (needed).

### Data

- `hero` — The top of a view: a title with a small line above it, a lead and tags. Props: `title` text ≤ 120 (needed); `eyebrow` text ≤ 60; `lead` text ≤ 400; `tags` list of text ≤ 30 (at most 8 items).
- `kpi` — One number with its label, its unit, what it is out of, a note and its recent values. Props: `label` text ≤ 60 (needed); `value` text ≤ 40 (needed); `unit` text ≤ 20; `of` text ≤ 20; `sub` text ≤ 120; `good` up | down; `tone` tone (default neutral); `points` list of number, null for a gap (at most 60 items); `source` text ≤ 120. Give it a `source`.
- `stat-row` — KPIs side by side. No props. Holds `kpi`, at most 6.
- `progress` — A bar showing how far something is, 0 to 100. Props: `label` text ≤ 60 (needed); `value` number 0 to 100 (needed); `text` text ≤ 60; `tone` tone (default neutral).
- `status` — A pill that says how something stands. Props: `text` text ≤ 60 (needed); `tone` tone (default neutral).
- `table` — Rows under column headings; on a phone, a list. Props: `title` text ≤ 80; `columns` list of { `label` text ≤ 40 (needed), `align` left | right | center (default left) } (1 to 12 items) (needed); `rows` list of list of text ≤ 200, may be empty (at most 12 items) (1 to 100 items) (needed); `source` text ≤ 120. Give it a `source`.
- `timeline` — Events in order, each with when it happened. Props: `items` list of { `when` text ≤ 30, `title` text ≤ 80 (needed), `text` text ≤ 200, `tone` tone (default neutral) } (1 to 20 items) (needed).
- `comparison` — Two to four options side by side, row by row; `pick` marks the one the bot recommends (a number from 0). Props: `title` text ≤ 80; `options` list of text ≤ 40 (2 to 4 items) (needed); `rows` list of { `label` text ≤ 60 (needed), `values` list of text ≤ 100, may be empty (1 to 4 items) (needed) } (1 to 20 items) (needed); `pick` whole number 0 to 3.
- `checklist` — Items with a tick for each one done. It only shows them. Props: `title` text ≤ 80; `items` list of { `text` text ≤ 120 (needed), `done` true or false } (1 to 30 items) (needed).

### Charts

- `chart` — Lines, areas, bars, stacked bars or horizontal bars over `labels`; a series is drawn in a colour by its number. Props: `title` text ≤ 80; `style` line | area | bar | stacked | hbar (default line); `labels` list of text ≤ 30 (at most 100 items); `series` list of { `label` text ≤ 40, `points` list of number, null for a gap (at least 1 items) (needed) } (1 to 6 items) (needed); `unit` text ≤ 20; `source` text ≤ 120. Give it a `source`.
- `pie` — Parts of a whole as slices, or as a ring with `donut`. Props: `title` text ≤ 80; `slices` list of { `label` text ≤ 40 (needed), `value` number at least 0 (needed) } (1 to 12 items) (needed); `donut` true or false; `unit` text ≤ 20; `source` text ≤ 120. Give it a `source`.
- `scatter` — Points placed by two numbers, x and y. Props: `title` text ≤ 80; `series` list of { `label` text ≤ 40, `points` list of { `x` number (needed), `y` number (needed) } (at least 1 items) (needed) } (1 to 6 items) (needed); `xLabel` text ≤ 30; `yLabel` text ≤ 30; `source` text ≤ 120. Give it a `source`.
- `histogram` — How many of `values` fall in each of `bins` equal ranges. Props: `title` text ≤ 80; `values` list of number (at least 1 items) (needed); `bins` whole number 2 to 40 (default 10); `unit` text ≤ 20; `source` text ≤ 120. Give it a `source`.
- `sparkline` — A small line of recent values, with no axes. Props: `label` text ≤ 40; `points` list of number, null for a gap (at least 2 items) (needed); `tone` tone (default neutral); `source` text ≤ 120. Give it a `source`.
- `gauge` — One value on a dial between `min` (0) and `max` (100). Props: `label` text ≤ 60 (needed); `value` number (needed); `min` number; `max` number; `unit` text ≤ 20; `tone` tone (default neutral); `source` text ≤ 120. Give it a `source`.

### Media

- `image` — A picture from the bot's files or from an https address botdot fetches. It needs `alt`: what the picture shows. Props: `src` a path among your files or an https address of a picture (png, jpg, jpeg, webp, gif) (needed); `alt` text ≤ 160 (needed); `caption` text ≤ 120.
- `gallery` — Several pictures; each needs `alt`. Props: `items` list of { `src` a path among your files or an https address of a picture (png, jpg, jpeg, webp, gif) (needed), `alt` text ≤ 160 (needed), `caption` text ≤ 120 } (1 to 12 items) (needed).
- `video` — A video from the bot's own files only. It needs `alt`: what it shows. Props: `src` a path among your files (mp4, webm, mov, m4v) (needed); `alt` text ≤ 160 (needed); `caption` text ≤ 120.
- `audio` — A sound from the bot's own files only. Props: `src` a path among your files (mp3, m4a, wav, ogg, oga, opus, aac) (needed); `title` text ≤ 80 (needed).
- `file` — A file of the bot's, to open or save. Props: `src` a path among your files (needed); `title` text ≤ 80.
- `link-card` — A link to a web page, with a line about it and an optional picture. Only an https address opens. Props: `url` https address (needed); `title` text ≤ 80 (needed); `text` text ≤ 160; `image` an https address of a picture.
- `products` — Shopping results as product cards (ADR 113); the first is the bot's pick. Props: `items` list of { `name` text ≤ 120 (needed), `url` https address, `image` https address, `price` text ≤ 30, `was` text ≤ 30, `store` text ≤ 60, `rating` number 0 to 5, `reviews` whole number at least 1, `arrives` text ≤ 60, `why` text ≤ 200 } (1 to 10 items) (needed).

### Feedback

- `callout` — A box that stands out, with a tone. Props: `title` text ≤ 80; `text` text ≤ 400 (needed); `tone` tone (default neutral).

### Inputs

- `text-input` — A one-line box for the owner to type in. It is named `text-input` because `text` is a paragraph. Props: `label` text ≤ 60 (needed); `value` text ≤ 200; `placeholder` text ≤ 80.
- `textarea` — A box of several lines to type in. Props: `label` text ≤ 60 (needed); `value` text ≤ 2000, lines kept; `placeholder` text ≤ 80.
- `number` — A number to type, within `min` and `max`. Props: `label` text ≤ 60 (needed); `value` number; `min` number; `max` number; `step` number at least 0; `unit` text ≤ 20.
- `slider` — One number picked on a line between `min` (0) and `max` (100). Props: `label` text ≤ 60 (needed); `value` number; `min` number; `max` number; `step` number at least 0; `unit` text ≤ 20.
- `range` — Two numbers, `low` and `high`, picked on a line between `min` (0) and `max` (100). Props: `label` text ≤ 60 (needed); `low` number; `high` number; `min` number; `max` number; `step` number at least 0; `unit` text ≤ 20.
- `select` — One option picked from a list that drops down. Props: `label` text ≤ 60 (needed); `options` list of text ≤ 60 (2 to 30 items) (needed); `value` text ≤ 60.
- `multi-select` — Any number of options ticked from a list. Props: `label` text ≤ 60 (needed); `options` list of text ≤ 60 (2 to 30 items) (needed); `values` list of text ≤ 60 (at most 30 items).
- `radio` — One option picked from a few, all shown. Props: `label` text ≤ 60 (needed); `options` list of text ≤ 60 (2 to 8 items) (needed); `value` text ≤ 60.
- `checkbox` — One box that is ticked or not; its label says what it is. Props: `label` text ≤ 60 (needed); `checked` true or false.
- `toggle` — A switch that is on or off; its label says what it is. Props: `label` text ≤ 60 (needed); `on` true or false.
- `date` — A day picked, as YYYY-MM-DD; `min` and `max` bound it. Props: `label` text ≤ 60 (needed); `value` text ≤ 10; `min` text ≤ 10; `max` text ≤ 10.
- `time` — A time of day picked, as HH:MM. Props: `label` text ≤ 60 (needed); `value` text ≤ 5.
- `rating` — A grade from 1 to `max` (5), shown as stars. Props: `label` text ≤ 60 (needed); `max` whole number 3 to 10 (default 5); `value` whole number 0 to 10.
- `segmented` — One option picked from two to six short ones, side by side. Props: `label` text ≤ 60 (needed); `options` list of text ≤ 30 (2 to 6 items) (needed); `value` text ≤ 30.

### Actions

- `button` — A button that sends `send` (or its label) as the owner's next message. The page shows `send` on the button. It approves, runs and changes nothing. Props: `label` text ≤ 60 (needed); `send` text ≤ 200; `tone` tone (default neutral).
- `button-group` — Buttons side by side. Props: `label` text ≤ 60. Holds `button`, at most 8.
- `link` — A link that opens a web page; only an https address opens. Props: `label` text ≤ 60 (needed); `url` https address (needed).
- `copy` — A button that copies `text` to the owner's clipboard. Props: `label` text ≤ 60 (needed); `text` text ≤ 2000, lines kept (needed).

<!-- ui-catalog:end -->

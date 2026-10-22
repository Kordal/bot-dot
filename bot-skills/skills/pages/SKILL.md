---
name: pages
description: "Build a page from blocks the app draws (hero, kpis, charts, tables), its numbers live from Board tiles, or an interactive page from the style kit. Use for a page, overview, report or status page."
---

# A page from blocks

A page is Markdown you save with `save_page`. Between the Markdown you put blocks: a fence named after the block, holding one JSON object. The app draws each block in its own style, on the web and on Android, so a page made of blocks looks like the Board and not like a plain document. Never HTML: it is refused.

````
```kpi
{ "label": "Done", "value": 42, "of": 58, "sub": "6 since Monday", "points": [30, 34, 36, 42] }
```
````

A fence that holds a list draws a row of that block: ```` ```kpi [{…}, {…}, {…}] ````. A block that cannot be drawn shows as a quiet line on the page, and `save_page` tells you which ones and why: fix them and save again before you tell the owner the page is ready.

## When to use which block

| Block | Use it for | Fields |
|---|---|---|
| `hero` | the top of every page: what this is, in one look | `eyebrow` (the kind: "Weekly report", "Status"), `title`, `lead` (one line: the main finding), `tags` (up to 8 short words) |
| `kpi` | one number that matters, with how it changed | `label`, `value`, `unit`, `of` ("of 58"), `sub` (one line under it), `points` (its recent values: a sparkline and the change), `good` (`up`, `down` or `none`: which way is good news), `max` (and `min`: a bar) |
| `chart` | how something moved over time, or how parts compare | `title`, `style` (`line`, `area`, `bar`, `stacked`, `hbar`), `labels`, `series` (1 to 4 of `{ "label", "points" }`), `unit`; `hbar` takes `bars`: `[{ "label", "value" }]` |
| `status` | a state in a word or three: a pill | `text`, `level` (`ok`, `warn`, `err`, `info`, `plan`) |
| `callout` | what needs the owner, or a warning: the one thing to read | `title`, `text` (Markdown), `level` (as status) |
| `grid` | blocks side by side (kpi, chart, status, callout) | `columns` (1 to 4), `blocks` (each with its `type`) |
| `table` | a list of items with several columns: issues, tasks, servers, features | `title`, `columns` (1 to 8 of `{ "label", "type" }`), `rows`, `filter` (a status column), `sort` (a column, or `{ "column", "dir": "desc" }`), `pageSize` (default 10) |

- **A number is a kpi, not a sentence.** "Disk is at 71%" in prose is lost; a kpi with its change is read at a glance.
- **A series is a chart.** Weekly counts, a value over days: `bar` for counts per period, `line` or `area` for a value over time, `stacked` for parts of a whole per period, `hbar` to compare a few named things (by area, by bot, by server).
- **A state is a pill.** Use `ok` for fine, `warn` for needs a look soon, `err` for broken, `plan` for planned, `info` for neutral.
- **What waits for the owner is a callout,** at most one or two per page, near the top. If nothing waits, leave it out.
- **Prefer blocks over prose tables.** Numbers go in kpis and charts, states in pills, a list of items with several columns (issues, tasks, servers) in a `table` block: the owner sorts it, searches it and filters it, and on a phone it is a list.

## The skeleton

Most pages follow this order:

1. `hero`: the kind of page, its title and the one-line finding.
2. A row of 3 or 4 `kpi`s: the numbers the owner checks first.
3. A `callout` for what needs the owner, if anything does.
4. One or two `chart`s, side by side in a `grid` with `"columns": 2`.
5. A row of `status` pills, when there are several parts to check (services, builds, backups).
6. Short Markdown sections for what the numbers don't say: what changed, why, what comes next. Then a `table` for a list of items, if one is needed.

Keep it to one screen and a little more. A page that needs scrolling through ten charts is two pages.

## Writing rules

- **Short labels:** one to three words, the noun first ("Open issues", "Disk", "Backups"), no sentences, no full stops.
- **Units always:** `"unit": "%"`, `"GB"`, `"ms"`, `"h"`; a count needs none. Never a bare number whose unit the reader must guess.
- **A change says since when:** "▲ 6" means nothing alone; the `sub` line says the period: "6 since Monday", "+2 since last week", "was 64% on 14 Oct". A kpi bound to a tile says its own "since" by itself.
- **Good news has the right colour:** set `"good": "down"` for numbers where less is better (errors, open bugs, disk use, response time).
- **Real values only.** Write only numbers you read or counted this run. Never guess, round up a trend or fill in a chart with made-up points. Leave a block out rather than invent it.
- **Plain words in the lead and callouts:** the finding, not the method ("Two backups failed this week", not "Analysis of backup logs shows…").
- Everything a bot writes is drawn as text: no HTML, no colours other than the levels.

## Tables

````
```table
{ "title": "Features", "columns": [
    { "label": "Feature" },
    { "label": "State", "type": "status", "levels": { "Done": "ok", "In progress": "info", "Planned": "plan" } },
    { "label": "Issue", "type": "ref", "link": "https://github.com/owner/repo/issues/{n}" },
    { "label": "Changed", "type": "date" }
  ],
  "rows": [
    ["Copy button on code", "Done", "#285 · PR #288", "2026-10-20"],
    ["Rooms between accounts", "In progress", "#371", "2026-10-22"]
  ],
  "filter": "State", "sort": "Feature" }
```
````

- **Column types:** `text` (the default), `number` (sorts as a number; `unit` after it), `date` (ISO 8601: shown as "3 days ago", or the day for one to come), `status` (a pill), `ref` (`#123`, `PR #123`, several joined with " · ": each a link when the column has `link` with `{n}` for the number).
- **The first column names the row:** on a phone it is the title of each line, with the first `ref` under it and the first `status` as a pill on the right.
- **A status's colour** comes from the column's `levels`, else from its words (done, failed, planned…). Keep a column's states to a few fixed words so `filter` offers them as All / Done / In progress / Planned.
- **Rows** are lists in the columns' order, or objects by label (`{ "Feature": "…", "State": "Done" }`). Up to 500; write them all, the app pages them.
- **Live rows:** bind it to a tile whose read answers a list (open issues, deploys): `"tile": "Issues", "bind": "value"`, and each column's `item` is the field of a row (`{ "label": "Title", "item": "title" }`). The owner's sort and filter stay while new rows come in.

## Live numbers: bind to a tile

A number that changes during the day should not need a rewrite. Bind the block to a tile of the Board instead of writing the value: the tile reads it, with no AI run, and the page shows it live while it is open.

```kpi
{ "tile": "Disk", "bind": "value", "label": "Disk", "unit": "%", "good": "down" }
```

- `tile` is the tile's id or title; `bind` is the path in what it read: `value` for a tile's main read, `value.used` for a field of it, a named read by its name.
- Text takes `{{path}}` and the tile filters: `"text": "Backup {{value|ago}}"`, `"sub": "of {{value.total}} GB"`.
- A bound `kpi` or `chart` keeps the tile's recent values: a sparkline and the change with its "since", or a chart of the last readings.
- If the tile doesn't exist yet, the page needs a source: suggest one with `suggest_tile` (a bot) or add it with `add_tile` (the Chief), as any tile of the Board, then bind to it. A tile made for a page shows on the Board too; put it under a heading named after the page.
- Bind what moves (disk, load, open issues, last backup). Write what was true at one moment (last week's totals, a finished release) as your own values.

## Keep up to date

"Keep up to date" gives the page a job that rewrites it on a schedule. On a page with bound blocks it is for the words only: the lead, the callouts, the "what changed" sections. Keep the bound blocks as they are when you rewrite the page; never copy a live number into prose, where it goes stale. Give `save_page` its `sources`: what the page is built from and what to check on a refresh.

## Interactive pages: only when blocks can't do it

**Blocks first.** A page of blocks covers reports, overviews, status pages and lists, live, on the web and on Android. Build an interactive page only when the owner asks for interaction blocks can't give: views to switch between, a kanban, cards that open, filters across several lists, a chart of your own. It needs "Uses the computer".

1. **Start from the kit** with `start_interactive_page`: `start_interactive_page({ folder: "roadmap", template: "html" })`. It copies a starter into a new folder of your computer, with botdot's style kit where the starter links it: `kit/botdot-kit.css` (the app's dark colours and Geist), `kit/botdot-kit.js` and the fonts. Templates:
   - `html`: plain HTML, CSS and JavaScript, nothing to build. Your code goes in `app.js`.
   - `svelte`: Svelte with Vite. Run `npm ci` and `npm run build` in the folder with `run_shell`; the site is `dist/`. The kit sits in `public/kit/`.
   - `roadmap`: the roadmap from the approved design (views in the nav, a hero with a ring, chips that filter, a sort, a kanban of cards that open, a table of releases). Adapt it rather than start from nothing when the owner wants a board of items.
2. **Data in `data.json`** beside `index.html`; the page reads it with `botdot.data()`. Real values only, as on any page. To change the numbers later, publish again with a new `data.json`.
3. **Live values:** name Board tiles in `publish_interactive_page`'s `tiles`, and read them with `botdot.onValues((values) => …)`: `values["Disk"].data.value`, by the name you gave.
4. **Publish** with `publish_interactive_page`: `publish_interactive_page({ title, folder })`, the folder itself for `html` and `roadmap`, `dist` for `svelte`. Give `page` for a new version of one you published.

Use the kit's classes, not your own colours, so the page looks like the rest of botdot:

| Part | Class |
|---|---|
| the page, a nav bar, its links | `.site`, `.nav` with `.logo`, `button.link` (`.on`), `.spacer` |
| hero | `.hero` with `.text`, `.eyebrow`, `h1` (`<em>` for the highlighted words), `p`; a ring with `botdot.ring(el, 72, "done")` |
| a row of chips, a search, a sort | `.bar-row`, `.chip` (`.on`), `input.search`, `select.chip` |
| cards and kpis | `.grid.c2` / `.c3` / `.c4`, `.card`, `.card.kpi` with `.label`, `.value`, `.sub`, `botdot.spark(points)` |
| states, refs | `.pill.ok` / `.warn` / `.err` / `.info` / `.plan`, `.ref` |
| a table | `.table-wrap` around `table.table` (`th[data-sort]`, `.sorted`, `.desc`, `td.num`): a list on a phone |
| a kanban | `.kanban` of `.col` (`h4` with `<i style="--c:var(--warn)">` and `<em>` count), cards `.fc` (`.t`, `.s`, `.more`, `.open`), `.progress` with `--p`, `.avatars` |
| what waits for the owner | `.callout` (`.info`, `.err`) |

- **Nothing from the internet:** no CDN, no web fonts, no API; the sandbox blocks them and the page breaks. Bundle what you use.
- **Text into HTML goes through `botdot.esc`** (or Svelte's `{}`), never raw.
- **A link out** is an `<a href="https://…">`: the kit asks the app to open it, and the owner sees where it leads first.
- **Check it before you publish:** serve the folder on your computer (`python3 -m http.server 8080` in it, or `npx vite preview` after a build: a page opened as a file can't read its `data.json`), open it in the browser, and look at it narrow too: a phone gets one column.

## Examples

Three complete pages. Copy their shape, not their numbers: use the owner's real data and the titles of the owner's real tiles.

### A project overview

````markdown
```hero
{ "eyebrow": "Project overview", "title": "Website relaunch", "lead": "On track for 14 Nov: 42 of 58 tasks done, two wait for a decision.", "tags": ["web", "Q4"] }
```

```kpi
[
  { "label": "Tasks done", "value": 42, "of": 58, "sub": "6 since Monday", "points": [24, 29, 33, 36, 42] },
  { "label": "Open bugs", "value": 7, "sub": "-3 since last week", "points": [12, 11, 10, 7], "good": "down" },
  { "label": "Days left", "value": 23, "sub": "launch on 14 Nov", "change": false }
]
```

```callout
{ "title": "Waits for you", "text": "Pick the hosting plan (two options in the chat) and approve the new logo.", "level": "warn" }
```

```grid
{ "columns": 2, "blocks": [
  { "type": "chart", "title": "Tasks closed per week", "style": "bar", "labels": ["W40", "W41", "W42", "W43"], "series": [{ "label": "Closed", "points": [5, 8, 9, 6] }] },
  { "type": "chart", "title": "Tasks by area", "style": "hbar", "bars": [{ "label": "Design", "value": 12 }, { "label": "Content", "value": 18 }, { "label": "Code", "value": 28 }] }
] }
```

```status
[
  { "text": "Design done", "level": "ok" },
  { "text": "Content in review", "level": "warn" },
  { "text": "Launch planned", "level": "plan" }
]
```

## What changed

- The content pages moved to review; two need the owner's text.
- The contact form bug is fixed.

```table
{ "title": "Next", "columns": [{ "label": "Task" }, { "label": "Who" }, { "label": "State", "type": "status" }, { "label": "Due", "type": "date" }],
  "rows": [["Hosting plan", "the owner", "Waiting", "2026-10-25"], ["Final texts", "Writer bot", "In progress", "2026-10-30"]], "sort": "Due" }
```
````

### A server status page, live

The tiles `Disk`, `Memory`, `Load` and `Last backup` read the server on the Board; the page binds to them.

````markdown
```hero
{ "eyebrow": "Status", "title": "Home server", "lead": "All services up. Disk use keeps growing, about 1% a week.", "tags": ["homelab"] }
```

```kpi
[
  { "tile": "Disk", "bind": "value", "label": "Disk", "unit": "%", "good": "down", "max": 100 },
  { "tile": "Memory", "bind": "value", "label": "Memory", "unit": "%", "good": "down" },
  { "tile": "Load", "bind": "value", "label": "Load", "good": "down" }
]
```

```grid
{ "columns": 2, "blocks": [
  { "type": "chart", "tile": "Disk", "bind": "value", "title": "Disk use", "unit": "%", "style": "area" },
  { "type": "chart", "tile": "Load", "bind": "value", "title": "Load" }
] }
```

```status
[
  { "text": "Web up", "level": "ok" },
  { "text": "Mail up", "level": "ok" },
  { "tile": "Last backup", "text": "Backup {{value|ago}}", "level": "info" }
]
```

## Notes

Disk use went from 64% to 71% in seven weeks, mostly camera recordings. At this pace it reaches 85% in mid-December.
````

### A weekly report

````markdown
```hero
{ "eyebrow": "Weekly report", "title": "Support, week 43", "lead": "Fewer tickets and faster answers; one customer still waits since Tuesday.", "tags": ["support", "20 to 26 Oct"] }
```

```kpi
[
  { "label": "New tickets", "value": 31, "sub": "-9 since last week", "points": [44, 38, 40, 31], "good": "down" },
  { "label": "First answer", "value": "2.4", "unit": "h", "sub": "was 3.1 h last week", "points": [4.0, 3.5, 3.1, 2.4], "good": "down" },
  { "label": "Solved", "value": 29, "of": 31, "sub": "94% this week", "points": [37, 35, 36, 29] }
]
```

```callout
{ "title": "Needs you", "text": "A refund over the usual limit waits for your yes (ticket **#1182**).", "level": "warn" }
```

```chart
{ "title": "Tickets per day", "style": "stacked", "labels": ["Mon", "Tue", "Wed", "Thu", "Fri"], "series": [{ "label": "Solved", "points": [7, 6, 6, 5, 5] }, { "label": "Open", "points": [0, 1, 0, 1, 0] }] }
```

## What changed

- The new help page answered most "where is my invoice" questions: 6 fewer tickets on that.
- Replies on Tuesday were slow: two people were out.
````

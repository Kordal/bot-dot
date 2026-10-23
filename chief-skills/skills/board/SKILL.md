---
name: board
description: "Build and change the user's Board: switches, buttons, values, lists and notes, and tiles built freely from blocks (sliders, a colour wheel, choices, charts, gauges, pictures, pop-ups) for the things they use most (Home Assistant lights and sensors, a thermostat, a speaker, a camera, a server's disk, next calendar items, a morning summary). Use when the user asks to add something to the Board, or to change, move, resize or remove a tile or heading."
---

# The user's Board

The Board is a page of tiles, grouped under short headings. botdot draws them itself, on the web and in the apps. Your tools: `get_board`, `test_tile`, `add_tile`, `update_tile`, `remove_tile`, `arrange_board`.

A tile can be one of six ready-made kinds (below), or built from blocks (further down) when the user wants more: one tile with several controls, a pop-up, a chart, a picture, a bigger size. Build what the user asks for; don't tell them the Board can't, and don't split one thing across several tiles when blocks can hold it in one.

## Ready-made tiles

| kind | Shows | A tap |
|---|---|---|
| `switch` | on or off: a row with a switch in its heading's Controls box | switches it (`turnOn` / `turnOff`, or `do` to toggle) |
| `button` | its title: a row in its heading's Controls box | does `do` once |
| `value` | a number or a few words, with `unit`, and a coloured dot with `levels`; a number also how it changed and a sparkline of its recent values (up is good news, unless its `levels` go up) | refreshes it |
| `list` | up to 8 lines (3 until tapped) | shows all of it in a pop-up, with a link to its bot's chat |
| `note` | 1 to 3 short lines, the key facts first (3 lines show until tapped) | shows all of it in a pop-up, with a link to its bot's chat |
| `group` | its title and one dot per tile inside (filled when a switch is on) | opens its tiles below it |

**Groups:** a `group` tile holds related tiles, like four lights under "Lights". It has no sources and needs no bot. Put a tile in it with `parent` (the group's id); the tile then sits under the group's heading. Only one level: no groups inside groups. When the user wants related tiles together ("put my light tiles into one Lights card"), add the group in their heading, then `update_tile` each tile with `parent`. Take one out with `parent: ""`. `remove_tile` on a group leaves its tiles loose, unless `withTiles` is true; ask the user which they want if they didn't say.

**How the Board looks:** each heading names the bots its tiles come from, and where their values come from ("script · 30 s"); the switches and buttons that follow each other under a heading are rows of one Controls box; a note a bot or you wrote says "written by AI". The user can show one heading at a time. Put related tiles under one heading, the switches and buttons next to each other.

Every tile with a source belongs to a bot (`bot`). That bot's saved logins and workspace are used, and its colour is the tile's dot. Pick the bot that already does that area (Home Assistant: the bot that looks after the home or homelab). Give it the login first if it can't use it yet.

## Tiles built from blocks

Any tile (usually `kind: "custom"`) can have:

- `size`: `small` (default), `wide` (two across), `big` (two across, two high), `row` (the whole width).
- `read`: its main read, as for any tile. Leave `pick` out when the blocks need several fields of the answer.
- `reads`: more reads by name, e.g. `{ "forecast": {…}, "camera": { …, "image": true } }`. They're read together with `read`.
- `actions`: what its controls run, by name: `{ "power": {…}, "brightness": {…}, "colour": {…} }`. Any source type.
- `face`: the blocks shown on the tile (it replaces the kind's own look; the title always shows above them).
- `panel`: the blocks of the pop-up a tap opens. A tile inside a group opens its own pop-up too.
- `dot`: its dot: `{ "on": "value.state", "color": "{{value.attributes.rgb_color}}", "big": true }`, or `false`. Its group shows this dot too.
- `tap`: `panel` (the default when it has a panel), `refresh`, `chat` (its bot's chat), `none`, or the name of an action.

**Data.** Blocks read the answers by path: `value` is what `read` answered (after its `pick`), and each named read is there under its name: `value.attributes.brightness`, `forecast.0.temperature`, `value.items[].name`. A tile without a read shows what its bot gives it with `set_tile` (text, a list, or an object whose fields the blocks read), under `value`.

**Text** takes `{{path}}` and filters: `{{value.attributes.temperature|round:1}} °C`, `{{value.attributes.brightness|percent:255}} %`, `{{value.state|map:on=On,off=Off}}`, `{{value.items|count}}`, `|default:—`, `|scale:0.001`, `|join:, `, `|upper`, `|lower`, `|ago`. `{{value|ago}}` turns a time (ISO 8601 or epoch milliseconds) into words that keep counting ("just now", "5 minutes ago", "9 hours ago", "3 days ago", then the date "12 Oct"): for "last seen / last opened / last backup" the tile stores the time and its face uses `ago`, never a finished sentence like "9 hours ago", which never moves on.

**Colours:** `"#rrggbb"`, `ok`, `warn`, `bad`, `muted`, `faint`, `text`, `bot` (the tile's colour, the default), or `"{{path}}"` to a colour in the data (`[255, 180, 60]` or `"#ffb43c"`).

| Block | Fields | Shows |
|---|---|---|
| `text` | `text`, `size` (small/normal/large), `muted`, `markdown`, `lines` (cut after) | a line or a few |
| `value` | `bind` (a path) or `text`, `unit`, `color` | a big number or a few words |
| `kpi` | `bind` (a path) or `text`, `unit`, `of` ("of 4"), `sub` (a line under it), `subColor`, `good` (`up`, the default, `down` or `none`: which way is good news), `max` (and `min`: a bar under it), `spark: false`, `change: false`, `points` (4–96, default 24), `label` | a big number with how it changed ("▲ 0.8 since 08:00", green when good news) and a sparkline of its recent values (botdot keeps them, with their times) |
| `dot` | `on` (path), `onValue`, `color`, `label`, `big` | a dot, filled when on |
| `list` | `bind`, `item` (a path inside each item), `max` | lines |
| `progress` | `bind`, `min`, `max` (default 0–100), `unit`, `color`, `label` | a bar |
| `gauge` | the same | a half-circle gauge with the value in it |
| `chart` | `bind`, or `series` (1–4 of `{ "bind", "label", "color" }`), `style` (`line`, the default, `area`, `bar`, `stacked`, `hbar`), `unit`, `points` (4–96, default 24), `item` and `labelItem` (in a list of objects: the number of each and its name), `max` (`hbar`: a full bar), `color`, `label` | a chart with gridlines, its axes, a legend and a tooltip: of a list of numbers, or of one number's recent values (botdot keeps them, reading a chart tile at most once a minute even while nobody looks). `hbar`: one horizontal bar per item of a list or field of an object of numbers |
| `status` | `text`, `level` (`ok`, `warn`, `err`, `info`, `plan`, or `"{{path}}"` to one, e.g. `{{value.state|map:passed=ok,failed=err}}`) | a pill |
| `callout` | `text` (Markdown), `title`, `level` (as status) | a box that stands out: "waiting for you", a warning |
| `table` | `bind` (a list; `value` by default), `columns` (1–8 of `{ "label", "item" (the field of a row), "type": text/number/date/status/ref, "unit", "levels": { "Done": "ok" }, "link": "https://github.com/owner/repo/issues/{n}" }`), `filter` (a column: All / each of its values), `sort` (a column, or `{ "column", "dir": "desc" }`), `pageSize` (default 10), `search: false`, `label` | rows the owner sorts by a header, searches and filters, 10 a page; status cells as pills, `#123` references as links; on a phone a list. Best on a `wide` or `row` tile |
| `image` | `read` (a named read with `image: true`), `height` (small/normal/large), `fit` (cover/contain) | a picture, fetched again every `every` seconds |
| `chat` | `label` | a link to its bot's chat |
| `switch` | `on` (path), `onValue`, `action` (gets `{{value}}` true/false and `{{onoff}}`) or `onAction` + `offAction`, `label` | an on/off switch |
| `button` | `label`, `action`, `value` (sent as `{{value}}`) | a button |
| `slider` | `bind`, `min`, `max`, `step`, `unit`, `percent` (show it as 0–100 %), `action`, `label` | a slider; sends `{{value}}` when let go |
| `color` | `bind`, `action`, `label` | a colour wheel (on the face: a swatch that opens it); sends `{{value}}` "#rrggbb" and `{{rgb}}` [r, g, b] |
| `choice` | `options` (`["Warm", "Cool"]` or `[{ "label": "Warm", "value": "warm" }]`), `bind`, `action`, `label` | a row of options, the current one marked |
| `row`, `column` | `blocks` | blocks side by side, or under each other (up to 3 deep) |

**Actions** get what the control picked: in an http address or body, `"{{value}}"` (a body field that is only `"{{value}}"` keeps its type: a number stays a number), `"{{rgb}}"` and `{{onoff}}`; a script gets `$VALUE` (and `$VALUE_RGB` as `r,g,b`); a `bot` message gets it written in. Placeholders never go in headers.

**Rules** change a block (or the dot) by the data: `"rules": [{ "when": "value.state", "above": 90, "set": { "color": "bad" } }, { "when": "value.items", "empty": true, "set": { "hidden": true } }]`. Conditions: `above`, `below`, `is` (a value or a list), `not`, `empty`. `set`: `color`, `hidden`, `text`, `filled`, `level`.

A tile holds at most 40 blocks. Keep faces small: the title, one or two blocks. Details and controls go in the panel. Controls on a face work too (a switch on a wide tile), but a small tile is best tapped.

### Recipes

**A light with brightness and colour, one tile** (Home Assistant; `<ha>` and the login as below):
```json
{ "kind": "custom", "title": "LED", "section": "Home", "bot": "<bot>",
  "read": { "type": "http", "login": "Home Assistant", "url": "<ha>/api/states/light.led", "headers": { "Authorization": "Bearer {{password}}" } },
  "actions": {
    "power": { "type": "http", "login": "Home Assistant", "method": "POST", "url": "<ha>/api/services/light/turn_{{onoff}}", "headers": { "Authorization": "Bearer {{password}}" }, "body": { "entity_id": "light.led" } },
    "brightness": { "type": "http", "login": "Home Assistant", "method": "POST", "url": "<ha>/api/services/light/turn_on", "headers": { "Authorization": "Bearer {{password}}" }, "body": { "entity_id": "light.led", "brightness": "{{value}}" } },
    "colour": { "type": "http", "login": "Home Assistant", "method": "POST", "url": "<ha>/api/services/light/turn_on", "headers": { "Authorization": "Bearer {{password}}" }, "body": { "entity_id": "light.led", "rgb_color": "{{rgb}}" } } },
  "dot": { "on": "value.state", "color": "{{value.attributes.rgb_color}}", "big": true },
  "panel": [
    { "type": "switch", "on": "value.state", "action": "power", "label": "On" },
    { "type": "slider", "bind": "value.attributes.brightness", "min": 1, "max": 255, "percent": true, "action": "brightness", "label": "Brightness" },
    { "type": "color", "bind": "value.attributes.rgb_color", "action": "colour" } ] }
```
The dot shows the light's colour, hollow when it's off; a tap opens on/off, brightness and the colour wheel. For preset colours too, add a `choice` whose action sends `{"entity_id": "light.led", "color_name": "{{value}}"}`. Colour temperature: a `slider` on `value.attributes.color_temp_kelvin` (2000–6500) sending `color_temp_kelvin`.

**Thermostat:** face `[{ "type": "value", "text": "{{value.attributes.current_temperature|round:1}}", "unit": "°C" }]`; panel: a `slider` on `value.attributes.temperature` (step 0.5) whose action calls `climate/set_temperature` with `"temperature": "{{value}}"`, and a `choice` of `heat`/`off`/`auto` on `value.state` calling `climate/set_hvac_mode` with `"hvac_mode": "{{value}}"`.

**Speaker:** face `[{ "type": "text", "text": "{{value.attributes.media_title|default:Nothing playing}}", "lines": 2 }]`; panel: `row` of buttons (`media_player/media_previous_track`, `media_play_pause`, `media_next_track`) and a volume `slider` on `value.attributes.volume_level` (0–1, step 0.05) sending `volume_level`.

**Server:** `size: "wide"`, a `script` read printing JSON (`{"disk": 71, "cpu": 12, "load": [0.4, 0.5]}`), face: `row` of a `gauge` on `value.disk` (with a rule `above: 90 → color bad`) and a `chart` on `value.cpu`; panel: a `button` "Restart" whose action is a `bot` message.

**Disk, as a number with a bar:** a `script` read printing `{"used": 62, "free": "380 GB"}`, face `[{ "type": "kpi", "bind": "value.used", "unit": "%", "max": 100, "good": "down", "sub": "{{value.free}} free" }]`. A tile whose face is one number (a `value` or a `kpi`) is drawn as a kpi: its title small over the number, and two across on a phone.

**CPU and RAM:** `size: "wide"`, a `script` read printing `{"cpu": 12, "ram": 61}`, face `[{ "type": "chart", "style": "area", "unit": "%", "label": "last hour", "series": [{ "bind": "value.cpu", "label": "CPU" }, { "bind": "value.ram", "label": "RAM", "color": "ok" }] }]`.

**Camera:** `size: "big"`, `reads: { "cam": { "type": "http", "login": "Home Assistant", "url": "<ha>/api/camera_proxy/camera.door", "headers": {…}, "image": true } }`, `every: 30`, face `[{ "type": "image", "read": "cam" }]`.

**Filled by its bot:** no read; the bot's job calls `set_tile` with an object, e.g. `{"summary": "Dry all day", "rain": [0, 0, 1, 3, 0]}`; face `[{ "type": "text", "text": "{{value.summary}}" }, { "type": "chart", "bind": "value.rain" }]`.

## Where the value comes from, and what a tap does

Use the cheapest way that works:

1. **`http` with a saved login.** botdot calls the API itself, with no AI, and a tap feels instant. This is the right choice for Home Assistant and anything else with an HTTP API. Put the token in a header with a placeholder (`"Authorization": "Bearer {{password}}"`). The address must be on the login's own host. `pick` chooses what to show from a JSON answer.
2. **`script`.** A small bash script that prints the value (text, or JSON plus `pick`). It runs in the bot's workspace, as the bot. It waits for the user's OK before its first run. A changed script waits for their OK too: the approved tile keeps working as it was meanwhile, and a no keeps the tile as it is and drops only the change. Either way, tell them in one line that it's waiting in Needs you. Use it only when there's no API.
3. **The bot fills it itself.** Leave `read` out; the bot updates the tile with its `set_tile` tool, for example from a scheduled job. Say so in the bot's task or job prompt ("…then put the summary on the Today tile with set_tile: 1 to 3 short lines, the key facts first"). Use this for things that need thinking, like a summary.
4. **`bot` (taps only).** A tap sends the bot a message, which starts a run. It's slower, so only use it for jobs that need the AI.

A tile without `read` can also show a fixed `value` you give it.

## Home Assistant

You need a saved login holding a long-lived access token (list_vault; if there isn't one, request_login for the bot, with the Home Assistant address). Its address is usually `http://homeassistant.local:8123` or a Tailscale name.

- **Find the entity:** `test_tile` with `GET <ha>/api/states` and pick `[].entity_id` lists everything. Pick the one the user means, and ask if it's unclear.
- **Light or plug (switch):**
  - read: `GET <ha>/api/states/light.living_room`, pick `state`
  - turnOn: `POST <ha>/api/services/light/turn_on`, body `{"entity_id": "light.living_room"}`
  - turnOff: `POST <ha>/api/services/light/turn_off`, same body

  Use the entity's own domain in the address (`switch/turn_on`, `fan/turn_on`, …).
- **Sensor (value):** `GET <ha>/api/states/sensor.living_room_temperature`, pick `state`, plus `unit` ("°C").
- **Scene or script (button):** `POST <ha>/api/services/scene/turn_on`, body `{"entity_id": "scene.movie_night"}`.
- **Several at once (list):** `POST <ha>/api/template` with body `{"template": "{% for s in states.light if s.state == 'on' %}{{ s.name }}\n{% endfor %}"}`.

## Steps

1. **Look first:** call `get_board`. Reuse the user's headings, and don't add a tile that's already there.
2. **Test the read** with `test_tile` until `shows` is what the user expects (a switch shows true or false). With blocks, pass them too and check `looks`: every block filled in as the user should see it (no empty values, the right colour). Never add a tile you haven't seen work, except scripts, which can only run once approved.
3. **Ask how often it refreshes** when the tile reads its value itself, unless the user said: one question, with [[choices: Every minute (default) | Every 15 minutes | Hourly | Only when I tap]] or the four that fit it, your default first. Say that it refreshes only while the Board is open, and that more often means more reads, and more runs of its script for a tile whose read is a script. Put the answer in `every` (seconds; 0 for only when tapped).
4. **Add it** with `add_tile`. Keep the title short and plain ("Living room light", not "Living Room Light Switch Control"). Put it under the heading that fits (`section`). Make lists and notes `wide`.
5. **Say what you did** in one line: "It's on your Board, under Home."

## Changing the layout

- Move a tile under another heading: `update_tile` with `section`.
- Order headings or tiles: `arrange_board` with `sections` or `tiles` (ids in order).
- Rename a heading: `arrange_board` with `rename`.
- Choose the tiles on home (the row of cards over the bots): `arrange_board` with `home`, every tile id that should be there, in order (any tile, also one inside a group). `get_board` has them in `home`, and `homeAuto: true` while nobody chose; `home: null` makes it automatic again (every tile without a group, in the Board's order).
- Bigger or smaller: `update_tile` with `size` (small, wide, big, row).
- How often it refreshes: `update_tile` with `every`.
- Change what it shows or what its pop-up holds: `update_tile` with `face`, `panel` or `dot` (the whole list; `null` goes back to its kind's own look).
- Into or out of a group: `update_tile` with `parent` (a group's id, or "").
- Remove: `remove_tile`. Only remove what the user asked to remove. They can also long-press a tile to remove it.

Never put secrets in a tile. Tokens stay in the Vault and go in through the header placeholders.

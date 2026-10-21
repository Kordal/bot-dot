# ADR-025: What a run did is no row under a reply

- **Status:** Accepted (2026-10-14, the owner's decision)
- **Owning task:** none (the owner's decision)
- **Widens:** [ADR 024](024-a-done-memory-change-is-no-row-under-a-reply.md)

## Context

After ADR 024 a bot's reply still ended in gray rows for the other things its run did: "Used todoist: todoist get all tasks" for each action in a connected app, "Created skill …" and "Updated skill …" for a skill it wrote, and "Added job …", "Changed job …" or "Removed job …" for a scheduled job. A job's run that reads an app several times ends in a run of identical-looking rows. The owner, on 2026-10-14, of the "Used todoist" rows under a Todo Tracker reply: "this info about what skill was used and other should not be visible in the app or web".

## Decision

- **A bot's run sends the apps only what waits for the owner.** Of a run's `learned` items, `memory-pending`, `skill-pending`, and a `job` or `instructions` item whose text ends with `waiting for your approval` are sent. Every other item is left out: `connector`, `skill`, `skill-updated`, a `job` that was done, an `instructions` item of a run from 24 to 29 September 2026 that changed them at once ("Updated its …"), the memory kinds of ADR 024, and a kind added later unless it is added to the list. (Widened by [ADR 050](050-a-bot-saves-a-skill-it-wrote-without-an-ok.md): `skill` and `skill-updated` are sent too, since no card asks about them.)
- **The filter is the one ADR 024 made** (`learnedSent` in `lib/learning.js`), applied when the server sends, not when it stores: the run's record, its log and the index of past runs keep every item. Old runs lose these rows too, and an app of any version stops showing them without an update.
- **A job and an instructions item are told apart by their text,** as a Chief's waiting memory chip is: the server has written `waiting for your approval` at the end of every such item that waits since they were first recorded, and no done one ends that way (the writer and the rule share `WAITS` in `lib/learning.js`). A job named so that its name ends in those words would show when done; no marker is added, so old records read the same.
- **The Chief's chips stay.** "Created Coder", "Started Web Surfer" and the like are left as they are: a tap on one opens the bot or the run. The owner chose this scope.

## Alternatives

- **Hide only the `connector` rows.** The owner asked for "and other" too.
- **Hide the Chief's done chips as well.** They lead somewhere; the owner kept them.
- **Filter in each app.** As in ADR 024: three changes, and an older app would keep the rows.

## Consequences

- **A skill written or a job changed is seen in the bot's reply, its settings and its jobs,** no longer on a row. The bot's instruction "When you learned something, say so in one short line at the end of your reply" stays.
- **The apps change nothing.** The web page, Android and the Mac app still draw a row for any kind they are sent; they are sent fewer.
- **No feature is announced.** Apps receive fewer items; an older app keeps working.

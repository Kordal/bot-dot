# ADR-024: A done memory change is no row under a reply

- **Status:** Accepted (2026-10-13, the owner's decision)
- **Owning task:** [#391](https://github.com/Kordal/bot-dot/issues/391)

## Context

A bot's run that saves, changes, pins, removes, brings back or forgets a note shows a gray row under its reply on the web page, in the Android app and in the Mac app: "🧠 Remembered, its own conclusion: …", "Updated …", "Removed …", "Forgot 2 notes". A Chief reply shows the same rows for the notes it files ([ADR 017](017-the-chief-files-a-note-with-a-bot-in-the-owners-turns.md), "The chip names the place").

Since Milestone 9 memory has no screen in any app, so such a row opens nothing and asks nothing: the owner can only read it. A reply with several notes ends in a run of these rows. The owner, on 2026-10-13: "I want to get rid of those 'remember'. User don't need to know about it."

Two things reached the owner only through a row: a note saved but not pinned because the pinned set was full, or older notes that left the pinned set to make room ([ADR 015](015-the-server-records-who-said-a-note.md)); and how much a forget erased ("Forgot 2 notes", "Forgot what was said in 3 chats", [ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md)).

## Decision

- **A memory change that is done is not sent to the apps.** Of a bot's run, the `learned` items of the kinds `memory`, `memory-shared`, `memory-removed`, `memory-restored`, `memory-pin` and `forgot` are left out of every run, event and stream an app reads. Of a Chief reply, the `memory` actions of a done change are left out of its `actions` wherever a Chief message goes to an app, live and from the chat.
- **A change that waits for the owner is still sent:** a bot's `memory-pending`, and the Chief's chip "Asked to … (waiting for your OK)". It asks for an answer.
- **The filter is applied when the server sends, not when it stores.** The run's record, its log, the index of past runs and the Chief's chat file keep every item as before. Old runs and old replies lose their rows too, and an app of any version stops showing them without an update.
- **The bot's reply carries the signal.** The `say` of every memory tool that saves a note it could not pin, unpins notes to make room or forgets now tells the bot, or the Chief, to tell the owner. "So say which" became "Tell the owner which", and a forget's answer names its count with "Tell the owner that 2 notes were erased and 1 past run was left out."

### How a Chief action that waits is told apart

The chat file must stay as it was, so no marker is added to a stored action. The rule reads the text: a `memory` action is sent when its text begins with `Asked to ` and ends with `(waiting for your OK)`. Every waiting chip of the Chief has been written by `waitingChip` in that shape, and every done chip begins with what was done ("Remembered", "Noted", "Updated", "Removed", "Restored", "Forgot"), so a note's own text cannot make a done chip look like a waiting one. Replies stored before this decision are read by the same rule.

## Alternatives

- **Filter in each app.** Three changes, and an older app would keep the rows. The server decides once ([ADR 0001](0001-native-apps-per-platform.md)).
- **Stop recording the items.** The index, a bot's recall and the Chief's forget read them; the owner asked only not to see them.
- **Mark a waiting Chief action with a new field.** It changes what the chat file holds, and stored replies would need the text rule anyway.
- **Hide `memory-pending` too.** The owner chose to keep it: it asks for an answer.

## Consequences

- **Widened by [ADR 025](025-what-a-run-did-is-no-row-under-a-reply.md):** of a bot's run, only what waits for the owner is sent now, not only no done memory change.
- **Supersedes, in [ADR 017](017-the-chief-files-a-note-with-a-bot-in-the-owners-turns.md):** "The chip names the place", for a change that is done; "The chip is a stored line", for what an app is sent (the chat still stores it, and the index still keeps "Changed a note in memory"); and "A note filed with the wrong bot is seen on the chip only": it is seen in the Chief's reply, which names where it filed the note, or by asking.
- **Narrows [ADR 015](015-the-server-records-who-said-a-note.md) and [ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md):** their chips of a done change are still put together when a run is read (`learnedView`), and no app is sent them. Bringing the rows back is one filter.
- **The signal now depends on the model.** "Not pinned", "left the pinned set" and "Forgot N notes" reach the owner only when the bot or the Chief says them, as its `say` tells it to. The bot's instruction "When you learned something, say so in one short line at the end of your reply" stays.
- **The apps change little.** The web page drops its fallback words for `learned` items of the memory kinds that came without a chip. Android and the Mac app keep theirs: they can be connected to an older server, which still sends the items.
- **No feature is announced.** Apps receive fewer items; an older app keeps working.

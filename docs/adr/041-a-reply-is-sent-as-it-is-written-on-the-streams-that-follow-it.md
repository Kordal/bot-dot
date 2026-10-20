# ADR-041: A reply is sent as it is written, on the streams that follow it

- **Status:** Proposed
- **Owning task:** [#178](https://github.com/Kordal/bot-dot/issues/178)

## Context

While a bot works, its chat shows the working line and Stop, and the whole reply appears at once when the run ends. A long answer feels slow: on 2026-10-20 a Polish reply with a heading, a table and bold text took 55 s in a chat with "Infra Admin" on hq.botdot.app, and nothing of it showed until the end. The improvement report of 2026-10-09 ([bots that feel alive](../product/improvements/2026-10-09-bots-that-feel-alive.md), proposal 6) proposed streaming the reply.

Bots and the Chief run Claude Code as `-p --output-format stream-json --verbose`. Its stream says each message whole (`assistant`) and the reply at the end (`result`). With `--include-partial-messages` the pinned Claude Code (2.1.303, `Dockerfile`) also writes `stream_event` lines for the main session: `message_start`, `content_block_start` / `content_block_delta` (`text_delta`) / `content_block_stop`, `message_delta` with `stop_reason`, and `message_stop`. Nothing in botdot read them before.

Three things stand in the way of drawing that text as it comes:

- **The opening line** (`lib/opening-line.js`) is the text before a run's first tool call, and arrives as `text_delta`s first, before anyone knows a tool call follows.
- **Markers.** A reply's last lines can be `[[choices: …]]` or `[[ask: …]]` (`lib/choices.js`), which the apps draw as buttons or a card, never as text.
- **A pass in a group** ([ADR 019](019-the-botdot-server-gives-the-turns-in-a-group.md)) is decided at the run's end, and shows nothing.

The Chief does not use the run stream: it has its own `GET /api/chief/chats/:id/stream`. A group's chat follows no run stream: it learns a turn's lines from the account-wide feed.

The owner decided on 2026-10-20 (#178): real streaming, not a word-by-word reveal of a finished reply; in bot chats, the Chief's chats and group chats, on the web page and in the Android app (the Mac app stays stopped, [ADR 031](031-the-mac-app-is-stopped-again.md)); and a group turn that ends as a pass leaves no bubble. Triage chose the defaults of the rest, for the owner to change in the review of this ADR.

## Proposed decision

- **The server reads partial messages.** Bot runs and Chief turns start Claude Code with `--include-partial-messages`. One reader (`lib/reply-draft.js`) builds the draft from the `text_delta`s of the message being written, since its last tool call. Its `stream_event` lines go nowhere else: not through a run's `record()`, so not in its log or `events`, and not in the Chief's chat file. The draft is kept for the running run or turn only (`entry`, `turn`), as the opening line is.
- **Only the reply is shown.**
  - A tool call (`content_block_start` of a `tool_use` block) and a new message clear the draft.
  - One line of at most 120 characters (`openingLine.MAX`) is held while its message has not ended (`stop_reason: "end_turn"`): it may be the opening line. It is released once it is longer, breaks a line (with text after the break), or its message ends its turn.
  - The lines at the end that start with `[[`, and a last line that is a lone `[`, are held: no marker, or the beginning of one, ever shows. A draft whose message ended its turn is what `choicesLib.split` leaves of it: the reply as the run's end has it.
  - In a group, nothing is sent while the text could still be the pass word: only the signs `isPass` allows around it and a beginning of `pass`. A pass shows nothing.
- **One event, the whole draft:** `{ type: "reply_draft", text }`, carrying all of the draft so far after the hold-backs, not only what is new. `""` says a draft that was shown is gone. A client can draw any one event alone, and a replayed or missed one does no harm.
- **At most one draft every 200 ms per run.** The newest text waits for its turn and is sent then. A draft that still waits when the run ends is not sent: the end brings the reply.
- **On the two existing streams, to who follows them.** A bot's run and a turn in a group: `GET /api/runs/:runId/stream`, raw and `?simple`. The Chief: `GET /api/chief/chats/:id/stream`. A client that connects mid-reply gets the draft as sent last, once, after the replay and the run's lines (`openingLineOf`, `workingLineOf`, `chief.subscribe`). Never on the account-wide feed (`/api/events`).
- **A group's chat follows its turns' run streams** while it is open: the `runId` it already has from `group_run_started` and the chat's `working`. It closes each stream when its turn ends, and all of them when the chat closes. A turn's draft stands under the member's name in a pending bubble until its reply is among the chat's replies; a pass takes it away at once.
- **Announced in `features` as `reply-draft`.** An app shows drafts only when the server lists it. An older app ignores the event; against an older server an app behaves as before.
- **The apps draw the draft in place, with the reply's own Markdown,** in the row or bubble its reply will have, and the end replaces it with the reply drawn as without drafts. Before drawing, both apps apply the same hold-back rules, kept as the `stream` cases of `test/fixtures/markdown-cases.json` (`draftSource` in `public/app.js` and `Markdown.kt`): a code block not closed yet is drawn as code, a fence still being opened or closed waits, a table row whose line has not ended waits, a `mermaid` block is code until the reply is whole, and an unclosed `**` or `[` is text. The web page redraws at most once a frame.
- **No animation, so nothing for reduced motion.** The text is drawn again as it comes, as the working line is.

## Alternatives

- **A reveal of the finished reply**, word by word in the app, without partial messages. Rejected by the owner: it only looks faster, and the reply still waits for the whole run.
- **A feed event for groups** (`group_reply_draft` on `/api/events`). Rejected: a draft every 200 ms would go to every app of the account, for every turn, whether a group's chat is open or not. The run stream reaches only who looks.
- **Only the new text per event** (appended deltas). Rejected: a client must then see every event in order, a reconnect or a missed event breaks the text, and the hold-backs (a cleared draft, a held line, a marker) would need events that take text back. The whole draft is simple to draw and safe to replay; a reply is a few kilobytes.
- **A WebSocket.** Rejected: the two SSE streams that exist already reach the right clients, and nothing new is needed on the server, the front door or in the apps.
- **A line in `DECISIONS.md` only.** Rejected for this change: it adds a live protocol event and makes the server read partial model output, which the rule for an ADR covers.
- **Sending a draft that waits at the run's end** (one draft closer than 200 ms). Not chosen: the end carries the reply, which takes the draft's place at once.

## Consequences

- Streaming covers only the time the model spends writing its last text. Tool calls and thinking before it still show as the working line, so a run that is mostly tools gains little.
- Interim text longer than one line, before a tool call, shows as a draft and is taken away at that call. Bots are told to write the reply last, so it should be rare.
- A short reply (one line of at most 120 characters) shows only once its message ends, a moment before the run ends.
- The server depends on the `stream_event` shape of Claude Code. A later version could change it: the stand-in (`test/fixtures/fake-claude.js`) writes that shape, and a change shows as drafts that stop coming, never as a wrong reply, since the reply still comes from `result`.
- A run's log is the same size as before: partial lines are not logged.
- The web page and Android must keep the hold-back rules the same: the shared fixture is their test.
- The Mac app gets nothing (ADR 031).
- The owner's review of the pull request that implements this ADR is its acceptance gate: the ADR is drafted and built in one change, and set to Accepted before it is merged.

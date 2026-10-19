# Feature test: a group shows who is next

The owner's test list for the third change of "Bots that feel alive" (spec Kordal/bot-dot#329, report [2026-10-09](../../product/improvements/2026-10-09-bots-that-feel-alive.md)), ALV-007 (Kordal/bot-dot#336): in a group's chat the members whose turn has not come stand under the working lines as small still heads, in their colours and hats, in the order they will answer. Between two turns the place is not blank. The heads carry no words and no digits, and never move. They are gone when the last turn ended or you pressed "Stop all".

The botdot server already sent who is next with each of your messages in a group; the apps now draw it. One row of heads is shown: that of the message whose turns are running, and when none runs but turns remain, that of your newest message that still has members to come.

## Checked before the owner's test

- Android: the unit tests (`GroupNextTest` for the rule, `GroupWordsTest` for what a screen reader is told), lint and the debug build passed.
- Android: not walked on the emulator or on a phone before the owner's test.

## How to start it

A test botdot server with scratch data and one group of three bots that all answer (for example Coder, Reviewer and Writer, each with a different colour and hat), and the debug app built from this branch on the emulator or a phone, connected to that server. Questions with longer answers leave time to look: "Each of you: write five sentences about bread."

## Android

1. Open the group and send "Each of you: write five sentences about bread." While the first member works, its working line stands under the chat, and under that line two small heads: those of the second and the third member, in the group's order, each in its colour with its hat. They have no eyes, no names and no number beside them, and they do not move.
2. Watch the first reply arrive. In the moment between the first member's reply and the second member's line, the heads still stand: the place under the chat is not blank.
3. When the second member works, one head is left: the third member's. When the third member works, no head is left.
4. After the last reply the working line and the heads are gone.
5. Send "@Coder write one sentence about rain, then hand the work on to the Writer by naming it." While Coder works no head stands, since nobody else has a turn. When Coder's reply names Writer, Writer's head shows, and goes when Writer's turn starts.
6. Send a message for all three, and while the first member works send a second one. One row of heads stands, never two. It is the row of a message whose turns are running, and of the newer one when both run.
7. Send a message for all three and press "Stop all" while the first member works. The heads go with the working line, and none comes back.
8. Turn TalkBack on and send a message for all three. Moving to the heads reads "Next: Reviewer and Writer", with the names of the members to come.

## Failure cases to try

- Pause the third member (switch all its jobs off) while the first works. It gets no turn and leaves no reply; its head may stand until its turn would have come, and is gone then.
- Ask a member to pass ("Reviewer, answer only PASS."). After its turn its head is not among those to come, and no reply of it is drawn.
- Delete a member in another app while a message's turns run. Its head goes.
- Leave the group's chat while turns run and open it again: the heads are those of the members still to come, not those of the moment you left.
- Sign Claude out on the server and send a message to the group. It waits, with "Take back", and the heads of every member stand until the sign-in, since each still has its turn to come.
- Let a group reach the limit of replies. Under the line with "Go on" the heads of the members whose turn waits stand; after "Stop all" they are gone.

## What cannot be tested by hand

- Which row is shown when the chat holds only its newest messages and a turn of an older message is at work: none. Covered by `GroupNextTest`.
- A head for a bot the app has not read yet: none is drawn until the app knows its colour and hat. Covered by `GroupNextTest`.

## The web page

Checked before the owner's test: the page's tests of its group functions (`test/groups-web.test.js`, the same cases as `GroupNextTest`), `make lint` and `make test` passed. The page was not walked in a browser before the owner's test.

Open the same test botdot server in a browser, at desktop width and at a phone's width.

1. Open the group and send "Each of you: write five sentences about bread." While the first member works, its working line stands under the chat, and directly under that line two small heads: those of the second and the third member, in the group's order, each in its colour with its hat. The first head stands under the line's dot. They have no eyes, no names and no number beside them, and they do not move: only the line's dot pulses.
2. Watch the first reply arrive. In the moment between the first member's reply and the second member's line, the heads still stand: the place under the chat is not blank.
3. When the second member works, one head is left: the third member's. When the third member works, no head is left.
4. After the last reply the working line and the heads are gone.
5. Send "@Coder write one sentence about rain, then hand the work on to the Writer by naming it." While Coder works no head stands. When Coder's reply names Writer, Writer's head shows, and goes when Writer's turn starts.
6. Send a message for all three, and while the first member works send a second one. One row of heads stands, never two, under the working lines and above the faded message that waits with "Take back".
7. Send a message for all three and press "Stop all" while the first member works. The heads go with the working line, and none comes back.
8. Hover over the heads and click them: nothing happens, they are no control. With a screen reader (VoiceOver, or the browser's accessibility inspector on the row) the row reads "Next: Reviewer and Writer", with the names of the members to come.
9. Turn "Reduce motion" on in the system settings and send a message for all three: the heads look and stand the same.
10. Change a member's colour or hat by the Chief of Staff while its head stands among those to come: the head follows.

The failure cases above apply to the web page as they are written. One more: let a group reach the limit of replies, then reload the page: under the line with "Go on" the heads of the members whose turn waits stand again.

## Owner acceptance

Not tested by the owner yet.

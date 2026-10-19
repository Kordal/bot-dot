# Feature test: a reply arrives, visibly

The owner's test list for ALV-008 ([Kordal/bot-dot#337](https://github.com/Kordal/bot-dot/issues/337), from the spec [Kordal/bot-dot#329](https://github.com/Kordal/bot-dot/issues/329), report [2026-10-09](../../product/improvements/2026-10-09-bots-that-feel-alive.md)): a new reply fades in and rises into its place, once, as the working line goes, in a bot's chat, a Chief chat and a group. Your own message arrives the same way when you press Send. A reply that was there when the chat opened stands still, and nothing moves again when the app reads its lists again. With animations switched off nothing moves. The botdot server is not changed.

How the movement looks is yours to judge on screen: no test can say whether it feels right.

## Checked before the owner's test

- Android: the unit tests (`ArrivalsTest`: which replies are new, in a bot's chat, a Chief chat and a group; none on opening, on a refresh, on older messages; your own message once on Send and not again as the server's; nothing with animations off), lint and the debug build passed.
- Android: not walked on the emulator or on a phone before the owner's test. The movement itself was never seen.

## How to start it

A test botdot server with scratch data and at least two bots and one group, and the debug app built from this branch on the emulator or a phone, connected to that server. Each chat needs a few older replies, so that there is something that must stand still.

## Android

1. Open a bot that has older replies. The chat is there at once: no reply fades or moves.
2. Send "Write three sentences about bread." Your message fades in and rises a little into its place, at half strength, with "Working…" under it. A moment later it turns to full strength where it stands: it does not fade in or move a second time.
3. Wait for the reply. The working line goes and the reply fades in and rises into its place, in one movement, once. Your message above it and the older replies stand still.
4. Stay in the chat for a minute and send nothing. Nothing moves again, also when the bot's row or the lists change behind it.
5. Scroll up until the reply is off the screen, then back down. It stands: it does not arrive a second time.
6. In a chat with many replies, scroll up until older messages are loaded. They are there without fading or moving.
7. Leave the chat and open it again. Everything stands, the newest reply too.
8. Turn the phone while a chat is open. Nothing fades or moves.
9. Send a message and press Stop on the working line. The line that says it was stopped arrives as a reply does.
10. Open the Chief of Staff, press the plus and send a first message. Your message arrives once, and the Chief's reply arrives once when it is written. Send a second message in the same chat: the same.
11. Open a group and send a message. Your message arrives once. Each member's reply arrives once, as it comes, under its bot's name; the replies before it stand still.
12. Keep a bot's chat open and let one of its scheduled jobs run, or send it a message from the web page. The reply arrives here once, as one you asked for in this app does.

## With animations off

In Android's settings switch animations off (Accessibility, "Remove animations"; or in the developer options set "Animator duration scale" to "Animation off"), close the app from the recent apps and open it again.

1. Do steps 2, 3, 10 and 11 again. Your message and every reply are there at once, in their place, with no fading and no movement. The heads stand still too, as before.
2. Switch animations on again and open the app again: the movement is back.

## What cannot be tested by hand

- That a reply read again from the botdot server, with the same id, is never taken as new: `ArrivalsTest`.
- That a chat read from scratch after many replies came at once (more than one look brings) moves nothing: `ArrivalsTest`.

## The web page

The same rule as on Android, on the web page: a reply whose id was not drawn before in the open chat fades in and rises about 10 pixels into its place, once, in about a quarter of a second. Your own message arrives the same way when you press Send.

### Checked before the owner's test

- The page's tests passed (`test/reply-arrives-web.test.js`, and the group's in `test/groups-web.test.js`): which replies are new, in a bot's chat, a Chief chat and a group; none on opening, on a refresh, when the chat's markup is built again, on older messages, or in a chat that is not on screen; your own message once on Send and not again as the server's; the stylesheet's movement, and that it is off with reduced motion.
- Walked once in a headless browser against a test botdot server with the stand-in Claude: a bot's chat, a Chief chat, a new Chief chat and a group. Each reply moved once and its mark was gone after the movement. Nothing moved on opening a chat, on reading the lists again, on building the chat again, or on coming back from another page. With reduced motion asked for nothing moved and no row was marked.
- Seen in that walk: the test server answers a Send at once, so your own bubble gave way to the server's message before its movement could be seen. Against a server that takes a moment to answer, it is seen. Nobody looked at the movement with their own eyes.

### How to start it

The same test botdot server, open in a browser. Do the steps once in a wide window and once in a narrow one (a phone's width).

### Steps

1. Open a bot that has older replies. The chat is there at once: no reply fades or moves.
2. Send "Write three sentences about bread." Your message fades in and rises a little into its place, at half strength, with "Working" under it. When botdot has taken it, it stands at full strength where it stood: it does not fade in or move a second time.
3. Wait for the reply. The working line goes and the reply fades in and rises into its place, once. Your message above it and the older replies stand still.
4. Stay in the chat for a minute and send nothing. Nothing moves again, also when the bot's row in the list changes.
5. Reload the page. Everything stands, the newest reply too.
6. Open another bot, then come back. Nothing moves. Open Settings, then come back: nothing moves.
7. Send a message and press Stop on the working line. The line that says it was stopped arrives as a reply does.
8. Send a message to a bot that is working. Your message arrives once at the end, under the messages that wait, and does not move again while it waits.
9. Open the Chief of Staff, press the plus and send a first message. Your message arrives once, and the Chief's reply arrives once when it is written. Send a second message in the same chat: the same.
10. Open an older Chief chat from its settings. Nothing moves.
11. Open a group and send a message. Your message arrives once. Each member's reply arrives once, as it comes, under its bot's name with its head beside it; the replies before it stand still.
12. In a group with "Earlier messages", press it. The older messages are there without fading or moving.
13. Keep a bot's chat open and let one of its scheduled jobs run, or send it a message from the phone. The reply arrives here once. Your message from the phone is there without movement.
14. In the narrow window, go back to the list while a bot works, wait for its reply, then open its chat. The reply stands: it does not arrive when the chat opens.

### With reduced motion

Switch reduced motion on in the system's settings (on a Mac: Accessibility, Display, "Reduce motion"; on Windows: Accessibility, Visual effects, "Animation effects" off). The page follows without a reload.

1. Do steps 2, 3, 9 and 11 again. Your message and every reply are there at once, in their place, with no fading and no movement.
2. Switch reduced motion off again: the next reply moves, and none of those that came meanwhile does.

### What cannot be tested by hand

- That a reply drawn again with the same id, in markup that was built again, is never taken as new: `test/reply-arrives-web.test.js`.
- That a chat read from scratch after many replies came at once moves nothing: the same tests.

## Owner acceptance

Not tested by the owner yet.

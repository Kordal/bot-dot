# Feature test: the sent message is there at once

The owner's test list for the first change of "Bots that feel alive" (spec Kordal/bot-dot#329, report [2026-10-09](improvements/2026-10-09-bots-that-feel-alive.md)): your message is in the chat the moment you press Send, drawn as a waiting message is, with "Working…" under it, in a bot's chat, a Chief chat and a group. When the botdot server answers, its version takes the place of yours. A message that did not go is back in the message box, as before.

The Android steps are ALV-006 (Kordal/bot-dot#335). The web page's steps are ALV-005 (Kordal/bot-dot#334), which adds them below.

## Checked before the owner's test

- Android: the unit tests (`SentAtOnceTest` with `FailedSendTest` and `MessageWaitsTest`), lint and the debug build passed.
- Android: not walked on the emulator or on a phone before the owner's test.

## How to start it

A test botdot server with scratch data and at least two bots and one group, and the debug app built from this branch on the emulator or a phone, connected to that server. A slow connection makes the change easy to see: on the emulator, set the network to "EDGE" or "GPRS" in its extended controls (Cellular, Network type).

## Android

Do each step on the slow connection first, then on a fast one.

1. Open a bot that is free and send "Write three sentences about bread." Your message is in the chat at once, a little faded, and under it stands one line, "Working…". The message box is empty.
2. A moment later the message turns to full strength, where it stood, and the line goes on with Stop beside it. The message is there once, never twice.
3. Attach a file, write a few words and send. The file's chip shows on the faded message at once, and stays on it when it turns to full strength.
4. While that bot still works, send a second message. It shows at once, faded, at the end of the chat. A moment later it reads "Waits until <bot> is free" with "Take back", as a waiting message always did. Take it back: it is in the message box again.
5. Open a bot whose last reply ends with quick answers (ask one "Do you want A or B? Give me the two as quick answers."). Tap an answer: it shows at once as your message, faded, with "Working…" under it, as a typed message does.
6. Open the Chief of Staff, press the plus for a new chat and send a first message. The heading and the suggestions give way to your message at once, with "Working…" under it. When the server answers, the line reads "Thinking…" and has Stop.
7. While the Chief replies, send another message. It shows at once at the end of the chat, then reads "Waits until the Chief is free" with "Take back".
8. Open a group whose members are free and send a message. It shows at once, faded, with "Working…" under it. Then the line of the member at work takes its place, with its name, and your message is at full strength, once.
9. In a group that stopped at the limit of replies, type "Go on" and send. Nothing is drawn for it: the group goes on, as before.

## Failure cases to try

- Switch the phone to flight mode and send a message to a bot. It shows at once; when the send gives up, it leaves the chat and is back in the message box with its files, and the line above the box says "Not sent: can't reach botdot. Your message is still here." Switch the network on and press Send again: it goes, and the chat has it once.
- Do the same with a quick answer: it leaves the chat, the answers stay to be tapped again, and the message box stays empty.
- Send a message, and leave the chat before the server answered. Open it again: the message is there, faded while it is still on its way, or at full strength once it went.
- Pause a bot in another app and send it a message: it leaves the chat, and the line above the box has the server's sentence.

## What cannot be tested by hand

- The server's message reaching the app through the live feed before the request answers, or the answer being lost: the message is still drawn once. Covered by `SentAtOnceTest`.
- The same message sent twice with one key: the botdot server takes it once, and the chat keeps one. Covered by `SentAtOnceTest` and by the server's tests of a message's key.

## The web page

The web page's steps of ALV-005 (Kordal/bot-dot#334).

### Checked before the owner's test

- `make lint` and `make test` passed on the working tree of this ticket.
- `test/sent-at-once-web.test.js`: the page's own senders, message box, waiting messages and working line against stand-in elements, with the server's answer held back. In a bot's chat and a Chief chat the message and "Working" are there before the answer, with the files; the answer's run, waiting message or Chief message takes their place, once; a failed send leaves nothing in the chat and the box as before; a quick answer behaves as a typed message; a bot's chat draws the answer before any list is read again.
- `test/groups-web.test.js`: the same in a group, with one plain "Working", and nothing drawn for a typed "Go on" in a stopped group.
- Walked once in a headless browser against a test server with a stand-in Claude and a slowed request: a bot's chat, a working bot, a send that failed, a new Chief chat and a group showed the rows below in this order. No bot answered for real and nobody looked at the screen: how the faded message looks is for the owner's test.

### How to start it

A test botdot server with scratch data, on this Mac, from this branch, with at least two bots and one group:

`PORT=4801 HOST=0.0.0.0 BOT_DOT_DATA=<scratch folder> node server.js`, then open http://localhost:4801. It uses this Mac's Claude sign-in, so bots answer for real.

A slow connection makes the change easy to see: in the browser's developer tools, under Network, choose "Slow 4G" or "3G".

### Steps

Do each step on the slow connection first, then on a fast one.

1. Open a bot that is free and send "Write three sentences about bread." Your message is in the chat at once, a little faded, and under it stands one line, "Working…", without Stop. The message box is empty.
2. A moment later the message turns to full strength, where it stood, and the line has Stop beside it. The message is there once, never twice.
3. In a bot with no message yet, send a first message: the bot's large head and its description give way to your message at once.
4. Attach a file, write a few words and send. The file's chip shows on the faded message at once, and stays on it when it turns to full strength.
5. While that bot still works, send a second message. It shows at once, faded, at the end of the chat under the line. A moment later it reads "Waits until <bot> is free" with "Take back", as a waiting message always did. Take it back: it is in the message box again.
6. Open a bot whose last reply ends with quick answers (ask one "Do you want A or B? Give me the two as quick answers."). Click an answer: it shows at once as your message, faded, with "Working…" under it, as a typed message does.
7. Open the Chief of Staff, start a new chat and send a first message, or click one of the suggestions. The heading and the suggestions give way to your message at once, with "Working…" under it and no Stop. When the server answers, the line reads "Thinking…" and has Stop.
8. While the Chief replies, send another message. It shows at once at the end of the chat, then reads "Waits until the Chief is free" with "Take back".
9. Open a group whose members are free and send a message. It shows at once, faded, with one "Working…" under it, without a name. Then the line of the member at work takes its place, with its name and "Stop all", and your message is at full strength, once.
10. In a group that stopped at the limit of replies, type "Go on" and send. Nothing is drawn for it: the group goes on, as before.

### Failure cases to try

- Stop the test server (Ctrl+C) and send a message to a bot. It shows at once; when the send gives up, it leaves the chat and is back in the message box with its files, and the line above the box says "Not sent: can't reach botdot. Your message is still here." Start the server again and press Send: it goes, and the chat has it once.
- Do the same with a quick answer: it leaves the chat, the answers stay to be clicked again, and the message box stays empty.
- Do the same with the first message of a new Chief chat: the heading and the suggestions are back as they were.
- Send a message on the slow connection and open another bot before the server answered. That bot's chat does not show it. Open the first bot again: the message is there, faded while it is still on its way, or at full strength once it went.

### What cannot be tested by hand

- The server's message reaching the page through the live feed before the request answers: the message is still drawn once. Covered by `test/sent-at-once-web.test.js` and `test/groups-web.test.js`.
- An answer that was lost and the same message sent again with its key: the botdot server takes it once, and the chat never shows a second one. Covered by `test/sent-at-once-web.test.js` and by the server's tests of a message's key.

## Owner acceptance

Not tested by the owner yet.

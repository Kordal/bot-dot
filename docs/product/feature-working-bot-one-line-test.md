# Feature test: a working bot is one line with Stop

Test document of the standalone feature MSG-013 (plan): a working bot's chat shows no step bubble and no Details, only the status line with Stop.

## Checked before the owner's test

- `pr-check` and `premerge-check` (Android build, tests and lint; Mac build and tests) passed on `eef407d`.
- The Flow was walked on the web page against the test server: "Working…" with Stop, then the bot's opening line with Stop, no bubble; the reply with Details when the run ended; Stop ended a run ("You stopped this run before it finished").
- Android, on the emulator: a running run shows "Working…" under the owner's message with no bubble, and the message box's Stop ended it.
- The Mac test build was built and started against the test server; its Flow was not walked before the owner's test.

## How to start it

It is running on this Mac, from branch `task/msg-013`:

- **Web:** http://localhost:4801. A test botdot server with scratch data: six bots. It uses this Mac's Claude sign-in, so bots answer for real.
- **Android:** the emulator (Medium_Phone), with the debug app built from this branch, connected to that server.
- **Mac:** a Debug build with its own bundle identifier (`dev.botdot.mac.m2test`), connected to that server. The installed botdot app is untouched.

To start it again, in the repository: `PORT=4801 HOST=0.0.0.0 BOT_DOT_ALLOWED_HOSTS=10.0.2.2 BOT_DOT_DATA=<scratch folder> node server.js`; `adb reverse tcp:4801 tcp:4801`; `open -n macos/build/m2test/Build/Products/Debug/botdot.app --args -botdot.server http://localhost:4801`.

## Checklist

Do each step on the web page, then on Android and the Mac.

1. Open **Cook** and send: "Write a 2000-word essay about the history of bread." Under your message there is one line, "Working…", with a pulsing dot. On the web page and the Mac a faint **Stop** follows it. There is no bubble, no step list and no Details.
2. Press **Stop** (on Android: the stop button of the message box). The line goes and the run shows as stopped.
3. Open **Fleet Doctor** and send: "Check your notes for what you know about my disk, then answer in one sentence." The line starts as "Working…" and changes to what the bot says it is about to do; Stop stays beside it.
4. When the reply arrives, the line and Stop go. The reply has its time and **Details**, and Details still lists the steps.
5. The bot's row in the list shows the same line as its preview while it works, as before.
6. Open the **Chief of Staff** and ask it anything: its chat is unchanged ("Thinking…" bubble, no Stop on its line).

## Failure cases to try

- Stop the test server (or switch off the network) while a bot works and press Stop on the web page: a message says the server can't be reached, and the chat stays as it is.
- Press Stop at the moment the reply arrives: nothing breaks; the reply shows.

## What cannot be tested by hand

- A server older than the opening line: the line then says "Working…" for the whole run. Covered by unit tests.
- A file attached mid-run showing at once without a bubble: needs a bot that sends a file during a long run. Covered by the web test and by the Mac's `FilesTests`.

## Owner acceptance

On 2026-10-02 the owner tested the feature on the test server and said it passes. Tested commit: `eef407d` (the commits after it change documents only).

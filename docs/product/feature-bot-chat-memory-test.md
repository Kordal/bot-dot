# Feature test: a bot remembers its chat

Test document of the feature "a bot remembers its chat" ([its record](milestone7.md#added-features)), written by its one task, CHAT-001. Nothing changes on the web page or in the Android app: what changes is what a bot is handed when you write to it, so the test is what the bot answers.

## Review

The feature is one task, so its review is the task's: the `kordal-task-reviewer` agent (Claude Opus 5.5), both axes, on `d47459b`; four medium and three low findings, six fixed in `78a8491` and one rejected, as the plan's Review section records. The task gate (1:58), the full gate (0:08) and the resilience gate (1:19) passed on `eab9f72`.

### What cannot be relied on

- **An answer is recognized by its words.** A message that equals an offered answer, typed or tapped, counts as that answer, while its buttons are the newest thing in the chat. Buttons that a newer reply has replaced answer nothing: their words arrive as an ordinary message.
- **That the bot reads a run in full before it explains it** rests on its instructions. It is handed the run's number and told to; nothing forces it.
- **The numbers are fixed:** your last 4 exchanges and the last 2 that someone else started, 7 days, the newest reply whole up to 20,000 characters, older ones cut at 1,500. A bot with long replies gets a longer prompt for every message.
- **The chat is looked for in the bot's newest 200 runs.** A bot whose job reports nothing every few minutes can push a chat of days ago out of them; it is then found with the bot's own search of its memory.
- **A run you excluded from memory** is not in the chat the bot is handed, and its buttons answer nothing.
- **A scheduled job's run and a run a teammate started** get no chat, as before.

## How to start it

It is running on this Mac, from branch `task/chat-001`:

- **The botdot server:** a test server with its own data folder (`.test-data`, given as a full path), started by the agent: http://localhost:4801. It uses the Claude sign-in of this Mac. It has one bot, Poem Writer, with the three exchanges of the walk below.
- **Android:** not needed. The app is unchanged; any build that reaches the server shows the same chat.
- For a phone on the tailnet, say "serve" and the agent starts Tailscale Serve for port 4801.

## What was walked before handing over

On 2026-10-06, on the test server, with real Claude:

- Poem Writer was asked for a four-line poem about a heron. It wrote one and asked "Translate it into Polish?" with the buttons Yes and No.
- "Yes" was sent, the words of the button. The run kept which run it answers, and the bot translated that poem, line for line.
- "Which of your runs wrote the English poem, and when? Quote its third line exactly." It named the run by its number and time and quoted the line exactly.

## Checklist

Open http://localhost:4801 and Poem Writer's chat.

| # | Do | You should see |
| --- | --- | --- |
| 1 | Ask: "A limerick about a cat, please." | A limerick, a question whether to translate it, and the buttons Yes and No |
| 2 | Tap **Yes** | The translation of that limerick, not a question what "Yes" means |
| 3 | Ask: "Write a long story about a lighthouse, at least 600 words." Then: "Make the last paragraph happier and give me the whole story again." | The same story, word for word, up to its last paragraph, which is changed. Before this feature the bot saw only the first quarter of it |
| 4 | Ask: "Why did you end it that way?" | An answer about that story, naming what it wrote |
| 5 | Ask: "Write a haiku about rain." While it works, send: "And one about snow." | The second message waits, faded, and starts by itself. Its reply is a haiku about snow, in the form of the first |
| 6 | In a Chief of Staff chat: "Ask Poem Writer for a couplet about tea." When it is done, in Poem Writer's chat: "Who asked you for the couplet?" | It says the Chief of Staff asked, for you. Before this feature it said you did |

## Failure cases to try

| # | Do | You should see |
| --- | --- | --- |
| F1 | After a reply with buttons, type "yes" yourself, in small letters | The same as a tap |
| F2 | After a reply with buttons, send another question first. When it is answered, type "Yes" | The bot treats "Yes" as a new message about the newest reply: the old buttons are gone |
| F3 | Ask for a poem, and press Stop while it works. Then: "What happened to my last request?" | It says you stopped it |
| F4 | Restart is the agent's: say "restart" while a message waits behind a working bot | After the restart the waiting message starts, once, and the bot still knows what it answers |

## What cannot be tested by hand

- That quiet runs of a job no longer push your chat out needs a job that runs many times with nothing to report: `test/chat-history.test.js` covers it with ten such runs.
- That a teammate's text cannot pass for yours inside the chat the bot is handed is not visible in any app: the same test file covers it.
- The cuts at 1,500 and 20,000 characters: the same.

## Owner's acceptance

On 2026-10-06 the owner tested the feature on the test server above, with real Claude, at runtime commit `eab9f72` (the commits after it change documentation only), and answered: "Passes". No change was asked for.

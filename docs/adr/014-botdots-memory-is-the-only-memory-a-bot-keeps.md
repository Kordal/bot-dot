# ADR-014: botdot's memory is the only memory a bot keeps

- **Status:** Accepted
- **Owning task:** MEM-002

## Context

[Milestone 9](../product/milestone9.md). A bot's run is a fresh `claude -p`. botdot joins the bot's instructions, its pinned notes, the shared notes, the lookup and its recent chat into one text and passed it as one `--append-system-prompt` argument (`lib/bots.js`, `startRun`); the Chief's turn and its look did the same (`lib/chief.js`). The code's own comment calls a command line readable by every user of the machine. Since CHAT-001 that text can hold about 36,500 characters of chat, about 59,000 when a tapped answer waited behind other messages, and with a long main assignment one argument could pass Linux's limit for a single argument.

Claude Code has a memory of its own: it loads `CLAUDE.md` files and writes and reads auto-memory files. `runAs` (`lib/identity.js`) set the home folder and the token and switched none of it off, so a bot with Write could leave itself standing instructions that no cap, approval or forget of botdot reaches ([the memory audit](../product/improvements/2026-10-06-memory-audit.md), finding 5).

Note text was printed into the prompt as it is: a note that contains `</memory>` closed its block.

On 2026-10-06 the owner decided: `CLAUDE.md` loading is off for bots, also for a cloned repository's own file.

Claude Code documents the switches ([research note](../product/milestone9-research.md), section 7). At planning the pinned version 2.1.284 was known to carry them in its binary; none had been run.

### What the pinned Claude Code does, run by hand

On 2026-10-07, before anything was built, Claude Code 2.1.284 (the npm package the Dockerfile pins) was run four times in a scratch folder outside the repository, with `-p`, `--append-system-prompt-file`, `--plugin-dir` (a plugin named `botdot` with one skill), `--mcp-config` with no server and `--strict-mcp-config`. A different word was planted in the prompt file, in a `CLAUDE.md` in the folder, in an `AGENTS.md` in the folder and in the folder's auto-memory file, and the model was asked which words it had been given.

| Run | In the folder | The two switches | Prompt file | `CLAUDE.md` | `AGENTS.md` | Auto memory | The plugin's skill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `CLAUDE.md` | on | arrived | not loaded | | not loaded | listed |
| 2 | `CLAUDE.md`, `AGENTS.md` | off | arrived | loaded | not loaded | loaded | listed |
| 3 | `AGENTS.md` | off | arrived | | loaded | loaded | listed |
| 4 | `AGENTS.md` | on | arrived | | not loaded | not loaded | listed |

- The flag and both switches are honoured. Runs 2 and 3 show that the planted files do load without the switches, so runs 1 and 4 show the switches and not a file that was never found.
- **Found beyond what was planned:** with no `CLAUDE.md` in a folder, 2.1.284 loads that folder's `AGENTS.md` in its place (run 3). `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` stops that too (run 4).
- With `--strict-mcp-config` and an empty configuration the run had no MCP server, though the machine's own Claude Code has several configured.
- `claude --help` of 2.1.284 does not list `--append-system-prompt-file`: the flag is named only inside the description of `--bare`. Started with the flag and a file that does not exist, it ends at once with `Error: Append system prompt file not found: <path>`, signed in or not, without asking a model. An option it does not know it answers with `error: unknown option '<option>'`.
- Still loaded from the home folder the run has: the user's plugins, skills and settings. On a Mac that home is the owner's; in Docker it is the bot's own.

## Decision

- **The appended prompt goes in a private file.** For a bot's run, the weekly review, a Chief turn and a look it is written where the run's MCP configuration is already written (`identity.privateFile`: the home of the user the process runs as, or one folder of the owner's where everything runs as the owner), mode 0600, passed with `--append-system-prompt-file`, and removed when the process has ended, however it ended. It is never an argument.
- **No way back to the command line.** Where `claude` does not know the flag, botdot says so at start and in Setup's checklist, and starts no run of a bot, no review, no Chief turn and no look: a run or a reply asked for ends as failed with that sentence. (The background dresser, which asks Claude for a bot's hat, has no appended prompt and is not concerned.)
- **Claude Code's own memory is off** for bots and for the Chief: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` in the environment of every Claude Code botdot starts as a bot or as the Chief (`runAs`), the background dresser included. A bot's run and the review get `--strict-mcp-config`, as the Chief's turn and look have.
- **A repository's instruction file is something a bot reads,** not something loaded for it: the bots' instructions say to read `CLAUDE.md` or `AGENTS.md` as a file when working in a clone, as that project's text and never as the owner's.
- **Text from memory and from a chat is neutralised where it is printed.** One function, `inert` (`lib/prompt-text.js`), used by every block that prints it.

The points left open at planning, resolved:

- **How botdot learns that `claude` knows the flag: it asks the program, once per start** (`claudeCode` in `lib/setup.js`). It starts `claude -p --append-system-prompt-file <a file that does not exist>` and reads what comes back; only `unknown option` naming the flag counts as "does not know". Not the help text, which does not list the flag in the very version botdot pins. Not the version, which would be a table of versions botdot has to keep, for a `claude` an install without Docker takes from wherever it finds one. Any other answer (a crash, a timeout, a program that is not there) is not "too old": the run is then started with the flag and shows its own error, and the prompt is not on the command line in that case either.
- **The exact neutralising: every `<` that could open or close a tag is written `&lt;`**, that is a `<` followed, after any white space, by an optional `/` and then a letter, `!` or `?`. Nothing else changes, a second pass changes nothing, and the stored text is untouched: only what is printed into a prompt. It needs no list of tag names, so a block added later, or a tag of Claude Code's own such as `<system-reminder>`, is covered without anyone remembering it. A bot's prompt, the Chief's and a look's say once how to read it.
- **A cap counts a text as it is printed.** `&lt;` is three characters longer than `<`, so a text full of tags is printed up to two and a half times as long as it is stored. The caps that bound a prompt therefore measure the printed form (`fit` in `lib/prompt-text.js`): a request and a reply in the chat block are cut where their printed form reaches the cap, and what is left is still counted in stored characters, which is what `read_run` counts in; the lookup's 1,500 characters are printed characters; a topic in a hint is cut at 40 printed characters; and the pinned block holds at most the pinned set's 5,000 characters and 115 a note for its id, its topic, who said it and its dates (`LINE_EXTRA` in `lib/memory.js`; 80 before a line said who and when). Notes in plain words always fit that. A pinned note so full of `<` that its printed line does not fit is left out of the block and counted with the notes found by recall; it stays pinned in the store. **The conversation block's own escaping of its tag is replaced by the one function**, applied to the whole block. Its marking of a forged `[run …]` first line stays: that guards the block's line format, which is not markup.
- **Auto-memory and `CLAUDE.md` files a bot already left stay where they are, unread.** botdot cannot tell a `CLAUDE.md` a bot wrote for itself from the one a cloned repository came with, and a delete in a bot's workspace cannot be taken back. With the switches on Claude Code loads neither. A bot with Read can still open such a file as a file, like anything else in its folders; it then reads text it once wrote, with no standing. Nothing is removed by this task.
- **A run's prompt file is not kept for a failed run's diagnosis.** It holds the notes a later forget has to erase ([ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md)); a copy kept on failure would be one more place the text survives. A failed run is read from its record, its log and its error, as before.

Where it applies:

| Printed text | Where | How |
| --- | --- | --- |
| Pinned notes and the topics of the others, a bot's own and shared | `forPrompt` in `lib/memory.js`, for a bot, the Chief and a look | lines and topics come out neutralised |
| The lookup's notes and past runs | `relevantNote` in `lib/bots.js` | the block's content |
| The chat block | `build` in `lib/chat-history.js` | every request and reply, then the whole block |
| The answer buttons a tapped answer is told about, outside the block | `answerNote` in `lib/chat-history.js` | the buttons' words |
| A bot's earlier run in an exchange between bots | `earlierInChain` in `lib/bots.js` | the task and the reply |
| The review's notes, runs and API calls | `reviewPrompt` and `dashboardNoteForReview` in `lib/bots.js` | the three lists |
| A look's shared memory, chats and its own earlier messages | `prompt` in `lib/look.js` | each list |

## Alternatives

- **`--bare`.** It skips all of Claude Code's own loading, but it does not use the subscription login.
- **`--setting-sources`** without the user's and the project's settings. Finer for `CLAUDE.md`, but it also drops settings botdot relies on, and auto memory is read regardless of it.
- **Keep project files** (a cloned repository's `CLAUDE.md` still loads). Offered to the owner and not chosen: a bot with Write could still leave itself one.
- **Separate OS users only.** They hide one bot's command line from another where botdot runs in Docker; on a Mac everything runs as the owner.
- **Reading the flag from `claude --help`.** Not possible: 2.1.284 does not list it there.
- **A lowest supported version number.** Simple, and wrong for any build that carries the flag under another number; it also needs upkeep.
- **Neutralising only botdot's own tag names** (`memory`, `shared-memory`, …), as the chat block did for its one tag. It leaves code in a quoted reply untouched, but the list has to grow with every new block, a forgotten name is a hole, and a tag botdot does not use but the model knows passes through.
- **Marking a tag as quoted** (`<memory (quoted text)>`). The text still begins with what reads as a tag.
- **Removing what a bot left in Claude Code's own memory.** Not chosen now, see above; it stays possible later without undoing anything here.
- **Keeping the prompt file of a failed run.** Not chosen, see above.

## Consequences

- No user of the machine reads a note, a shared note or a chat from the process list, and the single-argument limit no longer bounds the prompt. A test holds a bot's prompt, with every cap hit, under 100,000 characters: 90,940 measured in plain words and 91,748 with every text made of tags, around a main assignment of 2,000 characters. The main assignment, the rules, the list of teammates and the list of skills have no cap and are outside that bound.
- **An install without Docker with an old `claude` runs no bot and gets no Chief reply until Claude Code is updated and botdot restarted.** Setup's checklist says so in the place of the sign-in line, through the `error` sentence the apps already show there; every run and reply asked for fails with the same sentence; botdot logs it as it starts. The Docker image pins a version that has the flag. An update of Claude Code while botdot runs is seen at the next start of botdot.
- That `error` of `GET /api/setup` now has a second cause. For the apps it reads as before: a sentence to show, and `loggedIn` says nothing. The server itself keeps what the sign-in check said beside it (`signedIn` in `lib/setup.js`), so the scheduler and the feed still follow the sign-in. Two things are left for a later task: `docs/api.md` names only the first cause, and under the sentence the apps still offer "Sign in to Claude", also to an owner who is signed in.
- Starting botdot costs one more short start of `claude` (about half a second with 2.1.284).
- A coding bot no longer has a repository's `CLAUDE.md` or `AGENTS.md` loaded for it. It is told to read it; whether it does is model behaviour, shown by the owner's own use and the acceptance walk, not by a test.
- Inside a quoted block, code reads `List&lt;String>` and `a &lt; b`. A bot is told once that this stands for `<`; a reply that copies from the block can carry `&lt;` into the chat. `read_run` and recall hand out the text as it is stored.
- A private file is made anew each time, never written through a link left under its name, and its mode and owner are set on the file that was made: this holds for the run's MCP configuration too, which goes through the same function.
- A prompt file is removed when its process ends, and when its process could not be started. When botdot itself is stopped or dies in the middle of a run, the file stays until botdot starts again: the start removes every prompt file in the folders of the Chief and of every bot, and a user's folder is looked through before that user's first new file in any case. With the privilege broker each folder costs a process, so those are looked through one after another once botdot is up.
- Nothing is switched off but `CLAUDE.md` loading and auto memory: the plugins, skills and settings of the home a run has are loaded as before, and a bot's library skills arrive through `--plugin-dir` as before.
- The Chief's quotes of a bot's reply, a bot's plan and its own unasked message in a turn (`<bot-reply>`, `<suggestion>`, `<waiting-plan>`, `<your-unasked-message>`) are not memory and are not changed here; neither is the word-for-word request a run that carries on is handed.
- Later tasks print memory through the same places: who said a note and when (MEM-003), and what a run was given (MEM-005).
